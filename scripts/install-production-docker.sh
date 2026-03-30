#!/bin/bash
# ===========================================
# TMS Docker Production Install Script
# With Portainer & Nginx Proxy Manager
# For Ubuntu 22.04/24.04 LTS
# ===========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration defaults
INSTALL_DIR="/opt/tms"
DOCKER_DIR="/opt/docker"

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     TMS - Docker Production Install Script                 ║"
    echo "║     With Portainer & Nginx Proxy Manager                   ║"
    echo "║     Version: 2.0                                           ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "\n${GREEN}▶ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✖ $1${NC}"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

# Check Ubuntu version
check_ubuntu_version() {
    print_step "Checking Ubuntu version..."
    
    if [ ! -f /etc/os-release ]; then
        print_error "Cannot detect OS. This script requires Ubuntu."
        exit 1
    fi
    
    . /etc/os-release
    
    if [ "$ID" != "ubuntu" ]; then
        print_error "This script requires Ubuntu. Detected: $ID"
        exit 1
    fi
    
    VERSION_NUM=$(echo "$VERSION_ID" | cut -d. -f1)
    
    case "$VERSION_ID" in
        "22.04"|"24.04")
            echo "  Ubuntu $VERSION_ID LTS detected ✓"
            ;;
        "20.04")
            print_warning "Ubuntu 20.04 LTS detected. Consider upgrading to 22.04 or 24.04."
            read -p "Continue anyway? (y/n): " continue_old
            if [ "$continue_old" != "y" ]; then
                exit 0
            fi
            ;;
        "23.04"|"23.10"|"24.10")
            print_error "Ubuntu $VERSION_ID is a non-LTS release and has reached End of Life."
            echo ""
            echo "  Solutions:"
            echo "  1. Upgrade to Ubuntu 24.04 LTS: sudo do-release-upgrade"
            echo "  2. Fresh install with Ubuntu 22.04 LTS or 24.04 LTS"
            exit 1
            ;;
        *)
            if [ "$VERSION_NUM" -lt 20 ]; then
                print_error "Ubuntu $VERSION_ID is too old. Minimum required: 20.04 LTS"
                exit 1
            fi
            ;;
    esac
}

# Generate random password
generate_password() {
    openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24
}

