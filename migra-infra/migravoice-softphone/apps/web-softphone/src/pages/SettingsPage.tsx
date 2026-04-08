import { useState, useEffect, useMemo } from 'react';
import { loadConfig } from '@migravoice/config';
import { useSessionStore } from '../hooks/useSessionStore';
import { useVoipClient } from '../hooks/useVoipClient';
import BuildStamp from '../components/BuildStamp';
import { formattedBuildTime, releaseLabel } from '../buildInfo';

// ── Audio device helpers ──────────────────────────────────────────
interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState('default');
  const [selectedOutput, setSelectedOutput] = useState('default');

  useEffect(() => {
    async function enumerate() {
      try {
        // Need a short getUserMedia to unlock labels
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        const audio = all
          .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || (d.kind === 'audioinput' ? 'Microphone' : 'Speaker'),
            kind: d.kind as 'audioinput' | 'audiooutput',
          }));
        setDevices(audio);
      } catch {
        // Permission denied – show empty list
      }
    }
    enumerate();
    navigator.mediaDevices?.addEventListener?.('devicechange', enumerate);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', enumerate);
  }, []);

  return { devices, selectedInput, selectedOutput, setSelectedInput, setSelectedOutput };
}

// ── WebRTC support check ──────────────────────────────────────────
function webrtcSupport() {
  return {
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    rtcPeerConnection: typeof RTCPeerConnection !== 'undefined',
    audioContext: typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
  };
}

// ── Section component ─────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
        {children}
      </div>
    </section>
  );
}

function Row({ label, value, mono, badge, badgeColor }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        {badge && (
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase ${badgeColor || 'bg-gray-100 text-gray-500'}`}>
            {badge}
          </span>
        )}
        <span className={`text-sm ${mono ? 'font-mono' : ''} text-gray-900`}>{value}</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ══════════════════════════════════════════════════════════════════

export default function SettingsPage() {
  const { session, sipCredentials, logout } = useSessionStore();
  const { registered, registering, lastError } = useVoipClient();
  const config = useMemo(() => loadConfig(), []);
  const { devices, selectedInput, selectedOutput, setSelectedInput, setSelectedOutput } = useAudioDevices();
  const rtc = useMemo(() => webrtcSupport(), []);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const sipDomain = config.voip.sipDomain || sipCredentials?.domain || '—';
  const wssUrl = config.voip.wssUrl || `wss://${sipDomain}:8089/ws`;
  const sipUser = sipCredentials?.username || '—';

  const statusLabel = registering ? 'Connecting…' : registered ? 'Registered' : 'Offline';
  const statusColor = registering
    ? 'text-yellow-600'
    : registered
      ? 'text-emerald-600'
      : 'text-red-500';
  const statusDot = registering
    ? 'bg-yellow-400 animate-pulse'
    : registered
      ? 'bg-emerald-500'
      : 'bg-red-500';

  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      {/* Header */}
      <header className="px-4 sm:px-6 py-4 sm:py-5 bg-white border-b border-gray-200">
        <h1 className="text-lg sm:text-2xl font-display font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure your softphone connection &amp; preferences</p>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6 max-w-2xl mx-auto w-full">

        {/* ── SIP / VoIP Status ───────────────────────────────────── */}
        <Section title="VoIP Connection" icon="📡">
          <div className="px-5 py-4 flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${statusDot} ring-4 ring-opacity-20 ${registered ? 'ring-emerald-500' : registering ? 'ring-yellow-400' : 'ring-red-500'}`} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</p>
              {lastError && !registered && (
                <p className="text-xs text-red-400 mt-0.5">{lastError}</p>
              )}
            </div>
            {registered && (
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-full">SRTP SECURED</span>
            )}
          </div>
          <Row label="SIP Domain" value={sipDomain} mono />
          <Row label="SIP Extension" value={sipUser} mono badge={registered ? 'LIVE' : undefined} badgeColor="bg-emerald-100 text-emerald-700" />
          <Row label="WebSocket" value={wssUrl} mono />
          <Row label="Transport" value="WSS (TLS)" />
          <Row label="Codec" value="Opus / G.711" />
          <Row label="Registration TTL" value="300s" />
        </Section>

        {/* ── Audio Devices ──────────────────────────────────────── */}
        <Section title="Audio Devices" icon="🎧">
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Microphone</label>
              <select
                value={selectedInput}
                onChange={(e) => setSelectedInput(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand appearance-none cursor-pointer"
              >
                {inputs.length === 0 && <option value="default">Default microphone</option>}
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Speaker</label>
              <select
                value={selectedOutput}
                onChange={(e) => setSelectedOutput(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand appearance-none cursor-pointer"
              >
                {outputs.length === 0 && <option value="default">Default speaker</option>}
                {outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* ── Account ────────────────────────────────────────────── */}
        <Section title="Account" icon="👤">
          <Row label="Email" value={session?.email ?? '—'} />
          <Row label="User ID" value={session?.userId ?? '—'} mono />
          <Row label="Tenant" value={sipCredentials?.tenantId ?? '—'} mono />
        </Section>

        {/* ── WebRTC Capabilities ────────────────────────────────── */}
        <Section title="WebRTC Diagnostics" icon="🔬">
          <Row
            label="getUserMedia"
            value={rtc.getUserMedia ? '✅ Supported' : '❌ Not supported'}
          />
          <Row
            label="RTCPeerConnection"
            value={rtc.rtcPeerConnection ? '✅ Supported' : '❌ Not supported'}
          />
          <Row
            label="AudioContext"
            value={rtc.audioContext ? '✅ Supported' : '❌ Not supported'}
          />
          <Row
            label="MediaRecorder"
            value={rtc.mediaRecorder ? '✅ Supported' : '❌ Not supported'}
          />
        </Section>

        {/* ── Advanced ───────────────────────────────────────────── */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-brand hover:text-brand-700 transition font-medium flex items-center gap-1"
        >
          {showAdvanced ? '▾' : '▸'} Advanced
        </button>

        {showAdvanced && (
          <Section title="Connection Details" icon="⚙️">
            <Row label="STUN Servers" value={config.voip.stunServers?.join(', ') || 'Google STUN'} mono />
            <Row label="SIP Proxy" value={config.voip.sipProxy || sipDomain} mono />
            <Row label="Environment" value={config.env} badge={config.env} badgeColor={config.env === 'production' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'} />
            <Row label="API Base" value={config.api?.baseUrl || '—'} mono />
            <Row label="ICE Enabled" value="Yes" />
            <Row label="DTLS Auto Cert" value="Yes" />
          </Section>
        )}

        {/* ── About ──────────────────────────────────────────────── */}
        <Section title="About" icon="ℹ️">
          <Row label="Application" value="MigraVoice" />
          <Row label="Release" value={releaseLabel} badge="ENTERPRISE" badgeColor="bg-brand/10 text-brand" />
          <Row label="Built" value={formattedBuildTime} />
          <Row label="Platform" value="Web (PWA)" />
          <Row label="SIP Stack" value="sip.js 0.21" />
          <Row label="Publisher" value="MigraHosting LLC" />
        </Section>

        <BuildStamp />

        {/* ── Sign Out ───────────────────────────────────────────── */}
        <button
          onClick={logout}
          className="w-full py-3 px-4 bg-red-50 text-red-600 font-semibold rounded-xl border border-red-200 hover:bg-red-100 transition"
          type="button"
        >
          Sign Out
        </button>

        <div className="h-4" /> {/* Bottom spacer */}
      </div>
    </div>
  );
}
