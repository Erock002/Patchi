/**
 * Native Android Project Blueprint & Source Code Generator.
 * Provides Kotlin + Jetpack Compose code including a background NotificationListenerService
 * that automatically detects music playing on the Android phone (Spotify, Plex, Apple Music)
 * and beams album art & metadata over BLE to the WaveShare ESP32-S3!
 */

import React, { useState } from 'react';
import {
  Smartphone,
  Copy,
  Check,
  Code2,
  Download,
  Music,
  Bluetooth,
  FileCode,
  ShieldCheck,
  CheckCircle,
} from 'lucide-react';

const KOTLIN_BLE_MANAGER = `package com.waveshare.beamcontroller

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class BleManager(private val context: Context) {
    companion object {
        val SERVICE_UUID: UUID = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
        val CHAR_CMD_UUID: UUID = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")
        val CHAR_DATA_UUID: UUID = UUID.fromString("826f6405-10a0-422c-94f7-558b99e08374")
        private const val TAG = "BleManager"
    }

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter = bluetoothManager.adapter
    private var gatt: BluetoothGatt? = null
    private var cmdChar: BluetoothGattCharacteristic? = null
    private var dataChar: BluetoothGattCharacteristic? = null

    private val _isConnected = MutableStateFlow(false)
    val isConnected = _isConnected.asStateFlow()

    private val _transferProgress = MutableStateFlow<Int?>(null)
    val transferProgress = _transferProgress.asStateFlow()

    fun connectToBackpack(deviceAddress: String? = null) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner.startScan(listOf(filter), settings, object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (result.device.name == "Backpack-ESP32" || deviceAddress == result.device.address) {
                    scanner.stopScan(this)
                    connectGatt(result.device)
                }
            }
        })
    }

    private fun connectGatt(device: BluetoothDevice) {
        gatt = device.connectGatt(context, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.i(TAG, "Connected to ESP32! Requesting MTU 517...")
                    gatt.requestMtu(517)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    _isConnected.value = false
                    Log.i(TAG, "Disconnected.")
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                Log.i(TAG, "MTU Negotiated: $mtu. Discovering services...")
                gatt.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                val service = gatt.getService(SERVICE_UUID)
                cmdChar = service?.getCharacteristic(CHAR_CMD_UUID)
                dataChar = service?.getCharacteristic(CHAR_DATA_UUID)
                _isConnected.value = (cmdChar != null && dataChar != null)
                Log.i(TAG, "Ready for Backpack transmissions!")
            }
        }, BluetoothDevice.TRANSPORT_LE)
    }

    suspend fun sendCommand(cmd: String): Boolean = withContext(Dispatchers.IO) {
        val char = cmdChar ?: return@withContext false
        char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        char.value = cmd.toByteArray(Charsets.UTF_8)
        gatt?.writeCharacteristic(char) ?: false
    }

    suspend fun streamBinaryData(bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        val char = dataChar ?: return@withContext false
        val chunkSize = 500
        val totalChunks = (bytes.size + chunkSize - 1) / chunkSize

        for (i in 0 until totalChunks) {
            val start = i * chunkSize
            val end = minOf(start + chunkSize, bytes.size)
            val chunk = bytes.copyOfRange(start, end)

            char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            char.value = chunk
            gatt?.writeCharacteristic(char)

            _transferProgress.value = ((end.toFloat() / bytes.size) * 100).toInt()
            delay(12) // ensure ESP32 PSRAM memcpy stays buffer-safe
        }
        _transferProgress.value = null
        true
    }
}
`;