# Get user configuration
get_user_input() {
    print_step "Configuration"
    
    echo ""
    echo -e "${CYAN}=== Repository ===${NC}"
    read -p "Git repository URL [https://github.com/sercan8282/tmsapp.git]: " REPO_URL
    REPO_URL=${REPO_URL:-https://github.com/sercan8282/tmsapp.git}
    
    echo ""
    echo -e "${CYAN}=== Domain Configuration ===${NC}"
    read -p "Main domain for TMS (e.g., tms.example.com): " DOMAIN_TMS
    if [ -z "$DOMAIN_TMS" ]; then
        print_error "TMS domain is required"
        exit 1
    fi
    
    # Extract base domain
    BASE_DOMAIN=${DOMAIN_TMS#*.}
    
    read -p "Domain for Portainer [portainer.$BASE_DOMAIN]: " DOMAIN_PORTAINER
    DOMAIN_PORTAINER=${DOMAIN_PORTAINER:-portainer.$BASE_DOMAIN}
    
    read -p "Domain for Nginx Proxy Manager [npm.$BASE_DOMAIN]: " DOMAIN_NPM
    DOMAIN_NPM=${DOMAIN_NPM:-npm.$BASE_DOMAIN}
    
    echo ""
    echo -e "${CYAN}=== Database ===${NC}"
    read -p "Database name [tms_db]: " DB_NAME
    DB_NAME=${DB_NAME:-tms_db}
    
    read -p "Database user [tms_user]: " DB_USER
    DB_USER=${DB_USER:-tms_user}
    
    read -p "Database password (leave empty to generate): " DB_PASSWORD
    if [ -z "$DB_PASSWORD" ]; then
        DB_PASSWORD=$(generate_password)
        echo "  Generated: $DB_PASSWORD"
    fi
    
    echo ""
    echo -e "${CYAN}=== TMS Admin Account ===${NC}"
    read -p "Admin email [admin@$DOMAIN_TMS]: " ADMIN_EMAIL
    ADMIN_EMAIL=${ADMIN_EMAIL:-admin@$DOMAIN_TMS}
    
    while true; do
        read -sp "Admin password: " ADMIN_PASSWORD
        echo
        if [ -z "$ADMIN_PASSWORD" ]; then
            print_error "Password is required"
            continue
        fi
        read -sp "Confirm admin password: " ADMIN_PASSWORD2
        echo
        if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ]; then
            break
        else
            print_error "Passwords do not match"
        fi
    done
    
    echo ""
    echo -e "${CYAN}=== Portainer Admin ===${NC}"
    read -p "Portainer admin username [admin]: " PORTAINER_USER
    PORTAINER_USER=${PORTAINER_USER:-admin}
    
    read -p "Portainer admin password (leave empty to generate): " PORTAINER_PASSWORD
    if [ -z "$PORTAINER_PASSWORD" ]; then
        PORTAINER_PASSWORD=$(generate_password)
        echo "  Generated: $PORTAINER_PASSWORD"
    fi
    
    echo ""
    echo -e "${CYAN}=== Nginx Proxy Manager Admin ===${NC}"
    read -p "NPM admin email [$ADMIN_EMAIL]: " NPM_ADMIN_EMAIL
    NPM_ADMIN_EMAIL=${NPM_ADMIN_EMAIL:-$ADMIN_EMAIL}
    
    read -p "NPM admin password (leave empty to generate): " NPM_ADMIN_PASSWORD
    if [ -z "$NPM_ADMIN_PASSWORD" ]; then
        NPM_ADMIN_PASSWORD=$(generate_password)
        echo "  Generated: $NPM_ADMIN_PASSWORD"
    fi
    
    echo ""
    echo -e "${CYAN}=== SSL Configuration ===${NC}"
    read -p "Email for SSL certificates (Let's Encrypt): " SSL_EMAIL
    if [ -z "$SSL_EMAIL" ]; then
        SSL_EMAIL=$NPM_ADMIN_EMAIL
    fi
    
    # Generate secrets
    SECRET_KEY=$(openssl rand -base64 48)
    
    # Display summary
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                 Configuration Summary                      ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Repository:         $REPO_URL"
    echo ""
    echo "  TMS Domain:         $DOMAIN_TMS"
    echo "  Portainer Domain:   $DOMAIN_PORTAINER"
    echo "  NPM Domain:         $DOMAIN_NPM"
    echo ""
    echo "  Database:           $DB_NAME"
    echo "  DB User:            $DB_USER"
    echo ""
    echo "  TMS Admin:          $ADMIN_EMAIL"
    echo "  Portainer Admin:    $PORTAINER_USER"
    echo "  NPM Admin:          $NPM_ADMIN_EMAIL"
    echo "  SSL Email:          $SSL_EMAIL"
    echo ""
    echo -e "${YELLOW}Docker directories to be created:${NC}"
    echo "  $DOCKER_DIR/tms             - TMS application"
    echo "  $DOCKER_DIR/portainer       - Portainer data"
    echo "  $DOCKER_DIR/nginx-proxy     - Nginx Proxy Manager"
    echo "  $DOCKER_DIR/postgres        - PostgreSQL data"
    echo "  $DOCKER_DIR/redis           - Redis data"
    echo ""
    echo -e "${YELLOW}SSL will be configured automatically via NPM${NC}"
    echo ""
    read -p "Continue with installation? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Installation cancelled"
        exit 0
    fi
}

# Install Docker
install_docker() {
    print_step "Installing Docker..."
    
    if command -v docker &> /dev/null; then
        echo "  Docker already installed: $(docker --version)"
    else
        # Install dependencies
        apt-get update
        apt-get install -y ca-certificates curl gnupg
        
        # Add Docker GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        
        # Add Docker repository
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
          tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        # Enable and start Docker
        systemctl enable docker
        systemctl start docker
        
        echo "  Docker installed: $(docker --version)"
    fi
}

# Create directory structure with proper permissions
create_directories() {
    print_step "Creating Docker directory structure..."
    
    # Main directories
    mkdir -p $DOCKER_DIR/{tms,portainer,nginx-proxy,postgres,redis}
    
    # TMS subdirectories
    mkdir -p $DOCKER_DIR/tms/{backend,frontend,media,staticfiles,logs,backups}
    
    # Media subdirectories for uploads
    mkdir -p $DOCKER_DIR/tms/media/{fonts,branding,imports,temp/ocr}
    
    # Nginx Proxy Manager subdirectories
    mkdir -p $DOCKER_DIR/nginx-proxy/{data,letsencrypt}
    
    # PostgreSQL data
    mkdir -p $DOCKER_DIR/postgres/data
    
    # Redis data
    mkdir -p $DOCKER_DIR/redis/data
    
    # Set base permissions (docker group will be added)
    chmod -R 755 $DOCKER_DIR
    
    # Secure sensitive directories
    chmod 750 $DOCKER_DIR/postgres
    chmod 750 $DOCKER_DIR/postgres/data
    chmod 750 $DOCKER_DIR/tms/logs
    chmod 750 $DOCKER_DIR/tms/backups
    chmod 755 $DOCKER_DIR/tms/media
    chmod 755 $DOCKER_DIR/tms/media/fonts
    chmod 755 $DOCKER_DIR/tms/media/branding
    chmod 755 $DOCKER_DIR/tms/media/imports
    chmod 755 $DOCKER_DIR/tms/media/temp
    chmod 755 $DOCKER_DIR/tms/staticfiles
    chmod 755 $DOCKER_DIR/nginx-proxy/letsencrypt
    
    # Set ownership for containers (Docker uses specific UIDs)
    # PostgreSQL uses UID 999
    chown -R 999:999 $DOCKER_DIR/postgres/data
    # Redis uses UID 999
    chown -R 999:999 $DOCKER_DIR/redis/data
    
    echo "  ✓ Directories created with permissions:"
    echo "    $DOCKER_DIR/tms/backend       - Backend code"
    echo "    $DOCKER_DIR/tms/frontend      - Frontend code"
    echo "    $DOCKER_DIR/tms/media         - Uploads (755)"
    echo "    $DOCKER_DIR/tms/staticfiles   - Static assets (755)"
    echo "    $DOCKER_DIR/tms/logs          - App logs (750)"
    echo "    $DOCKER_DIR/tms/backups       - Backups (750)"
    echo "    $DOCKER_DIR/portainer         - Portainer data"
    echo "    $DOCKER_DIR/nginx-proxy/data  - NPM config"
    echo "    $DOCKER_DIR/nginx-proxy/letsencrypt - SSL certs"
    echo "    $DOCKER_DIR/postgres/data     - DB files (750, uid:999)"
    echo "    $DOCKER_DIR/redis/data        - Redis data (uid:999)"
}

# Create Docker network
create_docker_network() {
    print_step "Creating Docker network..."
    
    docker network create tms-network 2>/dev/null || echo "  Network 'tms-network' already exists"
}

# Setup Portainer
setup_portainer() {
    print_step "Setting up Portainer..."
    
    # Stop existing if running
    docker stop portainer 2>/dev/null || true
    docker rm portainer 2>/dev/null || true
    
    # Create Portainer container
    docker run -d \
        --name portainer \
        --restart=always \
        --network=tms-network \
        -p 9443:9443 \
        -p 9000:9000 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v $DOCKER_DIR/portainer:/data \
        portainer/portainer-ce:latest
    
    # Wait for Portainer to start
    echo "  Waiting for Portainer to start..."
    sleep 10
    
    # Create admin user via API
    echo "  Creating Portainer admin user..."
    
    # Wait for API to be ready
    for i in {1..30}; do
        if curl -s -k https://localhost:9443/api/status > /dev/null 2>&1; then
            break
        fi
        sleep 2
    done
    
    # Initialize admin user
    curl -s -k -X POST https://localhost:9443/api/users/admin/init \
        -H "Content-Type: application/json" \
        -d "{\"Username\":\"$PORTAINER_USER\",\"Password\":\"$PORTAINER_PASSWORD\"}" > /dev/null 2>&1 || true
    
    echo "  ✓ Portainer installed!"
}

# Setup Nginx Proxy Manager
setup_nginx_proxy_manager() {
    print_step "Setting up Nginx Proxy Manager..."
    
    # Create docker-compose for NPM
    cat > $DOCKER_DIR/nginx-proxy/docker-compose.yml << EOF
version: '3.8'
services:
  npm:
    image: 'jc21/nginx-proxy-manager:latest'
    container_name: nginx-proxy-manager
    restart: always
    ports:
      - '80:80'
      - '443:443'
      - '81:81'
    volumes:
      - $DOCKER_DIR/nginx-proxy/data:/data
      - $DOCKER_DIR/nginx-proxy/letsencrypt:/etc/letsencrypt
    networks:
      - tms-network

networks:
  tms-network:
    external: true
EOF
    
    # Start Nginx Proxy Manager
    cd $DOCKER_DIR/nginx-proxy
    docker compose up -d
    
    # Wait for NPM to be fully ready
    echo "  Waiting for Nginx Proxy Manager to start..."
    for i in {1..60}; do
        if curl -s http://localhost:81/api/ > /dev/null 2>&1; then
            echo "  NPM API is ready"
            break
        fi
        sleep 3
    done
    sleep 10
    
    echo "  ✓ Nginx Proxy Manager installed!"
}

# Configure NPM with SSL and proxy hosts
configure_npm_ssl() {
    print_step "Configuring Nginx Proxy Manager with SSL..."
    
    NPM_API="http://localhost:81/api"
    
    # Step 1: Login with default credentials
    echo "  Logging in to NPM..."
    LOGIN_RESPONSE=$(curl -s -X POST "$NPM_API/tokens" \
        -H "Content-Type: application/json" \
        -d '{"identity":"admin@example.com","secret":"changeme"}')
    
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$TOKEN" ]; then
        print_warning "Could not login to NPM with default credentials"
        print_warning "NPM may need manual configuration"
        return 1
    fi
    
    echo "  ✓ Logged in to NPM"
    
    # Step 2: Change default password
    echo "  Changing NPM admin password..."
    USER_ID=$(curl -s -X GET "$NPM_API/users" \
        -H "Authorization: Bearer $TOKEN" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
    
    curl -s -X PUT "$NPM_API/users/$USER_ID" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"$NPM_ADMIN_EMAIL\",
            \"nickname\": \"Admin\",
            \"is_disabled\": false,
            \"roles\": [\"admin\"]
        }" > /dev/null
    
    curl -s -X PUT "$NPM_API/users/$USER_ID/auth" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"type\": \"password\",
            \"current\": \"changeme\",
            \"secret\": \"$NPM_ADMIN_PASSWORD\"
        }" > /dev/null
    
    echo "  ✓ NPM password changed"
    
    # Re-login with new credentials
    LOGIN_RESPONSE=$(curl -s -X POST "$NPM_API/tokens" \
        -H "Content-Type: application/json" \
        -d "{\"identity\":\"$NPM_ADMIN_EMAIL\",\"secret\":\"$NPM_ADMIN_PASSWORD\"}")
    
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    # Step 3: Request SSL certificate for all domains
    echo "  Requesting SSL certificate from Let's Encrypt..."
    echo "  Domains: $DOMAIN_TMS, $DOMAIN_PORTAINER, $DOMAIN_NPM"
    
    SSL_RESPONSE=$(curl -s -X POST "$NPM_API/nginx/certificates" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"domain_names\": [\"$DOMAIN_TMS\", \"$DOMAIN_PORTAINER\", \"$DOMAIN_NPM\"],
            \"meta\": {
                \"letsencrypt_email\": \"$SSL_EMAIL\",
                \"letsencrypt_agree\": true,
                \"dns_challenge\": false
            },
            \"provider\": \"letsencrypt\"
        }")
    
    CERT_ID=$(echo "$SSL_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
    
    if [ -n "$CERT_ID" ] && [ "$CERT_ID" != "null" ]; then
        echo "  ✓ SSL certificate obtained (ID: $CERT_ID)"
    else
        print_warning "Could not obtain SSL certificate automatically"
        echo "  This might be because:"
        echo "    - DNS records not yet pointing to this server"
        echo "    - Domains not accessible from internet"
        echo "  You can configure SSL manually via NPM web interface"
        CERT_ID=""
    fi
    
    # Step 4: Create proxy host for TMS (frontend + backend)
    echo "  Creating proxy host for TMS: $DOMAIN_TMS"
    
    if [ -n "$CERT_ID" ]; then
        SSL_CONFIG="\"certificate_id\": $CERT_ID,
            \"ssl_forced\": true,
            \"http2_support\": true,"
    else
        SSL_CONFIG=""
    fi
    
    # TMS Proxy Host with custom locations for API
    curl -s -X POST "$NPM_API/nginx/proxy-hosts" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"domain_names\": [\"$DOMAIN_TMS\"],
            \"forward_scheme\": \"http\",
            \"forward_host\": \"tms-frontend\",
            \"forward_port\": 80,
            \"block_exploits\": true,
            \"allow_websocket_upgrade\": true,
            \"access_list_id\": 0,
            \"advanced_config\": \"location /api/ {\\n    proxy_pass http://tms-backend:8000;\\n    proxy_set_header Host \\$host;\\n    proxy_set_header X-Real-IP \\$remote_addr;\\n    proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;\\n    proxy_set_header X-Forwarded-Proto \\$scheme;\\n}\\n\\nlocation /admin/ {\\n    proxy_pass http://tms-backend:8000;\\n    proxy_set_header Host \\$host;\\n    proxy_set_header X-Real-IP \\$remote_addr;\\n}\\n\\nlocation /static/ {\\n    proxy_pass http://tms-backend:8000;\\n}\\n\\nlocation /media/ {\\n    proxy_pass http://tms-backend:8000;\\n}\",
            $SSL_CONFIG
            \"meta\": {
                \"letsencrypt_agree\": false,
                \"dns_challenge\": false
            },
            \"locations\": []
        }" > /dev/null 2>&1
    
    echo "  ✓ TMS proxy host created"
    
    # Step 5: Create proxy host for Portainer
    echo "  Creating proxy host for Portainer: $DOMAIN_PORTAINER"
    
    curl -s -X POST "$NPM_API/nginx/proxy-hosts" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"domain_names\": [\"$DOMAIN_PORTAINER\"],
            \"forward_scheme\": \"https\",
            \"forward_host\": \"portainer\",
            \"forward_port\": 9443,
            \"block_exploits\": true,
            \"allow_websocket_upgrade\": true,
            \"access_list_id\": 0,
            $SSL_CONFIG
            \"meta\": {
                \"letsencrypt_agree\": false,
                \"dns_challenge\": false
            },
            \"locations\": []
        }" > /dev/null 2>&1
    
    echo "  ✓ Portainer proxy host created"
    
    # Step 6: Create proxy host for NPM itself
    echo "  Creating proxy host for NPM: $DOMAIN_NPM"
    
    curl -s -X POST "$NPM_API/nginx/proxy-hosts" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"domain_names\": [\"$DOMAIN_NPM\"],
            \"forward_scheme\": \"http\",
            \"forward_host\": \"127.0.0.1\",
            \"forward_port\": 81,
            \"block_exploits\": true,
            \"allow_websocket_upgrade\": true,
            \"access_list_id\": 0,
            $SSL_CONFIG
            \"meta\": {
                \"letsencrypt_agree\": false,
                \"dns_challenge\": false
            },
            \"locations\": []
        }" > /dev/null 2>&1
    
    echo "  ✓ NPM proxy host created"
    
    echo ""
    if [ -n "$CERT_ID" ]; then
        echo -e "  ${GREEN}✓ SSL fully configured!${NC}"
        echo "    All services accessible via HTTPS"
    else
        echo -e "  ${YELLOW}⚠ Proxy hosts created without SSL${NC}"
        echo "    Add SSL certificates manually via NPM interface"
    fi
}

