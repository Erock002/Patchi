/**
 * GIF Optimizer & Presets Generator.
 * Uses omggif to generate native 172x320 animated GIFs that loop smoothly
 * on the WaveShare ESP32-S3 board with AnimatedGIF library.
 */

import { GifWriter, GifReader } from 'omggif';

export interface GifPresetItem {
  id: string;
  name: string;
  category: string;
  description: string;
  estimatedKb: number;
}

export const CURATED_GIF_PRESETS: GifPresetItem[] = [
  {
    id: 'equalizer',
    name: 'Cyber Equalizer',
    category: 'Audio',
    description: 'Bouncing neon equalizer bars',
    estimatedKb: 18,
  },
  {
    id: 'synthwave',
    name: 'Synthwave Sun',
    category: 'Retro',
    description: '80s horizon sunset with moving neon grid',
    estimatedKb: 22,
  },
  {
    id: 'matrix',
    name: 'Matrix Code Rain',
    category: 'Cyber',
    description: 'Cascading digital green glyphs',
    estimatedKb: 19,
  },
  {
    id: 'reactor',
    name: 'Arc Reactor',
    category: 'Sci-Fi',
    description: 'Pulsing cyan energy core with rotating particles',
    estimatedKb: 17,
  },
  {
    id: 'pixel_cat',
    name: '8-Bit Runner',
    category: 'Pixel Art',
    description: 'Retro game character bouncing on platform',
    estimatedKb: 14,
  },
  {
    id: 'cassette',
    name: 'Retro Cassette',
    category: 'Music',
    description: 'Spinning tape reels with VU audio meters',
    estimatedKb: 18,
  },
];

const presetCache = new Map<string, { buffer: ArrayBuffer; url: string }>();


/**
 * Quantize RGBA pixels to a 256-color palette for omggif
 */
function createQuantizedPalette(framesData: ImageData[], maxColors: number = 64): {
  palette: number[]; // 0xRRGGBB
  indexedFrames: Uint8Array[];
} {
  // Collect unique colors
  const colorMap = new Map<number, number>(); // 0xRRGGBB -> index
  const palette: number[] = [];

  // Always reserve black as index 0
  colorMap.set(0x000000, 0);
  palette.push(0x000000);

  // Sample colors from all frames
  for (const imgData of framesData) {
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 16) {
      // 5-bit color quantization to keep palette compact
      const r = (data[i] >> 3) << 3;
      const g = (data[i + 1] >> 3) << 3;
      const b = (data[i + 2] >> 3) << 3;
      const rgb = (r << 16) | (g << 8) | b;

      if (!colorMap.has(rgb) && palette.length < maxColors) {
        colorMap.set(rgb, palette.length);
        palette.push(rgb);
      }
    }
  }

  // Map each frame to the nearest palette index
  const indexedFrames: Uint8Array[] = [];
  for (const imgData of framesData) {
    const data = imgData.data;
    const indexed = new Uint8Array(imgData.width * imgData.height);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = (data[i] >> 3) << 3;
      const g = (data[i + 1] >> 3) << 3;
      const b = (data[i + 2] >> 3) << 3;
      const rgb = (r << 16) | (g << 8) | b;

      if (colorMap.has(rgb)) {
        indexed[p] = colorMap.get(rgb)!;
      } else {
        // Find nearest color in palette
        let minDist = Infinity;
        let bestIdx = 0;
        for (let c = 0; c < palette.length; c++) {
          const pr = (palette[c] >> 16) & 0xff;
          const pg = (palette[c] >> 8) & 0xff;
          const pb = palette[c] & 0xff;
          const dist = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);
          if (dist < minDist) {
            minDist = dist;
            bestIdx = c;
          }
        }
        indexed[p] = bestIdx;
      }
    }
    indexedFrames.push(indexed);
  }

  // omggif GifWriter strictly requires palette length to be a power of 2 (2 .. 256)
  let pLen = 2;
  while (pLen < palette.length && pLen < 256) {
    pLen *= 2;
  }
  while (palette.length < pLen) {
    palette.push(0x000000);
  }
  if (palette.length > 256) {
    palette.length = 256;
  }

  return { palette, indexedFrames };
}

