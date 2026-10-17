/**
 * Pixel & Android Notification Access Guide Modal.
 * Explains:
 *  1. Why there were no 3 dots previously (old APK lacked service declaration)
 *  2. How to open Notification Access directly from the app
 *  3. Alternative zero-permission instant Spotify/Song search
 */

import React, { useState } from 'react';
import {
  Smartphone,
  ShieldAlert,
  CheckCircle2,
  X,
  ExternalLink,
  Music,
  ArrowRight,
  Sparkles,
  Settings,
  MoreVertical,
  Sliders,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const PixelNotificationGuideModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [copiedAdb, setCopiedAdb] = useState(false);

  if (!isOpen) return null;

  const handleLaunchSettings = () => {
    if ((window as any).AndroidBridge?.openNotificationSettings) {
      (window as any).AndroidBridge.openNotificationSettings();
    } else {
      // In browser or web view without bridge:
      window.open('chrome://settings', '_blank');
    }
  };

  const adbCommand = 'adb shell cmd notification allow_listener com.patchi.app/com.patchi.app.MediaNotificationListener';

  const copyAdb = () => {
    navigator.clipboard.writeText(adbCommand);
    setCopiedAdb(true);
    setTimeout(() => setCopiedAdb(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#1A1A1E] border border-[#2C2C32] rounded-3xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2C2C32] pb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-white" />
            <div>
              <h3 className="text-sm font-bold text-white">Pixel Song Auto-Detection Setup</h3>
              <p className="text-[11px] text-[#9E9EA8]">Why the 3 dots were missing & how to fix it</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9E9EA8] hover:text-white p-1 rounded-xl hover:bg-[#222228] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1-Tap Open Settings Button (when running in APK) */}
        <button
          onClick={handleLaunchSettings}
          className="w-full py-3 px-4 rounded-2xl bg-white hover:bg-[#E8E8EC] text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-[0.98]"
        >
          <Settings className="w-4 h-4 text-black" />
          <span>Launch Notification Access Directly</span>
          <ExternalLink className="w-3.5 h-3.5 text-black" />
        </button>

        {/* Why the 3 dots were missing */}
        <div className="p-3.5 bg-[#222228] border border-[#33333C] rounded-2xl text-xs space-y-1.5">
          <div className="flex items-center gap-2 text-white font-bold">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 text-white" />
            <span>Why Were There No 3 Dots on Your Pixel?</span>
          </div>
          <p className="text-[#9E9EA8] text-[11px] leading-relaxed">
            On Pixel phones, Android <strong>only displays the 3 dots (⋮)</strong> if the APK installed on your device requests a restricted background service.
            In your previous APK, that service was deleted from the build script. Because Android saw no background service requested, it treated Patchi like a plain app with zero special permissions, so the 3 dots never appeared!
          </p>
        </div>

        {/* How to Fix */}
        <div className="space-y-3">
          <span className="text-xs font-bold text-white uppercase tracking-wider block">
            The Fix (In 3 Steps):
          </span>

          {/* Step 1 */}
          <div className="p-3 bg-[#222228] border border-[#33333C] rounded-2xl flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-white/10 text-white font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              1
            </div>
            <div className="space-y-1 text-xs">
              <span className="font-bold text-white block">Re-run GitHub Actions Workflow</span>
              <p className="text-[11px] text-[#9E9EA8] leading-relaxed">
                Go to your GitHub repo's <strong>Actions</strong> tab, click <strong>Build Patchi APK</strong>, and run it. The new build includes the <code className="text-white bg-[#1A1A1E] px-1 py-0.5 rounded">MediaNotificationListener</code> service and direct settings bridge.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-3 bg-[#222228] border border-[#33333C] rounded-2xl flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-white/10 text-white font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              2
            </div>
            <div className="space-y-1 text-xs">
              <span className="font-bold text-white block">Install & Open App Info</span>
              <p className="text-[11px] text-[#9E9EA8] leading-relaxed">
                Install the new APK on your Pixel. Then either tap the white button above, or go to <strong>Settings → Apps → Patchi</strong>. With the new APK, the 3 dots (⋮) will appear in the top-right corner! Tap <strong>"Allow restricted settings"</strong>.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-3 bg-[#222228] border border-[#33333C] rounded-2xl flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-white/10 text-white font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              3
            </div>
            <div className="space-y-1 text-xs">
              <span className="font-bold text-white block">Toggle Notification Access ON</span>
              <p className="text-[11px] text-[#9E9EA8] leading-relaxed">
                Go to <strong>Settings → Apps → Special app access → Notification access</strong>, tap <strong>Patchi</strong>, and toggle it ON!
              </p>
            </div>
          </div>
        </div>

        {/* Instant No-Permission Alternative */}
        <div className="p-3.5 bg-[#222228] border border-[#33333C] rounded-2xl text-xs space-y-2">
          <div className="flex items-center gap-2 text-white font-bold">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-white" />
            <span>Alternative: Instant Song Finder (Zero Permissions Needed!)</span>
          </div>
          <p className="text-[#9E9EA8] text-[11px] leading-relaxed">
            Don't want to mess with Pixel permissions? On the Patchi main screen, simply paste any <strong>Spotify track link</strong> or type any song title in the search bar. It instantly grabs the 600×600 artwork and beams it directly!
          </p>
        </div>

        {/* Optional 1-line ADB Command for Developers */}
        <div className="p-3 bg-[#222228] border border-[#33333C] rounded-2xl space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-white font-bold">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#9E9EA8]" />
              <span>Instant ADB Bypass (Optional):</span>
            </div>
            <button
              onClick={copyAdb}
              className="text-[11px] text-white hover:underline flex items-center gap-1"
            >
              {copiedAdb ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
              <span>{copiedAdb ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <p className="font-mono-code text-[10px] text-[#9E9EA8] break-all bg-[#1A1A1E] p-2 rounded-lg border border-[#2C2C32]">
            {adbCommand}
          </p>
        </div>

        {/* Footer */}
        <div className="pt-2 flex items-center justify-end border-t border-[#2C2C32]">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-white hover:bg-[#E8E8EC] text-black font-extrabold text-xs transition-colors shadow-md"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
