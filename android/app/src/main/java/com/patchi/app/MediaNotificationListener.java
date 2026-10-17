package com.patchi.app;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.os.PowerManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaNotificationListener extends NotificationListenerService {
    private static final String TAG = "DigiPatchMedia";
    public static JSONObject cachedCurrentTrack = null;
    private static String lastBroadcastKey = "";
    private static long lastBroadcastTimeMs = 0;
    private static final long REBROADCAST_INTERVAL_MS = 45_000;
    private static final ExecutorService executor = Executors.newFixedThreadPool(2);
    private static PowerManager.WakeLock wakeLock;

    private static Bitmap lastOriginalBitmap = null;
    private static String lastTitle = "";
    private static String lastArtist = "";
    private static String lastAlbum = "";
    private static int lastPosSec = 0;
    private static int lastDurSec = 0;
    private static boolean lastIsPlaying = true;
    public static MediaController activeMediaController = null;

    private static MediaSessionManager msm;
    private static final List<MediaController> registeredControllers = new ArrayList<>();
    private static Context instanceContext = null;

    public static class PlaybackProgress {
        public int positionSec = 0;
        public int durationSec = 0;
        public boolean isPlaying = false;
    }

    public static PlaybackProgress extractProgress(MediaController mc) {
        PlaybackProgress p = new PlaybackProgress();
        if (mc == null) return p;
        try {
            PlaybackState ps = mc.getPlaybackState();
            if (ps != null) {
                p.isPlaying = (ps.getState() == PlaybackState.STATE_PLAYING);
                long pos = ps.getPosition();
                long updateTime = ps.getLastPositionUpdateTime();
                float speed = ps.getPlaybackSpeed();
                if (p.isPlaying && updateTime > 0) {
                    long delta = android.os.SystemClock.elapsedRealtime() - updateTime;
                    if (delta > 0 && delta < 86400000L) {
                        pos += (long) (delta * (speed > 0 ? speed : 1.0f));
                    }
                }
                p.positionSec = (int) Math.max(0, pos / 1000);
            }
            MediaMetadata mm = mc.getMetadata();
            if (mm != null) {
                long dur = mm.getLong(MediaMetadata.METADATA_KEY_DURATION);
                if (dur > 0) {
                    p.durationSec = (int) (dur / 1000);
                }
            }
        } catch (Exception ignored) {}
        return p;
    }

    public static MediaController getActiveMediaController() {
        return activeMediaController;
    }

    public static Context getEffectiveContext() {
        if (instanceContext != null) return instanceContext;
        if (KeepAliveService.getInstance() != null) return KeepAliveService.getInstance().getApplicationContext();
        if (MainActivity.getInstance() != null) return MainActivity.getInstance().getApplicationContext();
        return null;
    }

    private static final MediaController.Callback controllerCallback = new MediaController.Callback() {
        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            Log.d(TAG, "MediaController onMetadataChanged fired in background!");
            Context ctx = getEffectiveContext();
            if (ctx != null) {
                acquireWakeLock(ctx, 25000);
                if (metadata != null) {
                    processAndBroadcastMetadata(ctx, metadata);
                } else {
                    rescanActiveSessions(ctx);
                }
            }
        }

        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            Log.d(TAG, "MediaController onPlaybackStateChanged state=" + (state != null ? state.getState() : "null"));
            Context ctx = getEffectiveContext();
            if (ctx == null) return;
            acquireWakeLock(ctx, 10000);

            // Fast, non-blocking progress extraction for all states (playing, paused, seeking, etc.)
            // NEVER call rescanActiveSessions or queryItunesSearch here to prevent thread starvation and hijacking.
            MediaController mc = activeMediaController;
            if (mc != null) {
                PlaybackProgress prog = extractProgress(mc);
                lastPosSec = prog.positionSec;
                lastDurSec = prog.durationSec;
                lastIsPlaying = prog.isPlaying;

                NativeBleManager ble = NativeBleManager.getInstance(ctx);
                if (ble != null && ble.isConnected()) {
                    ble.sendProgress(prog.positionSec, prog.durationSec, prog.isPlaying);
                }
                MainActivity.sendProgressToWeb(prog.positionSec, prog.durationSec, prog.isPlaying);
            }
        }
    };

    private static final MediaSessionManager.OnActiveSessionsChangedListener sessionsListener = new MediaSessionManager.OnActiveSessionsChangedListener() {
        @Override
        public void onActiveSessionsChanged(List<MediaController> controllers) {
            Log.d(TAG, "MediaSessionManager onActiveSessionsChanged count=" + (controllers != null ? controllers.size() : 0));
            updateRegisteredControllers(controllers);
            Context ctx = getEffectiveContext();
            if (ctx != null) {
                acquireWakeLock(ctx, 25000);
                rescanActiveSessions(ctx);
            }
        }
    };

    public static synchronized void ensureSessionListener(Context context) {
        if (context == null) return;
        if (msm == null) {
            try {
                msm = (MediaSessionManager) context.getSystemService(Context.MEDIA_SESSION_SERVICE);
                if (msm != null) {
                    ComponentName cn = new ComponentName(context, MediaNotificationListener.class);
                    msm.addOnActiveSessionsChangedListener(sessionsListener, cn);
                    updateRegisteredControllers(msm.getActiveSessions(cn));
                    Log.d(TAG, "ensureSessionListener successfully registered sessionsListener");
                }
            } catch (Exception e) {
                Log.w(TAG, "ensureSessionListener notice: " + e.getMessage());
            }
        }
    }

    public static boolean isExcludedPackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return true;
        pkg = pkg.toLowerCase();

        // 1. Self package (Patchi / DigiPatch keep-alive notification)
        if (pkg.contains("patchi") || pkg.contains("digipatch") || (instanceContext != null && pkg.equals(instanceContext.getPackageName().toLowerCase()))) {
            return true;
        }

        // 2. Phone / Telecom / Calling apps
        if (pkg.contains("telecom") 
            || pkg.contains("dialer") 
            || pkg.contains("incallui") 
            || pkg.contains("callscreen") 
            || pkg.equals("com.android.phone") 
            || pkg.equals("com.google.android.dialer") 
            || pkg.equals("com.samsung.android.incallui")
            || pkg.contains("telephony")
            || pkg.contains("voip")) {
            return true;
        }

        // 3. Email apps
        if (pkg.equals("com.google.android.gm") 
            || pkg.contains("outlook") 
            || pkg.contains(".mail") 
            || pkg.contains(".email") 
            || pkg.contains("k9")
            || pkg.contains("yahoo.mobile.client.android.mail") 
            || pkg.contains("samsung.android.email")) {
            return true;
        }

        // 4. Messaging & Chat / Social apps
        if (pkg.contains("messaging") 
            || pkg.contains("whatsapp") 
            || pkg.contains("telegram") 
            || pkg.contains("facebook.orca") 
            || pkg.contains("discord") 
            || pkg.contains("slack") 
            || pkg.contains("skype") 
            || pkg.contains("viber") 
            || pkg.contains("signal") 
            || pkg.contains("securesms") 
            || pkg.contains("snapchat") 
            || pkg.contains("instagram") 
            || pkg.contains("twitter") 
            || pkg.equals("com.x.android")
            || pkg.contains(".mms")
            || pkg.contains(".sms")) {
            return true;
        }

        // 5. Weather apps & Search / Pixel At a Glance
        if (pkg.contains("googlequicksearchbox") 
            || pkg.contains("weather") 
            || pkg.contains("accuweather")
            || pkg.contains("daemonapp")) {
            return true;
        }

        // 6. Core Android System UI, Play Store, Package installer, Clock/Timer
        if (pkg.equals("android") 
            || pkg.equals("com.android.systemui") 
            || pkg.equals("com.google.android.gms") 
            || pkg.equals("com.android.vending")
            || pkg.contains("deskclock")
            || pkg.contains("setupwizard")) {
            return true;
        }

        return false;
    }

    public static boolean isExcludedCategory(String category) {
        if (category == null || category.isEmpty()) return false;
        return Notification.CATEGORY_CALL.equals(category)
            || Notification.CATEGORY_MESSAGE.equals(category)
            || Notification.CATEGORY_EMAIL.equals(category)
            || Notification.CATEGORY_EVENT.equals(category)
            || Notification.CATEGORY_PROMO.equals(category)
            || Notification.CATEGORY_ALARM.equals(category)
            || Notification.CATEGORY_PROGRESS.equals(category)
            || Notification.CATEGORY_SOCIAL.equals(category)
            || Notification.CATEGORY_NAVIGATION.equals(category)
            || Notification.CATEGORY_SERVICE.equals(category)
            || Notification.CATEGORY_SYSTEM.equals(category)
            || Notification.CATEGORY_REMINDER.equals(category)
            || Notification.CATEGORY_LOCATION_SHARING.equals(category)
            || Notification.CATEGORY_MISSED_CALL.equals(category)
            || Notification.CATEGORY_WORKOUT.equals(category)
            || "status".equalsIgnoreCase(category);
    }

    public static boolean isNonMusicText(String title, String artist) {
        String combined = ((title != null ? title : "") + " " + (artist != null ? artist : "")).toLowerCase().trim();
        if (combined.isEmpty()) return true;

        if (combined.contains("call in progress") 
            || combined.contains("ongoing call") 
            || combined.contains("incoming call") 
            || combined.contains("call ended") 
            || combined.contains("missed call") 
            || combined.contains("call on hold") 
            || combined.contains("dialing") 
            || combined.contains("answering...")) {
            return true;
        }

        if (combined.contains("new message") 
            || combined.contains("new messages") 
            || combined.contains("unread message") 
            || combined.contains("mark as read") 
            || combined.contains("reply to ") 
            || combined.contains("sent a photo")
            || combined.contains("sent a video")) {
            return true;
        }

        if (combined.contains("weather alert") 
            || combined.contains("severe weather") 
            || combined.contains("humidity:") 
            || combined.contains("wind:")
            || combined.contains("current temperature")
            || (combined.matches(".*\\b\\d+°[cf]\\b.*") && combined.contains("weather"))) {
            return true;
        }

        return false;
    }

    private static synchronized void updateRegisteredControllers(List<MediaController> controllers) {
        for (MediaController mc : registeredControllers) {
            try {
                mc.unregisterCallback(controllerCallback);
            } catch (Exception ignored) {}
        }
        registeredControllers.clear();

        if (controllers != null) {
            for (MediaController mc : controllers) {
                if (mc == null) continue;
                String mcPkg = mc.getPackageName() != null ? mc.getPackageName().toLowerCase() : "";
                if (isExcludedPackage(mcPkg)) continue;
                try {
                    mc.registerCallback(controllerCallback);
                    registeredControllers.add(mc);
                    PlaybackState ps = mc.getPlaybackState();
                    if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) {
                        activeMediaController = mc;
                    }
                } catch (Exception ignored) {}
            }
            if (activeMediaController == null && !registeredControllers.isEmpty()) {
                activeMediaController = registeredControllers.get(0);
            }
        }
    }

    public static synchronized void acquireWakeLock(Context context, long timeoutMs) {
        try {
            if (wakeLock == null && context != null) {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DigiPatch:MediaBeamWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null) {
                wakeLock.acquire(timeoutMs);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instanceContext = this;
        Log.d(TAG, "MediaNotificationListener onCreate");
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        instanceContext = this;
        Log.d(TAG, "MediaNotificationListener CONNECTED");
        try {
            msm = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm != null) {
                ComponentName cn = new ComponentName(this, MediaNotificationListener.class);
                msm.addOnActiveSessionsChangedListener(sessionsListener, cn);
                updateRegisteredControllers(msm.getActiveSessions(cn));
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to register active sessions listener: " + e.getMessage());
        }
        rescanActiveSessions(this);
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        Log.d(TAG, "MediaNotificationListener DISCONNECTED - requesting rebind");
        try {
            if (msm != null) {
                msm.removeOnActiveSessionsChangedListener(sessionsListener);
            }
            updateRegisteredControllers(null);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                requestRebind(new ComponentName(this, MediaNotificationListener.class));
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (msm != null) {
                msm.removeOnActiveSessionsChangedListener(sessionsListener);
            }
            updateRegisteredControllers(null);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        instanceContext = this;
        if (sbn == null || sbn.getNotification() == null) return;

        Notification notif = sbn.getNotification();
        Bundle extras = notif.extras;
        if (extras == null) return;

        String pkg = sbn.getPackageName() != null ? sbn.getPackageName().toLowerCase() : "";
        if (isExcludedPackage(pkg)) return;

        String category = notif.category;
        if (isExcludedCategory(category)) return;

        boolean hasMediaSession = extras.containsKey(Notification.EXTRA_MEDIA_SESSION);
        boolean isCategoryTransport = Notification.CATEGORY_TRANSPORT.equals(category);

        boolean isKnownMediaApp = pkg.contains("spotify") 
            || pkg.contains("music") 
            || pkg.contains("audio") 
            || pkg.contains("sound") 
            || pkg.contains("player") 
            || pkg.contains("radio") 
            || pkg.contains("podcast") 
            || pkg.contains("pandora") 
            || pkg.contains("youtube") 
            || pkg.contains("tidal") 
            || pkg.contains("amazon") 
            || pkg.contains("deezer") 
            || pkg.contains("bandcamp") 
            || pkg.contains("vlc") 
            || pkg.contains("qobuz")
            || pkg.contains("plex")
            || pkg.contains("audible")
            || pkg.contains("soundcloud")
            || pkg.contains("tunein")
            || pkg.contains("iheart");

        // Verify if notification actions are music playback controls (play, pause, next, prev)
        boolean hasPlaybackActions = false;
        if (notif.actions != null && notif.actions.length > 0) {
            for (Notification.Action act : notif.actions) {
                if (act.title != null) {
                    String actTitle = act.title.toString().toLowerCase();
                    if (actTitle.contains("play") || actTitle.contains("pause") 
                        || actTitle.contains("skip") || actTitle.contains("next") 
                        || actTitle.contains("prev") || actTitle.contains("stop")) {
                        hasPlaybackActions = true;
                        break;
                    }
                }
            }
        }

        boolean isMedia = hasMediaSession 
            || (isCategoryTransport && (isKnownMediaApp || hasPlaybackActions)) 
            || (isKnownMediaApp && hasPlaybackActions);

        if (!isMedia) return;

        // Keep CPU awake for 25 seconds while background BLE streaming finishes
        acquireWakeLock(this, 25000);

        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence artistCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence albumCs = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

        String title = titleCs != null ? titleCs.toString().trim() : "";
        String artist = artistCs != null ? artistCs.toString().trim() : "";
        String album = albumCs != null ? albumCs.toString().trim() : "";

        Context pkgContext = null;
        try {
            if (sbn.getPackageName() != null) {
                pkgContext = createPackageContext(sbn.getPackageName(), Context.CONTEXT_IGNORE_SECURITY | Context.CONTEXT_INCLUDE_CODE);
            }
        } catch (Exception ignored) {
            try {
                if (sbn.getPackageName() != null) {
                    pkgContext = createPackageContext(sbn.getPackageName(), 0);
                }
            } catch (Exception ignored2) {}
        }
        if (pkgContext == null) pkgContext = this;

        MediaMetadata metadata = null;
        MediaController controller = null;
        if (extras.containsKey(Notification.EXTRA_MEDIA_SESSION)) {
            try {
                Parcelable p = extras.getParcelable(Notification.EXTRA_MEDIA_SESSION);
                if (p instanceof MediaSession.Token) {
                    MediaSession.Token token = (MediaSession.Token) p;
                    controller = new MediaController(this, token);
                    activeMediaController = controller;
                    metadata = controller.getMetadata();
                }
            } catch (Exception e) {
                Log.w(TAG, "MediaSession extraction: " + e.getMessage());
            }
        }

        if (metadata != null) {
            if (title.isEmpty()) {
                CharSequence metaTitle = metadata.getText(MediaMetadata.METADATA_KEY_TITLE);
                if (metaTitle != null) title = metaTitle.toString().trim();
            }
            if (artist.isEmpty()) {
                CharSequence metaArtist = metadata.getText(MediaMetadata.METADATA_KEY_ARTIST);
                if (metaArtist == null) metaArtist = metadata.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                if (metaArtist != null) artist = metaArtist.toString().trim();
            }
            if (album.isEmpty()) {
                CharSequence metaAlbum = metadata.getText(MediaMetadata.METADATA_KEY_ALBUM);
                if (metaAlbum != null) album = metaAlbum.toString().trim();
            }
        }

        Bitmap bitmap = extractArtworkBitmap(metadata, notif, pkgContext);

        if (bitmap == null || title.isEmpty() || artist.isEmpty()) {
            try {
                MediaSessionManager sessionMgr = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
                if (sessionMgr != null) {
                    List<MediaController> activeSessions = sessionMgr.getActiveSessions(new ComponentName(this, MediaNotificationListener.class));
                    for (MediaController mc : activeSessions) {
                        String mcPkg = mc.getPackageName() != null ? mc.getPackageName().toLowerCase() : "";
                        if (mcPkg.equals(pkg) || pkg.isEmpty() || mcPkg.contains("plex") || mcPkg.contains("spotify")) {
                            MediaMetadata mm = mc.getMetadata();
                            if (mm != null) {
                                if (title.isEmpty()) {
                                    CharSequence t = mm.getText(MediaMetadata.METADATA_KEY_TITLE);
                                    if (t != null) title = t.toString().trim();
                                }
                                if (artist.isEmpty()) {
                                    CharSequence a = mm.getText(MediaMetadata.METADATA_KEY_ARTIST);
                                    if (a == null) a = mm.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                                    if (a != null) artist = a.toString().trim();
                                }
                                if (album.isEmpty()) {
                                    CharSequence al = mm.getText(MediaMetadata.METADATA_KEY_ALBUM);
                                    if (al != null) album = al.toString().trim();
                                }
                                if (bitmap == null) {
                                    bitmap = extractArtworkBitmap(mm, null, this);
                                }
                                if (bitmap != null && !title.isEmpty() && !artist.isEmpty()) {
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "ActiveSessions scan: " + e.getMessage());
            }
        }

        if (title.isEmpty() && artist.isEmpty()) return;
        if (isNonMusicText(title, artist)) {
            Log.d(TAG, "onNotificationPosted: rejected non-music notification (" + title + " - " + artist + ")");
            return;
        }
        if (title.isEmpty()) title = "Unknown Title";
        if (artist.isEmpty()) artist = "Unknown Artist";

        PlaybackProgress prog = extractProgress(controller != null ? controller : activeMediaController);
        final int fPosSec = prog != null ? prog.positionSec : 0;
        final int fDurSec = prog != null ? prog.durationSec : 0;
        final boolean fIsPlaying = prog != null ? prog.isPlaying : true;

        if (bitmap != null) {
            broadcastWithBitmapStatic(title, artist, album, bitmap, fPosSec, fDurSec, fIsPlaying);
        } else {
            final String fTitle = title;
            final String fArtist = artist;
            final String fAlbum = album;

            executor.execute(() -> {
                acquireWakeLock(MediaNotificationListener.this, 25000);
                Bitmap netBmp = queryItunesSearch(fTitle, fArtist, fAlbum);
                broadcastWithBitmapStatic(fTitle, fArtist, fAlbum, netBmp, fPosSec, fDurSec, fIsPlaying);
            });
        }
    }

    private void broadcastWithBitmap(String title, String artist, String album, Bitmap bitmap) {
        broadcastWithBitmapStatic(title, artist, album, bitmap, lastPosSec, lastDurSec, lastIsPlaying);
    }

    public static void processAndBroadcastMetadata(Context ctx, MediaMetadata mm) {
        if (mm == null || ctx == null) return;
        acquireWakeLock(ctx, 25000);
        executor.execute(() -> {
            try {
                String title = "";
                String artist = "";
                String album = "";

                CharSequence t = mm.getText(MediaMetadata.METADATA_KEY_TITLE);
                if (t != null) title = t.toString().trim();
                CharSequence a = mm.getText(MediaMetadata.METADATA_KEY_ARTIST);
                if (a == null) a = mm.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                if (a != null) artist = a.toString().trim();
                CharSequence al = mm.getText(MediaMetadata.METADATA_KEY_ALBUM);
                if (al != null) album = al.toString().trim();

                android.media.MediaDescription desc = mm.getDescription();
                if (desc != null) {
                    if (title.isEmpty() && desc.getTitle() != null) {
                        title = desc.getTitle().toString().trim();
                    }
                    if (artist.isEmpty() && desc.getSubtitle() != null) {
                        artist = desc.getSubtitle().toString().trim();
                    }
                    if (album.isEmpty() && desc.getDescription() != null) {
                        album = desc.getDescription().toString().trim();
                    }
                }

                if (title.isEmpty() && artist.isEmpty()) {
                    rescanActiveSessions(ctx);
                    return;
                }

                if (isNonMusicText(title, artist)) {
                    Log.d(TAG, "processAndBroadcastMetadata: skipping non-music text (" + title + " - " + artist + ")");
                    return;
                }

                if (title.isEmpty()) title = "Unknown Title";
                if (artist.isEmpty()) artist = "Unknown Artist";

                Bitmap b = extractArtworkBitmap(mm, null, ctx);

                if (b == null) {
                    b = queryItunesSearch(title, artist, album);
                }

                PlaybackProgress prog = extractProgress(activeMediaController);
                int pSec = (prog != null) ? prog.positionSec : 0;
                int dSec = (prog != null) ? prog.durationSec : 0;
                boolean isPlaying = (prog != null) ? prog.isPlaying : true;

                broadcastWithBitmapStatic(title, artist, album, b, pSec, dSec, isPlaying);
            } catch (Exception e) {
                Log.w(TAG, "processAndBroadcastMetadata error: " + e.getMessage());
            }
        });
    }


    public static void rescanActiveSessions(Context context) {
        if (context == null) return;
        instanceContext = context.getApplicationContext();
        ensureSessionListener(context);
        acquireWakeLock(context, 25000);
        executor.execute(() -> {
            try {
                MediaSessionManager sessionMgr = (MediaSessionManager) context.getSystemService(Context.MEDIA_SESSION_SERVICE);
                if (sessionMgr == null) return;
                ComponentName cn = new ComponentName(context, MediaNotificationListener.class);
                List<MediaController> activeSessions = sessionMgr.getActiveSessions(cn);
                if (activeSessions == null || activeSessions.isEmpty()) return;

                updateRegisteredControllers(activeSessions);

                MediaController bestController = null;
                MediaMetadata bestMetadata = null;
                String bestTitle = "";
                String bestArtist = "";
                String bestAlbum = "";

                // Prioritize the existing active controller if it is actively playing
                if (activeMediaController != null) {
                    String acPkg = activeMediaController.getPackageName() != null ? activeMediaController.getPackageName().toLowerCase() : "";
                    if (!isExcludedPackage(acPkg)) {
                        PlaybackState curPs = activeMediaController.getPlaybackState();
                        MediaMetadata curMm = activeMediaController.getMetadata();
                        if (curPs != null && curPs.getState() == PlaybackState.STATE_PLAYING && curMm != null) {
                            CharSequence t = curMm.getText(MediaMetadata.METADATA_KEY_TITLE);
                            CharSequence a = curMm.getText(MediaMetadata.METADATA_KEY_ARTIST);
                            if (a == null) a = curMm.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                            if (t != null && !t.toString().trim().isEmpty()) {
                                String testTitle = t.toString().trim();
                                String testArtist = a != null ? a.toString().trim() : "";
                                if (!isNonMusicText(testTitle, testArtist)) {
                                    bestController = activeMediaController;
                                    bestMetadata = curMm;
                                    bestTitle = testTitle;
                                    bestArtist = testArtist;
                                    CharSequence al = curMm.getText(MediaMetadata.METADATA_KEY_ALBUM);
                                    if (al != null) bestAlbum = al.toString().trim();
                                }
                            }
                        }
                    }
                }

                // If no active playing controller was retained, scan all sessions
                if (bestController == null) {
                    for (MediaController mc : activeSessions) {
                        if (mc == null) continue;
                        String mcPkg = mc.getPackageName() != null ? mc.getPackageName().toLowerCase() : "";
                        if (isExcludedPackage(mcPkg)) continue;

                        MediaMetadata mm = mc.getMetadata();
                        if (mm == null) continue;

                        String title = "";
                        String artist = "";
                        String album = "";

                        CharSequence t = mm.getText(MediaMetadata.METADATA_KEY_TITLE);
                        if (t != null) title = t.toString().trim();
                        CharSequence a = mm.getText(MediaMetadata.METADATA_KEY_ARTIST);
                        if (a == null) a = mm.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                        if (a != null) artist = a.toString().trim();
                        CharSequence al = mm.getText(MediaMetadata.METADATA_KEY_ALBUM);
                        if (al != null) album = al.toString().trim();

                        if (title.isEmpty() && artist.isEmpty()) continue;
                        if (isNonMusicText(title, artist)) continue;

                        PlaybackState ps = mc.getPlaybackState();
                        boolean isPlaying = (ps != null && ps.getState() == PlaybackState.STATE_PLAYING);

                        if (isPlaying) {
                            bestController = mc;
                            bestMetadata = mm;
                            bestTitle = title;
                            bestArtist = artist;
                            bestAlbum = album;
                            break;
                        }

                        if (bestController == null) {
                            bestController = mc;
                            bestMetadata = mm;
                            bestTitle = title;
                            bestArtist = artist;
                            bestAlbum = album;
                        }
                    }
                }

                if (bestController == null || bestMetadata == null || (bestTitle.isEmpty() && bestArtist.isEmpty())) {
                    return;
                }

                activeMediaController = bestController;
                PlaybackProgress prog = extractProgress(bestController);
                int pSec = (prog != null) ? prog.positionSec : 0;
                int dSec = (prog != null) ? prog.durationSec : 0;
                boolean isPlaying = (prog != null) ? prog.isPlaying : true;

                Bitmap b = extractArtworkBitmap(bestMetadata, null, context);

                if (b == null) {
                    b = queryItunesSearch(bestTitle, bestArtist, bestAlbum);
                }

                broadcastWithBitmapStatic(bestTitle, bestArtist, bestAlbum, b, pSec, dSec, isPlaying);
            } catch (Exception e) {
                Log.w(TAG, "rescanActiveSessions error: " + e.getMessage());
            }
        });
    }

    public static Bitmap downloadHttpBitmap(String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) return null;
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2500);
            conn.connect();
            if (conn.getResponseCode() == 200) {
                InputStream is = conn.getInputStream();
                Bitmap b = BitmapFactory.decodeStream(is);
                if (is != null) is.close();
                conn.disconnect();
                return b;
            }
            conn.disconnect();
        } catch (Exception ignored) {}
        return null;
    }

    public static Bitmap queryItunesSearch(String title, String artist, String album) {
        if (title.isEmpty() && artist.isEmpty()) return null;
        try {
            String cleanTitle = title
                .replaceAll("(?i)\\s*\\(.*?\\)", "")
                .replaceAll("(?i)\\s*\\[.*?\\]", "")
                .replaceAll("(?i)\\s*ft\\..*|feat\\..*", "")
                .replaceAll("(?i)\\s*-\\s*(remaster|live|mono|stereo|bonus|acoustic).*", "")
                .trim();
            String cleanArtist = artist
                .replaceAll("(?i)\\s*ft\\..*|feat\\..*", "")
                .replaceAll("(?i)\\s*&.*", "")
                .trim();
            String cleanAlbum = album != null
                ? album.replaceAll("(?i)\\s*\\(.*?\\)", "").replaceAll("(?i)\\s*\\[.*?\\]", "").trim()
                : "";

            List<String> queries = new ArrayList<>();
            if (!cleanAlbum.isEmpty() && !cleanAlbum.equalsIgnoreCase("single") && !cleanAlbum.equalsIgnoreCase("spotify") && !cleanAlbum.equalsIgnoreCase("plexamp")) {
                queries.add(cleanArtist + " " + cleanAlbum);
            }
            if (!cleanTitle.isEmpty() && !cleanArtist.isEmpty()) {
                queries.add(cleanTitle + " " + cleanArtist);
            } else if (!cleanTitle.isEmpty()) {
                queries.add(cleanTitle);
            }

            for (String q : queries) {
                if (q.trim().isEmpty()) continue;
                String query = URLEncoder.encode(q.trim(), "UTF-8");
                URL itunesUrl = new URL("https://itunes.apple.com/search?term=" + query + "&media=music&limit=2");
                HttpURLConnection conn = (HttpURLConnection) itunesUrl.openConnection();
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2500);
                conn.connect();
                if (conn.getResponseCode() == 200) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                    reader.close();

                    JSONObject json = new JSONObject(sb.toString());
                    JSONArray results = json.optJSONArray("results");
                    if (results != null && results.length() > 0) {
                        for (int i = 0; i < results.length(); i++) {
                            JSONObject item = results.getJSONObject(i);
                            String artUrl = item.optString("artworkUrl100", "");
                            if (!artUrl.isEmpty()) {
                                artUrl = artUrl.replace("100x100bb.jpg", "300x300bb.jpg").replace("100x100", "300x300");
                                Bitmap downloaded = downloadHttpBitmap(artUrl);
                                if (downloaded != null) {
                                    conn.disconnect();
                                    return downloaded;
                                }
                            }
                        }
                    }
                }
                conn.disconnect();
            }
        } catch (Exception ignored) {}
        return null;
    }


    public static void broadcastWithBitmapStatic(String title, String artist, String album, Bitmap bitmap) {
        broadcastWithBitmapStatic(title, artist, album, bitmap, lastPosSec, lastDurSec, lastIsPlaying);
    }

    public static void broadcastWithBitmapStatic(String title, String artist, String album, Bitmap bitmap, int positionSec, int durationSec, boolean isPlaying) {
        if (bitmap != null) {
            lastOriginalBitmap = bitmap;
        } else if (lastOriginalBitmap != null && title != null && title.equalsIgnoreCase(lastTitle) && artist != null && artist.equalsIgnoreCase(lastArtist)) {
            bitmap = lastOriginalBitmap;
        }

        lastTitle = title;
        lastArtist = artist;
        lastAlbum = album;
        lastPosSec = positionSec;
        lastDurSec = durationSec;
        lastIsPlaying = isPlaying;

        String base64Art = "";
        String dominantHex = "#FF8800";
        byte[] rawJpegBytes = null;

        Context ctx = getEffectiveContext();
        String style = "scrubber";
        if (ctx != null) {
            NativeBleManager ble = NativeBleManager.getInstance(ctx);
            if (ble != null) {
                style = ble.getPreferredStyle();
            }
        }
        int targetW = 172;
        int targetH = 172;

        if (bitmap != null) {
            try {
                Bitmap scaled = centerCropAndScale(bitmap, targetW, targetH);
                dominantHex = extractDominantHex(scaled);

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 75, baos);
                rawJpegBytes = baos.toByteArray();
                base64Art = "data:image/jpeg;base64," + Base64.encodeToString(rawJpegBytes, Base64.NO_WRAP);
            } catch (Exception e) {
                Log.e(TAG, "Error compressing artwork: " + e.getMessage(), e);
            }
        }

        try {
            JSONObject json = new JSONObject();
            json.put("title", title);
            json.put("artist", artist);
            json.put("album", album != null ? album : "");
            json.put("artwork", base64Art);
            json.put("artBase64", base64Art);
            json.put("rgbHex", dominantHex);
            json.put("positionSec", positionSec);
            json.put("durationSec", durationSec);
            json.put("isPlaying", isPlaying);
            cachedCurrentTrack = json;
        } catch (Exception ignored) {}

        String broadcastKey = title + ":::" + artist + ":::" + style + ":::" + (base64Art.isEmpty() ? "NOART" : "ART");
        long now = System.currentTimeMillis();
        boolean isDuplicate = broadcastKey.equals(lastBroadcastKey);
        boolean isStale = (now - lastBroadcastTimeMs) > REBROADCAST_INTERVAL_MS;
        if (isDuplicate && !isStale) {
            return;
        }
        lastBroadcastKey = broadcastKey;
        lastBroadcastTimeMs = now;

        Log.d(TAG, "Broadcasting media: " + title + " - " + artist + " (Style: " + style + ", " + targetW + "x" + targetH + ", Art: " + (!base64Art.isEmpty()) + ", Hex: " + dominantHex + ", Pos: " + positionSec + "s/" + durationSec + "s)");

        // 1. Direct Native BLE transmission (works 24/7 when screen is locked in pocket)
        try {
            NativeBleManager ble = NativeBleManager.getInstance(ctx);
            if (ble != null) {
                ble.sendNowPlaying(title, artist, album, dominantHex, rawJpegBytes, positionSec, durationSec, isPlaying);
            }
        } catch (Exception e) {
            Log.w(TAG, "Native BLE sendNowPlaying notice: " + e.getMessage());
        }

        // 2. Also notify Web UI (when app is open in foreground)
        MainActivity.sendNowPlayingToWeb(title, artist, album, base64Art, dominantHex, positionSec, durationSec, isPlaying);
    }

    public static void rebroadcastWithNewStyle(String style) {
        if (lastTitle.isEmpty() && lastArtist.isEmpty()) return;
        Log.d(TAG, "Rebroadcasting with new style: " + style);
        lastBroadcastKey = "";
        Bitmap bmpToUse = lastOriginalBitmap;
        if (bmpToUse == null && activeMediaController != null) {
            MediaMetadata mm = activeMediaController.getMetadata();
            if (mm != null) {
                bmpToUse = extractArtworkBitmap(mm, null, getEffectiveContext());
                if (bmpToUse != null) {
                    lastOriginalBitmap = bmpToUse;
                }
            }
        }
        broadcastWithBitmapStatic(lastTitle, lastArtist, lastAlbum, bmpToUse, lastPosSec, lastDurSec, lastIsPlaying);
    }

    public static Bitmap centerCropAndScale(Bitmap src, int targetW, int targetH) {
        if (src == null) return null;
        int w = src.getWidth();
        int h = src.getHeight();
        if (w == targetW && h == targetH) return src;

        float scale = Math.max((float) targetW / w, (float) targetH / h);
        int scaledW = Math.max(1, Math.round(w * scale));
        int scaledH = Math.max(1, Math.round(h * scale));

        Bitmap scaled = Bitmap.createScaledBitmap(src, scaledW, scaledH, true);
        int xOffset = Math.max(0, (scaledW - targetW) / 2);
        int yOffset = Math.max(0, (scaledH - targetH) / 2);

        return Bitmap.createBitmap(scaled, xOffset, yOffset, Math.min(targetW, scaled.getWidth() - xOffset), Math.min(targetH, scaled.getHeight() - yOffset));
    }

    public static String extractDominantHex(Bitmap b) {
        if (b == null) return "#FF8800";
        try {
            int w = b.getWidth();
            int h = b.getHeight();
            long rSum = 0, gSum = 0, bSum = 0;
            int count = 0;

            // Sample grid of 64 pixels from center
            int startX = w / 4;
            int endX = (w * 3) / 4;
            int startY = h / 4;
            int endY = (h * 3) / 4;
            int stepX = Math.max(1, (endX - startX) / 8);
            int stepY = Math.max(1, (endY - startY) / 8);

            for (int y = startY; y < endY; y += stepY) {
                for (int x = startX; x < endX; x += stepX) {
                    int pixel = b.getPixel(x, y);
                    int r = (pixel >> 16) & 0xFF;
                    int g = (pixel >> 8) & 0xFF;
                    int bl = pixel & 0xFF;

                    // Exclude pure black and pure white
                    if ((r + g + bl > 40) && (r + g + bl < 720)) {
                        rSum += r;
                        gSum += g;
                        bSum += bl;
                        count++;
                    }
                }
            }

            if (count > 0) {
                int r = (int) (rSum / count);
                int g = (int) (gSum / count);
                int bl = (int) (bSum / count);
                return String.format("#%02X%02X%02X", r, g, bl);
            }
        } catch (Exception ignored) {}
        return "#FF8800";
    }

    public static Bitmap resolveUriBitmap(Context ctx, Uri uri) {
        if (ctx == null || uri == null) return null;
        try {
            // First decode bounds only to prevent OOM on huge images
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            try (InputStream is = ctx.getContentResolver().openInputStream(uri)) {
                if (is != null) {
                    BitmapFactory.decodeStream(is, null, opts);
                }
            }
            if (opts.outWidth > 0 && opts.outHeight > 0) {
                opts.inJustDecodeBounds = false;
                opts.inPreferredConfig = Bitmap.Config.RGB_565;
                int sample = 1;
                while (opts.outWidth / (sample * 2) >= 172 && opts.outHeight / (sample * 2) >= 172) {
                    sample *= 2;
                }
                opts.inSampleSize = sample;
                try (InputStream is = ctx.getContentResolver().openInputStream(uri)) {
                    if (is != null) {
                        return BitmapFactory.decodeStream(is, null, opts);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "resolveUriBitmap failed: " + e.getMessage());
        }
        return null;
    }

    public static Bitmap extractArtworkBitmap(MediaMetadata mm, Notification notif, Context ctx) {
        if (mm != null) {
            Bitmap b = mm.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (b == null) b = mm.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (b == null) b = mm.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
            if (b != null) return b;

            android.media.MediaDescription desc = mm.getDescription();
            if (desc != null) {
                b = desc.getIconBitmap();
                if (b != null) return b;
                if (desc.getIconUri() != null && ctx != null) {
                    Uri u = desc.getIconUri();
                    if ("http".equalsIgnoreCase(u.getScheme()) || "https".equalsIgnoreCase(u.getScheme())) {
                        b = downloadHttpBitmap(u.toString());
                    } else {
                        b = resolveUriBitmap(ctx, u);
                    }
                    if (b != null) return b;
                }
            }

            String[] uriKeys = new String[]{
                MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
                MediaMetadata.METADATA_KEY_ART_URI,
                MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI
            };
            for (String key : uriKeys) {
                String uriStr = mm.getString(key);
                if (uriStr != null && !uriStr.isEmpty()) {
                    try {
                        Uri u = Uri.parse(uriStr);
                        if ("http".equalsIgnoreCase(u.getScheme()) || "https".equalsIgnoreCase(u.getScheme())) {
                            b = downloadHttpBitmap(uriStr);
                        } else if (ctx != null) {
                            b = resolveUriBitmap(ctx, u);
                        }
                        if (b != null) return b;
                    } catch (Exception ignored) {}
                }
            }
        }

        if (notif != null) {
            if (notif.getLargeIcon() != null) {
                Bitmap b = extractBitmapFromObjectStatic(notif.getLargeIcon(), ctx);
                if (b != null) return b;
            }

            Bundle extras = notif.extras;
            if (extras != null) {
                String[] artKeys = new String[]{
                    "android.largeIcon.big",
                    Notification.EXTRA_LARGE_ICON,
                    Notification.EXTRA_PICTURE,
                    "android.picture",
                    "android.largeIcon",
                    "android.pictureIcon",
                    "android.backgroundImageUri",
                    "mediaSession.art"
                };
                for (String key : artKeys) {
                    if (extras.containsKey(key)) {
                        Bitmap b = extractBitmapFromObjectStatic(extras.get(key), ctx);
                        if (b != null) return b;
                    }
                }
            }
        }

        return null;
    }

    public static Bitmap extractBitmapFromObjectStatic(Object obj, Context pkgContext) {
        if (obj == null) return null;
        if (obj instanceof Bitmap) return (Bitmap) obj;
        if (obj instanceof Icon) {
            Icon icon = (Icon) obj;
            // 1. Direct reflection into Icon internal Bitmap/bytes
            try {
                java.lang.reflect.Field field = Icon.class.getDeclaredField("mObj1");
                field.setAccessible(true);
                Object inner = field.get(icon);
                if (inner instanceof Bitmap) {
                    return (Bitmap) inner;
                }
                if (inner instanceof byte[]) {
                    byte[] bytes = (byte[]) inner;
                    Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (decoded != null) return decoded;
                }
                if (inner instanceof Uri && pkgContext != null) {
                    Bitmap decoded = resolveUriBitmap(pkgContext, (Uri) inner);
                    if (decoded != null) return decoded;
                }
            } catch (Exception ignored) {}

            // 2. Standard loadDrawable fallback
            try {
                if (pkgContext != null) {
                    Drawable drawable = icon.loadDrawable(pkgContext);
                    if (drawable != null) return drawableToBitmapStatic(drawable);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load Icon drawable: " + e.getMessage());
            }
        }
        if (obj instanceof Drawable) {
            return drawableToBitmapStatic((Drawable) obj);
        }
        if (obj instanceof Uri && pkgContext != null) {
            return resolveUriBitmap(pkgContext, (Uri) obj);
        }
        return null;
    }

    private Bitmap extractBitmapFromObject(Object obj, Context pkgContext) {
        return extractBitmapFromObjectStatic(obj, pkgContext);
    }

    public static Bitmap drawableToBitmapStatic(Drawable drawable) {
        if (drawable == null) return null;
        if (drawable instanceof BitmapDrawable) {
            return ((BitmapDrawable) drawable).getBitmap();
        }
        int w = drawable.getIntrinsicWidth() > 0 ? drawable.getIntrinsicWidth() : 172;
        int h = drawable.getIntrinsicHeight() > 0 ? drawable.getIntrinsicHeight() : 172;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(b);
        drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
        drawable.draw(canvas);
        return b;
    }

    private Bitmap drawableToBitmap(Drawable drawable) {
        return drawableToBitmapStatic(drawable);
    }
}
