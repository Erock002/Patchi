package com.patchi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

/**
 * Lightweight Foreground Service to keep DigiPatch's WebView and BLE packet streaming
 * awake 24/7 on Android 14/15/16 (Pixel) devices even when screen is locked in a pocket.
 */
public class KeepAliveService extends Service {
    private static final String TAG = "DigiPatchKeepAlive";
    private static final String CHANNEL_ID = "digipatch_ble_channel";
    private static final int NOTIF_ID = 1001;

    private static KeepAliveService instance;
    private static PowerManager.WakeLock wakeLock;

    public static KeepAliveService getInstance() {
        return instance;
    }

    public static void start(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            Log.d(TAG, "KeepAliveService.start invoked successfully");
        } catch (Exception e) {
            Log.w(TAG, "Failed to start KeepAliveService: " + e.getMessage());
        }
    }

    public static void stop(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, KeepAliveService.class);
            context.stopService(intent);
            Log.d(TAG, "KeepAliveService.stop invoked successfully");
        } catch (Exception e) {
            Log.w(TAG, "Failed to stop KeepAliveService: " + e.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DigiPatch:BleKeepAliveLock");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire();
                }
                Log.d(TAG, "Acquired BleKeepAliveLock (held until onDestroy)");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WakeLock: " + e.getMessage());
        }

        // Maintain 24/7 Native BLE connection to Backpack-ESP32
        try {
            NativeBleManager.getInstance(this).connect();
        } catch (Exception e) {
            Log.w(TAG, "NativeBleManager auto-connect notice: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
                NotificationChannel chan = new NotificationChannel(
                    CHANNEL_ID,
                    "Patchi Backpack Sync",
                    NotificationManager.IMPORTANCE_LOW
                );
                chan.setDescription("Maintains continuous Bluetooth LE sync to WaveShare ESP32 display");
                chan.setShowBadge(false);
                chan.enableVibration(false);
                chan.setSound(null, null);
                nm.createNotificationChannel(chan);
            }

            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(this, CHANNEL_ID);
            } else {
                builder = new Notification.Builder(this);
            }

            Notification notif = builder
                .setContentTitle("Patchi Connected")
                .setContentText("Syncing Now Playing to Backpack ESP32")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth) // Guaranteed system drawable
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
                } catch (Exception e) {
                    Log.w(TAG, "startForeground with connectedDevice failed, falling back: " + e.getMessage());
                    startForeground(NOTIF_ID, notif);
                }
            } else {
                startForeground(NOTIF_ID, notif);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in KeepAliveService.onStartCommand: " + e.getMessage(), e);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "Released BleKeepAliveLock");
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // User swiped the app from recent tasks — reschedule service restart in 1s
        try {
            Intent restartIntent = new Intent(getApplicationContext(), KeepAliveService.class);
            android.app.PendingIntent restartPendingIntent = android.app.PendingIntent.getService(
                getApplicationContext(), 1, restartIntent,
                android.app.PendingIntent.FLAG_ONE_SHOT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? android.app.PendingIntent.FLAG_IMMUTABLE : 0)
            );
            android.app.AlarmManager alarmManager =
                (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                alarmManager.set(android.app.AlarmManager.ELAPSED_REALTIME,
                    android.os.SystemClock.elapsedRealtime() + 1000, restartPendingIntent);
            }
            Log.d(TAG, "onTaskRemoved — scheduled KeepAliveService restart in 1s");
        } catch (Exception e) {
            Log.w(TAG, "onTaskRemoved restart failed: " + e.getMessage());
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
