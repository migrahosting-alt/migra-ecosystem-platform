#!/bin/bash
#
# monitor-mail-auth.sh
# Monitors mail server logs for PostgreSQL authentication failures
# Designed to run as a systemd service or cron job
#
# Usage: ./monitor-mail-auth.sh [--alert-webhook URL] [--alert-email EMAIL]
#

set -euo pipefail

# Configuration
LOG_FILE="/var/log/mail-auth-monitor.log"
STATE_FILE="/var/run/mail-auth-monitor.state"
CHECK_INTERVAL="5m"  # How far back to check logs

# Alert configuration
ALERT_WEBHOOK=""
ALERT_EMAIL=""
ALERT_THRESHOLD=3  # Number of failures before alerting

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --alert-webhook)
            ALERT_WEBHOOK="$2"
            shift 2
            ;;
        --alert-email)
            ALERT_EMAIL="$2"
            shift 2
            ;;
        *)
            echo "Usage: $0 [--alert-webhook URL] [--alert-email EMAIL]"
            exit 1
            ;;
    esac
done

# Logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check for auth failures in journalctl
check_auth_failures() {
    local failures=$(journalctl --since "$CHECK_INTERVAL" --no-pager 2>/dev/null | \
        grep "password authentication failed for user" | wc -l)
    echo "$failures"
}

# Send alert via webhook
send_webhook_alert() {
    local message="$1"
    local failure_count="$2"
    
    if [ -z "$ALERT_WEBHOOK" ]; then
        return 0
    fi
    
    local payload=$(cat <<EOF
{
  "text": "🚨 Mail Server Alert",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Mail Authentication Failures Detected"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Server:* vps-core (dns-mail-core.migrahosting.com)"
        },
        {
          "type": "mrkdwn",
          "text": "*Failures:* $failure_count in last $CHECK_INTERVAL"
        },
        {
          "type": "mrkdwn",
          "text": "*Timestamp:* $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        },
        {
          "type": "mrkdwn",
          "text": "*Action Required:* Run validation script: \`/opt/migra/scripts/validate-mail-configs.sh --fix\`"
        }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "$message"
      }
    }
  ]
}
EOF
)
    
    curl -X POST "$ALERT_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "$payload" &> /dev/null || log "Failed to send webhook alert"
}

# Send email alert
send_email_alert() {
    local message="$1"
    local failure_count="$2"
  local mail_node_label="${MAIL_NODE_LABEL:-dns-mail-core}"
  local mail_node_host="${MAIL_NODE_HOST:-root@dns-mail-core}"
    
    if [ -z "$ALERT_EMAIL" ]; then
        return 0
    fi
    
    local subject="[ALERT] Mail Auth Failures on ${mail_node_label}: $failure_count failures"
    local body=$(cat <<EOF
Mail Server Authentication Alert
=================================

Server: ${mail_node_label}
Hostname: ${mail_node_label}
Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')

ISSUE:
$failure_count PostgreSQL authentication failures detected in the last $CHECK_INTERVAL

DETAILS:
$message

ACTION REQUIRED:
1. SSH to mail node: ssh ${mail_node_host}
2. Run validation: /opt/migra/scripts/validate-mail-configs.sh --verbose
3. If mismatches found, fix: /opt/migra/scripts/validate-mail-configs.sh --fix
4. Reload services: systemctl reload postfix dovecot
5. Verify: journalctl -f | grep "password authentication"

ROOT CAUSE:
Mail server config passwords likely don't match panel-api DATABASE_URL.

PREVENTION:
Validation script should run automatically via cron. Check:
systemctl status mail-config-validator.timer
EOF
)
    
    echo "$body" | mail -s "$subject" "$ALERT_EMAIL" || log "Failed to send email alert"
}

# Main monitoring logic
main() {
    log "Starting mail authentication monitoring..."
    
    # Check for failures
    failure_count=$(check_auth_failures)
    
    if [ "$failure_count" -ge "$ALERT_THRESHOLD" ]; then
        log "ALERT: $failure_count authentication failures detected"
        
        # Get sample log entries
        sample_logs=$(journalctl --since "$CHECK_INTERVAL" --no-pager 2>/dev/null | \
            grep "password authentication failed" | tail -5)
        
        # Read last alert time
        last_alert=0
        if [ -f "$STATE_FILE" ]; then
            last_alert=$(cat "$STATE_FILE")
        fi
        
        current_time=$(date +%s)
        time_since_last=$((current_time - last_alert))
        
        # Only alert if it's been more than 30 minutes since last alert
        if [ $time_since_last -gt 1800 ]; then
            log "Sending alerts (last alert was ${time_since_last}s ago)"
            
            send_webhook_alert "$sample_logs" "$failure_count"
            send_email_alert "$sample_logs" "$failure_count"
            
            # Update state file
            echo "$current_time" > "$STATE_FILE"
        else
            log "Skipping alert (sent ${time_since_last}s ago, threshold 1800s)"
        fi
    else
        log "OK: $failure_count authentication failures (threshold: $ALERT_THRESHOLD)"
    fi
}

main