/**
 * Generate a 172x320 GIF from an array of canvas render functions
 */
function renderFramesToGif(
  width: number,
  height: number,
  frameCount: number,
  delayCentisec: number,
  drawFrame: (ctx: CanvasRenderingContext2D, frameIndex: number, width: number, height: number) => void
): ArrayBuffer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const framesData: ImageData[] = [];
  for (let f = 0; f < frameCount; f++) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    drawFrame(ctx, f, width, height);
    framesData.push(ctx.getImageData(0, 0, width, height));
  }

  const { palette, indexedFrames } = createQuantizedPalette(framesData, 32);

  // Allocate 300KB buffer for output GIF
  const buffer = new Uint8Array(width * height * frameCount + 1024);
  const writer = new GifWriter(buffer, width, height, { loop: 0, palette });

  for (let f = 0; f < frameCount; f++) {
    writer.addFrame(0, 0, width, height, indexedFrames[f] as any, {
      delay: delayCentisec, // in hundredths of a second (e.g. 7 = 70ms = ~14fps)
    });
  }

  const actualLen = writer.end();
  return buffer.slice(0, actualLen).buffer;
}

/**
 * Generate built-in animated GIF preset ArrayBuffer (172x320)
 */
export async function generatePresetGif(presetId: string): Promise<{ buffer: ArrayBuffer; url: string }> {
  if (presetCache.has(presetId)) {
    return presetCache.get(presetId)!;
  }

  const w = 172;
  const h = 320;

  let buffer: ArrayBuffer;

  switch (presetId) {
    case 'equalizer': {
      // 8 compact frames of jumping equalizer
      buffer = renderFramesToGif(w, h, 8, 9, (ctx, f) => {
        const t = (f / 8) * Math.PI * 2;
        // Background gradient
        ctx.fillStyle = '#05070e';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('AUDIO SPECTRUM', 34, 35);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(16, 20, w - 32, 22);

        const bars = 10;
        const barW = 10;
        const gap = 4;
        const startX = (w - (bars * (barW + gap) - gap)) / 2;
        const baseY = 270;
        const maxH = 180;

        for (let i = 0; i < bars; i++) {
          const val = Math.abs(Math.sin(t + i * 0.7) * 0.6 + Math.cos(t * 1.5 + i * 0.4) * 0.4);
          const barH = Math.max(12, Math.round(val * maxH));
          const x = startX + i * (barW + gap);
          const y = baseY - barH;

          // Color gradient
          ctx.fillStyle = i < 3 ? '#00f0ff' : i < 7 ? '#3b82f6' : '#ec4899';
          ctx.fillRect(x, y, barW, barH);

          // Top peak
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y - 3, barW, 2);
        }

        ctx.fillStyle = '#475569';
        ctx.font = '10px monospace';
        ctx.fillText('172x320 WaveShare', 28, 305);
      });
      break;
    }

    case 'synthwave': {
      // 8 frames of retro synthwave sun & perspective grid
      buffer = renderFramesToGif(w, h, 8, 9, (ctx, f) => {
        ctx.fillStyle = '#0a051b';
        ctx.fillRect(0, 0, w, h);

        // Synthwave Sun in top half
        const sunRadius = 45;
        const sunX = w / 2;
        const sunY = 120;
        const grad = ctx.createLinearGradient(0, sunY - sunRadius, 0, sunY + sunRadius);
        grad.addColorStop(0, '#facc15');
        grad.addColorStop(0.6, '#f43f5e');
        grad.addColorStop(1, '#8b5cf6');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
        ctx.fill();

        // Horizontal sun stripes
        ctx.fillStyle = '#0a051b';
        for (let s = 1; s <= 4; s++) {
          ctx.fillRect(sunX - sunRadius, sunY + s * 9, sunRadius * 2, s * 1.5);
        }

        // Horizon line
        const horizonY = 180;
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, horizonY);
        ctx.lineTo(w, horizonY);
        ctx.stroke();

        // Moving perspective grid
        const offset = (f / 8) * 20;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1;

        // Horizontal lines moving forward
        for (let gy = horizonY + offset; gy < h; gy += 18) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
          ctx.stroke();
        }

        // Perspective vertical lines
        const vpX = w / 2;
        const bottomSteps = [-120, -70, -30, 0, 30, 70, 120];
        for (const bx of bottomSteps) {
          ctx.beginPath();
          ctx.moveTo(vpX, horizonY);
          ctx.lineTo(vpX + bx * 2, h);
          ctx.stroke();
        }

        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('SYNTHWAVE', 48, 40);
      });
      break;
    }

    case 'matrix': {
      // 8 frames of green digital rain
      const chars = '0123456789ABCDEF$#@%&*';
      buffer = renderFramesToGif(w, h, 8, 9, (ctx, f) => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        ctx.font = '10px monospace';
        const cols = 12;
        const colW = w / cols;

        for (let c = 0; c < cols; c++) {
          const colOffset = (c * 5) % 8;
          const dropY = ((f + colOffset) % 16) * 20 - 10;

          for (let trail = 0; trail < 6; trail++) {
            const y = dropY - trail * 12;
            if (y > 10 && y < h) {
              const char = chars[(c * 3 + trail + f) % chars.length];
              if (trail === 0) {
                ctx.fillStyle = '#ffffff'; // White tip
              } else if (trail < 3) {
                ctx.fillStyle = '#22c55e'; // Bright green
              } else {
                ctx.fillStyle = '#14532d'; // Dark green fade
              }
              ctx.fillText(char, c * colW + 2, y);
            }
          }
        }
      });
      break;
    }

    case 'reactor': {
      // 8 frames of pulsing reactor
      buffer = renderFramesToGif(w, h, 8, 9, (ctx, f) => {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const t = (f / 8) * Math.PI * 2;

        // Outer ring
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 64, 0, Math.PI * 2);
        ctx.stroke();

        // 8 orbiting reactor nodes
        for (let i = 0; i < 8; i++) {
          const angle = t + (i / 8) * Math.PI * 2;
          const nx = cx + Math.cos(angle) * 50;
          const ny = cy + Math.sin(angle) * 50;

          ctx.fillStyle = '#00f0ff';
          ctx.beginPath();
          ctx.arc(nx, ny, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Inner pulsing core
        const coreR = 24 + Math.sin(t * 2) * 5;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('REACTOR CORE', 42, 60);
      });
      break;
    }

    case 'pixel_cat': {
      // 6 frames of retro pixel running mascot
      buffer = renderFramesToGif(w, h, 6, 10, (ctx, f) => {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);

        // Ground platform
        ctx.fillStyle = '#334155';
        ctx.fillRect(10, 220, w - 20, 8);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(10, 218, w - 20, 2);

        // Bouncing box runner
        const bounce = f % 2 === 0 ? 0 : -6;
        const px = w / 2 - 20;
        const py = 175 + bounce;

        // Body
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(px, py, 40, 36);

        // Ears
        ctx.fillRect(px + 4, py - 8, 8, 8);
        ctx.fillRect(px + 28, py - 8, 8, 8);

        // Eyes
        ctx.fillStyle = '#000000';
        ctx.fillRect(px + 10, py + 12, 6, 6);
        ctx.fillRect(px + 24, py + 12, 6, 6);

        // Legs
        ctx.fillStyle = '#d97706';
        if (f % 2 === 0) {
          ctx.fillRect(px + 6, py + 36, 8, 8);
          ctx.fillRect(px + 26, py + 36, 8, 8);
        } else {
          ctx.fillRect(px + 10, py + 36, 8, 8);
          ctx.fillRect(px + 22, py + 36, 8, 8);
        }

        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('PIXEL RUNNER', 40, 70);
      });
      break;
    }

    default: // cassette
      buffer = renderFramesToGif(w, h, 8, 9, (ctx, f) => {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const t = (f / 8) * Math.PI * 2;

        // Cassette shell
        ctx.fillStyle = '#262626';
        ctx.fillRect(16, cy - 65, w - 32, 130);
        ctx.strokeStyle = '#525252';
        ctx.strokeRect(16, cy - 65, w - 32, 130);

        // Label
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(24, cy - 50, w - 48, 55);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('MIXTAPE VOL. 1', 38, cy - 30);

        // Left spool
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 30, cy + 25, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx - 30, cy + 25, 14, t, t + Math.PI);
        ctx.stroke();

        // Right spool
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + 30, cy + 25, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 30, cy + 25, 14, t, t + Math.PI);
        ctx.stroke();
      });
      break;
  }

  const blob = new Blob([buffer], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  const result = { buffer, url };
  presetCache.set(presetId, result);
  return result;
}

