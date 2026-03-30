#!/bin/bash
# ===========================================
# TMS Docker Production Update Script
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
DOCKER_DIR="${DOCKER_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-$DOCKER_DIR/backups}"
MAX_BACKUPS=5
LOG_FILE="/var/log/tms/update.log"

# Functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     TMS Docker - Production Update Script                  ║"
    echo "║     Safe updates with rollback capability                  ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
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
    # Check if TMS source exists
    if [ ! -d "$INSTALL_DIR" ]; then
        print_error "TMS source not found at $INSTALL_DIR"
        exit 1
    fi
    
    # Check if Docker compose file exists
    if [ ! -f "$DOCKER_DIR/tms/docker-compose.yml" ]; then
        print_error "Docker compose file not found at $DOCKER_DIR/tms/docker-compose.yml"
        exit 1
    fi
    
    # Check Docker is running
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running"
        exit 1
    fi
}

# Get database credentials from docker-compose or environment
get_db_credentials() {
    # Try to extract from docker-compose.yml
    if [ -f "$DOCKER_DIR/tms/docker-compose.yml" ]; then
        DB_NAME=$(grep -A5 "POSTGRES_DB:" "$DOCKER_DIR/tms/docker-compose.yml" | head -1 | awk -F: '{print $2}' | tr -d ' ' 2>/dev/null || echo "tms_db")
        DB_USER=$(grep -A5 "POSTGRES_USER:" "$DOCKER_DIR/tms/docker-compose.yml" | head -1 | awk -F: '{print $2}' | tr -d ' ' 2>/dev/null || echo "tms_user")
    fi
    
    # Fallback defaults
    DB_NAME=${DB_NAME:-tms_db}
    DB_USER=${DB_USER:-tms_user}
}

