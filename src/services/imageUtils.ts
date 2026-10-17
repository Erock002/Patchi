/**
 * Utility functions for resizing images to the exact 172x172 WaveShare album cover
 * dimensions, generating high-performance JPEGs, extracting RGB colors, and QR code tools.
 */

import QRCode from 'qrcode';

export interface ImageProcessingResult {
  blob: Blob;
  dataUrl: string;
  arrayBuffer: ArrayBuffer;
  sizeBytes: number;
  dominantHex: string;
}

/**
 * Fast synchronous conversion of base64 data URLs to ArrayBuffer without DOM/Canvas.
 * Essential for background Android BLE transmission when WebView image decoders are paused.
 */
export function dataUrlToArrayBuffer(dataUrl: string): { arrayBuffer: ArrayBuffer; sizeBytes: number } {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { arrayBuffer: bytes.buffer, sizeBytes: len };
}

/**
 * Fast, deterministic 8-character hex hash of artist & album for MicroSD caching.
 * Uses FNV-1a (32-bit) which is fast and collision-resistant.
 */
export function generateAlbumHash(
  artist: string,
  albumOrTitle: string,
  title?: string,
  style?: string
): string {
  const cleanArtist = (artist || '').trim().toLowerCase();
  let cleanAlbum = (albumOrTitle || '').trim().toLowerCase();

  // If album is missing or generic (e.g. app name like "Spotify" or "Plexamp"), fall back to title
  const genericTerms = ['spotify', 'plexamp', 'music', 'sound', 'audio', 'unknown album', 'unknown', 'single'];
  if (!cleanAlbum || genericTerms.includes(cleanAlbum)) {
    cleanAlbum = (title || '').trim().toLowerCase() || cleanAlbum;
  }

  // Strip common album variations so "Album (Deluxe)", "Album (Remastered)" share the same cached cover
  cleanAlbum = cleanAlbum
    .replace(/\s*\(.*?deluxe.*?\)/gi, '')
    .replace(/\s*\[.*?deluxe.*?\]/gi, '')
    .replace(/\s*\(.*?remaster.*?\)/gi, '')
    .replace(/\s*\[.*?remaster.*?\]/gi, '')
    .replace(/\s*\(.*?anniversary.*?\)/gi, '')
    .replace(/\s*\[.*?anniversary.*?\]/gi, '')
    .replace(/\s*\(.*?edition.*?\)/gi, '')
    .replace(/\s*\[.*?edition.*?\]/gi, '')
    .replace(/\s*\(.*?version.*?\)/gi, '')
    .replace(/\s*\[.*?version.*?\]/gi, '')
    .replace(/\s*\(.*?bonus.*?\)/gi, '')
    .replace(/\s*\[.*?bonus.*?\]/gi, '')
    .replace(/\s*\(.*?expanded.*?\)/gi, '')
    .replace(/\s*\[.*?expanded.*?\]/gi, '')
    .replace(/\s*\(.*?special.*?\)/gi, '')
    .replace(/\s*\[.*?special.*?\]/gi, '')
    .trim();

  const clean = `${cleanArtist}:::${cleanAlbum}${style ? `:::${style.trim().toLowerCase()}` : ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Direct HTTP fetch of artwork directly into Base64 data URL without DOM or Canvas.
 * Essential for Android background execution where HTMLImageElement and Canvas are throttled.
 */
export async function fetchDirectArtworkDataUrl(
  url: string,
  timeoutMs: number = 4000
): Promise<{ dataUrl: string; dominantHex: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const blob = await resp.blob();
    const arrayBuffer = await blob.arrayBuffer();

    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mimeType = blob.type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      dataUrl,
      dominantHex: '#FF8800',
    };
  } catch {
    return null;
  }
}

/**
 * Resizes, crops, and compresses an image to the exact WaveShare LCD
 * dimensions (172x320 for fullscreen art, 172x172 for scrubber/visualizer).
 */
export async function processAlbumArt(
  imageSource: string | File | Blob,
  quality: number = 0.68,
  style: 'scrubber' | 'visualizer' = 'scrubber'
): Promise<ImageProcessingResult> {
  const targetW = 172;
  const targetH = 172;

  return new Promise((resolve) => {
    let resolved = false;

    // Fallback generator if image fails to load or CORS blocks it
    const createFallbackResult = (fallbackHex: string = '#FF8800'): ImageProcessingResult => {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;

      // Draw rich cyber/vinyl gradient
      const grad = ctx.createLinearGradient(0, 0, targetW, targetH);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(0.5, '#16213e');
      grad.addColorStop(1, '#0f3460');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, targetW, targetH);

      // Draw stylized vinyl disc
      const cy = 86;
      ctx.beginPath();
      ctx.arc(86, cy, 60, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = fallbackHex;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(86, cy, 20, 0, Math.PI * 2);
      ctx.fillStyle = fallbackHex;
      ctx.fill();

      // Convert to dummy JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const byteString = atob(dataUrl.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/jpeg' });

      return {
        blob,
        dataUrl,
        arrayBuffer: ab,
        sizeBytes: blob.size,
        dominantHex: fallbackHex,
      };
    };

    // Safety timeout: Never hang longer than 3.5 seconds
    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('Image processing timed out, using fallback artwork');
        resolve(createFallbackResult());
      }
    }, 3500);

    const finish = (result: ImageProcessingResult) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(safetyTimeout);
        resolve(result);
      }
    };

    const img = new Image();
    if (typeof imageSource === 'string' && !imageSource.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    const handleLoad = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          finish(createFallbackResult());
          return;
        }

        // Center-crop to 1:1 aspect ratio (172x172)
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetW, targetH);

        // Extract dominant color for backplate NeoPixel
        const dominantHex = extractDominantColor(ctx, targetW, targetH);

        // Convert to high-compatibility JPEG synchronously (no toBlob scheduling delays in background)
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = dataUrl.split(',')[1];
        const byteString = atob(base64Data);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/jpeg' });

        finish({
          blob,
          dataUrl,
          arrayBuffer: ab,
          sizeBytes: ab.byteLength,
          dominantHex,
        });
      } catch {
        finish(createFallbackResult());
      }
    };

    img.onload = handleLoad;
    img.onerror = () => {
      finish(createFallbackResult());
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => finish(createFallbackResult());
      reader.readAsDataURL(imageSource);
    }
  });
}

/**
 * Samples pixel data to extract a vibrant dominant color from the album cover.
 */
export function extractDominantColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): string {
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    // Sample every 4th pixel for speed
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      // Prefer vibrant/colorful pixels over plain grays/blacks
      if (max - min > 20 && max > 40 && min < 220) {
        rSum += r;
        gSum += g;
        bSum += b;
        count++;
      }
    }

    if (count === 0) {
      // Default to Plex Amber if no vibrant color found
      return '#FF8800';
    }

    const avgR = Math.min(255, Math.round(rSum / count));
    const avgG = Math.min(255, Math.round(gSum / count));
    const avgB = Math.min(255, Math.round(bSum / count));

    return `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`.toUpperCase();
  } catch {
    return '#FF8800';
  }
}

/**
 * Generates QR Code Data URL with standard medium ECC
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 140,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}
