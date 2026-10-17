/**
 * Hardware Settings Header.
 * Minimalist status bar showing connection state, device MAC/name, and connection button.
 */

import React from 'react';
import { BleConnectionState } from '../types';
import {
  Bluetooth,
  BluetoothConnected,
  Cpu,
  FileCode,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
} from 'lucide-react';

interface HeaderProps {
  bleState: BleConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleVirtual: (enabled: boolean) => void;
  showDevDocs: boolean;
  onToggleDevDocs: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  bleState,
  onConnect,
  onDisconnect,
  onToggleVirtual,
  showDevDocs,
  onToggleDevDocs,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 flex items-center justify-between gap-3">
        {/* Device identity */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight">
                WaveShare ESP32-S3 (1.47")
              </h1>
              <span className="text-[10px] font-mono-code px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                ST7789
              </span>
            </div>
            <div className="text-[11px] font-mono-code text-slate-400 flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  bleState.connected ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
              />
              <span>
                {bleState.connected
                  ? `Connected: ${bleState.deviceName || 'Backpack-ESP32'}`
                  : 'Device Disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick controls */}
        <div className="flex items-center gap-2">
          {/* Docs / Code Reference button */}
          <button
            onClick={onToggleDevDocs}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              showDevDocs
                ? 'bg-cyan-950/50 text-cyan-300 border-cyan-700/50'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Firmware & Android Setup</span>
          </button>

          {/* Virtual Mode Switch */}
          <button
            onClick={() => onToggleVirtual(!bleState.isVirtualMode)}
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200"
            title="Toggle between Virtual Simulation and Physical BLE Device"
          >
            {bleState.isVirtualMode ? (
              <ToggleRight className="w-4 h-4 text-cyan-400" />
            ) : (
              <ToggleLeft className="w-4 h-4 text-slate-500" />
            )}
            <span className="text-[10px] font-mono-code">
              {bleState.isVirtualMode ? 'Virtual' : 'Physical'}
            </span>
          </button>

          {/* Connect / Disconnect */}
          {bleState.connected ? (
            <button
              onClick={onDisconnect}
              className="px-3 py-1.5 rounded-lg bg-red-950/40 text-red-300 border border-red-800/40 hover:bg-red-900/60 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <BluetoothConnected className="w-3.5 h-3.5 text-red-400" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={bleState.connecting}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              {bleState.connecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span>Connect</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
