package com.patchi.app;

import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static MainActivity instance;

    private void applySystemBarTheme() {
        try {
            Window window = getWindow();
            if (window == null) return;

            // Enable edge-to-edge drawing so app canvas flows seamlessly beneath status & navigation bars
            WindowCompat.setDecorFitsSystemWindows(window, false);

            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);

            int richGraphite = Color.parseColor("#121214");
            window.setStatusBarColor(richGraphite);
            window.setNavigationBarColor(richGraphite);
            if (window.getDecorView() != null) {
                window.getDecorView().setBackgroundColor(richGraphite);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }

            // Ensure status bar icons and navigation bar gesture handle are light (white) on dark #121214
            WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (insetsController != null) {
                insetsController.setAppearanceLightStatusBars(false);
                insetsController.setAppearanceLightNavigationBars(false);
            }
        } catch (Exception e) {
            android.util.Log.w("DigiPatch", "applySystemBarTheme notice: " + e.getMessage());
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        applySystemBarTheme();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                setShowWhenLocked(true);
            } catch (Exception ignored) {}
        }

        KeepAliveService.start(this);

        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    WebView webView = getBridge().getWebView();
                    webView.setBackgroundColor(Color.parseColor("#121214"));
                    
                    // Prevent background throttling of timers and media playback
                    WebSettings settings = webView.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setMediaPlaybackRequiresUserGesture(false);

                    webView.addJavascriptInterface(new Object() {
                        @JavascriptInterface
                        public void openNotificationSettings() {
                            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        }

                        @JavascriptInterface
                        public void requestMediaUpdate() {
                            if (MediaNotificationListener.cachedCurrentTrack != null) {
                                sendJsonToWeb(MediaNotificationListener.cachedCurrentTrack);
                            }
                            MediaNotificationListener.rescanActiveSessions(MainActivity.this);
                        }

                        @JavascriptInterface
                        public void startKeepAlive() {
                            KeepAliveService.start(MainActivity.this);
                        }

                        @JavascriptInterface
                        public void stopKeepAlive() {
                            KeepAliveService.stop(MainActivity.this);
                        }

                        @JavascriptInterface
                        public void setTargetDevice(String macAddress) {
                            NativeBleManager.getInstance(MainActivity.this).setTargetDevice(macAddress);
                            NativeBleManager.getInstance(MainActivity.this).connect();
                        }

                        @JavascriptInterface
                        public void connectNativeBle() {
                            NativeBleManager.getInstance(MainActivity.this).connect();
                        }

                        @JavascriptInterface
                        public void disconnectNativeBle() {
                            NativeBleManager.getInstance(MainActivity.this).disconnect();
                        }

                        @JavascriptInterface
                        public boolean isNativeBleConnected() {
                            return NativeBleManager.getInstance(MainActivity.this).isConnected();
                        }

                        @JavascriptInterface
                        public void setPreferredStyle(String style) {
                            NativeBleManager.getInstance(MainActivity.this).setPreferredStyle(style);
                        }

                        @JavascriptInterface
                        public boolean sendNativeBleCommand(String cmd) {
                            if (cmd != null) {
                                if (cmd.startsWith("STYLE|")) {
                                    String style = cmd.substring(6).trim();
                                    NativeBleManager.getInstance(MainActivity.this).setPreferredStyle(style);
                                } else if (cmd.startsWith("PLEX|")) {
                                    String[] parts = cmd.split("\\|");
                                    if (parts.length >= 6) {
                                        NativeBleManager.getInstance(MainActivity.this).setPreferredStyle(parts[5].trim());
                                    }
                                }
                            }
                            return NativeBleManager.getInstance(MainActivity.this).sendCommand(cmd);
                        }
                    }, "AndroidBridge");
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        // Prevent Android WebView from freezing JavaScript timers & BLE when screen is locked!
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Keep Chromium engine active even when activity is stopped
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        instance = this;
        applySystemBarTheme();
        KeepAliveService.start(this);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                NotificationListenerService.requestRebind(new ComponentName(this, MediaNotificationListener.class));
            } catch (Exception ignored) {}
        }

        if (MediaNotificationListener.cachedCurrentTrack != null) {
            sendJsonToWeb(MediaNotificationListener.cachedCurrentTrack);
        }
        MediaNotificationListener.rescanActiveSessions(this);
    }

    @Override
    public void onDestroy() {
        // If Activity is destroyed by system (memory pressure etc.),
        // restart KeepAliveService so BLE sync continues in background.
        try {
            KeepAliveService.start(getApplicationContext());
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    public static MainActivity getInstance() {
        return instance;
    }

    public static void sendNowPlayingToWeb(String title, String artist, String album, String artwork) {
        sendNowPlayingToWeb(title, artist, album, artwork, "#FF8800", 0, 0, true);
    }

    public static void sendNowPlayingToWeb(String title, String artist, String album, String artwork, String rgbHex) {
        sendNowPlayingToWeb(title, artist, album, artwork, rgbHex, 0, 0, true);
    }

    public static void sendNowPlayingToWeb(String title, String artist, String album, String artwork, String rgbHex, int positionSec, int durationSec, boolean isPlaying) {
        try {
            JSONObject json = new JSONObject();
            json.put("title", title);
            json.put("artist", artist);
            json.put("album", album != null ? album : "");
            json.put("artwork", artwork != null ? artwork : "");
            json.put("rgbHex", (rgbHex == null || rgbHex.isEmpty()) ? "#FF8800" : rgbHex);
            json.put("positionSec", positionSec);
            json.put("durationSec", durationSec);
            json.put("isPlaying", isPlaying);
            sendJsonToWeb(json);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void sendProgressToWeb(int positionSec, int durationSec, boolean isPlaying) {
        if (instance == null || instance.getBridge() == null) return;
        try {
            JSONObject json = new JSONObject();
            json.put("positionSec", positionSec);
            json.put("durationSec", durationSec);
            json.put("isPlaying", isPlaying);
            String payload = json.toString();
            String js = "try { window.dispatchEvent(new CustomEvent('nativeMediaProgress', { detail: " + payload + " })); } catch (e) {}";
            instance.runOnUiThread(() -> {
                WebView webView = instance.getBridge().getWebView();
                if (webView != null) webView.evaluateJavascript(js, null);
            });
        } catch (Exception ignored) {}
    }

    public static void sendJsonToWeb(JSONObject json) {
        if (instance == null || instance.getBridge() == null || json == null) return;
        try {
            // Wake CPU immediately for 25 seconds to evaluate Javascript and stream BLE in background
            MediaNotificationListener.acquireWakeLock(instance, 25000);

            String payload = json.toString();
            String js = "try { "
                + "if (window.onAndroidNowPlaying) { window.onAndroidNowPlaying(" + payload + "); } "
                + "window.dispatchEvent(new CustomEvent('androidNowPlaying', { detail: " + payload + " })); "
                + "window.dispatchEvent(new CustomEvent('nativeMediaUpdate', { detail: " + payload + " })); "
                + "} catch (e) { console.error('sendJsonToWeb error:', e); }";

            instance.runOnUiThread(() -> {
                WebView webView = instance.getBridge().getWebView();
                if (webView != null) {
                    webView.resumeTimers();
                    webView.evaluateJavascript(js, (result) -> {
                        if (result != null && result.contains("error")) {
                            android.util.Log.w("DigiPatchMedia", "sendJsonToWeb JS eval: " + result);
                        }
                    });
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void sendBleStateToWeb(boolean connected, String deviceName, String error) {
        if (instance == null || instance.getBridge() == null) return;
        try {
            JSONObject json = new JSONObject();
            json.put("connected", connected);
            json.put("deviceName", deviceName != null ? deviceName : "");
            json.put("error", error != null ? error : "");
            String payload = json.toString();
            String js = "try { window.dispatchEvent(new CustomEvent('nativeBleConnection', { detail: " + payload + " })); } catch (e) {}";
            instance.runOnUiThread(() -> {
                WebView webView = instance.getBridge().getWebView();
                if (webView != null) webView.evaluateJavascript(js, null);
            });
        } catch (Exception ignored) {}
    }

    public static void sendBleNotificationToWeb(String text) {
        if (instance == null || instance.getBridge() == null || text == null) return;
        try {
            JSONObject json = new JSONObject();
            json.put("message", text);
            String payload = json.toString();
            String js = "try { window.dispatchEvent(new CustomEvent('nativeBleRx', { detail: " + payload + " })); } catch (e) {}";
            instance.runOnUiThread(() -> {
                WebView webView = instance.getBridge().getWebView();
                if (webView != null) webView.evaluateJavascript(js, null);
            });
        } catch (Exception ignored) {}
    }
}
