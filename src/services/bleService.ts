/**
 * Hybrid Bluetooth Service for Backpack-ESP32:
 * Supports BOTH:
 *  1. Native Android BLE via @capacitor-community/bluetooth-le (when running inside the installed APK)
 *  2. Web Bluetooth API (when running in standalone Google Chrome / Edge)
 *  3. In-app browser detection with 1-click launcher for real Chrome on Pixel
 */

import { BleConnectionState, BlePacketLogItem } from '../types';
import { Capacitor } from '@capacitor/core';
import { BleClient, ConnectionPriority, numbersToDataView } from '@capacitor-community/bluetooth-le';

export const BLE_CONFIG = {
  SERVICE_UUID: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
  CHAR_CMD_UUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
  CHAR_DATA_UUID: '826f6405-10a0-422c-94f7-558b99e08374',
  CHUNK_SIZE_DEFAULT: 240, // 240 bytes safely fits into Android BLE ATT MTU default bounds (247 - 3)
  CHUNK_DELAY_MS: 20,     // 20ms stable pacing prevents Android GATT queue overflow and drops 0 packets
};

type StateListener = (state: BleConnectionState) => void;
type LogListener = (log: BlePacketLogItem) => void;
type VirtualMediaListener = (type: 'ART' | 'GIF', buffer: ArrayBuffer, hex?: string) => void;
export type BleNotificationListener = (message: string) => void;

class HybridBleManager {
  // Web Bluetooth handles
  private webDevice: any = null;
  private webServer: any = null;
  private webCmdChar: any = null;
  private webDataChar: any = null;

  // Native Capacitor device handle
  private nativeDeviceId: string | null = null;
  private isNative: boolean = false;
  private nativeInitialized: boolean = false;

  // Auto-reconnect & keepalive state
  private isIntentionalDisconnect: boolean = false;
  private autoReconnectEnabled: boolean = true;
  private reconnectTimer: any = null;
  private reconnectAttempt: number = 0;
  private keepAliveTimer: any = null;
  private isReconnecting: boolean = false;

  // Single-channel GATT queue & transfer abort controller to prevent GATT congestion / collision
  private bleQueuePromise: Promise<any> = Promise.resolve();
  private currentTransferAbort: boolean = false;

  private state: BleConnectionState = {
    connected: false,
    connecting: false,
    deviceName: null,
    mtu: 512,
    error: null,
    transferProgress: null,
    transferSpeedKbps: 0,
    isVirtualMode: false,
    reconnecting: false,
    reconnectAttempt: 0,
  };

  private stateListeners: Set<StateListener> = new Set();
  private logListeners: Set<LogListener> = new Set();
  private virtualMediaListeners: Set<VirtualMediaListener> = new Set();
  private notificationListeners: Set<BleNotificationListener> = new Set();

  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    if (this.isNative) {
      this.initNativeBle();
    }

