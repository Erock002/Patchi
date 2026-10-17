/**
 * Service to monitor and capture media playback on the device.
 * Supports:
 *  1. Android Native NotificationListenerService (Spotify, Plex, Apple Music, YouTube Music)
 *  2. Browser MediaSession API (audio playing in the browser)
 *  3. Local audio / simulated test stream
 */

import { TrackMetadata } from '../types';
import { processAlbumArt, fetchDirectArtworkDataUrl } from './imageUtils';
import { searchSongOnline } from './musicSearch';

type MediaChangeCallback = (track: TrackMetadata, rawImageBlob?: Blob) => void;

class NowPlayingService {
  private currentTrack: TrackMetadata = {
    title: 'No media detected',
    artist: 'Open Plex, Plexamp, or Spotify',
    album: '',
    rgbHex: '#FF8800',
    artworkUrl: '',
  };

  private listeners: Set<MediaChangeCallback> = new Set();
  private isAutoSync: boolean = true;
  private syncLedWithArt: boolean = true;

  constructor() {
    this.initNativeListenerHook();
    this.initMediaSessionHook();
  }

  private nativeDebounceTimer: any = null;
  private lastProcessedMediaKey: string = '';

  /**
   * Listen for Native Android Media events injected by NotificationListenerService
   */
  private initNativeListenerHook() {
    if (typeof window === 'undefined') return;

    // Window callback used by Android APK native bridge
    (window as any).onAndroidNowPlaying = (data: {
      title?: string;
      artist?: string;
      album?: string;
      artwork?: string;
      artBase64?: string;
      rgbHex?: string;
      positionSec?: number;
      durationSec?: number;
      isPlaying?: boolean;
    }) => {
      const title = (data.title || 'Unknown Title').trim();
      const artist = (data.artist || 'Unknown Artist').trim();
      const album = (data.album || '').trim();
      const artwork = (data.artwork || data.artBase64 || '').trim();
      const rgbHex = (data.rgbHex || this.currentTrack.rgbHex || '#FF8800').trim();
      const positionSec = typeof data.positionSec === 'number' ? data.positionSec : this.currentTrack.positionSec;
      const durationSec = typeof data.durationSec === 'number' ? data.durationSec : this.currentTrack.durationSec;
      const isPlaying = typeof data.isPlaying === 'boolean' ? data.isPlaying : this.currentTrack.isPlaying;

      const key = `${title}:::${artist}:::${artwork ? 'ART' : 'NOART'}`;
      if (key === this.lastProcessedMediaKey) {
        // Still update progress if same song
        if (positionSec !== this.currentTrack.positionSec || isPlaying !== this.currentTrack.isPlaying) {
          this.currentTrack = {
            ...this.currentTrack,
            positionSec,
            durationSec,
            isPlaying,
          };
          this.notify();
        }
        return;
      }

      this.lastProcessedMediaKey = key;
      console.log('Processing Android Now Playing immediately:', title, artist, 'HasArt:', Boolean(artwork), 'Hex:', rgbHex);

      const isNewSong = this.currentTrack.title !== title || this.currentTrack.artist !== artist;
      // Use the raw artwork data URL immediately — no canvas round-trip needed in the background
      const artworkUrl = artwork ? artwork : (isNewSong ? '' : this.currentTrack.artworkUrl);

      // Immediately notify subscribers with track + artwork so BLE transmission starts without delay
      this.currentTrack = {
        title,
        artist,
        album,
        rgbHex,
        artworkUrl,
        positionSec,
        durationSec,
        isPlaying,
      };
      this.notify();

      // If Android did not provide rgbHex, extract asynchronously
      if (artwork && !data.rgbHex) {
        processAlbumArt(artwork, 0.68)
          .then((processed) => {
            if (this.currentTrack.title === title) {
              this.currentTrack.rgbHex = processed.dominantHex;
              this.notify();
            }
          })
          .catch(() => {});
      } else if (!artworkUrl && title !== 'Unknown Title' && artist !== 'Unknown Artist') {
        // Fallback: search iTunes only if Android provided no artwork at all
        searchSongOnline(`${title} ${artist}`)
          .then(async (searchMatches) => {
            if (searchMatches && searchMatches.length > 0 && searchMatches[0].artworkUrl) {
              const direct = await fetchDirectArtworkDataUrl(searchMatches[0].artworkUrl);
              if (direct && this.currentTrack.title === title) {
                this.currentTrack.artworkUrl = direct.dataUrl;
                this.currentTrack.rgbHex = direct.dominantHex;
                this.notify();
              } else {
                const processed = await processAlbumArt(searchMatches[0].artworkUrl, 0.68);
                if (this.currentTrack.title === title) {
                  this.currentTrack.artworkUrl = processed.dataUrl;
                  this.currentTrack.rgbHex = processed.dominantHex;
                  this.notify();
                }
              }
            }
          })
          .catch((searchErr) => {
            console.warn('Auto artwork search error:', searchErr);
          });
      }
    };

    // Also listen on standard custom events
    const handleNativeEvent = (e: any) => {
      if (e && e.detail) {
        (window as any).onAndroidNowPlaying(e.detail);
      }
    };
    window.addEventListener('androidNowPlaying', handleNativeEvent);
    window.addEventListener('nativeMediaUpdate', handleNativeEvent);

    window.addEventListener('nativeMediaProgress', (e: any) => {
      if (e && e.detail) {
        this.currentTrack = {
          ...this.currentTrack,
          positionSec: typeof e.detail.positionSec === 'number' ? e.detail.positionSec : this.currentTrack.positionSec,
          durationSec: typeof e.detail.durationSec === 'number' ? e.detail.durationSec : this.currentTrack.durationSec,
          isPlaying: typeof e.detail.isPlaying === 'boolean' ? e.detail.isPlaying : this.currentTrack.isPlaying,
        };
        this.notify();
      }
    });

    // Request active media session on initial page load
    setTimeout(() => {
      this.requestRefresh();
    }, 400);

    // Re-query current song whenever the app is brought back to the foreground
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.requestRefresh();
      }
    });
  }

  public requestRefresh() {
    if (typeof window !== 'undefined' && (window as any).AndroidBridge?.requestMediaUpdate) {
      try {
        (window as any).AndroidBridge.requestMediaUpdate();
      } catch (e) {
        console.warn('AndroidBridge requestMediaUpdate notice:', e);
      }
    }
  }

  public subscribe(cb: MediaChangeCallback): () => void {
    this.listeners.add(cb);
    cb(this.currentTrack);
    return () => this.listeners.delete(cb);
  }

  public getTrack(): TrackMetadata {
    return { ...this.currentTrack };
  }

  public setAutoSync(enabled: boolean) {
    this.isAutoSync = enabled;
  }

  public getAutoSync(): boolean {
    return this.isAutoSync;
  }

  public setSyncLed(enabled: boolean) {
    this.syncLedWithArt = enabled;
  }

  public getSyncLed(): boolean {
    return this.syncLedWithArt;
  }

  /**
   * Monitor browser MediaSession API (for audio playing in current tab/browser)
   */
  private initMediaSessionHook() {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    setInterval(() => {
      this.checkBrowserMediaSession();
    }, 2000);
  }

  public async checkBrowserMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const meta = navigator.mediaSession.metadata;
    if (!meta) return;

    const title = meta.title;
    const artist = meta.artist;
    const album = meta.album || '';

    if (!title && !artist) return;

    if (
      title === this.currentTrack.title &&
      artist === this.currentTrack.artist &&
      album === this.currentTrack.album
    ) {
      return;
    }

    let artworkUrl: string | undefined = this.currentTrack.artworkUrl;
    if (meta.artwork && meta.artwork.length > 0) {
      const best = meta.artwork[meta.artwork.length - 1];
      artworkUrl = best.src;
    }

    let rgbHex = this.currentTrack.rgbHex;
    if (artworkUrl) {
      try {
        const processed = await processAlbumArt(artworkUrl);
        rgbHex = processed.dominantHex;
      } catch {
        // ignore
      }
    }

    this.currentTrack = {
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      album,
      rgbHex,
      artworkUrl,
    };
    this.notify();
  }

  /**
   * Manually update the detected media (e.g. sample track or user file)
   */
  public updateManual(track: Partial<TrackMetadata>) {
    this.currentTrack = {
      ...this.currentTrack,
      ...track,
    };
    this.notify();
  }

  private notify() {
    this.listeners.forEach((cb) => cb(this.currentTrack));
  }
}

export const nowPlayingService = new NowPlayingService();
