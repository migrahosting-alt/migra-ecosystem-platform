// Operational Readiness Slice 5 — real READ-ONLY network prober.
//
// Implements DNS/TLS/HTTP against SERVER-APPROVED endpoints only (host/url come
// from the target registry, never from a client). Infra methods that need
// diagnostics credentials (service/logs/metrics/db/mail/storage) are left to a
// credentialed read-only backend; here they report unreachable/unknown rather
// than fabricate health. There is no write/exec method — by construction.
//
// © MigraTeck LLC.

import { promises as dnsp } from 'node:dns';
import { connect as tlsConnect } from 'node:tls';
import type { ApprovedEndpoint } from './targetRegistry.js';
import { NullProber, type DnsResult, type HttpResult, type TlsResult } from './deps.js';

const SAFE_HEADERS = ['content-type', 'server', 'cache-control', 'strict-transport-security'];
const MAX_REDIRECTS = 3;
const NET_TIMEOUT_MS = 5000;

export class NetworkProber extends NullProber {
  override async resolveDns(endpoint: ApprovedEndpoint): Promise<DnsResult> {
    try {
      const records = await dnsp.resolve(endpoint.host).catch(async () => dnsp.resolve4(endpoint.host));
      const flat = (Array.isArray(records) ? records : []).map(String);
      const matchesExpected = endpoint.expectedRecords ? endpoint.expectedRecords.every((r) => flat.includes(r)) : undefined;
      return { reachable: true, records: flat, matchesExpected };
    } catch (err) {
      return { reachable: false, records: [], protocolError: codeOf(err) };
    }
  }

  override async inspectTls(endpoint: ApprovedEndpoint): Promise<TlsResult> {
    const port = endpoint.port ?? 443;
    return new Promise<TlsResult>((resolve) => {
      let settled = false;
      const done = (r: TlsResult) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* ignore */ }
        resolve(r);
      };
      const socket = tlsConnect({ host: endpoint.host, port, servername: endpoint.host, timeout: NET_TIMEOUT_MS, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        const validTo = cert && cert.valid_to ? Date.parse(cert.valid_to) : NaN;
        const daysToExpiry = Number.isFinite(validTo) ? Math.floor((validTo - nowMs()) / 86_400_000) : undefined;
        // authorized reflects chain validity against the system trust store.
        const chainValid = socket.authorized === true;
        const hostnameMatch = chainValid || (socket.authorizationError ? !/hostname|altnames|IP/i.test(String(socket.authorizationError)) : true);
        done({ reachable: true, daysToExpiry, hostnameMatch, chainValid });
      });
      socket.on('timeout', () => done({ reachable: false, protocolError: 'timeout' }));
      socket.on('error', (e) => done({ reachable: false, protocolError: codeOf(e) }));
    });
  }

  override async httpProbe(endpoint: ApprovedEndpoint): Promise<HttpResult> {
    if (!endpoint.url) return { reachable: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS);
    const started = nowMs();
    let redirects = 0;
    let url = endpoint.url;
    try {
      // Manual redirect handling so we can BOUND redirect count (SSRF hardening;
      // the initial URL is already an approved, server-authoritative endpoint).
      for (;;) {
        const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location') && redirects < MAX_REDIRECTS) {
          redirects += 1;
          url = new URL(res.headers.get('location')!, url).toString();
          continue;
        }
        const safeHeaders: Record<string, string> = {};
        for (const h of SAFE_HEADERS) { const v = res.headers.get(h); if (v) safeHeaders[h] = v; }
        return { reachable: true, status: res.status, latencyMs: nowMs() - started, redirects, safeHeaders };
      }
    } catch (err) {
      return { reachable: false, redirects, ...(codeOf(err) === 'AbortError' ? {} : {}) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function codeOf(err: unknown): string {
  const e = err as { code?: string; name?: string };
  return e?.code ?? e?.name ?? 'error';
}

function nowMs(): number {
  return Date.now();
}
