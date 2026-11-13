#!/bin/bash
# ===========================================
# TMS Update Script - Productie
# ===========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/tms}"

echo -e "${YELLOW}TMS Update Script${NC}"
echo "================================"

cd "$INSTALL_DIR"

# Banner + pushmelding; daarna wachten tot het aangekondigde moment.
# UPDATE_WACHT=0 slaat het wachten over.
UPDATE_WACHT="${UPDATE_WACHT:-60}"
kondig_aan() {
    echo "Update aankondigen (banner + pushmelding)..."
    if "$@" manage.py kondig_update_aan --seconden "$UPDATE_WACHT"; then
        [ "$UPDATE_WACHT" -gt 0 ] && sleep "$UPDATE_WACHT"
    else
        echo -e "${YELLOW}Aankondigen niet gelukt - update gaat door${NC}"
    fi
    return 0
}

# Check which mode we're running
if [ -f "docker-compose.yml" ] && docker compose ps &>/dev/null; then
    echo -e "${YELLOW}Detected: Docker mode${NC}"
    
    # Pull latest code
    echo "Pulling latest code..."
    git pull origin main
    
    # Rebuild and restart
    echo "Rebuilding containers..."
    docker compose build --no-cache
    kondig_aan docker compose exec -T backend python
    docker compose up -d
    
    # Run migrations
    echo "Running migrations..."
    docker compose exec -T backend python manage.py migrate --noinput
    docker compose exec -T backend python manage.py collectstatic --noinput
    docker compose exec -T backend python manage.py kondig_update_aan --klaar || true
    
else
    echo -e "${YELLOW}Detected: Native mode${NC}"
    
    (cd "$INSTALL_DIR/backend" && kondig_aan ./venv/bin/python)

    # Pull latest code
    echo "Pulling latest code..."
    git pull origin main
    
    # Update backend
    echo "Updating backend..."
    cd "$INSTALL_DIR/backend"
    ./venv/bin/pip install -r requirements/production.txt
    ./venv/bin/python manage.py migrate --noinput
    ./venv/bin/python manage.py collectstatic --noinput
    
    # Update frontend
    echo "Building frontend..."
    cd "$INSTALL_DIR/frontend"
    npm ci
    npm run build
    
    # Restart services
    echo "Restarting services..."
    supervisorctl restart tms
    systemctl reload nginx
    (cd "$INSTALL_DIR/backend" && ./venv/bin/python manage.py kondig_update_aan --klaar) || true
fi

echo ""
echo -e "${GREEN}Update completed successfully!${NC}"