# Create TMS Docker Compose
create_tms_compose() {
    print_step "Creating TMS Docker Compose configuration..."
    
    cat > $DOCKER_DIR/tms/docker-compose.yml << EOF
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: tms-postgres
    restart: always
    environment:
      POSTGRES_DB: $DB_NAME
      POSTGRES_USER: $DB_USER
      POSTGRES_PASSWORD: $DB_PASSWORD
    volumes:
      - $DOCKER_DIR/postgres/data:/var/lib/postgresql/data
    networks:
      - tms-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $DB_USER -d $DB_NAME"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: tms-redis
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - $DOCKER_DIR/redis/data:/data
    networks:
      - tms-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: tms-backend
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - DJANGO_SETTINGS_MODULE=tms.settings.production
      - SECRET_KEY=$SECRET_KEY
      - DB_NAME=$DB_NAME
      - DB_USER=$DB_USER
      - DB_PASSWORD=$DB_PASSWORD
      - DB_HOST=postgres
      - DB_PORT=5432
      - REDIS_URL=redis://redis:6379/1
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/0
      - ALLOWED_HOSTS=$DOMAIN_TMS,localhost,tms-backend
      - CORS_ALLOWED_ORIGINS=https://$DOMAIN_TMS
      - SECURE_SSL_REDIRECT=False
      - SESSION_COOKIE_SECURE=True
      - CSRF_COOKIE_SECURE=True
    volumes:
      - $DOCKER_DIR/tms/media:/app/media
      - $DOCKER_DIR/tms/staticfiles:/app/staticfiles
      - $DOCKER_DIR/tms/logs:/app/logs
    networks:
      - tms-network
    expose:
      - "8000"

  celery-worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: tms-celery-worker
    restart: always
    command: celery -A tms worker --loglevel=info --concurrency=2
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - DJANGO_SETTINGS_MODULE=tms.settings.production
      - SECRET_KEY=$SECRET_KEY
      - DB_NAME=$DB_NAME
      - DB_USER=$DB_USER
      - DB_PASSWORD=$DB_PASSWORD
      - DB_HOST=postgres
      - DB_PORT=5432
      - REDIS_URL=redis://redis:6379/1
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/0
      - ALLOWED_HOSTS=$DOMAIN_TMS,localhost,tms-backend
      - CORS_ALLOWED_ORIGINS=https://$DOMAIN_TMS
    volumes:
      - $DOCKER_DIR/tms/media:/app/media
      - $DOCKER_DIR/tms/logs:/app/logs
    networks:
      - tms-network

  celery-beat:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: tms-celery-beat
    restart: always
    command: celery -A tms beat --loglevel=info
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - DJANGO_SETTINGS_MODULE=tms.settings.production
      - SECRET_KEY=$SECRET_KEY
      - DB_NAME=$DB_NAME
      - DB_USER=$DB_USER
      - DB_PASSWORD=$DB_PASSWORD
      - DB_HOST=postgres
      - DB_PORT=5432
      - REDIS_URL=redis://redis:6379/1
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/0
      - ALLOWED_HOSTS=$DOMAIN_TMS,localhost,tms-backend
      - CORS_ALLOWED_ORIGINS=https://$DOMAIN_TMS
    volumes:
      - $DOCKER_DIR/tms/logs:/app/logs
    networks:
      - tms-network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - VITE_API_URL=/api
    container_name: tms-frontend
    restart: always
    depends_on:
      - backend
    networks:
      - tms-network
    expose:
      - "80"

networks:
  tms-network:
    external: true
EOF

    echo "  ✓ Docker Compose file created"
}

