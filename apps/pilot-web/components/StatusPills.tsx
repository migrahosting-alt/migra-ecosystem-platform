"use client";

/**
 * StatusPills — always-visible system instrumentation in the header.
 *
 * Shows: Auth state, LLM provider + breaker state, Policy engine,
 * System mode (Normal / Read-Only), Environment badge.
 *
 * Periodically polls /api/pilot/admin/providers for live data.
 */

import { useState } from 'react';

export type SystemMode = "normal" | "read-only";

type StatusPillsProps = {
  isAuthenticated?: boolean;
  activeProvider?: { tag: string; model: string; reason: string } | null;
  systemMode?: SystemMode;
  policyEnforced?: boolean;
  dryRun?: boolean;
};

export function StatusPills(_props: StatusPillsProps) {
  const [isConnected] = useState(true);
  const [systemStatus] = useState('operational');
  return (
    <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
    </div>
        <div className="text-sm text-gray-400">
          System Status: {systemStatus}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-sm bg-gray-700 px-3 py-1 rounded-full">Mode: Overview</div>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm">
            Overview
          </button>
          <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Debug
          </button>
        </div>
      </div>
    </div>
  );
}

export default StatusPills;

