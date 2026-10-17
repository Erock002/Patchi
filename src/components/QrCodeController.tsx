/**
 * Basic QR Code Hardware Settings.
 * Enter URL/text, pick the GPIO 38 LED color, and push to the ESP32 ST7789 display.
 */

import React, { useState } from 'react';
import { bleService } from '../services/bleService';
import { BleConnectionState } from '../types';
import { QrCode, Send, CheckCircle2, AlertCircle } from 'lucide-react';

interface QrProps {
  currentPayload: string;
  onUpdateQr: (payload: string, hexColor?: string) => void;
  bleState: BleConnectionState;
}

export const QrCodeController: React.FC<QrProps> = ({
  currentPayload,
  onUpdateQr,
  bleState,
}) => {
  const [payload, setPayload] = useState(currentPayload || 'https://plex.tv');
  const [ledHex, setLedHex] = useState('#00FFCC');
  const [isSending, setIsSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);

  const handleSendQr = async () => {
    setIsSending(true);
    setSentSuccess(false);

    try {
      const cleanHex = ledHex.startsWith('#') ? ledHex : `#${ledHex}`;
      const cmd = `QR|${payload}|${cleanHex}`;
      await bleService.sendCommand(cmd);

      onUpdateQr(payload, cleanHex);
      setSentSuccess(true);
      setTimeout(() => setSentSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to send QR:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">QR Code Display</h3>
        </div>
        <span className="text-[11px] font-mono-code text-slate-400">
          ST7789 132x132 px
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Display URL or Text Payload
          </label>
          <input
            type="text"
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              onUpdateQr(e.target.value, ledHex);
            }}
            placeholder="https://your-link.com"
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono-code"
          />
        </div>


        {/* Send Button */}
        <button
          onClick={handleSendQr}
          disabled={isSending}
          className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${
            sentSuccess
              ? 'bg-emerald-600 text-white'
              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
          } ${isSending ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {sentSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>QR Code Displayed on Board!</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Push QR to ESP32 Display</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
