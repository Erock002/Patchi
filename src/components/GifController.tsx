/**
 * Basic Hardware GIF Controller.
 * Provides a clean file loader to transmit animated GIFs to the ESP32-S3's 2MB PSRAM buffer.
 */

import React, { useState } from 'react';
import { BleConnectionState } from '../types';
import { bleService } from '../services/bleService';
import { Film, Upload, Send, Wifi, RefreshCw, CheckCircle2 } from 'lucide-react';

interface GifControllerProps {
  onSelectGif: (url: string | null) => void;
  bleState: BleConnectionState;
}

export const GifController: React.FC<GifControllerProps> = ({
  onSelectGif,
  bleState,
}) => {
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [gifBuffer, setGifBuffer] = useState<ArrayBuffer | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('GIF exceeds 2MB PSRAM buffer limit of the ESP32-S3.');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const url = URL.createObjectURL(file);
      setGifFile(file);
      setGifBuffer(buffer);
      setGifUrl(url);
      onSelectGif(url);
    } catch (err) {
      console.error('Failed to read GIF:', err);
    }
  };

  const handleStreamBle = async () => {
    if (!gifBuffer) return;
    setIsSending(true);
    setStatusMsg('Allocating PSRAM & streaming frames...');

    try {
      await bleService.sendCommand(`PREP_GIF|${gifBuffer.byteLength}`);
      await new Promise((r) => setTimeout(r, 40));
      await bleService.sendBinaryData(gifBuffer, 'GIF');
      setStatusMsg('GIF loaded into PSRAM! Looping on screen.');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg(`Stream error: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleStartWifiAp = async () => {
    try {
      await bleService.sendCommand('WIFI_ON');
      setStatusMsg('SoftAP started: Connect phone to Wi-Fi "Backpack-Beam" (pass: backpack123)');
    } catch (err) {
      console.error('Error starting Wi-Fi AP:', err);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">GIF Hardware Loader</h3>
        </div>
        <span className="text-[11px] font-mono-code text-slate-400">
          Max: 2MB Octal PSRAM
        </span>
      </div>

      {/* File input */}
      <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
        <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl cursor-pointer transition-colors">
          <Upload className="w-6 h-6 text-slate-400 mb-1" />
          <span className="text-xs font-semibold text-slate-200">
            {gifFile ? gifFile.name : 'Select 172x320 Animated GIF file'}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            {gifFile ? `${(gifFile.size / 1024).toFixed(1)} KB` : 'Loops directly out of ESP32 PSRAM'}
          </span>
          <input
            type="file"
            accept=".gif,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {gifFile && (
          <div className="flex gap-2">
            <button
              onClick={handleStreamBle}
              disabled={isSending}
              className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition-colors flex items-center justify-center gap-2"
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Streaming via BLE...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Stream GIF over BLE</span>
                </>
              )}
            </button>
            <button
              onClick={handleStartWifiAp}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
              title="Starts temporary SoftAP for large GIFs"
            >
              <Wifi className="w-3.5 h-3.5 text-amber-400" />
              <span>Wi-Fi Burst</span>
            </button>
          </div>
        )}

        {statusMsg && (
          <div className="text-xs text-cyan-300 font-mono-code bg-cyan-950/40 p-2 rounded-lg border border-cyan-800/40 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
};