const KOTLIN_NOTIFICATION_LISTENER = `package com.waveshare.beamcontroller

import android.app.Notification
import android.graphics.Bitmap
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

/**
 * Automatically captures media playback from Plex, Spotify, Apple Music,
 * resizes album cover to 172x172 JPEG, and beams to WaveShare ESP32!
 */
class NowPlayingNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName
        // Monitor known music & media apps
        if (pkg.contains("spotify") || pkg.contains("plex") || pkg.contains("music") || pkg.contains("youtube")) {
            val extras = sbn.notification.extras
            val title = extras.getString(Notification.EXTRA_TITLE) ?: return
            val artist = extras.getString(Notification.EXTRA_TEXT) ?: "Unknown Artist"
            val album = extras.getString(Notification.EXTRA_SUB_TEXT) ?: ""

            val largeIcon = extras.getParcelable<Bitmap>(Notification.EXTRA_LARGE_ICON)
            
            CoroutineScope(Dispatchers.IO).launch {
                val ble = App.bleManager // Singleton instance
                if (!ble.isConnected.value) return@launch

                if (largeIcon != null) {
                    // Rescale to exact 172x172 px ST7789 display top
                    val scaled = Bitmap.createScaledBitmap(largeIcon, 172, 172, true)
                    val stream = ByteArrayOutputStream()
                    scaled.compress(Bitmap.CompressFormat.JPEG, 82, stream)
                    val jpegBytes = stream.toByteArray()

                    // Step 1: Prepare art buffer
                    ble.sendCommand("PREP_ART|\${jpegBytes.size}")
                    // Step 2: Stream binary chunks
                    ble.streamBinaryData(jpegBytes)
                }

                // Step 3: Send PLEX text metadata + Amber LED
                ble.sendCommand("PLEX|\$title|\$artist|\$album|#FF8800")
            }
        }
    }
}
`;

const ANDROID_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:name=".App"
        android:label="WaveShare Beam"
        android:icon="@mipmap/ic_launcher"
        android:theme="@style/Theme.Material3.Dark">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- Service that catches Spotify/Plex song updates automatically -->
        <service
            android:name=".NowPlayingNotificationListener"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
    </application>
</manifest>
`;

export const AndroidNativeCodeModal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'BLE' | 'LISTENER' | 'MANIFEST'>('LISTENER');
  const [copied, setCopied] = useState(false);

  const getCode = () => {
    switch (activeTab) {
      case 'BLE':
        return KOTLIN_BLE_MANAGER;
      case 'LISTENER':
        return KOTLIN_NOTIFICATION_LISTENER;
      case 'MANIFEST':
        return ANDROID_MANIFEST;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Introduction highlight */}
      <div className="p-4 bg-cyan-950/20 border border-cyan-800/40 rounded-2xl space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">
            Two Ways to Control Your ESP32-S3 from Android:
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-xs font-bold text-cyan-300 block mb-1">
              Method 1: Instant Web Bluetooth PWA (No Android Studio Needed!)
            </span>
            <p className="text-[11px] text-slate-300">
              Open this web app in Chrome on your Android phone and tap <strong>"Add to Home Screen"</strong>. It connects via native Web Bluetooth and transmits album art, GIFs, and QR codes instantly!
            </p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-xs font-bold text-amber-300 block mb-1">
              Method 2: Background Android Service (Kotlin)
            </span>
            <p className="text-[11px] text-slate-300">
              Use the provided Kotlin <code className="text-amber-200">NotificationListenerService</code> below. It runs in the background of your phone, listens to Spotify/Plex songs, resizes the album cover to 172x172, and beams updates to your ESP32 automatically!
            </p>
          </div>
        </div>
      </div>

      {/* Code Tabs */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="p-2.5 bg-slate-950 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('LISTENER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'LISTENER'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              NowPlayingListener.kt
            </button>
            <button
              onClick={() => setActiveTab('BLE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'BLE'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              BleManager.kt
            </button>
            <button
              onClick={() => setActiveTab('MANIFEST')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'MANIFEST'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              AndroidManifest.xml
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 border border-slate-700 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied to Clipboard' : 'Copy Code'}</span>
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-4 text-xs font-mono-code text-slate-300 leading-relaxed bg-slate-950/80">
          <pre>{getCode()}</pre>
        </div>
      </div>
    </div>
  );
};