    // Auto-connect on startup if previously paired & listen for native BLE events
    if (typeof window !== 'undefined') {
      const savedId = localStorage.getItem('BACKPACK_BLE_LAST_DEVICE_ID');
      if (savedId && (window as any).AndroidBridge?.setTargetDevice) {
        try {
          (window as any).AndroidBridge.setTargetDevice(savedId);
        } catch (ignored) {}
      }

      window.addEventListener('nativeBleConnection', (e: any) => {
        if (e && e.detail) {
          if (e.detail.connected) {
            this.notifyState({
              connected: true,
              connecting: false,
              deviceName: e.detail.deviceName || 'Backpack-ESP32',
              error: null,
            });
          } else {
            this.notifyState({
              connected: false,
              connecting: false,
              deviceName: null,
              error: e.detail.error || null,
            });
          }
        }
      });

      window.addEventListener('nativeBleRx', (e: any) => {
        if (e && e.detail && e.detail.message) {
          this.handleIncomingNotification(e.detail.message);
        }
      });

      setTimeout(() => {
        this.tryAutoConnect().catch(() => {});
      }, 800);
    }
  }

  private async initNativeBle() {
    try {
      await BleClient.initialize();
      this.nativeInitialized = true;
      this.addLog('SYSTEM', 'Capacitor Native BLE initialized successfully');
    } catch (e: any) {
      console.warn('Native BLE init error:', e);
    }
  }

  public getState(): BleConnectionState {
    return { ...this.state };
  }

  public isNativeApp(): boolean {
    return this.isNative;
  }

  public isInAppBrowser(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    // Detect typical in-app webviews (Instagram, Facebook, Twitter, Slack, Gmail, or Android WebView)
    const isWebView =
      ua.includes('wv') ||
      ua.includes('Version/4.0') ||
      (ua.includes('Android') && ua.includes('FBAN/')) ||
      (ua.includes('Android') && ua.includes('Instagram')) ||
      (ua.includes('Android') && ua.includes('GSA/'));
    return isWebView && !this.isNative;
  }

  public setAutoReconnect(enabled: boolean) {
    this.autoReconnectEnabled = enabled;
  }

  public isAutoReconnect(): boolean {
    return this.autoReconnectEnabled;
  }

  /**
   * Cancel any in-progress binary transfer immediately so new song data is not delayed or corrupted
   */
  public cancelBinaryTransfer() {
    this.currentTransferAbort = true;
    this.notifyState({ transferProgress: null });
  }

  /**
   * Sequential GATT queue: Enforces strictly ONE write operation at a time on Android BLE stack
   */
  private enqueueBleOp<T>(op: () => Promise<T>): Promise<T> {
    const next = this.bleQueuePromise.then(
      () => op(),
      () => op() // continue queue even if previous op failed
    );
    this.bleQueuePromise = next.catch(() => {});
    return next;
  }

  public subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  public subscribeLogs(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  public subscribeVirtualMedia(listener: VirtualMediaListener): () => void {
    this.virtualMediaListeners.add(listener);
    return () => this.virtualMediaListeners.delete(listener);
  }

  private notifyState(partial: Partial<BleConnectionState>) {
    this.state = { ...this.state, ...partial };
    this.stateListeners.forEach((l) => l(this.getState()));

    if (partial.connected) {
      if (typeof window !== 'undefined' && (window as any).AndroidBridge?.startKeepAlive) {
        try {
          (window as any).AndroidBridge.startKeepAlive();
        } catch (e) {
          console.warn('AndroidBridge startKeepAlive notice:', e);
        }
      }
    }
  }

  private addLog(
    type: BlePacketLogItem['type'],
    summary: string,
    raw?: string,
    bytesCount?: number
  ) {
    const item: BlePacketLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      summary,
      raw,
      bytesCount,
    };
    this.logListeners.forEach((l) => l(item));
  }

  /**
   * Main Connect entry point: routes to Native Android BLE or Web Bluetooth
   */
  public async connect(): Promise<boolean> {
    this.isIntentionalDisconnect = false;
    this.notifyState({ connecting: true, error: null, errorType: undefined });

    // ROUTE 1: Native Android APK (Capacitor)
    if (this.isNative) {
      return await this.connectNative();
    }

    // ROUTE 2: Web Browser (Chrome on Android / Desktop)
    return await this.connectWeb();
  }

  /**
   * Background Auto-Connect to last remembered device without user interaction
   */
  public async tryAutoConnect(): Promise<boolean> {
    if (this.state.connected || this.state.connecting) return false;

    // Native route: use saved device ID
    if (this.isNative) {
      const savedId = localStorage.getItem('BACKPACK_BLE_LAST_DEVICE_ID');
      if (savedId) {
        this.addLog('SYSTEM', `Auto-reconnecting to remembered device ${savedId}...`);
        return await this.connectNativeById(savedId);
      }
    }

    // Web route: inspect navigator.bluetooth.getDevices()
    const navBt = (navigator as any)?.bluetooth;
    if (navBt && typeof navBt.getDevices === 'function') {
      try {
        const devices = await navBt.getDevices();
        const backpack = devices.find((d: any) =>
          d.name?.toLowerCase().includes('backpack') || d.name?.toLowerCase().includes('esp32')
        );
        if (backpack) {
          this.addLog('SYSTEM', `Auto-reconnecting to paired device: ${backpack.name}...`);
          return await this.connectWebWithDevice(backpack);
        }
      } catch {
        // silent
      }
    }

    return false;
  }

  /**
   * Connect natively using an already known deviceId (bypasses device picker dialog)
   */
  private async connectNativeById(deviceId: string): Promise<boolean> {
    try {
      if (!this.nativeInitialized) {
        await BleClient.initialize();
        this.nativeInitialized = true;
      }

      this.nativeDeviceId = deviceId;
      if (typeof window !== 'undefined' && (window as any).AndroidBridge?.setTargetDevice) {
        try {
          (window as any).AndroidBridge.setTargetDevice(deviceId);
        } catch (ignored) {}
      }
      await BleClient.connect(deviceId, () => {
        this.handleDisconnection();
      });

      this.isIntentionalDisconnect = false;
      this.reconnectAttempt = 0;
      this.isReconnecting = false;
      this.startKeepAlive();

      const name = localStorage.getItem('BACKPACK_BLE_LAST_DEVICE_NAME') || 'Backpack-ESP32';
      this.notifyState({
        connected: true,
        connecting: false,
        reconnecting: false,
        reconnectAttempt: 0,
        deviceName: name,
        mtu: 512,
        error: null,
      });

      try {
        await (BleClient as any).requestMtu?.(deviceId, 512);
      } catch (mErr) {
        console.warn('Native auto-connect MTU notice:', mErr);
      }

      try {
        await BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH);
      } catch (pErr) {
        console.warn('Native auto-connect priority notice:', pErr);
      }

      try {
        await BleClient.startNotifications(
          deviceId,
          BLE_CONFIG.SERVICE_UUID,
          BLE_CONFIG.CHAR_CMD_UUID,
          (value) => {
            const text = new TextDecoder().decode(value);
            this.handleIncomingNotification(text);
          }
        );
      } catch (e) {
        console.warn('Native auto-connect startNotifications notice:', e);
      }

      this.addLog('SYSTEM', `Reconnected successfully to ${name}!`);
      return true;
    } catch (err: any) {
      console.warn('Native auto-connect error:', err);
      return false;
    }
  }

  /**
   * Native Android BLE Connection via Capacitor
   */
  private async connectNative(): Promise<boolean> {
    try {
      if (!this.nativeInitialized) {
        await BleClient.initialize();
        this.nativeInitialized = true;
      }

      this.addLog('SYSTEM', 'Requesting native BLE device Backpack-ESP32...');
      
      const device = await BleClient.requestDevice({
        services: [BLE_CONFIG.SERVICE_UUID],
        name: 'Backpack-ESP32',
        namePrefix: 'Backpack',
      });

      this.nativeDeviceId = device.deviceId;
      localStorage.setItem('BACKPACK_BLE_LAST_DEVICE_ID', device.deviceId);
      localStorage.setItem('BACKPACK_BLE_LAST_DEVICE_NAME', device.name || 'Backpack-ESP32');
      if (typeof window !== 'undefined' && (window as any).AndroidBridge?.setTargetDevice) {
        try {
          (window as any).AndroidBridge.setTargetDevice(device.deviceId);
        } catch (ignored) {}
      }
      this.addLog('SYSTEM', `Found Backpack-ESP32 (${device.deviceId}). Connecting...`);

      await BleClient.connect(device.deviceId, (deviceId) => {
        this.handleDisconnection();
      });

      this.isIntentionalDisconnect = false;
      this.reconnectAttempt = 0;
      this.isReconnecting = false;
      this.startKeepAlive();

      this.notifyState({
        connected: true,
        connecting: false,
        reconnecting: false,
        reconnectAttempt: 0,
        deviceName: device.name || 'Backpack-ESP32',
        mtu: 512,
        error: null,
      });

      try {
        await (BleClient as any).requestMtu?.(device.deviceId, 512);
      } catch (mErr) {
        console.warn('Native connection MTU notice:', mErr);
      }

      try {
        await BleClient.requestConnectionPriority(device.deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH);
      } catch (pErr) {
        console.warn('Native connection priority notice:', pErr);
      }

      try {
        await BleClient.startNotifications(
          device.deviceId,
          BLE_CONFIG.SERVICE_UUID,
          BLE_CONFIG.CHAR_CMD_UUID,
          (value) => {
            const text = new TextDecoder().decode(value);
            this.handleIncomingNotification(text);
          }
        );
      } catch (e) {
        console.warn('Native startNotifications notice:', e);
      }

      this.addLog('SYSTEM', 'Native BLE Connected to Backpack-ESP32!');
      return true;
    } catch (err: any) {
      console.error('Native BLE error:', err);
      const msg = err.message || 'Failed to connect via Android BLE';
      this.notifyState({
        connecting: false,
        connected: false,
        reconnecting: false,
        error: msg,
        errorType: 'GENERIC',
      });
      return false;
    }
  }

  /**
   * Web Bluetooth API Connection
   */
  private async connectWeb(): Promise<boolean> {
    const nav = navigator as any;

    if (!nav.bluetooth) {
      const inApp = this.isInAppBrowser();
      const inIframe = typeof window !== 'undefined' && window.self !== window.top;

      let errorMsg = 'Web Bluetooth requires standalone Google Chrome on your Pixel or PC.';
      let errorType: BleConnectionState['errorType'] = 'UNSUPPORTED';

      if (inApp) {
        errorMsg = 'You are in an In-App browser (like Gmail or Discord) which blocks Bluetooth. Tap the menu in the top-right and select "Open in Chrome".';
        errorType = 'SECURITY_IFRAME';
      } else if (inIframe) {
        errorMsg = 'Bluetooth is blocked inside embedded iframe previews. Open the direct link in Google Chrome.';
        errorType = 'SECURITY_IFRAME';
      }

      this.notifyState({
        connecting: false,
        connected: false,
        error: errorMsg,
        errorType,
      });
      this.addLog('ERROR', errorMsg);
      return false;
    }

    try {
      this.addLog('SYSTEM', 'Opening Web Bluetooth device prompt...');

      const navBt = nav.bluetooth;
      let device: any;
      try {
        device = await navBt.requestDevice({
          filters: [
            { name: 'Backpack-ESP32' },
            { namePrefix: 'Backpack' },
          ],
          optionalServices: [BLE_CONFIG.SERVICE_UUID],
        });
      } catch (filterErr: any) {
        if (filterErr.name === 'NotFoundError') {
          throw filterErr;
        }
        device = await navBt.requestDevice({
          acceptAllDevices: true,
          optionalServices: [BLE_CONFIG.SERVICE_UUID],
        });
      }

      return await this.connectWebWithDevice(device);
    } catch (err: any) {
      console.error('Web BLE error:', err);
      let errorType: BleConnectionState['errorType'] = 'GENERIC';
      let msg = err.message || 'Failed to connect';

      if (err.name === 'NotFoundError') {
        errorType = 'CANCELLED';
        msg = 'Connection prompt was cancelled.';
      } else if (err.name === 'SecurityError') {
        errorType = 'SECURITY_IFRAME';
        msg = 'Browser security prevented Bluetooth access. Ensure the app is open in a direct Chrome tab.';
      }

      this.notifyState({
        connecting: false,
        connected: false,
        error: msg,
        errorType,
      });
      return false;
    }
  }

  /**
   * Connect to an existing Web Bluetooth BluetoothDevice handle
   */
  private async connectWebWithDevice(device: any): Promise<boolean> {
    try {
      this.webDevice = device;
      this.webDevice.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnection();
      });

      this.addLog('SYSTEM', `Found device: ${this.webDevice.name}. Connecting to GATT...`);
      this.webServer = await this.webDevice.gatt.connect();

      this.addLog('SYSTEM', 'Discovering service & characteristics...');
      const service = await this.webServer.getPrimaryService(BLE_CONFIG.SERVICE_UUID);
      this.webCmdChar = await service.getCharacteristic(BLE_CONFIG.CHAR_CMD_UUID);
      this.webDataChar = await service.getCharacteristic(BLE_CONFIG.CHAR_DATA_UUID);

      this.isIntentionalDisconnect = false;
      this.reconnectAttempt = 0;
      this.isReconnecting = false;
      this.startKeepAlive();

      this.notifyState({
        connected: true,
        connecting: false,
        reconnecting: false,
        reconnectAttempt: 0,
        deviceName: this.webDevice.name || 'Backpack-ESP32',
        mtu: 512,
        error: null,
      });

      try {
        await this.webCmdChar.startNotifications();
        this.webCmdChar.addEventListener('characteristicvaluechanged', (event: any) => {
          const value = event.target.value;
          const text = new TextDecoder().decode(value);
          this.handleIncomingNotification(text);
        });
      } catch (e) {
        console.warn('Web BLE startNotifications notice:', e);
      }

      this.addLog('SYSTEM', 'Connected to Backpack-ESP32 successfully!');
      return true;
    } catch (err: any) {
      console.error('connectWebWithDevice error:', err);
      return false;
    }
  }

  public subscribeNotifications(listener: BleNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  private handleIncomingNotification(text: string) {
    if (!text || text.trim().length === 0) return;
    const cleanText = text.trim();
    this.addLog('RX', `ESP32: ${cleanText}`);
    this.notificationListeners.forEach((fn) => {
      try {
        fn(cleanText);
      } catch (err) {
        console.warn('Notification listener error:', err);
      }
    });
  }

  public disconnect() {
    this.isIntentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.isReconnecting = false;
    this.stopKeepAlive();

    if (this.isNative && this.nativeDeviceId) {
      BleClient.disconnect(this.nativeDeviceId).catch(() => {});
      this.nativeDeviceId = null;
    } else if (this.webDevice && this.webDevice.gatt?.connected) {
      this.webDevice.gatt.disconnect();
    }

    if (typeof window !== 'undefined' && (window as any).AndroidBridge?.stopKeepAlive) {
      try {
        (window as any).AndroidBridge.stopKeepAlive();
      } catch (e) {
        console.warn('AndroidBridge stopKeepAlive notice:', e);
      }
    }

    this.handleDisconnection();
  }

  private handleDisconnection() {
    this.stopKeepAlive();
    this.webDevice = null;
    this.webServer = null;
    this.webCmdChar = null;
    this.webDataChar = null;
    // Preserve nativeDeviceId for seamless auto-reconnect without hitting localStorage.
    // Only clear it on intentional user disconnect.
    const savedNativeId = this.nativeDeviceId;
    if (this.isIntentionalDisconnect) {
      this.nativeDeviceId = null;
    }

    this.notifyState({
      connected: false,
      connecting: false,
      deviceName: null,
      transferProgress: null,
      transferSpeedKbps: 0,
    });
    this.addLog('SYSTEM', 'Disconnected from Backpack-ESP32.');

    // Auto-reconnect seamlessly if disconnection was not intentional
    if (!this.isIntentionalDisconnect && this.autoReconnectEnabled) {
      if (savedNativeId) {
        localStorage.setItem('BACKPACK_BLE_LAST_DEVICE_ID', savedNativeId);
      }
      this.startAutoReconnect();
    }
  }

  private startAutoReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.isIntentionalDisconnect) return;

    this.reconnectAttempt++;
    this.isReconnecting = true;
    this.notifyState({
      reconnecting: true,
      reconnectAttempt: this.reconnectAttempt,
    });

    const isBackoff = this.reconnectAttempt >= 8;
    const delay = isBackoff ? 12000 : 2800;

    this.addLog(
      'SYSTEM',
      `Seamless Auto-reconnect (attempt ${this.reconnectAttempt}${isBackoff ? ' · 12s periodic' : ''})...`
    );

    this.reconnectTimer = setTimeout(async () => {
      const ok = await this.tryAutoConnect();
      if (!ok && !this.state.connected && !this.isIntentionalDisconnect) {
        this.startAutoReconnect();
      }
    }, delay);
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      if (this.state.connected && !this.state.transferProgress) {
        try {
          await this.sendCommand('PING');
        } catch {
          this.handleDisconnection();
        }
      }
    }, 22000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Send text command to CHAR_CMD_UUID (queued sequentially on the single GATT channel)
   */
  public async sendCommand(command: string): Promise<boolean> {
    return this.enqueueBleOp(async () => {
      // When a new mode/song command arrives, cancel any stale in-progress artwork streaming
      if (command.startsWith('PLEX|') || command.startsWith('QR|') || command.startsWith('CLEAR') || command.startsWith('WIPE')) {
        this.currentTransferAbort = true;
      }

      this.addLog('CMD', `Write CMD: ${command}`, command);

      // Check if GATT is still physically connected
      if (this.webDevice && this.webDevice.gatt && !this.webDevice.gatt.connected) {
        this.handleDisconnection();
        this.addLog('ERROR', 'GATT connection was lost. Please reconnect to BACKPACK-ESP32.');
        return false;
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(command);

      const withCmdTimeout = <T>(p: Promise<T>, ms: number = 4500): Promise<T> => {
        let timer: any;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('BLE command timed out')), ms);
        });
        return Promise.race([p, timeoutPromise]).finally(() => clearTimeout(timer));
      };

      // Native route (Try AndroidBridge NativeBleManager first, then Capacitor BLE)
      if (this.isNative) {
        if (typeof window !== 'undefined' && (window as any).AndroidBridge?.sendNativeBleCommand) {
          try {
            const ok = (window as any).AndroidBridge.sendNativeBleCommand(command);
            if (ok) {
              await new Promise((r) => setTimeout(r, 20));
              return true;
            }
          } catch (bridgeErr) {
            console.warn('NativeBridge sendNativeBleCommand notice:', bridgeErr);
          }
        }

        if (this.nativeDeviceId) {
          try {
            const dataView = new DataView(bytes.buffer);
          // Try writeWithoutResponse first for high responsiveness without GATT blocking
          await withCmdTimeout(
            BleClient.writeWithoutResponse(
              this.nativeDeviceId,
              BLE_CONFIG.SERVICE_UUID,
              BLE_CONFIG.CHAR_CMD_UUID,
              dataView
            ),
            4500
          );
          await new Promise((r) => setTimeout(r, 35));
          return true;
        } catch {
          try {
            const dataView = new DataView(bytes.buffer);
            await withCmdTimeout(
              BleClient.write(
                this.nativeDeviceId,
                BLE_CONFIG.SERVICE_UUID,
                BLE_CONFIG.CHAR_CMD_UUID,
                dataView
              ),
              4500
            );
            await new Promise((r) => setTimeout(r, 35));
            return true;
          } catch (e2: any) {
            this.addLog('ERROR', `Native CMD failed: ${e2.message}`);
            return false;
          }
        }
      }
    }

      // Web route (Chrome on Android / Desktop)
      if (this.webCmdChar) {
        try {
          const props = this.webCmdChar.properties;
          if (props?.writeWithoutResponse && typeof this.webCmdChar.writeValueWithoutResponse === 'function') {
            await withCmdTimeout(this.webCmdChar.writeValueWithoutResponse(bytes));
          } else if (typeof this.webCmdChar.writeValueWithResponse === 'function') {
            await withCmdTimeout(this.webCmdChar.writeValueWithResponse(bytes));
          } else {
            await withCmdTimeout(this.webCmdChar.writeValue(bytes));
          }
          return true;
        } catch (err: any) {
          try {
            if (typeof this.webCmdChar.writeValueWithResponse === 'function') {
              await withCmdTimeout(this.webCmdChar.writeValueWithResponse(bytes));
            } else {
              await withCmdTimeout(this.webCmdChar.writeValue(bytes));
            }
            return true;
          } catch (retryErr: any) {
            this.addLog('ERROR', `Web CMD failed: ${retryErr.message}`);
            return false;
          }
        }
      }

      this.addLog('ERROR', 'Not connected to BACKPACK-ESP32.');
      return false;
    });
  }

  private lastError: string | null = null;

  public getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Stream binary data (JPEG / GIF) in chunks to CHAR_DATA_UUID with:
   *  - Immediate abort when user switches songs (zero delay / no stale transfers)
   *  - Single-channel GATT queue locking to prevent Android Bluetooth congestion
   *  - Safe 240-byte packets (fits inside Android default MTU 247)
   *  - Adaptive yield every 12 chunks
   */
  public async sendBinaryData(
    buffer: ArrayBuffer,
    type: 'ART' | 'GIF',
    onProgress?: (pct: number) => void
  ): Promise<boolean> {
    this.currentTransferAbort = false;
    this.lastError = null;
    const totalBytes = buffer.byteLength;
    this.addLog('DATA', `Streaming ${(totalBytes / 1024).toFixed(1)} KB ${type}...`, undefined, totalBytes);

    if (!this.webDataChar && (!this.isNative || !this.nativeDeviceId)) {
      this.lastError = 'Not connected to BACKPACK-ESP32';
      this.addLog('ERROR', this.lastError);
      return false;
    }

    let chunkSize = BLE_CONFIG.CHUNK_SIZE_DEFAULT;
    const uint8View = new Uint8Array(buffer);
    let offset = 0;
    let chunkCount = 0;

    const withTimeout = <T>(p: Promise<T>, ms: number, msg: string): Promise<T> => {
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
      });
      return Promise.race([p, timeoutPromise]).finally(() => clearTimeout(timer));
    };

    const props = this.webDataChar?.properties;
    const supportsNR = Boolean(props?.writeWithoutResponse && typeof this.webDataChar?.writeValueWithoutResponse === 'function');
    const supportsResponse = Boolean(props?.write && (typeof this.webDataChar?.writeValueWithResponse === 'function' || typeof this.webDataChar?.writeValue === 'function'));

    try {
      while (offset < totalBytes) {
        if (this.currentTransferAbort) {
          this.addLog('SYSTEM', `${type} transfer cancelled for new track.`);
          throw new Error('ABORTED');
        }

        const end = Math.min(offset + chunkSize, totalBytes);
        const chunk = uint8View.slice(offset, end);

        let chunkSent = false;
        let lastChunkErr: any = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          if (this.currentTransferAbort) throw new Error('ABORTED');

          try {
            await this.enqueueBleOp(async () => {
              if (this.currentTransferAbort) throw new Error('ABORTED');

              if (this.isNative && this.nativeDeviceId) {
                const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                await withTimeout(
                  BleClient.writeWithoutResponse(
                    this.nativeDeviceId,
                    BLE_CONFIG.SERVICE_UUID,
                    BLE_CONFIG.CHAR_DATA_UUID,
                    dataView
                  ),
                  2500,
                  'Native BLE write timed out'
                );
              } else if (this.webDataChar) {
                if (this.webDevice && this.webDevice.gatt && !this.webDevice.gatt.connected) {
                  throw new Error('Bluetooth connection dropped during transfer');
                }

                if (supportsNR) {
                  await withTimeout(
                    this.webDataChar.writeValueWithoutResponse(chunk),
                    2500,
                    'Web BLE write timed out'
                  );
                } else if (supportsResponse) {
                  if (typeof this.webDataChar.writeValueWithResponse === 'function') {
                    await withTimeout(
                      this.webDataChar.writeValueWithResponse(chunk),
                      3500,
                      'Web BLE write timed out'
                    );
                  } else {
                    await withTimeout(
                      this.webDataChar.writeValue(chunk),
                      3500,
                      'Web BLE write timed out'
                    );
                  }
                } else {
                  await withTimeout(
                    this.webDataChar.writeValueWithoutResponse ? this.webDataChar.writeValueWithoutResponse(chunk) : this.webDataChar.writeValue(chunk),
                    2500,
                    'Web BLE write timed out'
                  );
                }
              }
            });

            chunkSent = true;
            break;
          } catch (writeErr: any) {
            if (writeErr?.message === 'ABORTED') throw writeErr;
            lastChunkErr = writeErr;
            const errMsg = writeErr?.message || '';

            if (chunkSize > 64 && (errMsg.includes('too large') || errMsg.includes('MTU') || errMsg.includes('exceed'))) {
              chunkSize = Math.max(64, Math.floor(chunkSize / 2));
              this.addLog('SYSTEM', `Adapting chunk size to ${chunkSize} bytes...`);
              break;
            }

            // If GATT link dropped mid-transfer, abort instead of retrying dead writes
            if (this.isNative && !this.nativeDeviceId) {
              throw new Error('BLE device disconnected during transfer');
            }
            if (!this.isNative && this.webDevice && !this.webDevice.gatt?.connected) {
              throw new Error('BLE GATT disconnected during transfer');
            }

            await new Promise((r) => setTimeout(r, 15 * attempt));
          }
        }

        if (!chunkSent) {
          throw new Error(lastChunkErr?.message || `Failed to send chunk at byte ${offset}`);
        }

        offset = end;
        chunkCount++;

        const progress = Math.min(100, Math.round((offset / totalBytes) * 100));
        this.notifyState({ transferProgress: progress });
        if (onProgress) onProgress(progress);

        if (chunkCount % 16 === 0) {
          await new Promise((r) => setTimeout(r, 12));
        } else if (BLE_CONFIG.CHUNK_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, BLE_CONFIG.CHUNK_DELAY_MS));
        }
      }

      this.notifyState({ transferProgress: null });
      this.virtualMediaListeners.forEach((l) => l(type, buffer));
      this.addLog('DATA', `Transferred ${totalBytes} bytes successfully (${chunkCount} chunks)`);
      return true;
    } catch (err: any) {
      this.notifyState({ transferProgress: null });
      if (err?.message === 'ABORTED') {
        return false;
      }
      this.lastError = err?.message || 'GATT operation failed';
      console.error('Binary stream error:', err);
      this.addLog('ERROR', `Transfer failed: ${this.lastError}`);
      return false;
    }
  }
}

export const bleService = new HybridBleManager();
