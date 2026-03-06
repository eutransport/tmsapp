#!/bin/bash
# ===========================================
# TMS Docker Update Script
# ===========================================
# Volledige update: backup → code pull → rebuild →
# migraties → health check → opruiming.
# Secrets blijven automatisch behouden.
# ===========================================

set -e

# Configuratie
TMS_DIR="/var/www/tmsapp"
SECRETS_DIR="/opt/tms/secrets"
ENV_FILE="$SECRETS_DIR/.env"
BACKUP_DIR="/opt/tms/backups"
KEEP_BACKUPS=10  # Bewaar laatste N backups

# Kleuren
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check root
if [ "$EUID" -ne 0 ]; then
    log_error "Dit script moet als root worden uitgevoerd (gebruik sudo)"
    exit 1
fi

# Check of secrets bestaan
if [ ! -f "$ENV_FILE" ]; then
    log_error "Geen secrets gevonden in $ENV_FILE"
    log_error "Voer eerst ./docker-install.sh uit voor een nieuwe installatie"
    exit 1
fi

# Laad environment variabelen (nodig voor DB_USER, DB_NAME, etc.)
set -a
source "$ENV_FILE"
set +a

# =========================================
# Controleer vereiste variabelen — voeg toe als ze ontbreken
# =========================================
UPDATED_ENV=false

if [ -z "$REDIS_PASSWORD" ]; then
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
    echo "" >> "$ENV_FILE"
    echo "# Redis wachtwoord (automatisch gegenereerd door update script)" >> "$ENV_FILE"
    echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> "$ENV_FILE"
    export REDIS_PASSWORD
    UPDATED_ENV=true
    log_success "REDIS_PASSWORD gegenereerd en toegevoegd aan secrets"
fi

if [ "$UPDATED_ENV" = true ]; then
    # Herlaad environment met nieuwe variabelen
    set -a
    source "$ENV_FILE"
    set +a
fi

# Check of docker draait
if ! docker info &>/dev/null; then
    log_error "Docker is niet actief. Start Docker eerst: systemctl start docker"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  TMS Update                                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

cd "$TMS_DIR"

# =========================================
# 0. Environment symlink herstellen (nodig voor docker compose)
# =========================================
if [ ! -L "$TMS_DIR/.env" ] || [ ! -e "$TMS_DIR/.env" ]; then
    ln -sf "$ENV_FILE" "$TMS_DIR/.env"
    log_success "Environment symlink hersteld"
fi

# =========================================
# 1. Database backup
# =========================================
BACKUP_FILE="$BACKUP_DIR/db-pre-update-$(date +%Y%m%d%H%M%S).sql"
log_info "Database backup maken..."
mkdir -p "$BACKUP_DIR"

# Tijdelijk set -e uitschakelen — backup mag nooit de update afbreken
set +e

# Controleer of de db container draait (gebruik docker ps i.p.v. docker compose om .env problemen te vermijden)
DB_RUNNING=$(docker ps --filter "name=tms_db" --filter "status=running" -q 2>/dev/null)
if [ -z "$DB_RUNNING" ]; then
    log_warning "Database container (tms_db) draait niet — backup overgeslagen"
elif docker exec tms_db pg_dump -U "${DB_USER:-tms_user}" "${DB_NAME:-tms_db}" > "$BACKUP_FILE" 2>/tmp/tms_backup_err.log; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_success "Backup aangemaakt: $BACKUP_FILE ($BACKUP_SIZE)"
else
    BACKUP_ERR=$(cat /tmp/tms_backup_err.log 2>/dev/null | tail -3)
    log_warning "Database backup mislukt — overgeslagen"
    [ -n "$BACKUP_ERR" ] && log_warning "Reden: $BACKUP_ERR"
    rm -f "$BACKUP_FILE"
fi

# Weer strict mode inschakelen
set -e

# =========================================
# 2. Latest code ophalen
# =========================================
log_info "Laatste code ophalen van Git..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log_info "Code is al up-to-date ($LOCAL)"
    echo ""
    read -p "Toch herbouwen? (j/n) [n]: " FORCE_BUILD
    if [[ ! "$FORCE_BUILD" =~ ^[jJyY]$ ]]; then
        log_info "Update afgebroken — geen wijzigingen."
        exit 0
    fi
fi

