# NGINX Routing Runbook

- Verify config: `ssh nginx-proxy-core 'nginx -t'`
- Inspect routing: `ssh nginx-proxy-core "grep -R --line-number -E 'server_name|proxy_pass|upstream' /etc/nginx | head"`
- No reloads/restarts without explicit approval.