# Create Dockerfiles
create_dockerfiles() {
    print_step "Creating Dockerfiles..."
    
    # Backend Dockerfile
    cat > $DOCKER_DIR/tms/backend/Dockerfile << 'DOCKERFILE'
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    tesseract-ocr \
    tesseract-ocr-nld \
    tesseract-ocr-eng \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements/production.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy application
COPY . .

# Create directories including fonts, branding and OCR temp
RUN mkdir -p logs media/fonts media/branding media/imports media/temp/ocr staticfiles

# Collect static files
RUN python manage.py collectstatic --noinput || true

# Expose port
EXPOSE 8000

# Run gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "--threads", "2", "--timeout", "60", "tms.wsgi:application"]
DOCKERFILE

    # Frontend Dockerfile
    cat > $DOCKER_DIR/tms/frontend/Dockerfile << 'DOCKERFILE'
# Build stage
FROM node:20-alpine as build

WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Nginx config for SPA
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
DOCKERFILE

    echo "  ✓ Dockerfiles created"
}

# Clone and setup TMS
setup_tms_application() {
    print_step "Cloning TMS application..."
    
    # Clone repository
    if [ -d "$INSTALL_DIR" ]; then
        cd $INSTALL_DIR
        git pull origin main
    else
        git clone $REPO_URL $INSTALL_DIR
    fi
    
    # Copy to Docker directory
    print_step "Copying source to Docker directory..."
    cp -r $INSTALL_DIR/backend/* $DOCKER_DIR/tms/backend/
    cp -r $INSTALL_DIR/frontend/* $DOCKER_DIR/tms/frontend/
    
    # Build and start TMS
    print_step "Building TMS containers (this may take a few minutes)..."
    cd $DOCKER_DIR/tms
    docker compose build --no-cache
    
    print_step "Starting TMS containers..."
    docker compose up -d
    
    # Wait for backend to be ready
    echo "  Waiting for backend to start..."
    for i in {1..60}; do
        if docker exec tms-backend python -c "print('ready')" 2>/dev/null; then
            break
        fi
        sleep 2
    done
    sleep 5
    
    # Run migrations
    print_step "Running database migrations..."
    docker exec tms-backend python manage.py migrate --noinput
    
    # Collect static files
    docker exec tms-backend python manage.py collectstatic --noinput || true
    
    # Create admin user
    print_step "Creating admin user..."
    docker exec tms-backend python manage.py shell << PYTHON_EOF
from apps.accounts.models import User
if not User.objects.filter(email='$ADMIN_EMAIL').exists():
    User.objects.create_superuser(
        email='$ADMIN_EMAIL',
        password='$ADMIN_PASSWORD',
        first_name='Admin',
        last_name='User'
    )
    print('Superuser created!')
else:
    print('Superuser already exists.')
PYTHON_EOF
    
    echo "  ✓ TMS application deployed!"
}

# Configure firewall
configure_firewall() {
    print_step "Configuring firewall..."
    
    apt-get install -y ufw > /dev/null 2>&1
    
    ufw default deny incoming
    ufw default allow outgoing
    
    # SSH
    ufw limit ssh
    
    # HTTP/HTTPS (Nginx Proxy Manager)
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Nginx Proxy Manager Admin
    ufw allow 81/tcp
    
    # Portainer
    ufw allow 9000/tcp
    ufw allow 9443/tcp
    
    echo "y" | ufw enable
    
    echo "  ✓ Firewall configured"
    echo "    Open ports: 22 (SSH), 80, 443 (HTTP/S), 81 (NPM), 9000/9443 (Portainer)"
}

# Create maintenance scripts
create_maintenance_scripts() {
    print_step "Creating maintenance scripts..."
    
    # Copy comprehensive update script from repository
    if [ -f "$INSTALL_DIR/scripts/update-production-docker.sh" ]; then
        cp "$INSTALL_DIR/scripts/update-production-docker.sh" /usr/local/bin/tms-update
        chmod +x /usr/local/bin/tms-update
        
        # Set environment variables for the update script
        sed -i "s|INSTALL_DIR=.*|INSTALL_DIR=\"$INSTALL_DIR\"|" /usr/local/bin/tms-update
        sed -i "s|DOCKER_DIR=.*|DOCKER_DIR=\"$DOCKER_DIR\"|" /usr/local/bin/tms-update
    else
        # Fallback simple update script
        cat > /usr/local/bin/tms-update << EOF
#!/bin/bash
set -e
echo "=== Updating TMS ==="

cd $INSTALL_DIR
echo "Pulling latest code..."
git pull origin main

echo "Copying to Docker directory..."
cp -r backend/* $DOCKER_DIR/tms/backend/
cp -r frontend/* $DOCKER_DIR/tms/frontend/

echo "Rebuilding containers..."
cd $DOCKER_DIR/tms
docker compose build
docker compose up -d

echo "Running migrations..."
sleep 10
docker exec tms-backend python manage.py migrate --noinput
docker exec tms-backend python manage.py collectstatic --noinput

echo "=== TMS updated successfully! ==="
EOF
        chmod +x /usr/local/bin/tms-update
    fi
    
    # Backup script
    cat > /usr/local/bin/tms-backup << EOF
#!/bin/bash
BACKUP_DIR="$DOCKER_DIR/tms/backups"
TIMESTAMP=\$(date +%Y%m%d_%H%M%S)

echo "=== Creating TMS Backup ==="

# Backup database
echo "Backing up database..."
docker exec tms-postgres pg_dump -U $DB_USER $DB_NAME > "\$BACKUP_DIR/db_\$TIMESTAMP.sql"

# Backup media
echo "Backing up media files..."
tar -czf "\$BACKUP_DIR/media_\$TIMESTAMP.tar.gz" -C $DOCKER_DIR/tms media/

# Keep only last 7 days
find "\$BACKUP_DIR" -type f -mtime +7 -delete

echo "=== Backup completed ==="
echo "Location: \$BACKUP_DIR"
ls -lh "\$BACKUP_DIR" | tail -5
EOF
    chmod +x /usr/local/bin/tms-backup
    
    # Status script
    cat > /usr/local/bin/tms-status << 'EOF'
#!/bin/bash
echo "=== Docker Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "tms|portainer|nginx"
echo ""
echo "=== Disk Usage ==="
docker system df
echo ""
echo "=== Volume Sizes ==="
du -sh /opt/docker/*/ 2>/dev/null
EOF
    chmod +x /usr/local/bin/tms-status
    
    # Logs script
    cat > /usr/local/bin/tms-logs << 'EOF'
#!/bin/bash
CONTAINER=${1:-tms-backend}
docker logs -f --tail 100 $CONTAINER
EOF
    chmod +x /usr/local/bin/tms-logs
    
    # Setup daily backups
    (crontab -l 2>/dev/null | grep -v "tms-backup"; echo "0 2 * * * /usr/local/bin/tms-backup >> /var/log/tms-backup.log 2>&1") | crontab -
    
    echo "  ✓ Maintenance scripts created"
    echo "    tms-update [cmd]    - Update, rollback, status (run 'tms-update help' for options)"
    echo "    tms-backup          - Create manual backup"
    echo "    tms-status          - Show container status"
    echo "    tms-logs [service]  - View container logs"
}

