# MigraHosting Default Status Pages

Professional branded pages for domains in different states.

## Usage

### Coming Soon (Default)
```nginx
root /var/www/default-pages;
index index.html;
```
Access: `https://domain.com/` → Shows "Coming Soon"

### Cancelled Website
```nginx
root /var/www/default-pages;
index index.html;
# Add rewrite to pass status parameter
rewrite ^(.*)$ /index.html?status=cancelled break;
```
Access: `https://domain.com/` → Shows "Service Cancelled"

### Suspended Account
```nginx
root /var/www/default-pages;
index index.html;
rewrite ^(.*)$ /index.html?status=suspended break;
```
Access: `https://domain.com/` → Shows "Account Suspended"

## Installation on srv1-web

```bash
# Create directory
ssh root@100.68.239.94 "mkdir -p /var/www/default-pages"

# Copy file
scp index.html root@100.68.239.94:/var/www/default-pages/

# Set permissions
ssh root@100.68.239.94 "chown -R www-data:www-data /var/www/default-pages"
```

## Nginx Configuration Examples

### New Domain (Coming Soon)
```nginx
server {
    listen 443 ssl http2;
    server_name newdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/newdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/newdomain.com/privkey.pem;
    
    root /var/www/default-pages;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Cancelled Website (Holistic Group)
```nginx
server {
    listen 443 ssl http2;
    server_name holisticgroupllc.com;
    
    ssl_certificate /etc/letsencrypt/live/holisticgroupllc.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/holisticgroupllc.com/privkey.pem;
    
    root /var/www/default-pages;
    index index.html;
    
    location / {
        rewrite ^(.*)$ /index.html?status=cancelled break;
    }
}
```

## Features

✅ Responsive design (mobile-friendly)  
✅ Beautiful gradient background  
✅ Three status types: Coming Soon, Cancelled, Suspended  
✅ Query parameter switching (?status=cancelled)  
✅ MigraHosting/MigraPanel branding  
✅ Call-to-action buttons  
✅ Professional messaging  
✅ No external dependencies (self-contained HTML)  

## Customization

Edit the HTML file to customize:
- Logo/branding
- Colors (CSS variables in `<style>`)
- Button URLs
- Support contact information
- Status messages

## Status Parameter Values

- `?status=coming-soon` (default) - New domains, under construction
- `?status=cancelled` - Cancelled hosting services
- `?status=suspended` - Suspended accounts, payment issues
