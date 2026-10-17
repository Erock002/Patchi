package com.patchi.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 24/7 Native Android Bluetooth LE Manager for Backpack-ESP32.
 * Operates directly inside the KeepAliveService foreground service process, completely
 * independent of Chromium WebView, Audio Focus, or JavaScript timers.
 *
 * Guarantees that Now Playing track changes and album artwork are beamed to the ESP32
 * display in real-time even when the phone screen is locked in a pocket.
 */
@SuppressLint("MissingPermission")
public class NativeBleManager {
    private static final String TAG = "DigiPatchNativeBle";
    private static final String PREF_NAME = "digipatch_ble_prefs";
    private static final String KEY_LAST_MAC = "last_connected_mac";

    // ESP32 UUIDs
    public static final UUID SERVICE_UUID   = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b");
    public static final UUID CHAR_CMD_UUID  = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8");
    public static final UUID CHAR_DATA_UUID = UUID.fromString("826f6405-10a0-422c-94f7-558b99e08374");
    public static final UUID CCCD_UUID      = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private static NativeBleManager instance;
    private final Context appContext;
    private final SharedPreferences prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService streamExecutor = Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicInteger currentStreamGen = new java.util.concurrent.atomic.AtomicInteger(0);
    private volatile String currentStreamingHash = null;

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic cmdCharacteristic;
    private BluetoothGattCharacteristic dataCharacteristic;

    private boolean isConnecting = false;
    private boolean isConnected = false;
    private boolean isIntentionalDisconnect = false;
    private String connectedDeviceName = null;
    private String targetMacAddress = null;

    // Cache of recent artwork JPEGs keyed by 8-char FNV-1a hash
    private final Map<String, byte[]> artworkCache = Collections.synchronizedMap(new HashMap<>());
    private String lastStreamedHash = "";
    private volatile boolean isStreamingArt = false;

    public static synchronized NativeBleManager getInstance(Context context) {
        if (instance == null && context != null) {
            instance = new NativeBleManager(context.getApplicationContext());
        }
        return instance;
    }

