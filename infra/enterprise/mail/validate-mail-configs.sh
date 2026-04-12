#!/bin/bash
#
# validate-mail-configs.sh
# Validates that mail server configs match the canonical database credentials
# from panel-api .env file
#
# Usage: ./validate-mail-configs.sh [--fix] [--verbose]
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Flags
FIX_MODE=false
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fix)
            FIX_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Usage: $0 [--fix] [--verbose]"
            exit 1
            ;;
    esac
done

# Configuration
PANEL_API_HOST="${PANEL_API_HOST:-root@migrapanel-core}"
PANEL_API_ENV="${PANEL_API_ENV:-/opt/MigraPanel/apps/panel-api/.env}"
POSTFIX_CONFIG_DIR="/etc/postfix/sql"
DOVECOT_CONFIG="/etc/dovecot/dovecot-sql.conf.ext"

# Logging function
log() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO]${NC} $1"
    fi
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Extract database credentials from panel-api .env
extract_db_credentials() {
    log "Extracting database credentials from $PANEL_API_HOST:$PANEL_API_ENV"
    
    # Fetch .env from remote panel-api server
    local db_url=$(ssh "$PANEL_API_HOST" "grep '^DATABASE_URL=' '$PANEL_API_ENV' 2>/dev/null || echo ''" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    if [ -z "$db_url" ]; then
        error "DATABASE_URL not found in $PANEL_API_HOST:$PANEL_API_ENV"
        exit 1
    fi
    
    # Parse URL components
    DB_USER=$(echo "$db_url" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DB_PASS=$(echo "$db_url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    DB_HOST=$(echo "$db_url" | sed -n 's|.*@\([^:]*\):.*|\1|p')
    DB_PORT=$(echo "$db_url" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
    DB_NAME=$(echo "$db_url" | sed -n 's|.*/\([^?]*\).*|\1|p')
    
    log "Database: $DB_NAME at $DB_HOST:$DB_PORT (user: $DB_USER)"
}

# Check Postfix config files
check_postfix_configs() {
    local all_valid=0
    
    for config_file in "$POSTFIX_CONFIG_DIR"/*.cf; do
        if [ ! -f "$config_file" ]; then
            continue
        fi
        
        log "Checking $(basename "$config_file")..."
        
        # Extract password from config
        local config_pass=$(grep "^password =" "$config_file" | sed 's/^password = //' | tr -d ' ')
        
        if [ -z "$config_pass" ]; then
            warn "No password found in $config_file"
            all_valid=1
            continue
        fi
        
        # Compare with canonical password
        if [ "$config_pass" != "$DB_PASS" ]; then
            error "Password mismatch in $config_file"
            error "  Expected: $DB_PASS"
            error "  Found: $config_pass"
            all_valid=1
            
            if [ "$FIX_MODE" = true ]; then
                log "Fixing password in $config_file"
                sed -i "s|^password = .*|password = $DB_PASS|" "$config_file"
                success "Fixed $config_file"
            fi
        else
            success "$(basename "$config_file") password is correct"
        fi
        
        # Verify other critical fields
        local config_user=$(grep "^user =" "$config_file" | sed 's/^user = //' | tr -d ' ')
        local config_host=$(grep "^hosts =" "$config_file" | sed 's/^hosts = //' | tr -d ' ')
        local config_dbname=$(grep "^dbname =" "$config_file" | sed 's/^dbname = //' | tr -d ' ')
        
        if [ "$config_user" != "$DB_USER" ]; then
            error "User mismatch in $config_file: expected $DB_USER, found $config_user"
            all_valid=1
        fi
        
        if [ "$config_host" != "$DB_HOST" ]; then
            error "Host mismatch in $config_file: expected $DB_HOST, found $config_host"
            all_valid=1
        fi
        
        if [ "$config_dbname" != "$DB_NAME" ]; then
            error "Database name mismatch in $config_file: expected $DB_NAME, found $config_dbname"
            all_valid=1
        fi
    done
    
    return $all_valid
}

# Check Dovecot config
check_dovecot_config() {
    log "Checking Dovecot configuration..."
    
    if [ ! -f "$DOVECOT_CONFIG" ]; then
        error "Dovecot config not found at $DOVECOT_CONFIG"
        return 1
    fi
    
    # Extract connect string
    local connect_line=$(grep "^connect =" "$DOVECOT_CONFIG" | sed 's/^connect = //')
    
    # Parse connect string (format: host=X dbname=Y user=Z password='W')
    local dov_pass=$(echo "$connect_line" | sed -n "s/.*password='\([^']*\)'.*/\1/p")
    
    if [ -z "$dov_pass" ]; then
        error "Could not extract password from Dovecot config"
        return 1
    fi
    
    if [ "$dov_pass" != "$DB_PASS" ]; then
        error "Password mismatch in Dovecot config"
        error "  Expected: $DB_PASS"
        error "  Found: $dov_pass"
        
        if [ "$FIX_MODE" = true ]; then
            log "Fixing password in Dovecot config"
            sed -i "s|password='[^']*'|password='$DB_PASS'|" "$DOVECOT_CONFIG"
            success "Fixed Dovecot config"
        fi
        return 1
    else
        success "Dovecot password is correct"
        return 0
    fi
}

# Test database connectivity
test_db_connectivity() {
    log "Testing database connectivity..."
    
    if ! command -v psql &> /dev/null; then
        warn "psql not available, skipping connectivity test"
        return 0
    fi
    
    if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &> /dev/null; then
        success "Database connectivity verified"
        return 0
    else
        error "Failed to connect to database with extracted credentials"
        return 1
    fi
}

# Main execution
main() {
    echo "==================================="
    echo "Mail Config Validation"
    echo "==================================="
    echo ""
    
    # Extract credentials
    extract_db_credentials
    
    # Check configs (run in current shell, don't capture output)
    check_postfix_configs
    local postfix_valid=$?
    
    check_dovecot_config
    local dovecot_valid=$?
    
    echo ""
    
    # Test connectivity
    test_db_connectivity
    
    echo ""
    echo "==================================="
    
    # Summary
    if [ $postfix_valid -eq 0 ] && [ $dovecot_valid -eq 0 ]; then
        success "All mail configs are valid and match panel-api credentials"
        
        if [ "$FIX_MODE" = true ]; then
            warn "Configs were updated. Reload services:"
            echo "  systemctl reload postfix"
            echo "  systemctl reload dovecot"
        fi
        
        exit 0
    else
        error "Mail config validation failed"
        
        if [ "$FIX_MODE" = false ]; then
            echo ""
            echo "Run with --fix to automatically correct mismatches"
        fi
        
        exit 1
    fi
}

main