# Create backup before update
create_backup() {
    print_step "Creating backup..."
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"
    
    mkdir -p "$BACKUP_PATH"
    
    get_db_credentials
    
    # Backup database
    log "Backing up database..."
    docker exec tms-postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_PATH/database.sql" 2>/dev/null || {
        print_warning "Could not backup database - container may not be running"
    }
    
    # Backup media files
    log "Backing up media files..."
    if [ -d "$DOCKER_DIR/tms/media" ]; then
        cp -r "$DOCKER_DIR/tms/media" "$BACKUP_PATH/"
    fi
    
    # Backup staticfiles
    if [ -d "$DOCKER_DIR/tms/staticfiles" ]; then
        cp -r "$DOCKER_DIR/tms/staticfiles" "$BACKUP_PATH/"
    fi
    
    # Store current git commit
    cd "$INSTALL_DIR"
    git rev-parse HEAD > "$BACKUP_PATH/git_commit.txt"
    
    # Store current docker image IDs
    docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep -E "tms-" > "$BACKUP_PATH/docker_images.txt" 2>/dev/null || true
    
    # Backup docker-compose files
    cp "$DOCKER_DIR/tms/docker-compose.yml" "$BACKUP_PATH/"
    
    # Compress backup
    log "Compressing backup..."
    tar -czf "$BACKUP_DIR/$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
    rm -rf "$BACKUP_PATH"
    
    # Clean old backups
    cd "$BACKUP_DIR"
    ls -t *.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
    
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
    
    # Stop TMS containers (keep postgres and redis running for restore)
    print_step "Stopping application containers..."
    cd "$DOCKER_DIR/tms"
    docker compose stop backend frontend celery-worker celery-beat || true
    
    # Restore database
    if [ -f "$BACKUP_PATH/database.sql" ]; then
        log "Restoring database..."
        get_db_credentials
        docker exec -i tms-postgres psql -U "$DB_USER" "$DB_NAME" < "$BACKUP_PATH/database.sql"
    fi
    
    # Restore media
    if [ -d "$BACKUP_PATH/media" ]; then
        log "Restoring media files..."
        rm -rf "$DOCKER_DIR/tms/media"
        cp -r "$BACKUP_PATH/media" "$DOCKER_DIR/tms/"
    fi
    
    # Restore staticfiles
    if [ -d "$BACKUP_PATH/staticfiles" ]; then
        log "Restoring static files..."
        rm -rf "$DOCKER_DIR/tms/staticfiles"
        cp -r "$BACKUP_PATH/staticfiles" "$DOCKER_DIR/tms/"
    fi
    
    # Rollback git and rebuild
    if [ -f "$BACKUP_PATH/git_commit.txt" ]; then
        COMMIT=$(cat "$BACKUP_PATH/git_commit.txt")
        cd "$INSTALL_DIR"
        log "Rolling back source to commit: $COMMIT"
        git checkout "$COMMIT"
        
        # Recopy source
        cp -r backend/* "$DOCKER_DIR/tms/backend/"
        cp -r frontend/* "$DOCKER_DIR/tms/frontend/"
    fi
    
    # Rebuild and restart containers
    print_step "Rebuilding containers..."
    cd "$DOCKER_DIR/tms"
    docker compose build --no-cache backend frontend celery-worker celery-beat
    docker compose up -d
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    
    # Wait for containers
    sleep 10
    
    # Health check
    perform_health_check
    
    log "Rollback completed"
    echo -e "${GREEN}Rollback completed successfully${NC}"
}

# Health check
perform_health_check() {
    print_step "Performing health check..."
    
    # Wait for backend to be ready
    for i in {1..30}; do
        if docker exec tms-backend curl -s http://localhost:8000/api/health/ > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓ Backend healthy${NC}"
            return 0
        fi
        sleep 2
    done
    
    # Check via direct API call
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health/ 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "  ${GREEN}✓ API healthy (HTTP $HTTP_CODE)${NC}"
        return 0
    else
        print_warning "Health check returned: $HTTP_CODE"
        return 1
    fi
}

# Main update process
update() {
    print_header
    print_step "Starting TMS Docker update..."
    
    # Create backup first
    BACKUP_FILE=$(create_backup)
    
    cd "$INSTALL_DIR"
    
    # Check for updates
    print_step "Checking for updates..."
    git fetch origin
    
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        print_warning "Already up to date"
        echo ""
        echo "Current version:"
        git log -1 --oneline
        exit 0
    fi
    
    # Show changes
    print_step "Changes to be applied:"
    echo ""
    git log --oneline "$LOCAL..$REMOTE"
    echo ""
    
    # Show file changes summary
    echo "Files changed:"
    git diff --stat "$LOCAL..$REMOTE" | tail -5
    echo ""
    
    # Ask for confirmation
    read -p "Continue with update? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Update cancelled"
        exit 0
    fi
    
    # Pull changes
    print_step "Pulling latest changes..."
    git pull origin main
    
    # Copy source to Docker directory
    print_step "Copying source to Docker directory..."
    cp -r backend/* "$DOCKER_DIR/tms/backend/"
    cp -r frontend/* "$DOCKER_DIR/tms/frontend/"
    
    # Check for requirements changes
    if git diff "$LOCAL" "$REMOTE" --name-only | grep -q "requirements"; then
        print_step "Requirements changed - full rebuild needed..."
        cd "$DOCKER_DIR/tms"
        docker compose build --no-cache backend celery-worker celery-beat
    else
        print_step "Rebuilding containers..."
        cd "$DOCKER_DIR/tms"
        docker compose build backend frontend celery-worker celery-beat
    fi
    
    # Restart containers
    print_step "Restarting containers..."
    docker compose up -d
    
    # Wait for containers to start
    sleep 10
    
    # Run migrations
    print_step "Running database migrations..."
    docker exec tms-backend python manage.py migrate --noinput
    
    # Collect static files
    print_step "Collecting static files..."
    docker exec tms-backend python manage.py collectstatic --noinput --clear
    
    # Clear Redis cache
    print_step "Clearing cache..."
    docker exec tms-redis redis-cli FLUSHDB > /dev/null 2>&1 || true
    
    # Health check
    if ! perform_health_check; then
        print_warning "Application may not be healthy"
        
        read -p "Rollback to previous version? (y/n): " rollback_confirm
        if [ "$rollback_confirm" = "y" ]; then
            rollback "$BACKUP_FILE"
            exit 1
        fi
    fi
    
    # Reload nginx proxy manager (if using internal nginx)
    docker exec nginx-proxy-manager nginx -s reload 2>/dev/null || true
    
    log "Update completed successfully"
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Update Complete!                                 ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "New version:"
    git log -1 --oneline
    echo ""
    echo "Backup stored at: $BACKUP_FILE"
    echo ""
    echo "To rollback if needed:"
    echo "  $0 rollback $BACKUP_FILE"
    echo ""
}

# Quick update without prompts (for automation)
update_quick() {
    print_header
    print_step "Quick update (non-interactive)..."
    
    # Create backup
    BACKUP_FILE=$(create_backup)
    
    cd "$INSTALL_DIR"
    
    # Pull changes
    git pull origin main
    
    # Copy source
    cp -r backend/* "$DOCKER_DIR/tms/backend/"
    cp -r frontend/* "$DOCKER_DIR/tms/frontend/"
    
    # Rebuild and restart
    cd "$DOCKER_DIR/tms"
    docker compose build
    docker compose up -d
    
    # Migrations
    sleep 10
    docker exec tms-backend python manage.py migrate --noinput
    docker exec tms-backend python manage.py collectstatic --noinput --clear
    
    # Health check
    if ! perform_health_check; then
        print_error "Health check failed - rolling back"
        rollback "$BACKUP_FILE"
        exit 1
    fi
    
    log "Quick update completed"
    echo -e "${GREEN}Update completed successfully${NC}"
}

# Show status
status() {
    print_header
    print_step "TMS Docker Status"
    
    echo ""
    echo "Docker Containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "^NAMES|tms-|portainer|nginx-proxy"
    echo ""
    
    echo "Docker Images:"
    docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -E "^REPOSITORY|tms-"
    echo ""
    
    echo "Current version:"
    cd "$INSTALL_DIR"
    git log -1 --oneline
    echo ""
    
    echo "Remote version:"
    git fetch origin > /dev/null 2>&1
    git log origin/main -1 --oneline
    
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo -e "  ${GREEN}✓ Up to date${NC}"
    else
        echo -e "  ${YELLOW}⚠ Updates available${NC}"
        echo "    Run: $0 update"
    fi
    echo ""
    
    echo "Recent backups:"
    ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -5 || echo "  No backups found"
    echo ""
    
    echo "Disk usage:"
    echo "  Docker images: $(docker system df --format '{{.Size}}' | head -1)"
    echo "  Docker volumes: $(docker system df --format '{{.Size}}' | tail -1)"
    df -h "$DOCKER_DIR" 2>/dev/null | tail -1 | awk '{print "  Data directory: " $3 " used of " $2}'
    echo ""
    
    echo "Health check:"
    if perform_health_check > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Application healthy${NC}"
    else
        echo -e "  ${RED}✖ Application unhealthy${NC}"
    fi
    echo ""
    
    echo "Container logs (last errors):"
    docker logs tms-backend --tail 5 2>&1 | grep -i "error\|exception\|failed" | tail -3 || echo "  No recent errors"
}

# List backups
list_backups() {
    print_step "Available Backups"
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo "No backup directory found"
        exit 0
    fi
    
    echo ""
    ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null || echo "No backups found"
    echo ""
    echo "To restore a backup:"
    echo "  $0 rollback <backup_file>"
}

# Clean up old Docker resources
cleanup() {
    print_step "Cleaning up Docker resources..."
    
    echo "This will remove:"
    echo "  - Unused Docker images"
    echo "  - Unused Docker networks"
    echo "  - Build cache"
    echo ""
    
    read -p "Continue? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Cleanup cancelled"
        exit 0
    fi
    
    echo ""
    docker image prune -f
    docker network prune -f
    docker builder prune -f
    
    echo ""
    echo "Space recovered:"
    docker system df
}

# View container logs
logs() {
    CONTAINER=${1:-backend}
    LINES=${2:-100}
    
    case "$CONTAINER" in
        backend|tms-backend)
            docker logs tms-backend --tail "$LINES" -f
            ;;
        frontend|tms-frontend)
            docker logs tms-frontend --tail "$LINES" -f
            ;;
        postgres|db|database)
            docker logs tms-postgres --tail "$LINES" -f
            ;;
        redis)
            docker logs tms-redis --tail "$LINES" -f
            ;;
        celery-worker|worker|celery)
            docker logs tms-celery-worker --tail "$LINES" -f
            ;;
        celery-beat|beat)
            docker logs tms-celery-beat --tail "$LINES" -f
            ;;
        npm|proxy|nginx)
            docker logs nginx-proxy-manager --tail "$LINES" -f
            ;;
        portainer)
            docker logs portainer --tail "$LINES" -f
            ;;
        *)
            echo "Unknown container: $CONTAINER"
            echo "Available: backend, frontend, postgres, redis, celery-worker, celery-beat, npm, portainer"
            exit 1
            ;;
    esac
}

# Usage
usage() {
    echo "TMS Docker Update Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  update          Update to latest version (default)"
    echo "  quick           Quick update without prompts"
    echo "  rollback FILE   Rollback to backup file"
    echo "  status          Show current status"
    echo "  backups         List available backups"
    echo "  cleanup         Clean unused Docker resources"
    echo "  logs [service]  View container logs"
    echo "  help            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 update                    # Interactive update"
    echo "  $0 quick                     # Non-interactive update"
    echo "  $0 rollback /data/backups/20260128_120000.tar.gz"
    echo "  $0 logs backend              # View backend logs"
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
        quick|fast|auto)
            update_quick
            ;;
        rollback)
            if [ -z "$2" ]; then
                print_error "Backup file required for rollback"
                echo ""
                list_backups
                exit 1
            fi
            rollback "$2"
            ;;
        status)
            status
            ;;
        backups|backup-list)
            list_backups
            ;;
        cleanup|clean)
            cleanup
            ;;
        logs)
            logs "$2" "${3:-100}"
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
