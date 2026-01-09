server {
    listen 80;
    listen [::]:80;
    server_name intake.migrahosting.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    include /etc/nginx/snippets/ocsp-off.conf;
    listen [::]:443 ssl;
    server_name intake.migrahosting.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/intake.migrahosting.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/intake.migrahosting.com/privkey.pem;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # No cache for HTML files
    location ~* \.html$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy to Node.js app
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        client_max_body_size 50M;
    }

    access_log /var/log/nginx/intake.migrahosting.com.access.log;
    error_log /var/log/nginx/intake.migrahosting.com.error.log;
}