git reset --hard origin/main
log_success "Code bijgewerkt naar $(git rev-parse --short HEAD)"

# =========================================
# 3. Environment symlink opnieuw controleren (git reset kan hem verwijderen)
# =========================================
if [ ! -L "$TMS_DIR/.env" ] || [ ! -e "$TMS_DIR/.env" ]; then
    ln -sf "$ENV_FILE" "$TMS_DIR/.env"
    log_success "Environment symlink hersteld"
fi

# =========================================
# 4. Docker images herbouwen en herstarten
# =========================================
log_info "Containers stoppen..."
docker compose down --remove-orphans

log_info "Images herbouwen..."
docker compose build --no-cache

log_info "Containers starten..."
docker compose up -d

# =========================================
# 5. Wachten tot services healthy zijn
# =========================================
log_info "Wachten tot services gezond zijn..."
MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    DB_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' tms_db 2>/dev/null || echo "starting")
    REDIS_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' tms_redis 2>/dev/null || echo "starting")
    
    if [ "$DB_HEALTH" = "healthy" ] && [ "$REDIS_HEALTH" = "healthy" ]; then
        log_success "Database en Redis zijn gezond"
        break
    fi
    
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    log_error "Services zijn niet healthy geworden binnen ${MAX_WAIT}s"
    docker compose ps
    docker compose logs --tail=20 db redis
    exit 1
fi

# Wacht tot backend klaar is (entrypoint draait migrate + collectstatic)
log_info "Wachten tot backend klaar is..."
ELAPSED=0
while [ $ELAPSED -lt 60 ]; do
    if docker compose exec -T backend python -c "import django; django.setup()" 2>/dev/null; then
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done

# =========================================
# 6. Verifieer migraties
# =========================================
log_info "Migratiestatus controleren..."
PENDING=$(docker compose exec -T backend python manage.py showmigrations --plan 2>/dev/null | grep "\[ \]" | wc -l)
if [ "$PENDING" -gt 0 ]; then
    log_warning "$PENDING migraties nog niet toegepast — opnieuw uitvoeren..."
    docker compose exec -T backend python manage.py migrate --noinput
    log_success "Migraties alsnog uitgevoerd"
else
    log_success "Alle migraties zijn toegepast"
fi

# =========================================
# 7. Health check applicatie
# =========================================
log_info "Applicatie health check..."
sleep 5
BACKEND_STATUS=$(docker compose exec -T backend curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health/ 2>/dev/null || echo "000")
FRONTEND_STATUS=$(docker compose exec -T frontend curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ 2>/dev/null || echo "000")

if [[ "$BACKEND_STATUS" =~ ^(200|301|302)$ ]]; then
    log_success "Backend bereikbaar (HTTP $BACKEND_STATUS)"
else
    log_warning "Backend geeft HTTP $BACKEND_STATUS — controleer logs: docker compose logs backend"
fi

if [[ "$FRONTEND_STATUS" =~ ^(200|301|304)$ ]]; then
    log_success "Frontend bereikbaar (HTTP $FRONTEND_STATUS)"
else
    log_warning "Frontend geeft HTTP $FRONTEND_STATUS — controleer logs: docker compose logs frontend"
fi

# =========================================
# 8. Oude Docker images opruimen
# =========================================
log_info "Ongebruikte Docker images opruimen..."
docker image prune -f --filter "until=24h" >/dev/null 2>&1 || true

# =========================================
# 9. Oude backups opruimen (bewaar laatste N)
# =========================================
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/db-pre-update-*.sql 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$KEEP_BACKUPS" ]; then
    REMOVE_COUNT=$((BACKUP_COUNT - KEEP_BACKUPS))
    log_info "Oude backups opruimen ($REMOVE_COUNT verwijderen, $KEEP_BACKUPS bewaren)..."
    ls -1t "$BACKUP_DIR"/db-pre-update-*.sql | tail -n "$REMOVE_COUNT" | xargs rm -f
fi

# =========================================
# Status overzicht
# =========================================
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Container Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
docker compose ps
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Disk Usage${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
docker system df 2>/dev/null || true
echo ""

log_success "Update voltooid! ($(git rev-parse --short HEAD))"
echo ""
echo "Controleer de applicatie op je domein."
echo "Logs bekijken:  docker compose logs -f --tail=50"
echo ""
