/**
 * WaveShare ESP32-S3 1.47" Display Preview.
 * Renders an enlarged, high-visibility 172:320 hardware preview:
 *  - Now Playing Option 1: Fullscreen album art scrolling left-to-right and back
 *  - Now Playing Option 2: Now playing screen with large artwork, progress scrubber, and track title
 *  - Now Playing Option 3: Dynamic audio visualizer with track title
 *  - QR Code: Custom title + sharp QR Code
 *  - GIF: Auto-scaled animated GIF
 */

import React, { useEffect, useRef, useState } from 'react';
import { TrackMetadata } from '../types';
import { generateQrDataUrl } from '../services/imageUtils';
import { Music, QrCode, Film, Disc } from 'lucide-react';

export type NowPlayingStyle = 'scrubber' | 'visualizer';

interface DisplayPreviewProps {
  mode: 'NOW_PLAYING' | 'QR' | 'GIF';
  nowPlayingStyle: NowPlayingStyle;
  track: TrackMetadata;
  qrTitle: string;
  qrPayload: string;
  gifUrl: string | null;
  transferProgress?: number | null;
}

export const Esp32HardwareSimulator: React.FC<DisplayPreviewProps> = ({
  mode,
  nowPlayingStyle,
  track,
  qrTitle,
  qrPayload,
  gifUrl,
  transferProgress,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [scrubberProgress, setScrubberProgress] = useState<number>(38);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Generate QR code whenever payload changes
  useEffect(() => {
    if (qrPayload) {
      generateQrDataUrl(qrPayload)
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [qrPayload]);

  const [simulatedPositionSec, setSimulatedPositionSec] = useState<number>(track.positionSec || 0);

  useEffect(() => {
    if (typeof track.positionSec === 'number') {
      setSimulatedPositionSec(track.positionSec);
    }
  }, [track.positionSec]);

  // Real-time scrubber progression
  useEffect(() => {
    if (mode !== 'NOW_PLAYING' || nowPlayingStyle !== 'scrubber') return;
    const isPlaying = track.isPlaying ?? true;
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setSimulatedPositionSec((prev) => {
        const dur = track.durationSec || 204;
        if (dur > 0 && prev < dur) {
          return prev + 1;
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, nowPlayingStyle, track.isPlaying, track.durationSec]);

  // Audio visualizer animation for Option 3 (Title, Artist, Album UP TOP, no cover art)
  useEffect(() => {
    if (mode !== 'NOW_PLAYING' || nowPlayingStyle !== 'visualizer') return;
    const canvas = visualizerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();
    let phase = 0;

    const render = (now: number) => {
      const dt = Math.min(100, now - lastTime);
      lastTime = now;

      // Firmware matches: phase += 0.14f every 45ms -> (0.14 / 45) rad per ms
      phase += dt * (0.14 / 45);

      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, w, h);

      // Track Title UP TOP (Clean and prominent, enlarged to 20px)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      let titleDisplay = track.title || 'NOW PLAYING';
      if (titleDisplay.length > 18) {
        const padded = titleDisplay + '    ';
        const scrollIdx = Math.floor(now * 0.0045) % padded.length;
        titleDisplay = (padded + padded).substring(scrollIdx, scrollIdx + 18);
      }
      ctx.fillText(titleDisplay, 14, 34);

      // Artist UP TOP
      ctx.fillStyle = '#f59e0b';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const shortArtist = track.artist.length > 26 ? track.artist.substring(0, 25) + '..' : (track.artist || 'Waiting for audio...');
      ctx.fillText(shortArtist, 14, 58);

      // Album UP TOP (Clean and prominent)
      if (track.album) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const shortAlbum = track.album.length > 28 ? track.album.substring(0, 27) + '..' : track.album;
        ctx.fillText(shortAlbum, 14, 80);
      }

      // Divider line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(14, 94);
      ctx.lineTo(w - 14, 94);
      ctx.stroke();

      // Dynamic Audio Visualizer Bars (100% matched to ESP32 firmware)
      const numBars = 11;
      const barW = Math.round(10 * (w / 172));
      const gap = Math.round(4 * (w / 172));
      const startX = Math.round((w - (numBars * (barW + gap) - gap)) / 2);
      const baseY = Math.round(300 * (h / 320));
      const maxH = Math.round(190 * (h / 320));

      for (let i = 0; i < numBars; i++) {
        const x = startX + i * (barW + gap);
        // Exact firmware formula from animateVisualizerBars()
        let val = Math.sin(phase * 1.6 + i * 0.7) * 0.5 + Math.sin(phase * 0.9 + i * 1.3) * 0.35 + 0.15;
        if (val < 0.05) val = 0.05;
        const barH = Math.min(maxH, Math.round(val * maxH));

        // Exact firmware color palette: Cyan (0..3), Indigo (4..7), Neon Pink (8..10)
        const col = i < 4 ? '#00f0ff' : i < 8 ? '#6366f1' : '#ec4899';
        ctx.fillStyle = col;
        ctx.fillRect(x, baseY - barH, barW, barH);

        // Peak white cap (exact firmware line)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, baseY - barH - 2, barW, 2);
      }

      // Baseline (exact firmware divider at 305/320)
      const baselineY = Math.round(305 * (h / 320));
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(14, baselineY);
      ctx.lineTo(w - 14, baselineY);
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [mode, nowPlayingStyle, track]);

  return (
    <div className="flex flex-col items-center select-none w-full max-w-sm">
      {/* Hardware Header Label */}
      <div className="w-full flex items-center justify-center mb-2 px-2 text-[11px] font-mono-code text-[#9E9EA8]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          <span className="font-bold text-white tracking-wider">BACKPACK-ESP32</span>
        </div>
      </div>

      {/* ST7789 Scaled Display Area (Seamless Hero Display) */}
      <div className="relative w-[250px] sm:w-[270px] h-[465px] sm:h-[502px] bg-black rounded-2xl overflow-hidden border border-[#2C2C32] shadow-[0_16px_40px_rgba(0,0,0,0.8)] screen-pixelated flex-shrink-0">

          {/* ======================================================== */}
          {/* MODE: NOW PLAYING                                        */}
          {/* ======================================================== */}
          {mode === 'NOW_PLAYING' && (
            <div className="w-full h-full relative bg-black text-white">
              {/* Now Playing Screen (Artwork + Scrubber + Title) */}
              {nowPlayingStyle === 'scrubber' && (
                <div className="w-full h-full flex flex-col justify-between p-3.5 sm:p-4 bg-[#0F0F12]">
                  {/* Top Square Artwork */}
                  <div className="w-[220px] sm:w-[238px] h-[220px] sm:h-[238px] mx-auto rounded-2xl overflow-hidden bg-[#16161A] border border-[#26262E] flex items-center justify-center flex-shrink-0 shadow-lg">
                    {track.artworkUrl ? (
                      <img
                        src={track.artworkUrl}
                        alt="Album Art"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Disc className="w-16 h-16 text-amber-500/40 animate-spin" />
                    )}
                  </div>

                  {/* Metadata & Progress Scrubber */}
                  <div className="flex-1 flex flex-col justify-between pt-3 pb-1 px-1">
                    <div className="overflow-hidden space-y-1">
                      <div className="text-base sm:text-lg font-bold text-white leading-tight overflow-hidden whitespace-nowrap">
                        <span className={track.title && track.title.length > 15 ? 'title-marquee-scroll' : 'truncate block'}>
                          {track.title || 'Waiting for song'}
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm text-amber-400 font-medium truncate">
                        {track.artist || 'Play music on device'}
                      </div>
                      {track.album && (
                        <div className="text-[11px] sm:text-xs text-slate-400 truncate">
                          {track.album}
                        </div>
                      )}
                    </div>

                    {/* Scrubber Progress Bar */}
                    <div className="space-y-1.5 pt-2">
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              (track.durationSec && track.durationSec > 0)
                                ? Math.min(100, Math.round((simulatedPositionSec / track.durationSec) * 100))
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono-code text-slate-500">
                        <span>
                          {Math.floor(simulatedPositionSec / 60)}:
                          {String(Math.floor(simulatedPositionSec % 60)).padStart(2, '0')}
                        </span>
                        <span>
                          {track.durationSec && track.durationSec > 0
                            ? `${Math.floor(track.durationSec / 60)}:${String(
                                Math.floor(track.durationSec % 60)
                              ).padStart(2, '0')}`
                            : '--:--'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Option 3: Dynamic Audio Visualizer (No cover art, title and artist UP TOP) */}
              {nowPlayingStyle === 'visualizer' && (
                <div className="w-full h-full relative">
                  <canvas
                    ref={visualizerCanvasRef}
                    width={270}
                    height={502}
                    className="w-full h-full"
                  />
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* MODE: QR CODE                                            */}
          {/* ======================================================== */}
          {mode === 'QR' && (
            <div className="w-full h-full bg-white text-black flex flex-col items-center justify-between py-8 px-4">
              <div className="text-center px-1">
                <div className="text-base font-black tracking-wider uppercase text-slate-900 truncate max-w-[220px]">
                  {qrTitle || 'SCAN ME'}
                </div>
              </div>

              {/* Large QR Code */}
              <div className="w-[190px] sm:w-[200px] h-[190px] sm:h-[200px] bg-white flex items-center justify-center p-2 border-2 border-slate-200 shadow-sm rounded-lg">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <QrCode className="w-24 h-24 text-slate-300" />
                )}
              </div>

              {/* Payload footer */}
              <div className="text-center px-2 max-w-[220px]">
                <div className="text-xs text-slate-700 font-mono-code truncate font-medium">
                  {qrPayload?.startsWith('BEGIN:VCARD') || qrPayload?.startsWith('MECARD:')
                    ? 'Scan to Save Contact'
                    : (qrPayload || 'https://plex.tv')}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MODE: GIF PLAYER                                         */}
          {/* ======================================================== */}
          {mode === 'GIF' && (
            <div className="w-full h-full bg-black relative flex items-center justify-center overflow-hidden">
              {gifUrl ? (
                <img
                  src={gifUrl}
                  alt="Animated GIF"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-600 gap-3 p-4 text-center">
                  <Film className="w-14 h-14 text-cyan-400/50" />
                  <span className="text-xs font-mono-code text-slate-300 font-bold">
                    Upload Any GIF
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Auto-scaled to fit 172×320 screen
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

      {/* Bottom Hardware Bezel Note */}
      <div className="text-center text-[10px] font-mono-code text-[#7A7A85] mt-2">
        Pixel-Accurate Preview
      </div>
    </div>
  );
};
