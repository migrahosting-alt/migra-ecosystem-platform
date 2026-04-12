#!/bin/bash
# MigraHosting Guardian Monitoring System
# Created: 2026-01-11 15:32:00 UTC
# Purpose: 30-second health checks with instant Slack alerts
#
# Installation:
#   1. Copy to: /opt/migra-guardian/health_monitor.sh
#   2. Make executable: chmod +x /opt/migra-guardian/health_monitor.sh
#   3. Add to crontab: * * * * * /opt/migra-guardian/health_monitor.sh
#   4. Add 30s offset: * * * * * sleep 30 && /opt/migra-guardian/health_monitor.sh

set -euo pipefail

# ============================================
# CONFIGURATION
# ============================================
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
LOG_DIR="/var/log/migra-guardian"
LOG_FILE="$LOG_DIR/health-$(date +%Y%m%d).log"
STATE_FILE="/tmp/migra-guardian-state.json"
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"  # Set in environment or /etc/environment

# Services to monitor
SERVICES=(
    "migrapanel-panel-api:http://localhost:3020/api/health"
    "nginx:http://localhost/health"
    "postgresql:localhost:5432"
    "redis:localhost:6379"
)

# Hosts to ping
HOSTS=(
    "pve:100.73.199.109"
    "srv1-web:100.68.239.94"
    "migrapanel-core:100.119.105.93"
    "db-core:100.98.54.45"
)

# ============================================
# LOGGING FUNCTIONS
# ============================================
log() {
    local level=$1
    shift
    echo "[$TIMESTAMP] [$level] $*" | tee -a "$LOG_FILE"
}

send_slack_alert() {
    local service=$1
    local status=$2
    local message=$3
    
    if [[ -z "$SLACK_WEBHOOK" ]]; then
        log "WARN" "Slack webhook not configured, skipping alert"
        return 0
    fi
    
    local color="danger"
    [[ "$status" == "UP" ]] && color="good"
    [[ "$status" == "RECOVERING" ]] && color="warning"
    
    local payload=$(cat <<EOF
{
    "text": "🚨 MigraHosting Alert",
    "attachments": [{
        "color": "$color",
        "title": "$service - $status",
        "text": "$message",
        "footer": "MigraGuardian",
        "ts": $(date +%s)
    }]
}
EOF
)
    
    curl -X POST \
        -H 'Content-Type: application/json' \
        -d "$payload" \
        "$SLACK_WEBHOOK" \
        --silent \
        --max-time 5 || log "ERROR" "Failed to send Slack alert"
}

# ============================================
# HEALTH CHECK FUNCTIONS
# ============================================
check_http_endpoint() {
    local name=$1
    local url=$2
    local timeout=5
    
    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time $timeout "$url" 2>/dev/null || echo "000")
    
    if [[ "$response" -ge 200 ]] && [[ "$response" -lt 300 ]]; then
        log "INFO" "$name: UP (HTTP $response)"
        return 0
    else
        log "ERROR" "$name: DOWN (HTTP $response)"
        send_slack_alert "$name" "DOWN" "HTTP endpoint returned $response at $url"
        return 1
    fi
}

check_tcp_port() {
    local name=$1
    local host=$2
    local port=$3
    local timeout=5
    
    if timeout $timeout bash -c "cat < /dev/null > /dev/tcp/$host/$port" 2>/dev/null; then
        log "INFO" "$name: UP (TCP $host:$port)"
        return 0
    else
        log "ERROR" "$name: DOWN (TCP $host:$port unreachable)"
        send_slack_alert "$name" "DOWN" "TCP port $host:$port is unreachable"
        return 1
    fi
}

check_host_ping() {
    local name=$1
    local ip=$2
    
    if ping -c 1 -W 2 "$ip" &>/dev/null; then
        log "INFO" "$name: UP (ping $ip)"
        return 0
    else
        log "ERROR" "$name: DOWN (ping $ip failed)"
        send_slack_alert "$name" "DOWN" "Host $ip is not responding to ping"
        return 1
    fi
}

check_disk_usage() {
    local threshold=85
    local usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    
    if [[ $usage -lt $threshold ]]; then
        log "INFO" "Disk usage: ${usage}% (healthy)"
        return 0
    else
        log "WARN" "Disk usage: ${usage}% (threshold: ${threshold}%)"
        send_slack_alert "Disk Space" "WARNING" "Root disk usage at ${usage}% (threshold: ${threshold}%)"
        return 1
    fi
}

check_memory_usage() {
    local threshold=90
    local usage=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
    
    if [[ $usage -lt $threshold ]]; then
        log "INFO" "Memory usage: ${usage}% (healthy)"
        return 0
    else
        log "WARN" "Memory usage: ${usage}% (threshold: ${threshold}%)"
        send_slack_alert "Memory" "WARNING" "Memory usage at ${usage}% (threshold: ${threshold}%)"
        return 1
    fi
}

# ============================================
# MAIN EXECUTION
# ============================================
main() {
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "INFO" "========== Guardian Health Check Started =========="
    
    local failures=0
    
    # Check HTTP endpoints
    for service_def in "${SERVICES[@]}"; do
        IFS=':' read -r name url <<< "$service_def"
        
        if [[ "$url" =~ ^http ]]; then
            check_http_endpoint "$name" "$url" || ((failures++))
        else
            # TCP port check (format: localhost:5432)
            IFS=':' read -r host port <<< "$url"
            check_tcp_port "$name" "$host" "$port" || ((failures++))
        fi
    done
    
    # Check host connectivity
    for host_def in "${HOSTS[@]}"; do
        IFS=':' read -r name ip <<< "$host_def"
        check_host_ping "$name" "$ip" || ((failures++))
    done
    
    # Check system resources
    check_disk_usage || ((failures++))
    check_memory_usage || ((failures++))
    
    # Summary
    if [[ $failures -eq 0 ]]; then
        log "INFO" "========== All checks passed (0 failures) =========="
    else
        log "ERROR" "========== Health check completed with $failures failures =========="
        send_slack_alert "Guardian" "ALERT" "$failures health check(s) failed at $TIMESTAMP"
    fi
    
    # Save state for trend analysis
    echo "{\"timestamp\":\"$TIMESTAMP\",\"failures\":$failures}" > "$STATE_FILE"
    
    return $failures
}

# Run main function
main
exit $?
