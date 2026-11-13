#!/bin/bash
# ===========================================
# TMS Production Update Script
# Safe updates with rollback capability
# ===========================================

set -e

# Kleuren
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/tms}"
SERVICE_USER="${SERVICE_USER:-tms}"
BACKUP_DIR="/opt/tms-backups"
MAX_BACKUPS=5
LOG_FILE="/var/log/tms/update.log"

# Functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

print_step() {
    echo -e "\n${GREEN}▶ $1${NC}"
    log "STEP: $1"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
    log "WARNING: $1"
}

print_error() {
    echo -e "${RED}✖ $1${NC}"
    log "ERROR: $1"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

check_installation() {
    if [ ! -d "$INSTALL_DIR" ]; then
        print_error "TMS installation not found at $INSTALL_DIR"
        exit 1
    fi
    
    if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
        print_error "Environment file not found"
        exit 1
    fi
}

# Create backup before update
create_backup() {
    print_step "Creating backup..."
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"
    
    mkdir -p "$BACKUP_PATH"
    
    # Backup database
    log "Backing up database..."
    DB_NAME=$(grep DB_NAME "$INSTALL_DIR/backend/.env" | cut -d '=' -f2)
    DB_USER=$(grep DB_USER "$INSTALL_DIR/backend/.env" | cut -d '=' -f2)
    
    sudo -u postgres pg_dump "$DB_NAME" > "$BACKUP_PATH/database.sql"
    
    # Backup media files
    log "Backing up media files..."
    if [ -d "$INSTALL_DIR/backend/media" ]; then
        cp -r "$INSTALL_DIR/backend/media" "$BACKUP_PATH/"
    fi
    
    # Backup env file
    cp "$INSTALL_DIR/backend/.env" "$BACKUP_PATH/"
    
    # Store current git commit
    cd "$INSTALL_DIR"
    git rev-parse HEAD > "$BACKUP_PATH/git_commit.txt"
    
    # Compress backup
    log "Compressing backup..."
    tar -czf "$BACKUP_DIR/$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
    rm -rf "$BACKUP_PATH"
    
    # Clean old backups
    cd "$BACKUP_DIR"
    ls -t *.tar.gz | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
    
    log "Backup created: $BACKUP_DIR/$TIMESTAMP.tar.gz"
    echo "$BACKUP_DIR/$TIMESTAMP.tar.gz"
}

# Rollback to previous version
rollback() {
    print_step "Rolling back to previous version..."
    
    BACKUP_FILE=$1
    
    if [ ! -f "$BACKUP_FILE" ]; then
        print_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
    
    TEMP_DIR=$(mktemp -d)
    tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
    BACKUP_NAME=$(ls "$TEMP_DIR")
    BACKUP_PATH="$TEMP_DIR/$BACKUP_NAME"
    
    # Stop services
    supervisorctl stop tms
    
    # Restore database
    log "Restoring database..."
    DB_NAME=$(grep DB_NAME "$INSTALL_DIR/backend/.env" | cut -d '=' -f2)
    sudo -u postgres psql "$DB_NAME" < "$BACKUP_PATH/database.sql"
    
    # Restore media
    log "Restoring media files..."
    if [ -d "$BACKUP_PATH/media" ]; then
        rm -rf "$INSTALL_DIR/backend/media"
        cp -r "$BACKUP_PATH/media" "$INSTALL_DIR/backend/"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/backend/media"
    fi
    
    # Rollback git
    if [ -f "$BACKUP_PATH/git_commit.txt" ]; then
        COMMIT=$(cat "$BACKUP_PATH/git_commit.txt")
        cd "$INSTALL_DIR"
        sudo -u "$SERVICE_USER" git checkout "$COMMIT"
    fi
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    
    # Restart services
    supervisorctl start tms
    
    log "Rollback completed"
    echo -e "${GREEN}Rollback completed successfully${NC}"
}

# Main update process
update() {
    print_step "Starting TMS update..."
    
    # Create backup first
    BACKUP_FILE=$(create_backup)
    
    cd "$INSTALL_DIR"
    
    # Check for updates
    print_step "Checking for updates..."
    sudo -u "$SERVICE_USER" git fetch origin
    
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        print_warning "Already up to date"
        exit 0
    fi
    
    # Show changes
    print_step "Changes to be applied:"
    git log --oneline "$LOCAL..$REMOTE"
    
    # Ask for confirmation
    echo ""
    read -p "Continue with update? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Update cancelled"
        exit 0
    fi
    
    # Banner + pushmelding; UPDATE_WACHT=0 slaat het wachten over.
    local wacht="${UPDATE_WACHT:-60}"
    print_step "Announcing update to users (banner + push notification)..."
    if (cd "$INSTALL_DIR/backend" && sudo -u "$SERVICE_USER" ./venv/bin/python manage.py kondig_update_aan --seconden "$wacht"); then
        [ "$wacht" -gt 0 ] && sleep "$wacht"
    else
        print_warning "Could not announce update - continuing"
    fi

    # Stop application for update
    print_step "Stopping application..."
    supervisorctl stop tms
    
    # Pull changes
    print_step "Pulling latest changes..."
    sudo -u "$SERVICE_USER" git pull origin main
    
    # Update backend
    print_step "Updating backend dependencies..."
    cd "$INSTALL_DIR/backend"
    sudo -u "$SERVICE_USER" ./venv/bin/pip install -r requirements/production.txt --quiet
    
    # Run migrations
    print_step "Running database migrations..."
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py migrate --noinput
    
    # Collect static files
    print_step "Collecting static files..."
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py collectstatic --noinput --clear
    
    # Update frontend
    print_step "Building frontend..."
    cd "$INSTALL_DIR/frontend"
    sudo -u "$SERVICE_USER" npm ci --silent
    sudo -u "$SERVICE_USER" npm run build
    
    # Clear cache
    print_step "Clearing cache..."
    redis-cli FLUSHDB > /dev/null 2>&1 || true
    
    # Restart application
    print_step "Starting application..."
    supervisorctl start tms
    
    # Wait and check health
    sleep 5
    
    # Health check
    print_step "Performing health check..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health/ || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Health check passed${NC}"
        (cd "$INSTALL_DIR/backend" && sudo -u "$SERVICE_USER" ./venv/bin/python manage.py kondig_update_aan --klaar) \
            || print_warning "Could not clear update banner - it disappears after 30 minutes"
    else
        print_warning "Health check returned: $HTTP_CODE"
        
        read -p "Application may not be healthy. Rollback? (y/n): " rollback_confirm
        if [ "$rollback_confirm" = "y" ]; then
            rollback "$BACKUP_FILE"
            exit 1
        fi
    fi
    
    # Reload nginx
    print_step "Reloading nginx..."
    nginx -t && systemctl reload nginx
    
    log "Update completed successfully"
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Update Complete!                                 ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Backup stored at: $BACKUP_FILE"
    echo ""
    echo "To rollback if needed:"
    echo "  $0 rollback $BACKUP_FILE"
    echo ""
}

# Show status
status() {
    print_step "TMS Status"
    
    echo ""
    echo "Services:"
    supervisorctl status tms
    echo ""
    
    echo "Nginx:"
    systemctl status nginx --no-pager -l | head -5
    echo ""
    
    echo "Current version:"
    cd "$INSTALL_DIR"
    git log -1 --oneline
    echo ""
    
    echo "Recent backups:"
    ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -5 || echo "No backups found"
    echo ""
    
    echo "Disk usage:"
    df -h "$INSTALL_DIR" | tail -1
    echo ""
    
    echo "Health check:"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health/ || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "  ${GREEN}✓ API healthy (HTTP $HTTP_CODE)${NC}"
    else
        echo -e "  ${RED}✖ API unhealthy (HTTP $HTTP_CODE)${NC}"
    fi
    
    echo ""
    echo "Security status:"
    echo -n "  Firewall: "
    ufw status | head -1
    echo -n "  Fail2ban: "
    systemctl is-active fail2ban
    echo -n "  SSL certificate expires: "
    certbot certificates 2>/dev/null | grep "Expiry Date" | head -1 | awk '{print $3, $4, $5}' || echo "Unable to check"
}

# List available backups
list_backups() {
    print_step "Available Backups"
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo "No backup directory found"
        exit 0
    fi
    
    ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null || echo "No backups found"
}

# Security audit
security_audit() {
    print_step "Security Audit"
    
    echo ""
    echo "1. Firewall Status:"
    ufw status verbose
    echo ""
    
    echo "2. Fail2ban Status:"
    fail2ban-client status
    echo ""
    
    echo "3. Open Ports:"
    ss -tuln | grep LISTEN
    echo ""
    
    echo "4. SSL Certificate:"
    certbot certificates 2>/dev/null || echo "Certbot not configured"
    echo ""
    
    echo "5. File Permissions:"
    echo "   .env file:"
    ls -la "$INSTALL_DIR/backend/.env" 2>/dev/null
    echo "   Media folder:"
    ls -ld "$INSTALL_DIR/backend/media" 2>/dev/null
    echo ""
    
    echo "6. Recent Security Logs (last 10 lines):"
    tail -10 "$INSTALL_DIR/backend/logs/security.log" 2>/dev/null || echo "No security log found"
    echo ""
    
    echo "7. Failed SSH Attempts (last 24h):"
    grep "Failed password" /var/log/auth.log 2>/dev/null | tail -5 || echo "No failed SSH attempts"
    echo ""
    
    echo "8. Banned IPs (fail2ban):"
    fail2ban-client status sshd 2>/dev/null | grep "Banned IP" || echo "No banned IPs"
    echo ""
    
    echo "9. Django Security Check:"
    cd "$INSTALL_DIR/backend"
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py check --deploy 2>&1 | head -20
}

# Usage
usage() {
    echo "TMS Update Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  update          Update to latest version (default)"
    echo "  rollback FILE   Rollback to backup file"
    echo "  status          Show current status"
    echo "  backups         List available backups"
    echo "  security        Run security audit"
    echo "  help            Show this help"
    echo ""
}

# Main
main() {
    check_root
    check_installation
    
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$(dirname $LOG_FILE)"
    
    case "${1:-update}" in
        update)
            update
            ;;
        rollback)
            if [ -z "$2" ]; then
                print_error "Backup file required for rollback"
                usage
                exit 1
            fi
            rollback "$2"
            ;;
        status)
            status
            ;;
        backups)
            list_backups
            ;;
        security)
            security_audit
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            print_error "Unknown command: $1"
            usage
            exit 1
            ;;
    esac
}

main "$@"
