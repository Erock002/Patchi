/**
 * Real-time BLE Packet & Serial Log Inspector.
 * Displays commands sent, binary packet chunk counters, and connection events.
 */

import React, { useState } from 'react';
import { BlePacketLogItem } from '../types';
import { Terminal, Trash2, ArrowUpRight, ShieldAlert, Cpu } from 'lucide-react';

interface BlePacketLogProps {
  logs: BlePacketLogItem[];
  onClear: () => void;
}

export const BlePacketLog: React.FC<BlePacketLogProps> = ({ logs, onClear }) => {
  const [filter, setFilter] = useState<'ALL' | 'CMD' | 'DATA' | 'SYSTEM'>('ALL');

  const filteredLogs = logs.filter((l) => {
    if (filter === 'ALL') return true;
    return l.type === filter;
  });

  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-300 font-mono-code uppercase">
            BLE Packet Monitor
          </h3>
          <span className="text-[10px] text-slate-500 font-mono-code">
            ({logs.length} events)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800">
            {(['ALL', 'CMD', 'DATA'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-2 py-0.5 text-[10px] font-mono-code rounded ${
                  filter === t ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            onClick={onClear}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono-code text-[11px] pr-1">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-600 text-center py-4 text-xs">
            No packet activity recorded yet. Connect or send a command to see traffic.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const badgeColor =
              log.type === 'CMD'
                ? 'text-cyan-400 bg-cyan-950/40 border-cyan-800/40'
                : log.type === 'DATA'
                ? 'text-amber-400 bg-amber-950/40 border-amber-800/40'
                : log.type === 'ERROR'
                ? 'text-red-400 bg-red-950/40 border-red-800/40'
                : 'text-slate-400 bg-slate-800 border-slate-700';

            return (
              <div
                key={log.id}
                className="flex items-start justify-between gap-2 p-1.5 rounded-lg bg-slate-950/60 border border-slate-850 hover:bg-slate-950 transition-colors"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${badgeColor}`}
                  >
                    {log.type}
                  </span>
                  <span className="text-slate-300 truncate">{log.summary}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-slate-500">
                  {log.bytesCount && (
                    <span className="text-slate-400 font-medium">
                      {(log.bytesCount / 1024).toFixed(1)} KB
                    </span>
                  )}
                  <span>{log.timestamp}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