# Save credentials
save_credentials() {
    print_step "Saving credentials..."
    
    CREDS_FILE="$DOCKER_DIR/CREDENTIALS.txt"
    SERVER_IP=$(hostname -I | awk '{print $1}')
    
    cat > "$CREDS_FILE" << EOF
╔══════════════════════════════════════════════════════════════════════════════╗
║                    TMS Docker Installation Credentials                        ║
║                 KEEP THIS FILE SECURE - DELETE AFTER BACKUP                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

Server IP: $SERVER_IP

════════════════════════════════════════════════════════════════════════════════
 TMS APPLICATION
════════════════════════════════════════════════════════════════════════════════
URL:        https://$DOMAIN_TMS
Admin:      $ADMIN_EMAIL
Password:   [as entered during installation]

════════════════════════════════════════════════════════════════════════════════
 PORTAINER (Docker Management)
════════════════════════════════════════════════════════════════════════════════
URL:        https://$SERVER_IP:9443
            https://$DOMAIN_PORTAINER (with SSL)
Username:   $PORTAINER_USER
Password:   $PORTAINER_PASSWORD

════════════════════════════════════════════════════════════════════════════════
 NGINX PROXY MANAGER
════════════════════════════════════════════════════════════════════════════════
URL:        http://$SERVER_IP:81
            https://$DOMAIN_NPM (with SSL)
Email:      $NPM_ADMIN_EMAIL
Password:   $NPM_ADMIN_PASSWORD

════════════════════════════════════════════════════════════════════════════════
 DATABASE
════════════════════════════════════════════════════════════════════════════════
Type:       PostgreSQL 16
Host:       tms-postgres (internal Docker network)
Name:       $DB_NAME
User:       $DB_USER
Password:   $DB_PASSWORD

════════════════════════════════════════════════════════════════════════════════
 DOCKER DIRECTORIES & VOLUMES
════════════════════════════════════════════════════════════════════════════════
$DOCKER_DIR/tms/backend         - Backend source code
$DOCKER_DIR/tms/frontend        - Frontend source code
$DOCKER_DIR/tms/media           - Uploaded files (VOLUME)
$DOCKER_DIR/tms/staticfiles     - Static assets (VOLUME)
$DOCKER_DIR/tms/logs            - Application logs (VOLUME)
$DOCKER_DIR/tms/backups         - Database backups

$DOCKER_DIR/portainer           - Portainer data (VOLUME)

$DOCKER_DIR/nginx-proxy/data       - NPM configuration (VOLUME)
$DOCKER_DIR/nginx-proxy/letsencrypt - SSL certificates (VOLUME)

$DOCKER_DIR/postgres/data       - PostgreSQL data (VOLUME)
$DOCKER_DIR/redis/data          - Redis persistence (VOLUME)

════════════════════════════════════════════════════════════════════════════════
 COMMANDS
════════════════════════════════════════════════════════════════════════════════
tms-update              - Update TMS to latest version
tms-backup              - Create database & media backup
tms-status              - Show Docker container status
tms-logs [container]    - View container logs (default: tms-backend)

docker compose -f $DOCKER_DIR/tms/docker-compose.yml logs -f        - All logs
docker compose -f $DOCKER_DIR/tms/docker-compose.yml restart        - Restart TMS
docker exec -it tms-backend python manage.py shell                  - Django shell
docker exec -it tms-postgres psql -U $DB_USER $DB_NAME              - PostgreSQL

════════════════════════════════════════════════════════════════════════════════
 SSL STATUS
════════════════════════════════════════════════════════════════════════════════
SSL certificates have been automatically configured via Let's Encrypt.
If SSL setup failed (DNS not ready), you can manually add certificates:

1. Login to NPM: http://$SERVER_IP:81
2. Go to: SSL Certificates → Add SSL Certificate
3. Choose: Let's Encrypt
4. Enter domains: $DOMAIN_TMS, $DOMAIN_PORTAINER, $DOMAIN_NPM
5. Update proxy hosts with new certificate

════════════════════════════════════════════════════════════════════════════════
 PROXY HOSTS (Auto-Configured)
════════════════════════════════════════════════════════════════════════════════
$DOMAIN_TMS         → tms-frontend:80 (with /api → tms-backend:8000)
$DOMAIN_PORTAINER   → portainer:9443 (HTTPS)
$DOMAIN_NPM         → localhost:81

════════════════════════════════════════════════════════════════════════════════
EOF

    chmod 600 "$CREDS_FILE"
    
    echo "  ✓ Credentials saved to: $CREDS_FILE"
}

