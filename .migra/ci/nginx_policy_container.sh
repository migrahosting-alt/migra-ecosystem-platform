#!/usr/bin/env bash
set -euo pipefail

NGINX_MAIN_CONF="${NGINX_MAIN_CONF:-nginx.conf}"

cp -a /mnt/src/. /etc/nginx/

if [[ -f "/etc/nginx/${NGINX_MAIN_CONF}" ]]; then
  sed -i -E 's/^\s*user\s+[^;]+;/user nginx;/' "/etc/nginx/${NGINX_MAIN_CONF}" || true
  sed -i -E 's/^\s*pid\s+[^;]+;/pid \/tmp\/nginx.pid;/' "/etc/nginx/${NGINX_MAIN_CONF}" || true
fi

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout /tmp/migra_dummy.key \
  -out /tmp/migra_dummy.crt \
  -subj '/CN=example.invalid' \
  -days 1 >/dev/null 2>&1

openssl dhparam -dsaparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1 || \
  openssl dhparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1

mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF

copy_stub() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

while read -r path; do
  [[ -z "$path" ]] && continue
  copy_stub /tmp/migra_dummy.crt "$path"
done < <(grep -RhoE 'ssl_certificate\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\r].*$//' | sort -u)

while read -r path; do
  [[ -z "$path" ]] && continue
  copy_stub /tmp/migra_dummy.key "$path"
done < <(grep -RhoE 'ssl_certificate_key\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\r].*$//' | sort -u)

while read -r path; do
  [[ -z "$path" ]] && continue
  copy_stub /tmp/migra_dummy.crt "$path"
done < <(grep -RhoE 'ssl_trusted_certificate\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\r].*$//' | sort -u)

while read -r path; do
  [[ -z "$path" ]] && continue
  copy_stub /tmp/migra_dummy_dhparams.pem "$path"
done < <(grep -RhoE 'ssl_dhparam\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\r].*$//' | sort -u)

while read -r inc; do
  [[ -z "$inc" ]] && continue
  case "$inc" in
    /*) ;;
    *) continue ;;
  esac
  case "$inc" in
    /etc/nginx/*) continue ;;
  esac
  case "$inc" in
    *\**|*\?*|*\[*) continue ;;
  esac
  mkdir -p "$(dirname "$inc")"
  : > "$inc"
done < <(grep -RhoE '^\s*include\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\r].*$//' | sort -u)

nginx -T -c "/etc/nginx/${NGINX_MAIN_CONF}" 2>&1
