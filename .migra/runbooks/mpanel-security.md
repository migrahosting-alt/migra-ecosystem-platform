# mPanel Edge Security Policy (NGINX)

## Goals
- Protect control plane endpoints from brute force and abuse
- Keep changes reload-only where possible

## Rate limiting
- Define limit_req_zone in http{} via:
  - /etc/nginx/snippets/mpanel-limits.conf

## Enforced locations (migrapanel.com)
- /api/auth, /api/session: strict rate limit
- /api/*: moderate rate limit

## Validation
- nginx -t
- curl health endpoints
- monitor nginx error/access logs after reload
