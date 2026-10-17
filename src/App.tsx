/**
 * Minimalist WaveShare ESP32-S3 (BACKPACK-ESP32) Controller & Screen Sync.
 * Features:
 *  - Gemini-style top-left dropdown (Now Playing, QR Code, GIF Player)
 *  - Top-right Connect/Disconnect for BACKPACK-ESP32
 *  - Instant Spotify Link Resolver & Song Search (600x600 album art)
 *  - Quick 1-tap song chips for immediate audio testing
 *  - Enlarged 172:320 hardware display preview with instant live sync
 *  - Now Playing with 3 layout options (Full Screen Art, Scrubber, Visualizer)
 *  - QR Code with Custom Words, Quick Titles, Link length safety & ESP32 sketch fix
 *  - GIF Player with auto-scaled upload
 *  - Reliable BLE transmission with disconnect guard & status feedback
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TrackMetadata, BleConnectionState, VCardContact } from './types';
import { bleService } from './services/bleService';
import { nowPlayingService } from './services/nowPlayingService';
import { processAlbumArt, dataUrlToArrayBuffer, generateAlbumHash } from './services/imageUtils';
import { backgroundKeepAlive } from './services/backgroundKeepAlive';
import { DEFAULT_VCARD_CONTACT, buildContactQrPayload } from './services/vcardUtils';

import {
  CURATED_GIF_PRESETS,
  generatePresetGif,
  optimizeUserGif,
  GifPresetItem,
} from './services/gifOptimizer';
import {
  Esp32HardwareSimulator,
  NowPlayingStyle,
} from './components/Esp32HardwareSimulator';
import { FirstTimeConnectWalkthrough } from './components/FirstTimeConnectWalkthrough';
import { FirmwareReviewModal } from './components/FirmwareReviewModal';
import { PixelNotificationGuideModal } from './components/PixelNotificationGuideModal';
import { MicroSdActivityModal, SdActivityState } from './components/MicroSdActivityModal';
import { VCardContactBuilder } from './components/VCardContactBuilder';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Music,
  QrCode,
  Film,
  Bluetooth,
  RefreshCw,
  Upload,
  Send,
  Check,
  Sparkles,
  Search,
  Code2,
  AlertTriangle,
  X,
  Copy,
  ExternalLink,
  ShieldAlert,
  Smartphone,
  Edit2,
  Trash2,
  HardDrive,
  Zap,
  Globe,
  User,
  Instagram,
  DollarSign,
  Wifi,
  Share2,
  Edit3,
  Lock,
  Phone,
  Mail,
} from 'lucide-react';

export type AppMode = 'NOW_PLAYING' | 'QR' | 'GIF';

export interface QrPresetItem {
  id: string;
  label: string;
  title: string;
  payload: string;
  placeholder: string;
  icon: 'instagram' | 'globe' | 'dollar' | 'wifi' | 'vcard' | 'custom';
  isCustom?: boolean;
  isVCard?: boolean;
}

export const DEFAULT_QR_PRESETS: QrPresetItem[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    title: 'MY INSTAGRAM',
    payload: 'https://instagram.com/',
    placeholder: 'https://instagram.com/yourhandle',
    icon: 'instagram',
  },
  {
    id: 'website',
    label: 'Website',
    title: 'MY WEBSITE',
    payload: 'https://',
    placeholder: 'https://yourwebsite.com',
    icon: 'globe',
  },
  {
    id: 'venmo',
    label: 'Pay / Venmo',
    title: 'PAY / VENMO',
    payload: 'https://venmo.com/',
    placeholder: 'https://venmo.com/yourhandle',
    icon: 'dollar',
  },
  {
    id: 'wifi',
    label: 'WiFi Access',
    title: 'WIFI ACCESS',
    payload: 'WIFI:S:MyNetwork;T:WPA;P:Password;;',
    placeholder: 'WIFI:S:NetworkName;T:WPA;P:Password;;',
    icon: 'wifi',
  },
  {
    id: 'vcard',
    label: 'Contact Card',
    title: 'MY CONTACT',
    payload: '',
    placeholder: 'Scan to Save Contact',
    icon: 'vcard',
    isVCard: true,
  },
  {
    id: 'custom',
    label: 'Custom',
    title: 'SCAN ME',
    payload: 'https://',
    placeholder: 'Enter any link, text, or URL',
    icon: 'custom',
    isCustom: true,
  },
];

export interface CustomGifItem {
  id: string;
  name: string;
  category: string;
  base64Data: string;
}

export interface UnifiedGifItem {
  id: string;
  name: string;
  category: string;
  isCustom: boolean;
  isSdCard?: boolean;
  sdFilename?: string;
  base64Data?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export default function App() {
  // Navigation mode (Gemini-style dropdown)
  const [currentMode, setCurrentMode] = useState<AppMode>('NOW_PLAYING');
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState<boolean>(false);
  const [showPixelGuide, setShowPixelGuide] = useState<boolean>(false);

  // First-time walkthrough modal state
  const [showWalkthrough, setShowWalkthrough] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return !localStorage.getItem('backpack_setup_seen');
    }
    return false;
  });

  // Now Playing state
  const [nowPlayingStyle, setNowPlayingStyle] = useState<NowPlayingStyle>('scrubber');
  const [track, setTrack] = useState<TrackMetadata>({
    title: 'The Rebel Path',
    artist: 'P.T. Adamczyk',
    album: 'Cyberpunk 2077 OST',
    rgbHex: '#00F0FF',
    artworkUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&h=600&q=80',
  });
  const currentTrackRef = useRef<TrackMetadata>(track);
  currentTrackRef.current = track;
  const artworkByHashRef = useRef<Map<string, string>>(new Map());



  // QR state & 1-Tap Presets
  const [isEditingPreset, setIsEditingPreset] = useState<boolean>(false);
  const [savedContact, setSavedContact] = useState<VCardContact>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('PATCHI_VCARD_DATA') || localStorage.getItem('DIGIPATCH_VCARD_DATA');
        if (saved) return { ...DEFAULT_VCARD_CONTACT, ...JSON.parse(saved) };
      } catch {}
    }
    return DEFAULT_VCARD_CONTACT;
  });

  const [qrPresets, setQrPresets] = useState<QrPresetItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('PATCHI_QR_PRESETS') || localStorage.getItem('DIGIPATCH_QR_PRESETS');
        if (saved) {
          const parsed: QrPresetItem[] = JSON.parse(saved);
          return DEFAULT_QR_PRESETS.map((def) => {
            const found = parsed.find((p) => p.id === def.id);
            return found ? { ...def, ...found } : def;
          });
        }
      } catch (e) {
        console.warn('Failed to parse PATCHI_QR_PRESETS:', e);
      }
    }
    return DEFAULT_QR_PRESETS;
  });

  const [activeQrPresetId, setActiveQrPresetId] = useState<string>('instagram');

  const activeQrPreset = useMemo(() => {
    return qrPresets.find((p) => p.id === activeQrPresetId) || qrPresets[0] || DEFAULT_QR_PRESETS[0];
  }, [qrPresets, activeQrPresetId]);

  const [qrTitle, setQrTitle] = useState<string>(() => activeQrPreset.title);
  const [qrPayload, setQrPayload] = useState<string>(() => activeQrPreset.payload);
  const [qrLedHex, setQrLedHex] = useState<string>('#00FFCC');

  const handleSelectQrPreset = (preset: QrPresetItem) => {
    setActiveQrPresetId(preset.id);
    setIsEditingPreset(false);

    if (preset.id === 'vcard') {
      let currentContact = savedContact;
      try {
        const stored = localStorage.getItem('PATCHI_VCARD_DATA') || localStorage.getItem('DIGIPATCH_VCARD_DATA');
        if (stored) {
          currentContact = { ...DEFAULT_VCARD_CONTACT, ...JSON.parse(stored) };
          setSavedContact(currentContact);
        }
      } catch {}
      const fullName = [currentContact.firstName, currentContact.lastName].filter(Boolean).join(' ').trim();
      const title = fullName ? (fullName.length > 13 ? fullName.substring(0, 13) : fullName) : 'MY CONTACT';
      const payload = buildContactQrPayload(currentContact);
      setQrTitle(title);
      setQrPayload(payload);
    } else {
      setQrTitle(preset.title);
      setQrPayload(preset.payload);
    }
  };

  const handleUpdateActivePresetPayload = (newPayload: string) => {
    setQrPayload(newPayload);
    setQrPresets((prev) => {
      const updated = prev.map((p) =>
        p.id === activeQrPresetId ? { ...p, payload: newPayload } : p
      );
      try {
        localStorage.setItem('PATCHI_QR_PRESETS', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save PATCHI_QR_PRESETS:', e);
      }
      return updated;
    });
  };

  const handleUpdateActivePresetTitle = (newTitle: string) => {
    const capped = newTitle.toUpperCase().slice(0, 13);
    setQrTitle(capped);
    setQrPresets((prev) => {
      const updated = prev.map((p) =>
        p.id === activeQrPresetId ? { ...p, title: capped } : p
      );
      try {
        localStorage.setItem('PATCHI_QR_PRESETS', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save PATCHI_QR_PRESETS:', e);
      }
      return updated;
    });
  };

  // GIF state & Presets
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifBuffer, setGifBuffer] = useState<ArrayBuffer | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>('equalizer');
  const [isOptimizingGif, setIsOptimizingGif] = useState<boolean>(false);
  const [gifOptimizationNote, setGifOptimizationNote] = useState<string | null>(null);

  // Custom GIFs & Pagination state (9 squares per page, hold to rename)
  const [customGifs, setCustomGifs] = useState<CustomGifItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('backpack_custom_gifs');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse backpack_custom_gifs:', e);
      }
    }
    return [];
  });
  const [customPresetNames, setCustomPresetNames] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('backpack_preset_names');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse backpack_preset_names:', e);
      }
    }
    return {};
  });
  const [gifPage, setGifPage] = useState<number>(0);
  const [renamingItem, setRenamingItem] = useState<UnifiedGifItem | null>(null);
  const [editNameInput, setEditNameInput] = useState<string>('');
  const [editCategoryInput, setEditCategoryInput] = useState<string>('Custom');
  const customGifMemoryCache = useRef<Map<string, { buffer: ArrayBuffer; url: string }>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // MicroSD Card & Autonomous Cache state
  const [sdCardMounted, setSdCardMounted] = useState<boolean>(false);
  const [sdStatusMessage, setSdStatusMessage] = useState<string | null>(null);
  const [sdGifs, setSdGifs] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('backpack_sd_gifs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const sdCachedArtHashes = useRef<Set<string>>(
    (() => {
      try {
        const saved = localStorage.getItem('backpack_sd_art_hashes');
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch {
        return new Set();
      }
    })()
  );

  const updateSdGifs = (updater: string[] | ((prev: string[]) => string[])) => {
    setSdGifs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('backpack_sd_gifs', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const markArtCachedOnSd = (hash: string) => {
    sdCachedArtHashes.current.add(hash);
    try {
      localStorage.setItem('backpack_sd_art_hashes', JSON.stringify(Array.from(sdCachedArtHashes.current)));
    } catch {}
  };

  const [sdActivity, setSdActivity] = useState<SdActivityState>({
    status: 'idle',
    targetType: 'none',
    targetName: '',
  });
  const sdActivityTimeoutRef = useRef<any>(null);
  const [showSdModal, setShowSdModal] = useState<boolean>(false);

  // Hold-to-rename touch / pointer tracking refs
  const pressTimerRef = useRef<any>(null);
  const pressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressRef = useRef<boolean>(false);
  const pendingNeedArtHashRef = useRef<string | null>(null);
  const isStreamingArtRef = useRef<string | null>(null);

  // Unified list of 6 curated presets + user-uploaded custom GIFs (merged with SD status)
  const allGifItems: UnifiedGifItem[] = useMemo(() => {
    const sdFileSet = new Set(sdGifs.map((f) => f.toLowerCase().trim()));

    // 1. Curated Presets: Check if any preset is cached on SD
    const curated: UnifiedGifItem[] = CURATED_GIF_PRESETS.map((p) => {
      const cleanFile = `${p.id}.gif`.toLowerCase();
      const onSd = sdFileSet.has(cleanFile);
      return {
        id: p.id,
        name: customPresetNames[p.id] || p.name,
        category: p.category,
        isCustom: false,
        isSdCard: onSd,
        sdFilename: onSd ? cleanFile : undefined,
      };
    });

    // 2. Custom User Uploads: Check if stored on SD card (matches clean filename)
    const custom: UnifiedGifItem[] = customGifs.map((g) => {
      const cleanFile = `${g.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.gif`;
      const onSd = sdFileSet.has(cleanFile) || sdFileSet.has(`${g.id}.gif`);
      const matchedSdFilename = sdFileSet.has(cleanFile)
        ? cleanFile
        : sdFileSet.has(`${g.id}.gif`)
        ? `${g.id}.gif`
        : undefined;
      return {
        id: g.id,
        name: g.name,
        category: g.category || 'Custom',
        isCustom: true,
        isSdCard: onSd,
        sdFilename: matchedSdFilename,
        base64Data: g.base64Data,
      };
    });

    // 3. Any additional files found directly on SD card that weren't uploaded via app
    const knownCustomFiles = new Set(custom.map((c) => c.sdFilename?.toLowerCase()).filter(Boolean));
    const knownCuratedFiles = new Set(curated.map((c) => c.sdFilename?.toLowerCase()).filter(Boolean));

    const extraSdItems: UnifiedGifItem[] = sdGifs
      .filter((file) => !knownCustomFiles.has(file.toLowerCase()) && !knownCuratedFiles.has(file.toLowerCase()))
      .map((file) => ({
        id: `sd_${file}`,
        name: file.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        category: 'SD CARD',
        isCustom: false,
        isSdCard: true,
        sdFilename: file,
      }));

    return [...curated, ...custom, ...extraSdItems];
  }, [customPresetNames, customGifs, sdGifs]);

  const totalGifPages = Math.max(1, Math.ceil(allGifItems.length / 9));
  const currentGifPageItems = allGifItems.slice(gifPage * 9, (gifPage + 1) * 9);

  // BLE state & feedback
  const [bleState, setBleState] = useState<BleConnectionState>(bleService.getState());
  const [isBeaming, setIsBeaming] = useState<boolean>(false);
  const [beamedSuccess, setBeamedSuccess] = useState<boolean>(false);
  const [beamError, setBeamError] = useState<string | null>(null);
  const [beamingStatus, setBeamingStatus] = useState<string | null>(null);
  const [includeAlbumArt, setIncludeAlbumArt] = useState<boolean>(true);

  // "Set & Forget" Seamless Auto-Beam state
  const [autoBeamEnabled, setAutoBeamEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('backpack_auto_beam') !== 'false';
    }
    return true;
  });

  const lastAutoBeamedTrackRef = useRef<string>('');
  const lastAutoBeamedArtRef = useRef<string>('');
  const lastAutoBeamedArtHashRef = useRef<string>('');
  const isAutoBeamingRef = useRef<boolean>(false);
  const pendingTrackSyncRef = useRef<TrackMetadata | null>(null);

  const autoBeamEnabledRef = useRef(autoBeamEnabled);
  autoBeamEnabledRef.current = autoBeamEnabled;

  const currentModeRef = useRef(currentMode);
  currentModeRef.current = currentMode;

  const bleStateRef = useRef(bleState);
  bleStateRef.current = bleState;

  const includeAlbumArtRef = useRef(includeAlbumArt);
  includeAlbumArtRef.current = includeAlbumArt;

  const nowPlayingStyleRef = useRef(nowPlayingStyle);
  nowPlayingStyleRef.current = nowPlayingStyle;

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Subscribe to BLE connection state
  useEffect(() => {
    const unsub = bleService.subscribeState((st) => setBleState(st));
    return () => unsub();
  }, []);

  // Subscribe to BLE notifications (MicroSD ready, cache hits/misses, file manifests, live activity)
  useEffect(() => {
    const unsub = bleService.subscribeNotifications((msg: string) => {
      console.log('[BLE NOTIFY RX]', msg);
      if (msg.startsWith('SD_STATUS|')) {
        const parts = msg.split('|');
        const code = parts[1] || '';
        if (code === 'MOUNTED') {
          setSdCardMounted(true);
          setSdStatusMessage(null);
        } else if (code === 'FAIL_FORMAT_FAT32') {
          setSdCardMounted(false);
          setSdStatusMessage('MicroSD mount failed: 64GB card must be formatted to FAT32 (MS-DOS) in Disk Utility!');
        } else if (code === 'NO_CARD') {
          setSdCardMounted(false);
          setSdStatusMessage('No MicroSD card detected in slot.');
        }
      } else if (msg.startsWith('SD_READY|')) {
        const ready = msg.substring(9).trim() === '1';
        setSdCardMounted(ready);
        if (ready) setSdStatusMessage(null);
      }

      if (msg.startsWith('SD_READING|')) {
        const parts = msg.split('|');
        if (sdActivityTimeoutRef.current) clearTimeout(sdActivityTimeoutRef.current);
        setSdActivity({
          status: 'reading',
          targetType: (parts[1] as any) || 'art',
          targetName: parts[2] || '',
        });
        setSdCardMounted(true);
        // Auto-revert to idle after 3s if no SD_IDLE notification arrives
        sdActivityTimeoutRef.current = setTimeout(() => {
          setSdActivity({ status: 'idle', targetType: 'none', targetName: '' });
        }, 3000);
      } else if (msg.startsWith('SD_WRITING|')) {
        const parts = msg.split('|');
        if (sdActivityTimeoutRef.current) clearTimeout(sdActivityTimeoutRef.current);
        setSdActivity({
          status: 'writing',
          targetType: (parts[1] as any) || 'art',
          targetName: parts[2] || '',
        });
        setSdCardMounted(true);
        sdActivityTimeoutRef.current = setTimeout(() => {
          setSdActivity({ status: 'idle', targetType: 'none', targetName: '' });
        }, 3000);
      } else if (msg.startsWith('SD_IDLE|')) {
        if (sdActivityTimeoutRef.current) clearTimeout(sdActivityTimeoutRef.current);
        setSdActivity({ status: 'idle', targetType: 'none', targetName: '' });
      } else if (msg.startsWith('SD_FILES|')) {
        const listStr = msg.substring(9).trim();
        if (listStr.length > 0) {
          const files = listStr
            .split(',')
            .map((f) => {
              let clean = f.trim();
              const idx = clean.lastIndexOf('/');
              if (idx >= 0) clean = clean.substring(idx + 1);
              return clean.replace(/^(\/|gifs\/)+/i, '');
            })
            .filter((f) => f && !f.startsWith('ERR_'));
          updateSdGifs(files);
        } else {
          updateSdGifs([]);
        }
      } else if (msg.startsWith('GIF_SAVED|')) {
        let file = msg.substring(10).trim();
        const idx = file.lastIndexOf('/');
        if (idx >= 0) file = file.substring(idx + 1);
        file = file.replace(/^(\/|gifs\/)+/i, '');
        if (file) {
          updateSdGifs((prev) => (prev.includes(file) ? prev : [...prev, file]));
          setSdCardMounted(true);
        }
      } else if (msg.startsWith('NEED_ART|')) {
        const hash = msg.substring(9).trim();
        console.log('[BLE RX] ESP32 MicroSD cache miss, requested art for hash:', hash);
        if (isStreamingArtRef.current === hash) {
          console.log('[BLE RX] Ignoring redundant NEED_ART; stream already active for:', hash);
        } else {
          pendingNeedArtHashRef.current = hash;
          const cachedArt = artworkByHashRef.current.get(hash) || currentTrackRef.current?.artworkUrl;
          if (cachedArt) {
            beamArtworkForTrack(hash, { ...currentTrackRef.current, artworkUrl: cachedArt });
          }
        }
      } else if (msg.startsWith('CACHE_HIT|')) {
        const hash = msg.substring(10).trim();
        markArtCachedOnSd(hash);
        lastAutoBeamedArtHashRef.current = hash;
        pendingNeedArtHashRef.current = null;
      } else if (msg.startsWith('CACHE_SAVED|')) {
        const hash = msg.substring(12).trim();
        markArtCachedOnSd(hash);
        lastAutoBeamedArtHashRef.current = hash;
        pendingNeedArtHashRef.current = null;
      }
    });
    return () => {
      unsub();
      if (sdActivityTimeoutRef.current) clearTimeout(sdActivityTimeoutRef.current);
    };
  }, []);

  // Dedicated helper to beam album art to ESP32 (handles NEED_ART and auto-beam)
  const beamArtworkForTrack = async (artHash: string, customTrack?: TrackMetadata) => {
    if (!bleStateRef.current.connected) return;
    if (isStreamingArtRef.current === artHash) {
      console.log('[BEAM ART] Artwork stream already active for hash:', artHash);
      return;
    }

    const targetTrack = customTrack || pendingTrackSyncRef.current || currentTrackRef.current;
    const artworkUrl = targetTrack?.artworkUrl || artworkByHashRef.current.get(artHash);
    if (!artworkUrl) {
      console.log('[BEAM ART] Artwork not ready yet for hash:', artHash);
      pendingNeedArtHashRef.current = artHash;
      return;
    }

    // Retain artwork in fast memory map so sibling songs on same album have instant access
    artworkByHashRef.current.set(artHash, artworkUrl);
    const unstyledHash = generateAlbumHash(track.artist, track.album, track.title);
    artworkByHashRef.current.set(unstyledHash, artworkUrl);
    isStreamingArtRef.current = artHash;

    try {
      console.log('[BEAM ART] Streaming cover art for hash:', artHash);
      let artBuffer: ArrayBuffer | null = null;
      let artSizeBytes = 0;

      if (artworkUrl.startsWith('data:image/')) {
        const res = dataUrlToArrayBuffer(artworkUrl);
        artBuffer = res.arrayBuffer;
        artSizeBytes = res.sizeBytes;
      } else {
        const processed = await processAlbumArt(artworkUrl, 0.68, nowPlayingStyleRef.current);
        if (processed && processed.arrayBuffer.byteLength > 0) {
          artBuffer = processed.arrayBuffer;
          artSizeBytes = processed.sizeBytes;
        }
      }

      if (artBuffer && artSizeBytes > 0) {
        const prepOk = await bleService.sendCommand(`PREP_ART|${artSizeBytes}`);
        if (prepOk) {
          await new Promise((r) => setTimeout(r, 60));
          const dataOk = await bleService.sendBinaryData(artBuffer, 'ART');
          if (dataOk) {
            await new Promise((r) => setTimeout(r, 80));
            await bleService.sendCommand(`SHOW_ART|${artSizeBytes}|${artHash}`);
            markArtCachedOnSd(artHash);
            lastAutoBeamedArtHashRef.current = artHash;
            pendingNeedArtHashRef.current = null;
            console.log('[BEAM ART] Successfully beamed & cached cover art to MicroSD:', artHash);
          }
        }
      }
    } catch (err) {
      console.warn('[BEAM ART] Failed to beam artwork:', err);
    } finally {
      if (isStreamingArtRef.current === artHash) {
        isStreamingArtRef.current = null;
      }
    }
  };

  // Background KeepAlive audio anchor to prevent Chromium from freezing when phone is locked
  useEffect(() => {
    backgroundKeepAlive.start();
    const handleUserInteraction = () => {
      backgroundKeepAlive.start();
    };
    window.addEventListener('touchstart', handleUserInteraction, { once: true });
    window.addEventListener('click', handleUserInteraction, { once: true });
    return () => {
      window.removeEventListener('touchstart', handleUserInteraction);
      window.removeEventListener('click', handleUserInteraction);
    };
  }, []);

  // When connected, start keepalive and query MicroSD GIF manifest
  useEffect(() => {
    if (bleState.connected) {
      backgroundKeepAlive.start();
      bleService.sendCommand('LIST_SD').catch(() => {});
    }
  }, [bleState.connected]);

  // Pre-load default GIF preset (Cyber Equalizer) in background
  useEffect(() => {
    generatePresetGif('equalizer')
      .then(({ buffer, url }) => {
        setGifBuffer(buffer);
        setGifUrl(url);
        setGifOptimizationNote('Ready: Cyber Equalizer (172x320)');
      })
      .catch(() => {});
  }, []);

  // Seamless Auto-Sync queue worker: ensures track text and artwork are never dropped
  const runAutoBeamWorker = async () => {
    if (isAutoBeamingRef.current) return;
    isAutoBeamingRef.current = true;

    try {
      while (
        pendingTrackSyncRef.current &&
        autoBeamEnabledRef.current &&
        bleStateRef.current.connected
      ) {
        const currentTrack = pendingTrackSyncRef.current;
        pendingTrackSyncRef.current = null;

        if (currentModeRef.current !== 'NOW_PLAYING') {
          continue;
        }

        const currentStyle = nowPlayingStyleRef.current;
        const songIdentifier = `${currentTrack.title}:::${currentTrack.artist}:::${currentStyle}`;
        const titleChanged = lastAutoBeamedTrackRef.current !== songIdentifier;

        // If artwork is missing on an initial song detection, wait a brief grace period (500ms)
        // so text and cover art can be beamed in a single atomic pass (identical to manual beaming)
        if (
          titleChanged &&
          includeAlbumArtRef.current &&
          currentStyle !== 'visualizer' &&
          !currentTrack.artworkUrl
        ) {
          await new Promise((r) => setTimeout(r, 500));
          if (pendingTrackSyncRef.current) {
            // A newer track or art update arrived during the grace period!
            continue;
          }
        }

        // 1. Immediately send layout style, text, RGB metadata & MicroSD album hash
        const artHash = generateAlbumHash(currentTrack.artist, currentTrack.album, currentTrack.title, currentStyle);
        const isArtCached = sdCachedArtHashes.current.has(artHash);
        const availableArt = currentTrack.artworkUrl || artworkByHashRef.current.get(artHash);

        const shouldSendArt = Boolean(
          includeAlbumArtRef.current &&
          currentStyle !== 'visualizer' &&
          availableArt &&
          !isArtCached
        );

        if (!titleChanged && !shouldSendArt) {
          continue;
        }

        if (titleChanged) {
          lastAutoBeamedTrackRef.current = songIdentifier;
          const cleanHex = (currentTrack.rgbHex || '#FF8800').replace('#', '');
          const cleanAlbum = (currentTrack.album || '').trim();
          const cleanTitle = (currentTrack.title || '').replace(/\|/g, '-').trim();
          const cleanArtist = (currentTrack.artist || '').replace(/\|/g, '-').trim();
          const posSec = currentTrack.positionSec || 0;
          const durSec = currentTrack.durationSec || 0;
          const isPlaying = currentTrack.isPlaying ? 1 : 0;
          const plexCmd = `PLEX|${cleanTitle}|${cleanArtist}|${cleanAlbum}|#${cleanHex}|${currentStyle}|${artHash}|${posSec}|${durSec}|${isPlaying}`;
          await bleService.sendCommand(plexCmd);
        }

        // 2. Stream album art tailored to the selected screen layout (skipped for visualizer)
        // If the artwork is already cached on the MicroSD card, the ESP32 loaded it in 15ms! Skip BLE streaming!
        if (shouldSendArt && availableArt && !isArtCached) {
          await beamArtworkForTrack(artHash, { ...currentTrack, artworkUrl: availableArt });
        }
      }
    } catch (err: any) {
      if (err?.message !== 'ABORTED') {
        console.warn('Auto-beam sync error:', err);
      }
    } finally {
      isAutoBeamingRef.current = false;
      // If a track update arrived while completing the cycle, re-trigger worker
      if (
        pendingTrackSyncRef.current &&
        autoBeamEnabledRef.current &&
        bleStateRef.current.connected
      ) {
        runAutoBeamWorker();
      }
    }
  };

  // Subscribe to device now-playing media session with Seamless Auto-Sync ("Set & Forget")
  useEffect(() => {
    const unsub = nowPlayingService.subscribe(async (detected) => {
      if (!detected.title || detected.title === 'No media detected' || detected.title === 'Detecting Media...') {
        return;
      }
      setTrack(detected);
      currentTrackRef.current = detected;
      if (detected.artworkUrl) {
        const hash = generateAlbumHash(detected.artist, detected.album, detected.title, nowPlayingStyleRef.current);
        const unstyledHash = generateAlbumHash(detected.artist, detected.album, detected.title);
        artworkByHashRef.current.set(hash, detected.artworkUrl);
        artworkByHashRef.current.set(unstyledHash, detected.artworkUrl);
      }

      // Only auto-beam over BLE if Auto-Beam is enabled and in NOW_PLAYING mode
      if (!autoBeamEnabledRef.current || currentModeRef.current !== 'NOW_PLAYING') {
        return;
      }

      // If BLE connection dropped earlier while phone was idle, reconnect immediately
      if (!bleStateRef.current.connected) {
        console.log('[AUTO-BEAM] Reconnecting to Backpack-ESP32 for new song...');
        bleService.tryAutoConnect().then((reconnected) => {
          if (reconnected) {
            console.log('[AUTO-BEAM] Reconnected! Auto-beaming newly arrived song...');
            pendingTrackSyncRef.current = detected;
            runAutoBeamWorker();
          }
        });
        return;
      }

      const songIdentifier = `${detected.title}:::${detected.artist}:::${nowPlayingStyleRef.current}`;
      const titleChanged = lastAutoBeamedTrackRef.current !== songIdentifier;

      // If a new song arrived while old artwork was still streaming, cancel old transfer instantly
      if (titleChanged) {
        bleService.cancelBinaryTransfer();
      }

      pendingTrackSyncRef.current = detected;
      runAutoBeamWorker();

      // If ESP32 requested art earlier and artwork is available, satisfy it immediately!
      if (pendingNeedArtHashRef.current) {
        const detectedHash = generateAlbumHash(detected.artist, detected.album, detected.title, nowPlayingStyleRef.current);
        const unstyledHash = generateAlbumHash(detected.artist, detected.album, detected.title);
        const artToUse = detected.artworkUrl ||
          artworkByHashRef.current.get(pendingNeedArtHashRef.current) ||
          artworkByHashRef.current.get(detectedHash) ||
          artworkByHashRef.current.get(unstyledHash);
        if (artToUse) {
          console.log('[AUTO-BEAM] Satisfying pending NEED_ART with artwork:', pendingNeedArtHashRef.current);
          beamArtworkForTrack(pendingNeedArtHashRef.current, { ...detected, artworkUrl: artToUse });
        }
      }
    });
    return () => unsub();
  }, []);

  // When switching back to NOW_PLAYING mode, automatically sync the current track
  useEffect(() => {
    if (
      currentMode === 'NOW_PLAYING' &&
      autoBeamEnabledRef.current &&
      bleStateRef.current.connected &&
      track.title &&
      track.title !== 'No media detected' &&
      track.title !== 'Waiting for Plex...'
    ) {
      pendingTrackSyncRef.current = track;
      runAutoBeamWorker();
    }
  }, [currentMode]);


  // Handle Connect / Disconnect
  const handleToggleConnection = async (): Promise<boolean> => {
    setBeamError(null);
    if (bleState.connected) {
      bleService.disconnect();
      return true;
    } else {
      const success = await bleService.connect();
      if (!success) {
        setShowWalkthrough(true);
      } else {
        localStorage.setItem('backpack_setup_seen', 'true');
      }
      return success;
    }
  };

  const handleDismissWalkthrough = () => {
    setShowWalkthrough(false);
    localStorage.setItem('backpack_setup_seen', 'true');
  };


  // Immediate style switch: updates preview & physical display immediately if connected
  const handleSelectNowPlayingStyle = async (newStyle: NowPlayingStyle) => {
    setNowPlayingStyle(newStyle);
    if (bleState.connected && currentMode === 'NOW_PLAYING') {
      try {
        const cleanHex = (track.rgbHex || '#FF8800').replace('#', '');
        const cleanTitle = (track.title || 'Now Playing').replace(/\|/g, '-');
        const cleanArtist = (track.artist || '').replace(/\|/g, '-');
        const cleanAlbum = (track.album || '').replace(/\|/g, '-');
        const artHash = generateAlbumHash(cleanArtist, cleanAlbum, cleanTitle, newStyle);
        const posSec = track.positionSec || 0;
        const durSec = track.durationSec || 0;
        const isPlaying = track.isPlaying ? 1 : 0;
        await bleService.sendCommand(
          `PLEX|${cleanTitle}|${cleanArtist}|${cleanAlbum}|#${cleanHex}|${newStyle}|${artHash}|${posSec}|${durSec}|${isPlaying}`
        );
        lastAutoBeamedTrackRef.current = `${cleanTitle}:::${cleanArtist}:::${newStyle}`;

        const isArtCached = sdCachedArtHashes.current.has(artHash);
        if (includeAlbumArt && track.artworkUrl && newStyle !== 'visualizer' && !isArtCached) {
          let artBuffer: ArrayBuffer | null = null;
          let artSizeBytes = 0;
          if (track.artworkUrl.startsWith('data:image/')) {
            const res = dataUrlToArrayBuffer(track.artworkUrl);
            artBuffer = res.arrayBuffer;
            artSizeBytes = res.sizeBytes;
          } else {
            const processed = await processAlbumArt(track.artworkUrl, 0.68, newStyle);
            if (processed && processed.arrayBuffer.byteLength > 0) {
              artBuffer = processed.arrayBuffer;
              artSizeBytes = processed.sizeBytes;
            }
          }
          if (artBuffer && artSizeBytes > 0) {
            await bleService.sendCommand(`PREP_ART|${artSizeBytes}`);
            await new Promise((r) => setTimeout(r, 40));
            const dataOk = await bleService.sendBinaryData(artBuffer, 'ART');
            if (dataOk) {
              await new Promise((r) => setTimeout(r, 60));
              await bleService.sendCommand(`SHOW_ART|${artSizeBytes}|${artHash}`);
              sdCachedArtHashes.current.add(artHash);
              lastAutoBeamedArtHashRef.current = artHash;
            }
          }
        }
      } catch (err) {
        console.warn('Style switch beam notice:', err);
      }
    }
  };

  // Unified GIF item selection (curated preset, SD card animation, or custom upload)
  const handleSelectGifItem = async (item: UnifiedGifItem) => {
    setSelectedPresetId(item.id);
    setGifError(null);

    // 1. Load buffer & url for live in-app preview
    if (item.isCustom) {
      setGifOptimizationNote(null);
      let cached = customGifMemoryCache.current.get(item.id);
      if (!cached && item.base64Data) {
        try {
          const buf = base64ToArrayBuffer(item.base64Data);
          const blob = new Blob([buf], { type: 'image/gif' });
          const url = URL.createObjectURL(blob);
          cached = { buffer: buf, url };
          customGifMemoryCache.current.set(item.id, cached);
        } catch (e) {
          console.error('Failed to reconstruct custom GIF from base64:', e);
          setGifError('Failed to load saved custom GIF animation.');
        }
      }

      if (cached) {
        setGifBuffer(cached.buffer);
        setGifUrl(cached.url);
        setGifOptimizationNote(
          `Ready: ${item.name} (${(cached.buffer.byteLength / 1024).toFixed(0)} KB) · 172x320`
        );
      }
    } else {
      setGifOptimizationNote(null);
      setIsOptimizingGif(true);
      try {
        const { buffer, url } = await generatePresetGif(item.id);
        setGifBuffer(buffer);
        setGifUrl(url);
        setGifOptimizationNote(
          `Ready: ${(buffer.byteLength / 1024).toFixed(0)} KB (172x320)`
        );
      } catch (err: any) {
        console.error('Failed to generate preset GIF:', err);
        setGifError('Failed to generate preset GIF animation.');
      } finally {
        setIsOptimizingGif(false);
      }
    }

    // 2. MicroSD Instant Launch path (20ms) - instantly switch ESP32 display if already cached on card
    if (item.isSdCard && item.sdFilename) {
      const cleanFile = item.sdFilename.replace(/^(\/|gifs\/)+/i, '');
      setGifOptimizationNote(`Playing from MicroSD: ${cleanFile} (Instant 20ms launch)`);
      if (bleState.connected) {
        setBeamingStatus(`Launching ${item.name} from MicroSD (20ms)...`);
        await bleService.sendCommand(`PLAY_SD|${cleanFile}`).catch(() => {});
        setBeamedSuccess(true);
        setTimeout(() => setBeamedSuccess(false), 2000);
      }
    }
  };

  const handleSelectPresetGif = (preset: GifPresetItem) => {
    handleSelectGifItem({
      id: preset.id,
      name: customPresetNames[preset.id] || preset.name,
      category: preset.category,
      isCustom: false,
    });
  };

  // Open rename modal
  const handleOpenRename = (item: UnifiedGifItem) => {
    setRenamingItem(item);
    setEditNameInput(item.name);
    setEditCategoryInput(item.category);
  };

  // Save renamed GIF title/category
  const handleSaveRename = () => {
    if (!renamingItem) return;
    const trimmedName = editNameInput.trim() || renamingItem.name;
    const trimmedCat = editCategoryInput.trim() || renamingItem.category;

    if (renamingItem.isCustom) {
      const nextCustom = customGifs.map((g) => {
        if (g.id === renamingItem.id) {
          return { ...g, name: trimmedName, category: trimmedCat };
        }
        return g;
      });
      setCustomGifs(nextCustom);
      try {
        localStorage.setItem('backpack_custom_gifs', JSON.stringify(nextCustom));
      } catch (e) {}
    } else {
      const nextNames = { ...customPresetNames, [renamingItem.id]: trimmedName };
      setCustomPresetNames(nextNames);
      try {
        localStorage.setItem('backpack_preset_names', JSON.stringify(nextNames));
      } catch (e) {}
    }

    setRenamingItem(null);
  };

  // Delete custom GIF
  const handleDeleteCustomGif = (id: string) => {
    const nextCustom = customGifs.filter((g) => g.id !== id);
    setCustomGifs(nextCustom);
    try {
      localStorage.setItem('backpack_custom_gifs', JSON.stringify(nextCustom));
    } catch (e) {}
    customGifMemoryCache.current.delete(id);

    // If active GIF was deleted, fall back to first preset
    if (selectedPresetId === id) {
      const fallbackPreset = CURATED_GIF_PRESETS[0];
      handleSelectGifItem({
        id: fallbackPreset.id,
        name: customPresetNames[fallbackPreset.id] || fallbackPreset.name,
        category: fallbackPreset.category,
        isCustom: false,
      });
    }

    // Ensure valid page if last item on page was deleted
    const newTotal = 6 + nextCustom.length;
    const maxPages = Math.max(1, Math.ceil(newTotal / 9));
    setGifPage((prev) => Math.min(prev, maxPages - 1));

    setRenamingItem(null);
  };

  // Hold-to-rename touch / mouse handlers (500ms long press)
  const handleItemPointerDown = (item: UnifiedGifItem, e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isLongPressRef.current = false;
    pressStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (_) {}
      }
      handleOpenRename(item);
    }, 500);
  };

  const handleItemPointerMove = (e: React.PointerEvent) => {
    if (!pressStartPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - pressStartPosRef.current.x,
      e.clientY - pressStartPosRef.current.y
    );
    if (dist > 10) {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    }
  };

  const handleItemPointerUp = (item: UnifiedGifItem, e: React.PointerEvent) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartPosRef.current = null;

    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }

    handleSelectGifItem(item);
  };

  const handleItemPointerCancel = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartPosRef.current = null;
    isLongPressRef.current = false;
  };

  // Handle GIF file upload (auto-scaled, adds new square, paginates 9 squares per page)
  const handleGifUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGifError(null);
    setGifOptimizationNote(null);
    setIsOptimizingGif(true);

    try {
      const result = await optimizeUserGif(file);
      setGifBuffer(result.buffer);
      setGifUrl(result.url);

      const base64Data = arrayBufferToBase64(result.buffer);
      const cleanName =
        file.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim() || 'Custom GIF';

      const newId = `custom_${Date.now()}`;
      const newCustomItem: CustomGifItem = {
        id: newId,
        name: cleanName,
        category: 'Custom',
        base64Data,
      };

      // Store in memory cache for immediate access
      customGifMemoryCache.current.set(newId, {
        buffer: result.buffer,
        url: result.url,
      });

      // Append new custom GIF
      const updatedCustomGifs = [...customGifs, newCustomItem];
      setCustomGifs(updatedCustomGifs);
      try {
        localStorage.setItem('backpack_custom_gifs', JSON.stringify(updatedCustomGifs));
      } catch (err) {
        console.warn('Could not persist custom GIF to localStorage:', err);
      }

      // Mark newly added GIF as selected
      setSelectedPresetId(newId);

      // Navigate to the page containing the new square (9 per page)
      const newIndex = 6 + updatedCustomGifs.length - 1;
      const targetPage = Math.floor(newIndex / 9);
      setGifPage(targetPage);

      const cleanFilename = `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}.gif`;

      // If connected to ESP32, do the hard work NOW: auto-upload once to MicroSD!
      if (bleState.connected) {
        setIsBeaming(true);
        setBeamingStatus(`Uploading "${cleanName}" to MicroSD card...`);
        try {
          await bleService.sendCommand(`PREP_GIF|${result.buffer.byteLength}`);
          await new Promise((r) => setTimeout(r, 80));
          const streamOk = await bleService.sendBinaryData(
            result.buffer,
            'GIF',
            (pct) => setBeamingStatus(`Uploading to MicroSD (${pct}%)...`)
          );
          if (streamOk) {
            await new Promise((r) => setTimeout(r, 80));
            await bleService.sendCommand(`PLAY_GIF|${result.buffer.byteLength}|${cleanFilename}`);
            updateSdGifs((prev) => (prev.includes(cleanFilename) ? prev : [...prev, cleanFilename]));
            setBeamedSuccess(true);
            setTimeout(() => setBeamedSuccess(false), 2500);
            setGifOptimizationNote(
              `⚡ Uploaded "${cleanName}" to MicroSD! Instant 20ms switching enabled.`
            );
          } else {
            setGifOptimizationNote(
              `Added "${cleanName}". Tap "Upload to MicroSD" when ready to cache.`
            );
          }
        } catch (upErr) {
          console.warn('MicroSD auto-upload failed upon addition:', upErr);
          setGifOptimizationNote(
            `Added "${cleanName}". Tap "Upload to MicroSD" when ready to cache.`
          );
        } finally {
          setIsBeaming(false);
          setBeamingStatus(null);
        }
      } else {
        if (result.originalSize !== result.optimizedSize) {
          setGifOptimizationNote(
            `Added "${cleanName}": ${(result.originalSize / 1024).toFixed(0)} KB → ${(result.optimizedSize / 1024).toFixed(0)} KB. Connect to upload to MicroSD!`
          );
        } else {
          setGifOptimizationNote(`Added "${cleanName}": ${(result.optimizedSize / 1024).toFixed(0)} KB. Connect to upload to MicroSD!`);
        }
      }
    } catch (err) {
      console.error('Failed to load/optimize GIF:', err);
      setGifError('Failed to read or optimize GIF file.');
    } finally {
      setIsOptimizingGif(false);
      if (e.target) e.target.value = '';
    }
  };

  // Main "Set Display" action
  const handleSetDisplay = async () => {
    if (isBeaming) return;
    setBeamError(null);

    // Verify BLE Connection first
    if (!bleState.connected) {
      setBeamError('Not connected to BACKPACK-ESP32. Please tap Connect in the top-right corner.');
      return;
    }

    setIsBeaming(true);
    setBeamedSuccess(false);
    setBeamingStatus('Connecting to display...');

    // Dynamic safety timeout: ample time for GIF transfers without premature abort
    const safetyTimeoutMs =
      currentMode === 'GIF'
        ? Math.max(50000, Math.ceil(((gifBuffer?.byteLength || 60000) / 3500) * 1000))
        : 18000;

    let timeoutId: any;
    const safetyAbort = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Operation timed out. Reconnect to BACKPACK-ESP32 and retry.'));
      }, safetyTimeoutMs);
    });

    const runBeam = async () => {
      if (currentMode === 'NOW_PLAYING') {
        const cleanHex = track.rgbHex || '#FF8800';
        const cleanTitle = (track.title || 'Now Playing').replace(/\|/g, '-');
        const cleanArtist = (track.artist || '').replace(/\|/g, '-');
        const cleanAlbum = (track.album || '').replace(/\|/g, '-');

        // STEP 1: Set style & metadata immediately (PLEX command already includes nowPlayingStyle and artHash)
        const artHash = generateAlbumHash(cleanArtist, cleanAlbum, cleanTitle, nowPlayingStyle);
        setBeamingStatus('Updating layout, track & LED...');
        const posSec = track.positionSec || 0;
        const durSec = track.durationSec || 0;
        const isPlaying = track.isPlaying ? 1 : 0;
        const plexOk = await bleService.sendCommand(
          `PLEX|${cleanTitle}|${cleanArtist}|${cleanAlbum}|${cleanHex}|${nowPlayingStyle}|${artHash}|${posSec}|${durSec}|${isPlaying}`
        );
        if (!plexOk) {
          throw new Error('ESP32 did not acknowledge track update. Tap Connect to re-link.');
        }

        // STEP 2: Stream album art tailored to the selected layout (skipped for visualizer)
        // If cached on MicroSD, the ESP32 renders it in 15ms directly from the card!
        const isArtCached = sdCachedArtHashes.current.has(artHash);
        if (includeAlbumArt && track.artworkUrl && nowPlayingStyle !== 'visualizer' && !isArtCached) {
          try {
            setBeamingStatus('Processing cover art...');
            let artBuffer: ArrayBuffer | null = null;
            let artSizeBytes = 0;

            if (track.artworkUrl.startsWith('data:image/')) {
              const res = dataUrlToArrayBuffer(track.artworkUrl);
              artBuffer = res.arrayBuffer;
              artSizeBytes = res.sizeBytes;
            } else {
              const processed = await processAlbumArt(track.artworkUrl, 0.68, nowPlayingStyle);
              if (processed && processed.arrayBuffer.byteLength > 0) {
                artBuffer = processed.arrayBuffer;
                artSizeBytes = processed.sizeBytes;
              }
            }

            if (artBuffer && artSizeBytes > 0) {
              setBeamingStatus('Sending cover art header...');
              const prepOk = await bleService.sendCommand(`PREP_ART|${artSizeBytes}`);
              if (prepOk) {
                await new Promise((r) => setTimeout(r, 60));
                setBeamingStatus('Streaming album art (0%)...');
                const dataOk = await bleService.sendBinaryData(
                  artBuffer,
                  'ART',
                  (pct) => setBeamingStatus(`Streaming album art (${pct}%)...`)
                );
                if (dataOk) {
                  // Tell ESP32 the image payload is complete so it decodes cleanly and caches to SD
                  await new Promise((r) => setTimeout(r, 60));
                  await bleService.sendCommand(`SHOW_ART|${artSizeBytes}|${artHash}`);
                  sdCachedArtHashes.current.add(artHash);
                  lastAutoBeamedTrackRef.current = `${cleanTitle}:::${cleanArtist}:::${nowPlayingStyle}`;
                  lastAutoBeamedArtHashRef.current = artHash;
                } else {
                  console.warn('Cover art streaming failed, but track metadata was updated');
                }
              }
            }
          } catch (artErr: any) {
            console.warn('Cover art streaming error:', artErr);
            // Non-fatal: the track metadata and LED were already set successfully!
          }
        }

      } else if (currentMode === 'QR') {
        const cleanPayload = qrPayload.trim() || 'https://plex.tv';
        const cleanTitle = qrTitle.trim() || 'SCAN ME';
        const cleanHex = qrLedHex.startsWith('#') ? qrLedHex : `#${qrLedHex}`;

        setBeamingStatus('Rendering QR code on ESP32...');
        const cmd = `QR|${cleanTitle}|${cleanPayload}|${cleanHex}`;

        const qrOk = await bleService.sendCommand(cmd);
        if (!qrOk) throw new Error('ESP32 did not acknowledge QR command. Reconnect and retry.');

      } else if (currentMode === 'GIF') {
        const selectedItem = allGifItems.find((g) => g.id === selectedPresetId);
        if (selectedItem?.isSdCard && selectedItem.sdFilename) {
          const cleanFile = selectedItem.sdFilename.replace(/^(\/|gifs\/)+/i, '');
          setBeamingStatus(`Launching ${selectedItem.name} from MicroSD (20ms)...`);
          const sdOk = await bleService.sendCommand(`PLAY_SD|${cleanFile}`);
          if (!sdOk) throw new Error('ESP32 did not acknowledge PLAY_SD command.');
        } else {
          let activeBuffer = gifBuffer;
          if (!activeBuffer) {
            // Auto-load equalizer preset if user hasn't selected one
            const gen = await generatePresetGif('equalizer');
            activeBuffer = gen.buffer;
            setGifBuffer(gen.buffer);
            setGifUrl(gen.url);
          }

          setBeamingStatus(`Preparing GIF (${(activeBuffer.byteLength / 1024).toFixed(0)} KB)...`);
          const prepOk = await bleService.sendCommand(`PREP_GIF|${activeBuffer.byteLength}`);
          if (!prepOk) throw new Error('ESP32 rejected PREP_GIF command. Check connection.');

          await new Promise((r) => setTimeout(r, 80));
          setBeamingStatus('Streaming GIF frames (0%)...');
          const streamOk = await bleService.sendBinaryData(
            activeBuffer,
            'GIF',
            (pct) => setBeamingStatus(`Streaming GIF frames (${pct}%)...`)
          );
          if (!streamOk) {
            const detail = bleService.getLastError();
            throw new Error(detail ? `Failed to stream GIF frames: ${detail}` : 'Failed to stream GIF frames');
          }

          // Trigger playback command with total byte length and filename for autonomous SD caching
          await new Promise((r) => setTimeout(r, 80));
          const baseName = selectedItem?.isCustom
            ? (selectedItem.name || 'custom').toLowerCase().replace(/[^a-z0-9]/g, '_')
            : (selectedItem?.id || 'animation').toLowerCase();
          const cleanGifFilename = `${baseName}.gif`;
          await bleService.sendCommand(`PLAY_GIF|${activeBuffer.byteLength}|${cleanGifFilename}`);
          updateSdGifs((prev) => (prev.includes(cleanGifFilename) ? prev : [...prev, cleanGifFilename]));
        }
      }

      setBeamedSuccess(true);
      setTimeout(() => setBeamedSuccess(false), 2500);
    };

    try {
      await Promise.race([runBeam(), safetyAbort]);
    } catch (err: any) {
      console.error('Failed to set display:', err);
      setBeamError(err.message || 'Failed to beam to display. Please verify connection.');
    } finally {
      clearTimeout(timeoutId);
      setIsBeaming(false);
      setBeamingStatus(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#121214] text-white flex flex-col font-sans selection:bg-white selection:text-black">
      {/* ======================================================== */}
      {/* FIRST-TIME SETUP WALKTHROUGH MODAL                       */}
      {/* ======================================================== */}
      {showWalkthrough && (
        <FirstTimeConnectWalkthrough
          bleState={bleState}
          onConnect={handleToggleConnection}
          onDismiss={handleDismissWalkthrough}
        />
      )}

      {/* ======================================================== */}
      {/* ENHANCED FIRMWARE CODE MODAL                             */}
      {/* ======================================================== */}
      {showFirmwareModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-3xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2C2C32] pb-2">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-white" />
                <h3 className="text-sm font-bold text-white">ESP32-S3 Firmware Fixes & Sketch</h3>
              </div>
              <button
                onClick={() => setShowFirmwareModal(false)}
                className="text-[#9E9EA8] hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <FirmwareReviewModal />
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* PIXEL / ANDROID NOTIFICATION ACCESS GUIDE MODAL          */}
      {/* ======================================================== */}
      <PixelNotificationGuideModal
        isOpen={showPixelGuide}
        onClose={() => setShowPixelGuide(false)}
      />

      {/* ======================================================== */}
      {/* MICROSD HARDWARE & ACTIVITY TELEMETRY MODAL              */}
      {/* ======================================================== */}
      <MicroSdActivityModal
        isOpen={showSdModal}
        onClose={() => setShowSdModal(false)}
        sdCardMounted={sdCardMounted}
        sdActivity={sdActivity}
        sdGifs={sdGifs}
        cachedArtCount={sdCachedArtHashes.current.size}
        onRefreshSd={() => {
          if (bleState.connected) {
            bleService.sendCommand('LIST_SD').catch(() => {});
          }
        }}
      />

      {/* ======================================================== */}
      {/* TOP HEADER: Gemini-style dropdown & BACKPACK-ESP32 button */}
      {/* ======================================================== */}
      <header className="border-b border-[#2C2C32] bg-[#121214]/95 backdrop-blur-md sticky top-0 z-40 pt-[max(env(safe-area-inset-top),8px)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          {/* Top Left: Gemini-style dropdown menu */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1A1A1E] hover:bg-[#222228] border border-[#2C2C32] text-sm font-semibold text-white transition-all shadow-sm"
            >
              {currentMode === 'NOW_PLAYING' && (
                <>
                  <Music className="w-4 h-4 text-white" />
                  <span>Now Playing</span>
                </>
              )}
              {currentMode === 'QR' && (
                <>
                  <QrCode className="w-4 h-4 text-white" />
                  <span>QR Code</span>
                </>
              )}
              {currentMode === 'GIF' && (
                <>
                  <Film className="w-4 h-4 text-white" />
                  <span>GIF Player</span>
                </>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-[#9E9EA8] transition-transform ${
                  dropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Dropdown Popover */}
            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-48 bg-[#1A1A1E] border border-[#2C2C32] rounded-2xl p-1.5 shadow-2xl z-50">
                <button
                  onClick={() => {
                    setCurrentMode('NOW_PLAYING');
                    setDropdownOpen(false);
                    setBeamError(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    currentMode === 'NOW_PLAYING'
                      ? 'bg-white text-black font-extrabold shadow-md'
                      : 'text-[#9E9EA8] hover:bg-[#222228] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4" />
                    <span>Now Playing</span>
                  </div>
                  {currentMode === 'NOW_PLAYING' && <Check className="w-3.5 h-3.5 text-black" />}
                </button>

                <button
                  onClick={() => {
                    setCurrentMode('QR');
                    setDropdownOpen(false);
                    setBeamError(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    currentMode === 'QR'
                      ? 'bg-white text-black font-extrabold shadow-md'
                      : 'text-[#9E9EA8] hover:bg-[#222228] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <QrCode className="w-4 h-4" />
                    <span>QR Code</span>
                  </div>
                  {currentMode === 'QR' && <Check className="w-3.5 h-3.5 text-black" />}
                </button>

                <button
                  onClick={() => {
                    setCurrentMode('GIF');
                    setDropdownOpen(false);
                    setBeamError(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    currentMode === 'GIF'
                      ? 'bg-white text-black font-extrabold shadow-md'
                      : 'text-[#9E9EA8] hover:bg-[#222228] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4" />
                    <span>GIF Player</span>
                  </div>
                  {currentMode === 'GIF' && <Check className="w-3.5 h-3.5 text-black" />}
                </button>
              </div>
            )}
          </div>

          {/* Top Right: MicroSD Activity Pill + Help icon + BACKPACK-ESP32 Connect / Disconnect */}
          <div className="flex items-center gap-1.5">
            {/* MicroSD Live Activity / Status Indicator */}
            {bleState.connected && (
              <button
                onClick={() => setShowSdModal(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-mono-code transition-all border ${
                  sdActivity.status === 'reading'
                    ? 'bg-[#222228] text-white border-white/60 shadow-sm animate-pulse'
                    : sdActivity.status === 'writing'
                    ? 'bg-[#222228] text-white border-white/60 shadow-sm animate-pulse'
                    : sdCardMounted
                    ? 'bg-[#1A1A1E] text-white border-[#2C2C32] hover:border-[#3E3E48]'
                    : 'bg-[#1A1A1E]/60 text-[#7A7A85] border-[#2C2C32]'
                }`}
                title={
                  sdActivity.status === 'reading'
                    ? `Reading ${sdActivity.targetName} from MicroSD (15ms)`
                    : sdActivity.status === 'writing'
                    ? `Caching ${sdActivity.targetName} to MicroSD`
                    : sdCardMounted
                    ? 'MicroSD Ready - Tap for details'
                    : 'MicroSD not detected'
                }
              >
                <HardDrive
                  className={`w-3.5 h-3.5 ${
                    sdActivity.status === 'reading'
                      ? 'text-white animate-spin'
                      : sdActivity.status === 'writing'
                      ? 'text-white animate-pulse'
                      : sdCardMounted
                      ? 'text-emerald-400'
                      : 'text-[#7A7A85]'
                  }`}
                />
                <span className="font-bold text-[10px] tracking-wide">
                  {sdActivity.status === 'reading' ? (
                    <span className="flex items-center gap-1">
                      <span>SD READ</span>
                      <span className="text-[9px] text-white truncate max-w-[55px]">
                        {sdActivity.targetName}
                      </span>
                    </span>
                  ) : sdActivity.status === 'writing' ? (
                    <span className="flex items-center gap-1">
                      <span>SD SAVE</span>
                      <span className="text-[9px] text-white truncate max-w-[55px]">
                        {sdActivity.targetName}
                      </span>
                    </span>
                  ) : sdCardMounted ? (
                    'SD READY'
                  ) : (
                    'NO SD'
                  )}
                </span>
              </button>
            )}

            <button
              onClick={() => handleToggleConnection()}
              disabled={bleState.connecting}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                bleState.connected
                  ? 'bg-[#1A1A1E] text-white border-[#2C2C32] hover:border-red-500/50 hover:text-red-300'
                  : bleState.reconnecting
                  ? 'bg-[#1A1A1E] text-white border-[#2C2C32]'
                  : 'bg-[#1A1A1E] text-white border-[#2C2C32] hover:border-[#3E3E48]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  bleState.connected
                    ? 'bg-emerald-400 animate-pulse'
                    : bleState.reconnecting
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-[#7A7A85]'
                }`}
              />
              {bleState.reconnecting ? (
                <span className="flex items-center gap-1 text-white">
                  <RefreshCw className="w-3 h-3 animate-spin text-white" />
                  Reconnecting ({bleState.reconnectAttempt || 1}/10)...
                </span>
              ) : bleState.connecting ? (
                <span className="flex items-center gap-1 text-white">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Connecting...
                </span>
              ) : bleState.connected ? (
                <span>BACKPACK-ESP32</span>
              ) : (
                <span>Connect</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ======================================================== */}
      {/* MAIN BODY: Large Full-Visibility Display Preview         */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-2 sm:px-5 flex flex-col items-center overflow-y-auto pb-[max(env(safe-area-inset-bottom),16px)]">
        {/* Real-time MicroSD Activity HUD Notification */}
        {sdActivity.status !== 'idle' && (
          <div
            onClick={() => setShowSdModal(true)}
            className="w-full cursor-pointer transition-all hover:scale-[1.01]"
          >
            <div
              className={`p-2.5 rounded-2xl border flex items-center justify-between text-xs font-mono-code shadow-lg backdrop-blur-md ${
                sdActivity.status === 'reading'
                  ? 'bg-[#1A1A1E] border-white/40 text-white shadow-black/40'
                  : 'bg-[#1A1A1E] border-white/40 text-white shadow-black/40'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <HardDrive
                  className={`w-4 h-4 ${
                    sdActivity.status === 'reading'
                      ? 'text-white animate-spin'
                      : 'text-white animate-pulse'
                  }`}
                />
                <div>
                  <span className="font-bold text-white">
                    {sdActivity.status === 'reading'
                      ? 'Reading from MicroSD (15ms Recall):'
                      : 'Saving to MicroSD Cache:'}
                  </span>{' '}
                  <span className="underline decoration-dotted text-[#9E9EA8]">
                    {sdActivity.targetType === 'art'
                      ? `/art/${sdActivity.targetName}.jpg`
                      : `/gifs/${sdActivity.targetName}`}
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#222228] text-[9px] font-bold uppercase tracking-wider text-[#9E9EA8]">
                SD_MMC
              </span>
            </div>
          </div>
        )}

        {/* The Hardware Screen Preview (Real-time Mirror) */}
        <div className="w-full flex justify-center pt-1">
          <Esp32HardwareSimulator
            mode={currentMode}
            nowPlayingStyle={nowPlayingStyle}
            track={track}
            qrTitle={qrTitle}
            qrPayload={qrPayload}
            gifUrl={gifUrl}
            transferProgress={bleState.transferProgress}
          />
        </div>

        {/* Global Error Banner */}
        {beamError && (
          <div className="w-full p-3 rounded-2xl bg-[#1A1A1E] border border-red-500/40 text-xs text-red-200 flex items-start gap-2.5 shadow-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-red-300">Beam Notice</span>
              <span>{beamError}</span>
            </div>
            <button
              onClick={() => setBeamError(null)}
              className="text-red-400 hover:text-red-200 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* MicroSD Notice / Format Alert Banner */}
        {sdStatusMessage && (
          <div className="w-full p-3 rounded-2xl bg-[#1A1A1E] border border-[#2C2C32] text-xs text-white flex items-start gap-2.5 shadow-lg">
            <HardDrive className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-white">MicroSD Notice</span>
              <span className="text-[#9E9EA8]">{sdStatusMessage}</span>
            </div>
            <button
              onClick={() => setSdStatusMessage(null)}
              className="text-[#9E9EA8] hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ======================================================== */}
        <div className="flex-1 flex flex-col justify-center w-full max-w-sm space-y-4 my-auto py-2">
          {/* NOW PLAYING: Layout options & LED Accent */}
          {currentMode === 'NOW_PLAYING' && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#9E9EA8] uppercase tracking-wider block text-center">
                Choose Screen Layout
              </span>

              {/* 2 Clean Layout Buttons: Now Playing & Visualizer */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectNowPlayingStyle('scrubber')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    nowPlayingStyle === 'scrubber'
                      ? 'bg-white text-black font-extrabold shadow-md border-transparent ring-0'
                      : 'bg-[#1A1A1E] border-[#2C2C32] text-[#9E9EA8] hover:text-white hover:border-[#3E3E48]'
                  }`}
                >
                  <div className="text-sm font-bold flex items-center justify-center gap-1.5">
                    <Music className={`w-4 h-4 ${nowPlayingStyle === 'scrubber' ? 'text-black' : 'text-white'}`} />
                    <span>Now Playing</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 ${nowPlayingStyle === 'scrubber' ? 'text-black/80 font-medium' : 'text-[#7A7A85]'}`}>
                    Album Art & Scrubber
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectNowPlayingStyle('visualizer')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    nowPlayingStyle === 'visualizer'
                      ? 'bg-white text-black font-extrabold shadow-md border-transparent ring-0'
                      : 'bg-[#1A1A1E] border-[#2C2C32] text-[#9E9EA8] hover:text-white hover:border-[#3E3E48]'
                  }`}
                >
                  <div className="text-sm font-bold flex items-center justify-center gap-1.5">
                    <Sparkles className={`w-4 h-4 ${nowPlayingStyle === 'visualizer' ? 'text-black' : 'text-white'}`} />
                    <span>Visualizer</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 ${nowPlayingStyle === 'visualizer' ? 'text-black/80 font-medium' : 'text-[#7A7A85]'}`}>
                    Audio Spectrum Bars
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* QR CODE: 1-Tap Preset Grid, Safe Locked Display & Conscious Edit Mode */}
          {currentMode === 'QR' && (
            <div className="space-y-3">
              {/* 1-Tap Preset Grid (6 buttons) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#9E9EA8] uppercase tracking-wider block">
                    Quick Preset Buttons
                  </label>
                  <span className="text-[10px] text-[#7A7A85] font-mono-code">1-Tap Display</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {qrPresets.map((preset) => {
                    const isActive = activeQrPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectQrPreset(preset)}
                        className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all active:scale-[0.98] ${
                          isActive
                            ? 'bg-white text-black font-extrabold shadow-md border-transparent ring-0'
                            : 'bg-[#1A1A1E] border-[#2C2C32] text-[#9E9EA8] hover:text-white hover:border-[#3E3E48]'
                        }`}
                      >
                        <div
                          className={`p-1.5 rounded-lg mb-1.5 ${
                            isActive
                              ? 'bg-black/10 text-black'
                              : 'bg-[#222228] text-white'
                          }`}
                        >
                          {preset.icon === 'instagram' && <Instagram className="w-4 h-4" />}
                          {preset.icon === 'globe' && <Globe className="w-4 h-4" />}
                          {preset.icon === 'dollar' && <DollarSign className="w-4 h-4" />}
                          {preset.icon === 'wifi' && <Wifi className="w-4 h-4" />}
                          {preset.icon === 'vcard' && <User className="w-4 h-4" />}
                          {preset.icon === 'custom' && <Edit3 className="w-4 h-4" />}
                        </div>
                        <span className="text-[11px] font-bold leading-tight truncate w-full">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preset Details: Locked View vs Conscious Edit Mode */}
              {!isEditingPreset ? (
                /* LOCKED MODE (Safe from accidental typing/edits) */
                activeQrPreset.id === 'vcard' ? (
                  <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-white/10 text-white">
                          <User className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-white block">
                            {[savedContact.firstName, savedContact.lastName].filter(Boolean).join(' ').trim() || 'My Contact Card'}
                          </span>
                          <span className="text-[10px] text-[#7A7A85]">
                            Saved in App · Ready to display
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingPreset(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#222228] hover:bg-[#2C2C32] text-white border border-[#33333C] text-xs font-semibold transition-colors shadow-sm active:scale-95"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-white" />
                        <span>Edit Card</span>
                      </button>
                    </div>

                    <div className="bg-[#222228] rounded-lg p-2.5 border border-[#33333C] space-y-1">
                      {(savedContact.organization || savedContact.title) && (
                        <div className="text-[11px] text-[#9E9EA8] font-medium">
                          {[savedContact.title, savedContact.organization].filter(Boolean).join(' at ')}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px] font-mono-code text-white">
                        {savedContact.phone && (
                          <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20">
                            <Phone className="w-2.5 h-2.5 text-[#9E9EA8]" />
                            {savedContact.phone}
                          </span>
                        )}
                        {savedContact.email && (
                          <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20">
                            <Mail className="w-2.5 h-2.5 text-[#9E9EA8]" />
                            {savedContact.email}
                          </span>
                        )}
                        {savedContact.website && (
                          <span className="flex items-center gap-1 text-white bg-white/10 px-2 py-0.5 rounded border border-white/20 truncate max-w-full">
                            <Globe className="w-2.5 h-2.5 text-[#9E9EA8] flex-shrink-0" />
                            <span className="truncate">{savedContact.website}</span>
                          </span>
                        )}
                        {!savedContact.phone && !savedContact.email && !savedContact.website && (
                          <span className="text-[#7A7A85] italic">No contact details added yet. Tap Edit Card to configure.</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-white/10 text-white">
                          <Lock className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-white block">
                            {activeQrPreset.label}
                          </span>
                          <span className="text-[10px] text-[#7A7A85]">
                            Title: <strong className="text-white font-mono-code font-bold">{qrTitle}</strong>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingPreset(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#222228] hover:bg-[#2C2C32] text-white border border-[#33333C] text-xs font-semibold transition-colors shadow-sm active:scale-95"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-white" />
                        <span>Edit Link</span>
                      </button>
                    </div>

                    <div className="bg-[#222228] rounded-lg p-2.5 border border-[#33333C] font-mono-code text-xs text-white break-all select-all flex items-center justify-between gap-2">
                      <span className="truncate">{qrPayload || '(Not configured yet)'}</span>
                      <span className="text-[10px] text-[#7A7A85] flex-shrink-0">{qrPayload.length} chars</span>
                    </div>
                  </div>
                )
              ) : (
                /* EDITING MODE (Conscious, deliberate user editing) */
                activeQrPreset.id === 'vcard' ? (
                  <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-[#2C2C32]">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit Contact Card</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsEditingPreset(false)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-black font-extrabold text-xs shadow-md transition-all active:scale-95 hover:bg-[#E8E8EC]"
                      >
                        <Check className="w-3.5 h-3.5 text-black" />
                        <span>Done & Lock</span>
                      </button>
                    </div>
                    <VCardContactBuilder
                      onPayloadChange={(payload, title) => {
                        setQrPayload(payload);
                        setQrTitle(title);
                        try {
                          const stored = localStorage.getItem('PATCHI_VCARD_DATA') || localStorage.getItem('DIGIPATCH_VCARD_DATA');
                          if (stored) setSavedContact({ ...DEFAULT_VCARD_CONTACT, ...JSON.parse(stored) });
                        } catch {}
                      }}
                      onBeam={(payload, title) => {
                        setQrPayload(payload);
                        setQrTitle(title);
                        handleSetDisplay();
                      }}
                      onDone={() => setIsEditingPreset(false)}
                      isBeaming={isBeaming}
                    />
                  </div>
                ) : (
                  <div className="bg-[#1A1A1E] border border-white/40 rounded-xl p-3.5 space-y-3 ring-1 ring-white/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Editing {activeQrPreset.label}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsEditingPreset(false)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-black font-extrabold text-xs shadow-md transition-all active:scale-95 hover:bg-[#E8E8EC]"
                      >
                        <Check className="w-3.5 h-3.5 text-black" />
                        <span>Done & Lock</span>
                      </button>
                    </div>

                    {activeQrPreset.isCustom ? (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-[#9E9EA8] uppercase tracking-wider block mb-1">
                            Screen Title (Words On Display - Max 13 chars)
                          </label>
                          <input
                            type="text"
                            value={qrTitle}
                            onChange={(e) => handleUpdateActivePresetTitle(e.target.value)}
                            placeholder="e.g. SCAN ME"
                            maxLength={13}
                            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-bold tracking-wider font-mono-code uppercase transition-colors"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-[#9E9EA8] uppercase tracking-wider block mb-1">
                            Custom Link, URL or Text
                          </label>
                          <input
                            type="text"
                            value={qrPayload}
                            onChange={(e) => handleUpdateActivePresetPayload(e.target.value)}
                            placeholder={activeQrPreset.placeholder}
                            className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono-code transition-colors"
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-[#9E9EA8] uppercase tracking-wider">
                            {activeQrPreset.label} URL or String
                          </label>
                          <span className="text-[10px] text-[#7A7A85] font-mono-code">Auto-saved</span>
                        </div>
                        <input
                          type="text"
                          value={qrPayload}
                          onChange={(e) => handleUpdateActivePresetPayload(e.target.value)}
                          placeholder={activeQrPreset.placeholder}
                          className="w-full bg-[#222228] border border-[#33333C] focus:border-white focus:ring-1 focus:ring-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono-code transition-colors"
                        />
                        <p className="text-[10px] text-[#7A7A85] mt-1.5">
                          Displays <strong className="text-white font-mono-code">"{activeQrPreset.title}"</strong> on your ESP32 display.
                        </p>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {/* GIF PLAYER: Presets, Auto-Optimizer & File Picker */}
          {currentMode === 'GIF' && (
            <div className="space-y-3">
              {/* Header & Description */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-[#9E9EA8] uppercase tracking-wider block">
                    Choose 172×320 Animation
                  </span>
                  <span className="text-[10px] text-[#7A7A85]">
                    Instant presets or custom GIF upload
                  </span>
                </div>
                {isOptimizingGif && (
                  <span className="flex items-center gap-1 text-[10px] font-mono-code text-white">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Optimizing...
                  </span>
                )}
              </div>

              {/* 3x3 Paginated GIF Grid (Exactly 9 squares per page) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-[#9E9EA8] block">
                      GIF Library ({allGifItems.length} {allGifItems.length === 1 ? 'animation' : 'animations'})
                    </span>
                    {sdCardMounted && (
                      <span className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[9px] text-white font-mono-code font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        MicroSD
                      </span>
                    )}
                  </div>
                  {totalGifPages > 1 && (
                    <span className="text-[10px] font-mono-code text-[#9E9EA8]">
                      Page {gifPage + 1} of {totalGifPages}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {currentGifPageItems.map((item) => {
                    const isSelected = selectedPresetId === item.id;
                    return (
                      <div
                        key={item.id}
                        onPointerDown={(e) => handleItemPointerDown(item, e)}
                        onPointerMove={handleItemPointerMove}
                        onPointerUp={(e) => handleItemPointerUp(item, e)}
                        onPointerCancel={handleItemPointerCancel}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          handleOpenRename(item);
                        }}
                        className={`relative select-none flex flex-col justify-between p-2 rounded-xl text-left cursor-pointer transition-all min-h-[68px] active:scale-[0.98] ${
                          isSelected
                            ? 'bg-[#222228] border-white text-white shadow-md ring-1 ring-white/60'
                            : 'bg-[#1A1A1E] border-[#2C2C32] text-[#9E9EA8] hover:text-white hover:border-[#3E3E48]'
                        }`}
                        title="Tap to select · Hold to rename"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className={`text-[11px] font-bold leading-tight line-clamp-2 ${isSelected ? 'text-white' : 'text-[#D0D0D8]'}`}>
                            {item.name}
                          </div>
                          {item.isSdCard ? (
                            <span
                              className="shrink-0 text-[8px] font-mono-code font-bold px-1 py-0.5 rounded bg-white/10 text-white border border-white/20 flex items-center gap-0.5"
                              title="Stored on MicroSD - Instant 20ms launch"
                            >
                              ⚡ SD
                            </span>
                          ) : (
                            <span
                              className="shrink-0 text-[8px] font-mono-code px-1 py-0.5 rounded bg-[#222228] text-[#7A7A85] border border-[#33333C]"
                              title="Not on MicroSD card yet (will upload & cache on play)"
                            >
                              BLE
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded border border-[#2C2C32] bg-[#222228] text-[#9E9EA8] font-mono-code font-semibold tracking-wider uppercase"
                          >
                            {item.category}
                          </span>
                          {item.isCustom && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_#ffffff]"
                              title="Custom GIF"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Fill up remaining slots on the page up to 9 squares */}
                  {Array.from({ length: 9 - currentGifPageItems.length }).map((_, slotIndex) => {
                    const isFirstEmpty = slotIndex === 0 && gifPage === totalGifPages - 1;
                    return (
                      <div
                        key={`empty_${slotIndex}`}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border border-dashed transition-all cursor-pointer min-h-[68px] ${
                          isFirstEmpty
                            ? 'border-white/40 bg-[#1A1A1E] text-white hover:bg-[#222228] hover:border-white'
                            : 'border-[#2C2C32] bg-[#1A1A1E]/30 text-[#7A7A85] hover:border-[#3E3E48] hover:text-[#9E9EA8]'
                        }`}
                        title="Click to add custom GIF"
                      >
                        {isFirstEmpty ? (
                          <>
                            <Upload className="w-4 h-4 mb-0.5 text-white" />
                            <span className="text-[10px] font-semibold text-center leading-tight text-white">
                              + Add GIF
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] font-bold text-[#3E3E48] select-none">
                            +
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pagination controls when > 9 items (more than 1 page) */}
                {totalGifPages > 1 && (
                  <div className="flex items-center justify-between px-1 pt-1 text-xs">
                    <button
                      type="button"
                      disabled={gifPage === 0}
                      onClick={() => setGifPage((p) => Math.max(0, p - 1))}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1A1A1E] border border-[#2C2C32] text-[#9E9EA8] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors text-[10px] font-medium"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 text-white" />
                      Prev
                    </button>

                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: totalGifPages }).map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setGifPage(idx)}
                          className={`h-1.5 rounded-full transition-all ${
                            gifPage === idx
                              ? 'bg-white w-4'
                              : 'bg-[#33333C] w-1.5 hover:bg-[#4A4A54]'
                          }`}
                          title={`Go to page ${idx + 1}`}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={gifPage >= totalGifPages - 1}
                      onClick={() => setGifPage((p) => Math.min(totalGifPages - 1, p + 1))}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1A1A1E] border border-[#2C2C32] text-[#9E9EA8] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors text-[10px] font-medium"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                )}

                <div className="text-[9px] text-[#7A7A85] font-mono-code text-center pt-0.5">
                  Hold any square to rename · 9 squares per page
                </div>
              </div>

              {/* Error alert */}
              {gifError && (
                <div className="p-2.5 rounded-xl bg-[#1A1A1E] border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span>{gifError}</span>
                </div>
              )}

              {/* Hidden file input triggered by grid '+ Add GIF' square */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".gif,image/gif"
                onChange={handleGifUpload}
                className="hidden"
              />
            </div>
          )}

          {/* ======================================================== */}
          {/* PRIMARY ACTION: Set Display button                       */}
          {/* ======================================================== */}
          <button
            onClick={handleSetDisplay}
            disabled={isBeaming}
            className={`w-full py-3.5 px-4 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 transition-all shadow-xl bg-white hover:bg-[#E8E8EC] text-black active:scale-[0.98] ${
              isBeaming ? 'opacity-85 cursor-wait' : ''
            }`}
          >
            {isBeaming ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0 text-black" />
                <span className="truncate text-black">{beamingStatus || 'Setting Display...'}</span>
              </>
            ) : beamedSuccess ? (
              <>
                <Check className="w-4 h-4 text-black" />
                <span className="text-black">Display Set on BACKPACK-ESP32!</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-black" />
                <span className="text-black">
                  {currentMode === 'NOW_PLAYING'
                    ? 'Set Display (Now Playing)'
                    : currentMode === 'QR'
                    ? 'Set Display (QR Code)'
                    : allGifItems.find((g) => g.id === selectedPresetId)?.isSdCard
                    ? '⚡ Play from MicroSD (Instant 20ms)'
                    : 'Upload to MicroSD & Display'}
                </span>
              </>
            )}
          </button>
        </div>
      </main>

      {/* ======================================================== */}
      {/* RENAME GIF SQUARE MODAL                                  */}
      {/* ======================================================== */}
      {renamingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setRenamingItem(null)}
        >
          <div
            className="bg-[#1A1A1E] border border-[#2C2C32] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#2C2C32]">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-white" />
                <h3 className="text-sm font-bold text-white">
                  Rename GIF Square
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="text-[#9E9EA8] hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[#9E9EA8] block mb-1">
                  Square Name
                </label>
                <input
                  type="text"
                  value={editNameInput}
                  onChange={(e) => setEditNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setRenamingItem(null);
                  }}
                  autoFocus
                  maxLength={30}
                  placeholder="e.g. Homer Simpson"
                  className="w-full px-3 py-2 bg-[#222228] border border-[#33333C] rounded-xl text-white text-xs focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-colors"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#9E9EA8] block mb-1">
                  Tag Badge
                </label>
                <input
                  type="text"
                  value={editCategoryInput}
                  onChange={(e) => setEditCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setRenamingItem(null);
                  }}
                  maxLength={12}
                  placeholder="e.g. Meme, Retro, Custom"
                  className="w-full px-3 py-2 bg-[#222228] border border-[#33333C] rounded-xl text-white text-xs focus:outline-none focus:border-white focus:ring-1 focus:ring-white font-mono-code uppercase transition-colors"
                />
              </div>

              {/* Square Preview */}
              <div className="p-2.5 rounded-xl bg-[#222228] border border-[#33333C] space-y-1">
                <span className="text-[9px] uppercase tracking-wider font-mono-code text-[#7A7A85] block">
                  Preview on Controller
                </span>
                <div className="p-2.5 rounded-xl bg-[#1A1A1E] border border-[#2C2C32] text-left min-h-[64px] flex flex-col justify-between">
                  <div className="text-[11px] font-bold text-white truncate">
                    {editNameInput.trim() || 'Untitled'}
                  </div>
                  <div className="mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#222228] border border-[#33333C] text-[#9E9EA8] font-mono-code font-semibold tracking-wider uppercase">
                      {editCategoryInput.trim() || 'CUSTOM'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#2C2C32]">
              {renamingItem.isCustom ? (
                <button
                  type="button"
                  onClick={() => handleDeleteCustomGif(renamingItem.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-950/40 border border-red-900/50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingItem(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#9E9EA8] hover:text-white bg-[#222228] hover:bg-[#2C2C32] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveRename}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold text-black bg-white hover:bg-[#E8E8EC] transition-colors shadow-sm"
                >
                  <Check className="w-3.5 h-3.5 text-black" />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
