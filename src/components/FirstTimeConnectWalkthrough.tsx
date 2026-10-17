/**
 * First-Time Connect Walkthrough.
 * Foolproof step-by-step setup guide with native Android APK support and
 * 1-click launcher for real Chrome on Pixel.
 */

import React, { useState } from 'react';
import { BleConnectionState } from '../types';
import { bleService } from '../services/bleService';
import {
  Bluetooth,
  Usb,
  Smartphone,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';

interface WalkthroughProps {
  bleState: BleConnectionState;
  onConnect: () => Promise<boolean>;
  onDismiss: () => void;
}

export const FirstTimeConnectWalkthrough: React.FC<WalkthroughProps> = ({
  bleState,
  onConnect,
  onDismiss,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const isInsideIframe = typeof window !== 'undefined' && window.self !== window.top;
  const isNative = bleService.isNativeApp();
  const inAppBrowser = bleService.isInAppBrowser();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleLaunchChrome = () => {
    // Android Chrome intent launcher
    const currentUrl = window.location.href.replace(/^https?:\/\//, '');
    const intentUrl = `intent://${currentUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    try {
      window.location.href = intentUrl;
    } catch {
      window.open(window.location.href, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-3xl p-5 sm:p-7 max-w-md w-full shadow-2xl space-y-5 my-auto">
        {/* Friendly Header */}
        <div className="text-center space-y-1.5">
          <div className="w-12 h-12 rounded-2xl bg-white text-black flex items-center justify-center mx-auto shadow-lg mb-3">
            <Bluetooth className="w-6 h-6 text-black font-bold" />
          </div>
          <h2 className="text-lg sm:text-xl font-extrabold text-white">
            Let's Connect Your Display!
          </h2>
          <p className="text-xs sm:text-sm text-[#9E9EA8]">
            {isNative
              ? 'Using Native Android Bluetooth in Patchi App'
              : '3 simple steps to pair your WaveShare screen'}
          </p>
        </div>

        {/* 3 Step Cards */}
        <div className="space-y-3">
          {/* Step 1 */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#222228] border border-[#33333C]">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 text-white font-bold text-xs mt-0.5">
              1
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Usb className="w-3.5 h-3.5 text-white" />
                <span>Plug in your screen</span>
              </div>
              <p className="text-[11px] text-[#9E9EA8] mt-0.5 leading-normal">
                Plug your WaveShare display into USB power. The screen will light up.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#222228] border border-[#33333C]">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 text-white font-bold text-xs mt-0.5">
              2
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-white" />
                <span>Turn on Bluetooth</span>
              </div>
              <p className="text-[11px] text-[#9E9EA8] mt-0.5 leading-normal">
                Make sure Bluetooth is turned ON in your phone's quick settings.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#222228] border border-[#33333C]">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 text-white font-bold text-xs mt-0.5">
              3
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Bluetooth className="w-3.5 h-3.5 text-white" />
                <span>Pair "Backpack-ESP32"</span>
              </div>
              <p className="text-[11px] text-[#9E9EA8] mt-0.5 leading-normal">
                Tap the button below. When the window pops up, tap <strong>Backpack-ESP32</strong> and hit <strong>Pair</strong>!
              </p>
            </div>
          </div>
        </div>

        {/* Notice for In-App Browser on Pixel */}
        {(!isNative && (inAppBrowser || isInsideIframe)) && (
          <div className="p-3.5 bg-[#222228] border border-[#33333C] rounded-2xl space-y-2 text-xs">
            <div className="flex items-center gap-2 text-white font-bold">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#9E9EA8]" />
              <span>Pixel In-App Browser Notice</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-relaxed">
              If you opened this link from Gmail, Discord, or an app preview, Android uses an in-app viewer that disables Bluetooth. Tap below to launch your standalone Chrome app:
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleLaunchChrome}
                className="flex-1 py-2 px-3 rounded-xl bg-white text-black font-extrabold text-xs flex items-center justify-center gap-1.5 hover:bg-[#E8E8EC] transition-colors shadow-md"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Launch in Google Chrome</span>
              </button>
              <button
                onClick={handleCopyLink}
                className="py-2 px-3 rounded-xl bg-[#1A1A1E] text-white text-xs flex items-center gap-1 hover:bg-[#2C2C32] border border-[#2C2C32] transition-colors"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Error message if connection failed */}
        {bleState.error && (
          <div className="p-3 bg-[#222228] border border-red-500/40 rounded-xl text-xs text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="leading-relaxed">{bleState.error}</div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            onClick={async () => {
              const ok = await onConnect();
              if (ok) onDismiss();
            }}
            disabled={bleState.connecting}
            className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-[#E8E8EC] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl transition-all disabled:opacity-70 active:scale-[0.98]"
          >
            {bleState.connecting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-black" />
                <span>Searching for Backpack-ESP32...</span>
              </>
            ) : (
              <>
                <Bluetooth className="w-4 h-4 text-black" />
                <span>Connect Backpack-ESP32</span>
              </>
            )}
          </button>

          <button
            onClick={onDismiss}
            className="w-full py-2.5 text-xs text-[#9E9EA8] hover:text-white transition-colors text-center"
          >
            Skip for now (just test screen preview)
          </button>
        </div>
      </div>
    </div>
  );
};
