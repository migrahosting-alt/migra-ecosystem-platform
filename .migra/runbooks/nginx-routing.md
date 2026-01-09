# NGINX Routing Runbook

- Verify config: `ssh srv1-web 'nginx -t'`
- Inspect routing: `ssh srv1-web "grep -R --line-number -E 'server_name|proxy_pass|upstream' /etc/nginx | head"`
- No reloads/restarts without explicit approval.
