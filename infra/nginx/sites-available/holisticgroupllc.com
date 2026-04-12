server {
    listen 80;
    server_name holisticgroupllc.com www.holisticgroupllc.com;

    root /srv/web/clients/holisticgroupllc.com;

    # Always return 503 for normal traffic
    error_page 503 @maintenance;

    location / {
        return 503;
    }

    # Serve the offline page
    location @maintenance {
        try_files /maintenance.html =503;
    }
}