# Print final summary
print_summary() {
    # Get server IP
    SERVER_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                         Installation Complete!                               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ TMS Application                                                              │${NC}"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "│ URL:      ${BLUE}https://$DOMAIN_TMS${NC} (after NPM setup)"
    echo -e "│ Admin:    ${YELLOW}$ADMIN_EMAIL${NC}"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ Portainer (Docker Management)                                                │${NC}"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "│ URL:      ${BLUE}https://$SERVER_IP:9443${NC}"
    echo -e "│ Username: ${YELLOW}$PORTAINER_USER${NC}"
    echo -e "│ Password: ${YELLOW}$PORTAINER_PASSWORD${NC}"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ Nginx Proxy Manager                                                          │${NC}"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "│ URL:      ${BLUE}http://$SERVER_IP:81${NC}"
    echo -e "│           ${BLUE}https://$DOMAIN_NPM${NC} (with SSL)"
    echo -e "│ Email:    ${YELLOW}$NPM_ADMIN_EMAIL${NC}"
    echo -e "│ Password: ${YELLOW}$NPM_ADMIN_PASSWORD${NC}"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ Database                                                                     │${NC}"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "│ Name:     ${YELLOW}$DB_NAME${NC}"
    echo -e "│ User:     ${YELLOW}$DB_USER${NC}"
    echo -e "│ Password: ${YELLOW}$DB_PASSWORD${NC}"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  tms-update     - Update TMS"
    echo "  tms-backup     - Create backup"
    echo "  tms-status     - Container status"
    echo "  tms-logs       - View logs"
    echo ""
    echo -e "${YELLOW}Docker Directories:${NC}"
    echo "  $DOCKER_DIR/tms           - TMS volumes"
    echo "  $DOCKER_DIR/portainer     - Portainer data"
    echo "  $DOCKER_DIR/nginx-proxy   - NPM & SSL certs"
    echo "  $DOCKER_DIR/postgres      - Database"
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  SSL & PROXY CONFIGURATION - AUTOMATED!                                      ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  ✓ NPM password has been changed                                             ║${NC}"
    echo -e "${GREEN}║  ✓ Proxy hosts created for TMS, Portainer, and NPM                          ║${NC}"
    echo -e "${GREEN}║  ✓ SSL certificates requested from Let's Encrypt                            ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Make sure DNS records point to this server: $SERVER_IP"
    echo "  2. Test your URLs:"
    echo "     - TMS:        https://$DOMAIN_TMS"
    echo "     - Portainer:  https://$DOMAIN_PORTAINER"
    echo "     - NPM:        https://$DOMAIN_NPM"
    echo "  3. Save credentials from: $DOCKER_DIR/CREDENTIALS.txt"
    echo "  4. Delete credentials file after saving securely!"
    echo ""
    echo -e "${YELLOW}If SSL failed (DNS not ready yet):${NC}"
    echo "  - Login to NPM: http://$SERVER_IP:81"
    echo "  - Manually request SSL certificates once DNS propagates"
    echo ""
}

# Main installation
main() {
    print_header
    check_root
    check_ubuntu_version
    get_user_input
    
    install_docker
    create_directories
    create_docker_network
    setup_portainer
    setup_nginx_proxy_manager
    create_tms_compose
    create_dockerfiles
    setup_tms_application
    configure_npm_ssl
    configure_firewall
    create_maintenance_scripts
    save_credentials
    print_summary
}

main "$@"