/**
 * Resizes and optimizes any user-uploaded GIF into a compliant 172x320 GIF
 */
export async function optimizeUserGif(file: File): Promise<{
  buffer: ArrayBuffer;
  url: string;
  originalSize: number;
  optimizedSize: number;
}> {
  const originalBuffer = await file.arrayBuffer();
  const originalSize = originalBuffer.byteLength;

  try {
    const reader = new GifReader(new Uint8Array(originalBuffer));
    const srcW = reader.width;
    const srcH = reader.height;
    const numFrames = reader.numFrames();
    const targetW = 172;
    const targetH = 320;

    if (numFrames <= 0 || srcW <= 0 || srcH <= 0) {
      throw new Error('Invalid GIF dimensions or frame count');
    }

    // Target max 16 frames for ESP32 memory safety and ultra-fast BLE transfer
    const maxFrames = 16;
    const frameStep = numFrames > maxFrames ? Math.ceil(numFrames / maxFrames) : 1;
    const selectedFramesSet = new Set<number>();
    for (let i = 0; i < numFrames && selectedFramesSet.size < maxFrames; i += frameStep) {
      selectedFramesSet.add(i);
    }
    // Always include first frame
    selectedFramesSet.add(0);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcW;
    tempCanvas.height = srcH;
    const tempCtx = tempCanvas.getContext('2d')!;
    const tempImgData = tempCtx.createImageData(srcW, srcH);

    const framesData: ImageData[] = [];

    // Scale aspect ratio to fit inside 172x320 LCD
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const drawW = Math.max(1, Math.round(srcW * scale));
    const drawH = Math.max(1, Math.round(srcH * scale));
    const offsetX = Math.round((targetW - drawW) / 2);
    const offsetY = Math.round((targetH - drawH) / 2);

    // CRITICAL: Must decode all frames sequentially so GIF deltas/disposals accumulate properly
    for (let f = 0; f < numFrames; f++) {
      reader.decodeAndBlitFrameRGBA(f, tempImgData.data);

      if (selectedFramesSet.has(f)) {
        tempCtx.putImageData(tempImgData, 0, 0);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(tempCanvas, 0, 0, srcW, srcH, offsetX, offsetY, drawW, drawH);

        framesData.push(ctx.getImageData(0, 0, targetW, targetH));
      }
    }

    if (framesData.length === 0) {
      throw new Error('No frames extracted from GIF');
    }

    const { palette, indexedFrames } = createQuantizedPalette(framesData, 64);
    const outputBuffer = new Uint8Array(targetW * targetH * framesData.length + 4096);
    const writer = new GifWriter(outputBuffer, targetW, targetH, { loop: 0, palette });

    const rawDelay = reader.frameInfo(0).delay || 10;
    // Scale delay so playback speed matches the original despite frame skipping
    const delay = Math.max(7, Math.min(20, Math.round(rawDelay * frameStep)));

    for (let f = 0; f < framesData.length; f++) {
      writer.addFrame(0, 0, targetW, targetH, indexedFrames[f] as any, { delay });
    }

    const finalLen = writer.end();
    const finalBuffer = outputBuffer.slice(0, finalLen).buffer;
    const finalBlob = new Blob([finalBuffer], { type: 'image/gif' });
    const finalUrl = URL.createObjectURL(finalBlob);

    return {
      buffer: finalBuffer,
      url: finalUrl,
      originalSize,
      optimizedSize: finalBuffer.byteLength,
    };
  } catch (err: any) {
    console.warn('GIF optimization encountered an issue:', err);
    // If the file is already under 75KB, it might still work directly
    if (originalSize <= 75 * 1024) {
      const url = URL.createObjectURL(file);
      return {
        buffer: originalBuffer,
        url,
        originalSize,
        optimizedSize: originalSize,
      };
    }
    throw new Error(
      `Could not optimize GIF (${err?.message || 'Unsupported format'}). Try another GIF or use the built-in presets.`
    );
  }
}
