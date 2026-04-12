'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorHealth {
  connectorName: string;
  status: 'green' | 'yellow' | 'red';
  lastSignalAt?: string;
  errorMessage?: string;
}

interface ExternalSignal {
  signalId: string;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

interface WebhookDelivery {
  deliveryId: string;
  eventType: string;
  url: string;
  payload: Record<string, unknown>;
  timestamp: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

interface IntegrationDashboard {
  connectors: ConnectorHealth[];
  recentSignals: ExternalSignal[];
  recentWebhooks: WebhookDelivery[];
  failedWebhooks: WebhookDelivery[];
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------

const FALLBACK_DATA: IntegrationDashboard = {
  connectors: [
    { connectorName: 'Datadog', status: 'green', lastSignalAt: '2026-01-12T11:55:00Z' },
    { connectorName: 'Zendesk', status: 'yellow', lastSignalAt: '2026-01-12T10:30:00Z' },
    { connectorName: 'PagerDuty', status: 'red', errorMessage: 'API key expired' },
  ],
  recentSignals: [
    {
      signalId: 'sig_dd_001',
      source: 'datadog',
      type: 'alert_firing',
      payload: { metric: 'error_rate', value: 0.035 },
      timestamp: '2026-01-12T11:55:00Z',
      severity: 'warning',
    },
    {
      signalId: 'sig_zd_001',
      source: 'zendesk',
      type: 'support_ticket',
      payload: { ticketId: 'T-4521', subject: 'App crashes on upload' },
      timestamp: '2026-01-12T10:30:00Z',
      severity: 'info',
    },
  ],
  recentWebhooks: [
    {
      deliveryId: 'whk_policyPromoted_001',
      eventType: 'policyPromoted',
      url: 'https://hooks.example.com/policy',
      payload: { policyVersion: 'pol-v14' },
      timestamp: '2026-01-12T11:00:00Z',
      success: true,
      statusCode: 200,
    },
  ],
  failedWebhooks: [
    {
      deliveryId: 'whk_driftCritical_002',
      eventType: 'driftCritical',
      url: 'https://hooks.example.com/policy',
      payload: { policyVersion: 'pol-v13' },
      timestamp: '2026-01-12T09:00:00Z',
      success: false,
      statusCode: 502,
      error: 'Bad Gateway',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusDot: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
};

const severityColor: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectorHealthPanel({ connectors }: { connectors: ConnectorHealth[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Connector Health</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {connectors.map((c) => (
            <div key={c.connectorName} className="flex items-center justify-between border rounded-md p-3">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${statusDot[c.status]}`} />
                <span className="font-medium text-sm">{c.connectorName}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.lastSignalAt ? `Last: ${fmtTime(c.lastSignalAt)}` : ''}
                {c.errorMessage && (
                  <span className="ml-2 text-red-500">{c.errorMessage}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalFeed({ signals }: { signals: ExternalSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Incoming Signals</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2">Time</th>
              <th className="pb-2">Source</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Severity</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.signalId} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{fmtTime(s.timestamp)}</td>
                <td className="py-2">{s.source}</td>
                <td className="py-2 font-mono text-xs">{s.type}</td>
                <td className="py-2">
                  <Badge className={severityColor[s.severity] ?? ''}>
                    {s.severity}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function WebhookLog({ deliveries, title }: { deliveries: WebhookDelivery[]; title: string }) {
  if (deliveries.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2">Time</th>
              <th className="pb-2">Event</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.deliveryId} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{fmtTime(d.timestamp)}</td>
                <td className="py-2 font-mono text-xs">{d.eventType}</td>
                <td className="py-2">
                  <Badge className={d.success ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}>
                    {d.statusCode ?? '—'}
                  </Badge>
                </td>
                <td className="py-2 text-xs text-muted-foreground">{d.error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  const [data, setData] = useState<IntegrationDashboard>(FALLBACK_DATA);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    // Future: fetch from /api/optimizer/integrations
    setData(FALLBACK_DATA);
    setLastRefresh(new Date());
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <span className="text-xs text-muted-foreground">
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </span>
      </div>

      <ConnectorHealthPanel connectors={data.connectors} />
      <SignalFeed signals={data.recentSignals} />
      <WebhookLog deliveries={data.recentWebhooks} title="Webhook Deliveries" />
      {data.failedWebhooks.length > 0 && (
        <WebhookLog deliveries={data.failedWebhooks} title="Failed Webhooks (Retry Queue)" />
      )}
    </div>
  );
}
