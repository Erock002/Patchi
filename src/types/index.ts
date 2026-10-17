export type DisplayMode = 'BOOT' | 'PLEX' | 'QR' | 'GIF';

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  rgbHex: string;
  artworkUrl?: string;
  artworkBlob?: Blob;
  positionSec?: number;
  durationSec?: number;
  isPlaying?: boolean;
}

export interface BlePacketLogItem {
  id: string;
  timestamp: string;
  type: 'CMD' | 'DATA' | 'SYSTEM' | 'ERROR' | 'RX';
  summary: string;
  raw?: string;
  bytesCount?: number;
}

export interface BleConnectionState {
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  rssi?: number;
  mtu: number;
  error: string | null;
  errorType?: 'SECURITY_IFRAME' | 'BLUETOOTH_OFF' | 'CANCELLED' | 'UNSUPPORTED' | 'GENERIC';
  transferProgress: number | null; // 0-100 or null if idle
  transferSpeedKbps: number;
  isVirtualMode: boolean; // simulated board if physical device not connected or Web BLE unsupported
  reconnecting?: boolean;
  reconnectAttempt?: number;
}

export interface GifPreset {
  id: string;
  name: string;
  category: string;
  url: string;
  sizeBytes: number;
  fps: number;
  description: string;
}

export interface VCardContact {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  website: string;
  organization?: string;
  title?: string;
  format: 'vcard' | 'mecard';
}
