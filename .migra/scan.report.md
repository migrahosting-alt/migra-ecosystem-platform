# Migra Scan Report (2026-01-08)

## Executive Summary
Infrastructure is **Healthy**. All core nodes and tenant pods designated as 'running' are active.

## Findings
1.  **mpanel-core:** API is stable with 7 hours of uptime.
2.  **srv1-web:** Nginx is active with no reload errors in the last 24 hours. Protocol warnings detected for `migrapanel.com` and `migravoice.com` (non-critical).
3.  **pve:** LXCs `pod-lituationdjs` (10.1.10.53) and `pod-premtint` (10.1.10.54) are active and correctly routed.
4.  **Core Connectivity:** Tailscale links to all nodes are verified.

## Warnings
- **Nginx protocol redefinition:** `protocol options redefined for 0.0.0.0:443` in `/etc/nginx/sites-enabled/migrapanel.com.conf`.
- **SSL Stapling:** Ignored for several domains (missing responder URL).

---
*End of Report.*
