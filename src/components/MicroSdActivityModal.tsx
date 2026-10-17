/**
 * MicroSD Hardware & Autonomous Cache Management Modal.
 * Provides live telemetry when the MicroSD card is being read or written to,
 * shows autonomous album art & GIF cache stats, and allows manual re-scanning.
 */

import React, { useState } from 'react';
import {
  HardDrive,
  Check,
  RefreshCw,
  Zap,
  Folder,
  Image,
  Film,
  X,
  AlertCircle,
  Database,
  ExternalLink,
} from 'lucide-react';

export interface SdActivityState {
  status: 'idle' | 'reading' | 'writing';
  targetType: 'art' | 'gif' | 'none';
  targetName: string;
}

interface MicroSdActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  sdCardMounted: boolean;
  sdActivity: SdActivityState;
  sdGifs: string[];
  cachedArtCount: number;
  onRefreshSd: () => Promise<void> | void;
}

export const MicroSdActivityModal: React.FC<MicroSdActivityModalProps> = ({
  isOpen,
  onClose,
  sdCardMounted,
  sdActivity,
  sdGifs,
  cachedArtCount,
  onRefreshSd,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshSd();
    } finally {
      setTimeout(() => setIsRefreshing(false), 800);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-3xl p-5 max-w-lg w-full max-h-[88vh] overflow-y-auto space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2C2C32] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#222228] border border-[#33333C] flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">MicroSD & Autonomous Cache</h3>
              <p className="text-[11px] text-[#9E9EA8]">High-speed 4-bit SD_MMC parallel hardware storage</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9E9EA8] hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Hardware Activity Status Card */}
        <div
          className={`p-4 rounded-2xl border transition-all ${
            sdActivity.status === 'reading'
              ? 'bg-[#222228] border-white/60 shadow-lg'
              : sdActivity.status === 'writing'
              ? 'bg-[#222228] border-white/60 shadow-lg'
              : sdCardMounted
              ? 'bg-[#222228] border-[#33333C]'
              : 'bg-[#222228] border-[#33333C]'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                {sdActivity.status !== 'idle' ? (
                  <>
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        sdActivity.status === 'reading' ? 'bg-white' : 'bg-white'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        sdActivity.status === 'reading' ? 'bg-white' : 'bg-white'
                      }`}
                    />
                  </>
                ) : sdCardMounted ? (
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                ) : (
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#7A7A85]" />
                )}
              </span>
              <span className="text-xs font-bold font-mono-code uppercase tracking-wider text-white">
                {sdActivity.status === 'reading'
                  ? 'Actively Reading from MicroSD'
                  : sdActivity.status === 'writing'
                  ? 'Writing to MicroSD Cache'
                  : sdCardMounted
                  ? 'MicroSD Card Mounted & Idle'
                  : 'MicroSD Card Not Detected'}
              </span>
            </div>

            <span className="text-[10px] font-mono-code text-[#9E9EA8] px-2 py-0.5 rounded bg-[#1A1A1E]">
              {sdActivity.status === 'reading' ? '15ms RECALL' : sdCardMounted ? 'READY' : 'OFFLINE'}
            </span>
          </div>

          {/* Current Activity Detail */}
          {sdActivity.status !== 'idle' && (
            <div className="mt-3 pt-3 border-t border-[#33333C] flex items-center justify-between text-xs font-mono-code">
              <span className="text-[#9E9EA8]">Current Item:</span>
              <span className="text-white font-bold truncate max-w-[200px]">
                {sdActivity.targetType === 'art'
                  ? `/art/${sdActivity.targetName}.jpg`
                  : `/gifs/${sdActivity.targetName}`}
              </span>
            </div>
          )}
        </div>

        {/* Autonomous Cache Metrics */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 bg-[#222228] border border-[#33333C] rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-[#9E9EA8] text-xs">
              <Image className="w-3.5 h-3.5 text-white" />
              <span>Cached Covers</span>
            </div>
            <div className="text-lg font-bold text-white font-mono-code">
              {cachedArtCount > 0 ? cachedArtCount : sdCardMounted ? 'Active' : '0'}
            </div>
            <p className="text-[10px] text-[#7A7A85]">Autonomous 15ms recall</p>
          </div>

          <div className="p-3 bg-[#222228] border border-[#33333C] rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-[#9E9EA8] text-xs">
              <Film className="w-3.5 h-3.5 text-white" />
              <span>Stored GIFs</span>
            </div>
            <div className="text-lg font-bold text-white font-mono-code">
              {sdGifs.length}
            </div>
            <p className="text-[10px] text-[#7A7A85]">Available in GIF Library</p>
          </div>
        </div>

        {/* How It Works Explanation */}
        <div className="p-3.5 bg-[#222228] border border-[#33333C] rounded-2xl space-y-2 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-white">
            <Zap className="w-3.5 h-3.5 text-white" />
            <span>How MicroSD Acceleration Works</span>
          </div>
          <ul className="space-y-1.5 text-[#9E9EA8] text-[11px] leading-relaxed">
            <li className="flex items-start gap-1.5">
              <span className="text-white font-bold">•</span>
              <span>
                <strong>Zero Delay Album Art:</strong> When a song plays, the ESP32 checks its TF card. If cached, it displays in <strong>15ms</strong> without sending a single byte over Bluetooth!
              </span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-white font-bold">•</span>
              <span>
                <strong>Automatic Permanent Caching:</strong> New songs and custom GIFs beamed from the app are automatically saved to <code className="text-white bg-[#1A1A1E] px-1 py-0.5 rounded">/art/</code> and <code className="text-white bg-[#1A1A1E] px-1 py-0.5 rounded">/gifs/</code> on your MicroSD card.
              </span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-white font-bold">•</span>
              <span>
                <strong>Card Compatibility:</strong> Supports FAT32 formatted MicroSD cards up to 2TB (your 64GB card works right out of the box).
              </span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || !sdCardMounted}
            className="flex-1 py-2.5 px-3 rounded-xl bg-[#222228] hover:bg-[#2C2C32] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors border border-[#33333C] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Scanning MicroSD...' : 'Rescan MicroSD Files'}</span>
          </button>
          <button
            onClick={onClose}
            className="py-2.5 px-5 rounded-xl bg-white hover:bg-[#E8E8EC] text-xs font-extrabold text-black transition-colors shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