    private NativeBleManager(Context context) {
        this.appContext = context;
        this.prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        this.targetMacAddress = prefs.getString(KEY_LAST_MAC, null);

        BluetoothManager bm = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            this.bluetoothAdapter = bm.getAdapter();
        }
    }

    public synchronized boolean isConnected() {
        return isConnected && bluetoothGatt != null && cmdCharacteristic != null;
    }

    public synchronized String getConnectedDeviceName() {
        return connectedDeviceName;
    }

    public synchronized void setTargetDevice(String macAddress) {
        if (macAddress == null || macAddress.trim().isEmpty()) return;
        this.targetMacAddress = macAddress.trim();
        prefs.edit().putString(KEY_LAST_MAC, this.targetMacAddress).apply();
        Log.d(TAG, "Target ESP32 MAC saved: " + this.targetMacAddress);
    }

    /**
     * Connect to Backpack-ESP32 natively using saved MAC or by scanning
     */
    public synchronized void connect() {
        if (isConnected() || isConnecting) return;
        isIntentionalDisconnect = false;

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Log.w(TAG, "Bluetooth adapter not enabled");
            return;
        }

        if (targetMacAddress != null && BluetoothAdapter.checkBluetoothAddress(targetMacAddress)) {
            connectToMac(targetMacAddress);
        } else {
            scanAndConnect();
        }
    }

    private synchronized void connectToMac(String mac) {
        try {
            isConnecting = true;
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(mac);
            Log.d(TAG, "Connecting to ESP32 by MAC: " + mac);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                bluetoothGatt = device.connectGatt(appContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                bluetoothGatt = device.connectGatt(appContext, false, gattCallback);
            }
        } catch (Exception e) {
            isConnecting = false;
            Log.e(TAG, "Failed to connectToMac: " + e.getMessage(), e);
        }
    }

    private void scanAndConnect() {
        if (bluetoothAdapter == null || isConnecting || isConnected()) return;
        final BluetoothLeScanner scanner = bluetoothAdapter.getBluetoothLeScanner();
        if (scanner == null) return;

        isConnecting = true;
        Log.d(TAG, "Scanning for Backpack-ESP32...");

        ScanFilter filter = new ScanFilter.Builder()
            .setServiceUuid(new ParcelUuid(SERVICE_UUID))
            .build();

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        final ScanCallback scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice dev = result.getDevice();
                String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : dev.getName();
                if (name != null && (name.contains("Backpack") || name.contains("ESP32"))) {
                    Log.d(TAG, "Found target device in scan: " + name + " (" + dev.getAddress() + ")");
                    try {
                        scanner.stopScan(this);
                    } catch (Exception ignored) {}
                    setTargetDevice(dev.getAddress());
                    connectToMac(dev.getAddress());
                }
            }

            @Override
            public void onScanFailed(int errorCode) {
                isConnecting = false;
                Log.w(TAG, "Scan failed with error code: " + errorCode);
            }
        };

        try {
            scanner.startScan(Collections.singletonList(filter), settings, scanCallback);
            // Stop scanning after 12 seconds if not found
            mainHandler.postDelayed(() -> {
                try {
                    scanner.stopScan(scanCallback);
                    if (!isConnected() && isConnecting) {
                        isConnecting = false;
                        Log.d(TAG, "Scan timed out without finding Backpack-ESP32");
                    }
                } catch (Exception ignored) {}
            }, 12000);
        } catch (Exception e) {
            isConnecting = false;
            Log.e(TAG, "Error starting scan: " + e.getMessage(), e);
        }
    }

    public synchronized void disconnect() {
        isIntentionalDisconnect = true;
        isConnecting = false;
        mainHandler.removeCallbacks(progressSyncRunnable);
        if (bluetoothGatt != null) {
            try {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            } catch (Exception ignored) {}
            bluetoothGatt = null;
        }
        cmdCharacteristic = null;
        dataCharacteristic = null;
        isConnected = false;
        notifyWebConnectionState(false, null, null);
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            Log.d(TAG, "onConnectionStateChange status=" + status + " newState=" + newState);
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                isConnected = true;
                isConnecting = false;
                connectedDeviceName = gatt.getDevice().getName();
                if (connectedDeviceName == null) connectedDeviceName = "Backpack-ESP32";
                setTargetDevice(gatt.getDevice().getAddress());
                Log.d(TAG, "GATT Connected to " + connectedDeviceName + "! Discovering services...");

                mainHandler.postDelayed(() -> {
                    if (bluetoothGatt != null) {
                        bluetoothGatt.discoverServices();
                    }
                }, 300);

            } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "GATT Disconnected (status " + status + ")");
                isConnected = false;
                isConnecting = false;
                cmdCharacteristic = null;
                dataCharacteristic = null;
                mainHandler.removeCallbacks(progressSyncRunnable);
                notifyWebConnectionState(false, null, "Disconnected");

                if (bluetoothGatt != null) {
                    try {
                        bluetoothGatt.close();
                    } catch (Exception ignored) {}
                    bluetoothGatt = null;
                }

                // Seamless background auto-reconnect if disconnection was accidental
                if (!isIntentionalDisconnect) {
                    mainHandler.postDelayed(() -> {
                        if (!isConnected() && !isConnecting && !isIntentionalDisconnect) {
                            Log.d(TAG, "Triggering seamless background auto-reconnect...");
                            connect();
                        }
                    }, 2800);
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.w(TAG, "onServicesDiscovered failed status=" + status);
                return;
            }

            BluetoothGattService service = gatt.getService(SERVICE_UUID);
            if (service == null) {
                Log.w(TAG, "Service " + SERVICE_UUID + " not found on ESP32");
                return;
            }

            cmdCharacteristic = service.getCharacteristic(CHAR_CMD_UUID);
            dataCharacteristic = service.getCharacteristic(CHAR_DATA_UUID);

            if (cmdCharacteristic != null) {
                Log.d(TAG, "CMD and DATA characteristics discovered successfully!");

                // 1. Request MTU 512 for high throughput
                gatt.requestMtu(512);

                // 2. Request high connection priority
                gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);

                // 3. Enable notifications on CMD characteristic for NEED_ART and CACHE_HIT
                mainHandler.postDelayed(() -> {
                    enableCmdNotifications(gatt, cmdCharacteristic);
                }, 350);

                mainHandler.removeCallbacks(progressSyncRunnable);
                mainHandler.postDelayed(progressSyncRunnable, 15000);

                notifyWebConnectionState(true, connectedDeviceName, null);
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            Log.d(TAG, "MTU changed to " + mtu + " (status " + status + ")");
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            byte[] value = characteristic.getValue();
            handleIncomingNotification(value);
        }

        // Android 13+ (API 33) overload
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            handleIncomingNotification(value);
        }
    };

    private void enableCmdNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic ch) {
        try {
            gatt.setCharacteristicNotification(ch, true);
            BluetoothGattDescriptor desc = ch.getDescriptor(CCCD_UUID);
            if (desc != null) {
                desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                gatt.writeDescriptor(desc);
                Log.d(TAG, "Enabled notifications on CHAR_CMD_UUID");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to enable notifications: " + e.getMessage());
        }
    }

    private final Runnable progressSyncRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (isConnected()) {
                    android.media.session.MediaController mc = MediaNotificationListener.getActiveMediaController();
                    if (mc != null) {
                        MediaNotificationListener.PlaybackProgress prog = MediaNotificationListener.extractProgress(mc);
                        if (prog != null && prog.isPlaying && prog.durationSec > 0) {
                            sendProgress(prog.positionSec, prog.durationSec, true);
                        }
                    }
                }
            } catch (Exception ignored) {}
            if (isConnected()) {
                mainHandler.postDelayed(this, 15000);
            }
        }
    };

    public synchronized void setPreferredStyle(String style) {
        if (style != null && !style.trim().isEmpty()) {
            String oldStyle = getPreferredStyle();
            String newStyle = style.trim().toLowerCase();
            prefs.edit().putString("preferred_style", newStyle).apply();
            Log.d(TAG, "Preferred layout style saved: " + newStyle);
            if (!newStyle.equals(oldStyle)) {
                MediaNotificationListener.rebroadcastWithNewStyle(newStyle);
            }
        }
    }

    public synchronized String getPreferredStyle() {
        return prefs.getString("preferred_style", "scrubber");
    }

    public void sendProgress(int positionSec, int durationSec, boolean isPlaying) {
        if (!isConnected()) return;
        String cmd = "PROG|" + Math.max(0, positionSec) + "|" + Math.max(0, durationSec) + "|" + (isPlaying ? "1" : "0");
        sendCommand(cmd);
    }

    private void handleIncomingNotification(byte[] value) {
        if (value == null || value.length == 0) return;
        String text = new String(value, StandardCharsets.UTF_8).trim();
        Log.d(TAG, "[ESP32 NOTIFY] " + text);

        // Forward to WebView so simulator and UI logs stay in sync
        MainActivity.sendBleNotificationToWeb(text);

        if (text.startsWith("NEED_ART|")) {
            String hash = text.substring(9).trim();
            byte[] cached = artworkCache.get(hash);
            if (cached != null && cached.length > 0) {
                Log.d(TAG, "Fulfilling NEED_ART natively for hash " + hash + " (" + cached.length + " bytes)");
                streamArtwork(cached, hash);
            } else {
                Log.w(TAG, "NEED_ART requested hash " + hash + " but not found in native cache");
            }
        } else if (text.startsWith("CACHE_HIT|")) {
            String hash = text.substring(10).trim();
            lastStreamedHash = hash;
            Log.d(TAG, "ESP32 reported MicroSD CACHE_HIT for hash " + hash + " (loaded in 15ms!)");
        }
    }

    /**
     * Send Now Playing metadata and stream album art completely natively in Java.
     * Guaranteed to work 24/7 when the phone screen is locked.
     */
    public void sendNowPlaying(String title, String artist, String album, String rgbHex, byte[] jpegBytes) {
        sendNowPlaying(title, artist, album, rgbHex, jpegBytes, 0, 0, true);
    }

    public void sendNowPlaying(String title, String artist, String album, String rgbHex, byte[] jpegBytes, int positionSec, int durationSec, boolean isPlaying) {
        if (!isConnected()) {
            Log.d(TAG, "sendNowPlaying called but not connected — initiating native auto-connect...");
            connect();
            return;
        }

        executor.execute(() -> {
            try {
                String cleanTitle = (title != null ? title : "Unknown Title").replace("|", "-").trim();
                String cleanArtist = (artist != null ? artist : "Unknown Artist").replace("|", "-").trim();
                String cleanAlbum = (album != null ? album : "").replace("|", "-").trim();
                String cleanHex = (rgbHex != null && !rgbHex.isEmpty()) ? rgbHex.replace("#", "") : "FF8800";
                String style = getPreferredStyle();

                // Generate deterministic 8-char FNV-1a hash incorporating style
                String artHash = generateAlbumHash(cleanArtist, cleanAlbum, cleanTitle, style);
                String unstyledHash = generateAlbumHash(cleanArtist, cleanAlbum, cleanTitle, null);

                if (jpegBytes != null && jpegBytes.length > 0) {
                    artworkCache.put(artHash, jpegBytes);
                    artworkCache.put(unstyledHash, jpegBytes);
                }

                // Immediately cancel any previous song's active stream!
                currentStreamGen.incrementAndGet();

                // 1. Send PLEX command with user's preferred layout style and progress
                String plexCmd = "PLEX|" + cleanTitle + "|" + cleanArtist + "|" + cleanAlbum + "|#" + cleanHex + "|" + style + "|" + artHash
                    + "|" + Math.max(0, positionSec) + "|" + Math.max(0, durationSec) + "|" + (isPlaying ? "1" : "0");
                Log.d(TAG, "Natively beaming command: " + plexCmd);
                sendCommand(plexCmd);

                // If visualizer mode, album art is not displayed
                if ("visualizer".equalsIgnoreCase(style) || "3".equals(style)) {
                    return;
                }

                // 2. Scheduled fallback art stream:
                // If ESP32 has MicroSD and cache hit, it sends CACHE_HIT within 20ms, marking lastStreamedHash = artHash.
                // If it's a cache miss, ESP32 sends NEED_ART immediately, triggering streamArtwork and marking lastStreamedHash upon completion.
                // If ESP32 has no MicroSD or notification dropped, this 400ms fallback guarantees the art streams!
                if (jpegBytes != null && jpegBytes.length > 0) {
                    final String targetHash = artHash;
                    final byte[] artData = jpegBytes;
                    mainHandler.postDelayed(() -> {
                        if (isConnected() && !targetHash.equals(lastStreamedHash)) {
                            Log.d(TAG, "Fallback streaming art for hash " + targetHash + " (no CACHE_HIT / NEED_ART received)");
                            streamArtwork(artData, targetHash);
                        }
                    }, 400);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in sendNowPlaying: " + e.getMessage(), e);
            }
        });
    }

    /**
     * Send text command to CHAR_CMD_UUID
     */
    public synchronized boolean sendCommand(String command) {
        if (!isConnected() || cmdCharacteristic == null) {
            Log.w(TAG, "Cannot send command: not connected");
            return false;
        }

        try {
            byte[] bytes = command.getBytes(StandardCharsets.UTF_8);
            return writeCharacteristicNoResponse(cmdCharacteristic, bytes);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send command: " + e.getMessage());
            return false;
        }
    }

    /**
     * Stream binary artwork (172x172 or 172x320 JPEG) to CHAR_DATA_UUID in 240-byte chunks
     * with write-retry protection, dedicated stream thread, and immediate generation cancellation.
     */
    public void streamArtwork(byte[] jpegBytes, String artHash) {
        if (!isConnected() || dataCharacteristic == null || jpegBytes == null || jpegBytes.length == 0) return;
        if (artHash != null && artHash.equals(currentStreamingHash) && isStreamingArt) {
            Log.d(TAG, "Artwork stream already in-flight for this exact hash " + artHash + " — skipping duplicate");
            return;
        }

        final int gen = currentStreamGen.incrementAndGet();
        currentStreamingHash = artHash;

        streamExecutor.execute(() -> {
            if (gen != currentStreamGen.get()) {
                Log.d(TAG, "Stream gen " + gen + " superseded before starting for " + artHash);
                return;
            }
            isStreamingArt = true;
            try {
                Log.d(TAG, "Native BLE streaming " + jpegBytes.length + " bytes for hash " + artHash + " (gen=" + gen + ")");

                // 1. Send PREP_ART|<size>
                sendCommand("PREP_ART|" + jpegBytes.length);
                Thread.sleep(60);

                // 2. Stream in 240-byte chunks with reliable write-retry & stable pacing
                int chunkSize = 240;
                int offset = 0;

                while (offset < jpegBytes.length && isConnected()) {
                    if (gen != currentStreamGen.get()) {
                        Log.d(TAG, "Aborting stale artwork stream for " + artHash + " (superseded by newer song/style)");
                        return;
                    }

                    int end = Math.min(offset + chunkSize, jpegBytes.length);
                    byte[] chunk = Arrays.copyOfRange(jpegBytes, offset, end);

                    boolean sent = false;
                    for (int retry = 0; retry < 5; retry++) {
                        if (gen != currentStreamGen.get()) return;
                        if (writeCharacteristicNoResponse(dataCharacteristic, chunk)) {
                            sent = true;
                            break;
                        }
                        Thread.sleep(15 + retry * 10);
                    }

                    if (!sent) {
                        Log.e(TAG, "Failed to send chunk at byte " + offset + " after 5 retries. Aborting stream.");
                        return;
                    }

                    offset = end;

                    // 22ms stable pacing prevents Android GATT queue overflow
                    Thread.sleep(22);
                }

                if (isConnected() && gen == currentStreamGen.get()) {
                    Thread.sleep(80);
                    // 3. Send SHOW_ART|<size>|<hash>
                    sendCommand("SHOW_ART|" + jpegBytes.length + "|" + artHash);
                    lastStreamedHash = artHash;
                    Log.d(TAG, "Successfully streamed & finalized artwork (" + jpegBytes.length + " bytes) for " + artHash);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error streaming artwork: " + e.getMessage(), e);
            } finally {
                if (gen == currentStreamGen.get()) {
                    isStreamingArt = false;
                    currentStreamingHash = null;
                }
            }
        });
    }

    private boolean writeCharacteristicNoResponse(BluetoothGattCharacteristic ch, byte[] data) {
        if (bluetoothGatt == null || ch == null || data == null) return false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int res = bluetoothGatt.writeCharacteristic(ch, data, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                return res == BluetoothStatusCodes.SUCCESS;
            } else {
                ch.setValue(data);
                ch.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                return bluetoothGatt.writeCharacteristic(ch);
            }
        } catch (Exception e) {
            Log.w(TAG, "writeCharacteristicNoResponse failed: " + e.getMessage());
            return false;
        }
    }

    private void notifyWebConnectionState(boolean connected, String deviceName, String error) {
        MainActivity.sendBleStateToWeb(connected, deviceName, error);
    }

    /**
     * Exact FNV-1a 32-bit hash matching imageUtils.ts generateAlbumHash
     */
    public static String generateAlbumHash(String artist, String albumOrTitle, String title) {
        return generateAlbumHash(artist, albumOrTitle, title, null);
    }

    public static String generateAlbumHash(String artist, String albumOrTitle, String title, String style) {
        String cleanArtist = (artist != null ? artist : "").trim().toLowerCase();
        String cleanAlbum = (albumOrTitle != null ? albumOrTitle : "").trim().toLowerCase();

        String[] genericTerms = {"spotify", "plexamp", "music", "sound", "audio", "unknown album", "unknown", "single"};
        boolean isGeneric = false;
        for (String g : genericTerms) {
            if (cleanAlbum.isEmpty() || cleanAlbum.equals(g)) {
                isGeneric = true;
                break;
            }
        }
        if (isGeneric && title != null && !title.trim().isEmpty()) {
            cleanAlbum = title.trim().toLowerCase();
        }

        cleanAlbum = cleanAlbum
            .replaceAll("(?i)\\s*\\(.*?deluxe.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?deluxe.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?remaster.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?remaster.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?anniversary.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?anniversary.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?edition.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?edition.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?version.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?version.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?bonus.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?bonus.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?expanded.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?expanded.*?\\]", "")
            .replaceAll("(?i)\\s*\\(.*?special.*?\\)", "")
            .replaceAll("(?i)\\s*\\[.*?special.*?\\]", "")
            .trim();

        String clean = cleanArtist + ":::" + cleanAlbum + (style != null && !style.trim().isEmpty() ? ":::" + style.trim().toLowerCase() : "");
        int hash = (int) 0x811c9dc5L;
        for (int i = 0; i < clean.length(); i++) {
            hash ^= (int) clean.charAt(i);
            hash = hash * 0x01000193;
        }
        long unsignedHash = hash & 0xFFFFFFFFL;
        String hex = Long.toHexString(unsignedHash);
        while (hex.length() < 8) {
            hex = "0" + hex;
        }
        return hex;
    }
}
