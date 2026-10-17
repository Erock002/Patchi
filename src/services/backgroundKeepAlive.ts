/**
 * BackgroundKeepAliveService
 * Prevents Chromium WebView from freezing the V8 JavaScript runtime, Promises,
 * and BLE background packet streaming when the phone screen is locked in a pocket.
 *
 * Chromium Page Lifecycle specification guarantees:
 * "Pages currently playing audio are never frozen in the background."
 *
 * Self-healing: auto-restarts on pause/ended events and via 30s watchdog timer.
 */
class BackgroundKeepAliveService {
  private audioElement: HTMLAudioElement | null = null;
  private isRunning: boolean = false;
  private watchdogTimer: any = null;
  private startRequested: boolean = false;
  private _visibilityListenerAdded = false;

  private static readonly SILENT_WAV_BASE64 =
    'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

  public start() {
    if (typeof window === 'undefined') return;
    this.startRequested = true;

    try {
      if (!this.audioElement) {
        this.audioElement = new Audio(BackgroundKeepAliveService.SILENT_WAV_BASE64);
        this.audioElement.loop = true;
        this.audioElement.volume = 0.01;

        this.audioElement.addEventListener('pause', () => {
          // Only auto-restart if it was legitimately running and got paused externally
          if (this.startRequested && this.isRunning) {
            this.isRunning = false;
            console.log('[KEEPALIVE] Audio paused externally — restarting anchor...');
            this._play();
          }
        });
        this.audioElement.addEventListener('ended', () => {
          if (this.startRequested) {
            console.log('[KEEPALIVE] Audio ended — restarting anchor...');
            this._play();
          }
        });
      }

      this._play();
      this._startWatchdog();
      this._listenVisibility();
    } catch (e) {
      console.warn('[KEEPALIVE] Audio anchor init notice:', e);
    }
  }

  private _isPlayPending = false;

  private _play() {
    if (!this.audioElement || !this.startRequested || this._isPlayPending) return;
    this._isPlayPending = true;

    const playPromise = this.audioElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this._isPlayPending = false;
          this.isRunning = true;
          console.log('[KEEPALIVE] Background audio anchor active. V8 engine will not freeze on lock.');
        })
        .catch((err) => {
          this._isPlayPending = false;
          this.isRunning = false;
          // In desktop browsers / initial WebView without user gesture, play() requires interaction
          if (typeof window !== 'undefined') {
            const unlock = () => {
              if (this.startRequested && !this.isRunning) {
                this._play();
              }
            };
            window.addEventListener('pointerdown', unlock, { once: true });
            window.addEventListener('keydown', unlock, { once: true });
          }
        });
    } else {
      this._isPlayPending = false;
    }
  }

  private _startWatchdog() {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (this.startRequested && this.audioElement && this.audioElement.paused) {
        console.log('[KEEPALIVE] Watchdog: anchor paused — restarting...');
        this._play();
      }
    }, 30000);
  }

  private _listenVisibility() {
    if (this._visibilityListenerAdded || typeof document === 'undefined') return;
    this._visibilityListenerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.startRequested) {
        if (this.audioElement && this.audioElement.paused) {
          console.log('[KEEPALIVE] Visibility visible — restarting paused anchor...');
          this._play();
        }
      }
    });
  }

  public stop() {
    this.startRequested = false;
    this.isRunning = false;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
    }
  }

  public isActive(): boolean {
    return this.isRunning && !!this.audioElement && !this.audioElement.paused;
  }
}

export const backgroundKeepAlive = new BackgroundKeepAliveService();
