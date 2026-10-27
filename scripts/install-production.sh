#!/bin/bash
# ===========================================
# TMS Production Install Script
# Secure deployment with SSL, firewall, fail2ban
# ===========================================

set -e

# Kleuren
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Defaults
INSTALL_DIR="/opt/tms"
SERVICE_USER="tms"
DOMAIN=""
REPO_URL=""
DB_NAME=""
DB_USER=""
DB_PASSWORD=""
SECRET_KEY=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
USE_SSL="y"
AUTO_RENEW_SSL="y"

# Functions
print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     TMS - Production Installation Script                   ║"
    echo "║     Version: 1.0 | Security Hardened                       ║"
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

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

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
    
    # Get version number
    VERSION_NUM=$(echo "$VERSION_ID" | cut -d. -f1)
    
    # List of supported LTS versions
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
            echo "  Non-LTS releases are only supported for 9 months."
            echo "  Your repositories are no longer available."
            echo ""
            echo "  Options:"
            echo "  1. Upgrade to Ubuntu 24.04 LTS (recommended)"
            echo "     sudo do-release-upgrade -d"
            echo ""
            echo "  2. Fresh install with Ubuntu 22.04 LTS or 24.04 LTS"
            echo ""
            echo "  LTS releases are supported for 5 years."
            exit 1
            ;;
        *)
            if [ "$VERSION_NUM" -lt 20 ]; then
                print_error "Ubuntu $VERSION_ID is too old. Minimum required: 20.04 LTS"
                exit 1
            else
                print_warning "Ubuntu $VERSION_ID detected. LTS versions (22.04, 24.04) are recommended."
                read -p "Continue anyway? (y/n): " continue_unknown
                if [ "$continue_unknown" != "y" ]; then
                    exit 0
                fi
            fi
            ;;
    esac
}

generate_password() {
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32
}

# Interactive prompts
get_user_input() {
    print_step "Configuration"
    
    echo ""
    echo -e "${BLUE}=== Repository ===${NC}"
    read -p "Git repository URL [https://github.com/sercan8282/tmsapp.git]: " REPO_URL
    REPO_URL=${REPO_URL:-https://github.com/sercan8282/tmsapp.git}
    
    echo ""
    echo -e "${BLUE}=== Domain & SSL ===${NC}"
    read -p "Domain name (e.g., tms.example.com): " DOMAIN
    if [ -z "$DOMAIN" ]; then
        print_error "Domain is required"
        exit 1
    fi
    
    read -p "Use SSL/HTTPS with Let's Encrypt? (y/n) [y]: " USE_SSL
    USE_SSL=${USE_SSL:-y}
    
    if [ "$USE_SSL" = "y" ]; then
        read -p "Email for SSL certificate notifications: " ADMIN_EMAIL
        if [ -z "$ADMIN_EMAIL" ]; then
            print_error "Email is required for SSL certificates"
            exit 1
        fi
        
        read -p "Auto-renew SSL certificate? (y/n) [y]: " AUTO_RENEW_SSL
        AUTO_RENEW_SSL=${AUTO_RENEW_SSL:-y}
    fi
    
    echo ""
    echo -e "${BLUE}=== Service Account ===${NC}"
    read -p "Service account name [tms]: " SERVICE_USER
    SERVICE_USER=${SERVICE_USER:-tms}
    
    echo ""
    echo -e "${BLUE}=== Database ===${NC}"
    read -p "Database name [tms_db]: " DB_NAME
    DB_NAME=${DB_NAME:-tms_db}
    
    read -p "Database user [tms_user]: " DB_USER
    DB_USER=${DB_USER:-tms_user}
    
    while true; do
        read -sp "Database password: " DB_PASSWORD
        echo
        if [ -z "$DB_PASSWORD" ]; then
            print_warning "Generating random password..."
            DB_PASSWORD=$(generate_password)
            echo "  Generated password (saved in credentials file)"
            break
        fi
        read -sp "Confirm database password: " DB_PASSWORD2
        echo
        if [ "$DB_PASSWORD" = "$DB_PASSWORD2" ]; then
            break
        else
            print_error "Passwords do not match. Try again."
        fi
    done
    
    echo ""
    echo -e "${BLUE}=== Admin Account ===${NC}"
    read -p "Admin email: " ADMIN_USER_EMAIL
    if [ -z "$ADMIN_USER_EMAIL" ]; then
        ADMIN_USER_EMAIL="admin@${DOMAIN}"
    fi
    
    while true; do
        read -sp "Admin password: " ADMIN_PASSWORD
        echo
        if [ -z "$ADMIN_PASSWORD" ]; then
            print_error "Admin password is required"
            continue
        fi
        read -sp "Confirm admin password: " ADMIN_PASSWORD2
        echo
        if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ]; then
            break
        else
            print_error "Passwords do not match. Try again."
        fi
    done
    
    # Generate secret key
    SECRET_KEY=$(generate_password)
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                 Configuration Summary                      ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Repository:      $REPO_URL"
    echo "  Domain:          $DOMAIN"
    echo "  SSL/HTTPS:       $( [ "$USE_SSL" = "y" ] && echo "Yes (Let's Encrypt)" || echo "No" )"
    if [ "$USE_SSL" = "y" ]; then
    echo "  SSL Email:       $ADMIN_EMAIL"
    echo "  Auto-renew:      $( [ "$AUTO_RENEW_SSL" = "y" ] && echo "Yes" || echo "No" )"
    fi
    echo ""
    echo "  Service User:    $SERVICE_USER"
    echo "  Install Dir:     $INSTALL_DIR"
    echo ""
    echo "  Database:        $DB_NAME"
    echo "  DB User:         $DB_USER"
    echo ""
    echo "  Admin Email:     $ADMIN_USER_EMAIL"
    echo ""
    echo -e "${YELLOW}Directories to be created:${NC}"
    echo "  $INSTALL_DIR                     - Application"
    echo "  $INSTALL_DIR/backend/media       - Uploads"
    echo "  $INSTALL_DIR/backend/staticfiles - Static files"
    echo "  $INSTALL_DIR/backups             - Database backups"
    echo "  /var/log/tms                     - Logs"
    echo ""
    read -p "Continue with installation? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Installation cancelled"
        exit 0
    fi
}

# System updates and dependencies
install_dependencies() {
    print_step "Installing system dependencies..."
    
    apt-get update
    apt-get upgrade -y
    
    apt-get install -y \
        python3.11 \
        python3.11-venv \
        python3.11-dev \
        python3-pip \
        postgresql \
        postgresql-contrib \
        redis-server \
        nginx \
        certbot \
        python3-certbot-nginx \
        supervisor \
        git \
        curl \
        ufw \
        fail2ban \
        unattended-upgrades \
        libpq-dev \
        build-essential \
        libffi-dev \
        libssl-dev
    
    # Node.js 20 LTS
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
}

# Security: Firewall setup
configure_firewall() {
    print_step "Configuring firewall (UFW)..."
    
    ufw default deny incoming
    ufw default allow outgoing
    
    # SSH (rate limited)
    ufw limit ssh
    
    # HTTP/HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Enable firewall
    echo "y" | ufw enable
    ufw status
}

# Security: Fail2ban setup
configure_fail2ban() {
    print_step "Configuring Fail2ban..."
    
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = auto

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10

[tms-login]
enabled = true
port = http,https
filter = tms-login
logpath = /opt/tms/backend/logs/security.log
maxretry = 5
bantime = 1800
EOF

    # Custom TMS login filter
    cat > /etc/fail2ban/filter.d/tms-login.conf << 'EOF'
[Definition]
failregex = ^.*Failed login attempt.*IP: <HOST>.*$
            ^.*Rate limit exceeded.*IP: <HOST>.*$
            ^.*Failed MFA verification.*IP: <HOST>.*$
ignoreregex =
EOF

    systemctl enable fail2ban
    systemctl restart fail2ban
}

# Security: Automatic updates
configure_auto_updates() {
    print_step "Configuring automatic security updates..."
    
    cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

    systemctl enable unattended-upgrades
}

# Create service user
create_service_user() {
    print_step "Creating service user: $SERVICE_USER"
    
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -m -s /bin/bash "$SERVICE_USER"
    fi

    # Ensure the service user can manage its own crontab.
    # If /etc/cron.allow exists, only users listed there may use crontab.
    if [ -f /etc/cron.allow ]; then
        grep -qxF "$SERVICE_USER" /etc/cron.allow || echo "$SERVICE_USER" >> /etc/cron.allow
    fi
    # If /etc/cron.deny exists, make sure the service user is not listed there.
    if [ -f /etc/cron.deny ]; then
        sed -i "/^${SERVICE_USER}$/d" /etc/cron.deny
    fi
}

# PostgreSQL setup
setup_database() {
    print_step "Setting up PostgreSQL database..."
    
    # Configure PostgreSQL for security
    sudo -u postgres psql << EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
ALTER USER $DB_USER SET client_encoding TO 'utf8';
ALTER USER $DB_USER SET default_transaction_isolation TO 'read committed';
ALTER USER $DB_USER SET timezone TO 'Europe/Amsterdam';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

    # Secure PostgreSQL
    PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -1)
    if [ -f "$PG_HBA" ]; then
        # Only allow local connections
        sed -i 's/host    all             all             127.0.0.1\/32            md5/host    all             all             127.0.0.1\/32            scram-sha-256/' "$PG_HBA"
    fi
    
    systemctl restart postgresql
}

# Clone and setup application
setup_application() {
    print_step "Cloning and setting up application..."
    
    # Clone repository
    git clone "$REPO_URL" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Create directories with correct permissions
    print_step "Creating application directories..."
    
    mkdir -p "$INSTALL_DIR/backend/media"
    mkdir -p "$INSTALL_DIR/backend/staticfiles"
    mkdir -p "$INSTALL_DIR/backend/logs"
    mkdir -p "$INSTALL_DIR/backups"
    mkdir -p /var/log/tms
    mkdir -p /run/tms
    
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" /var/log/tms
    chown "$SERVICE_USER:www-data" /run/tms
    
    chmod 750 "$INSTALL_DIR/backend/media"
    chmod 755 "$INSTALL_DIR/backend/staticfiles"
    chmod 750 "$INSTALL_DIR/backend/logs"
    chmod 750 "$INSTALL_DIR/backups"
    chmod 750 /var/log/tms
    chmod 755 /run/tms
    
    cd "$INSTALL_DIR"
    
    # Create environment file with secure permissions
    cat > "$INSTALL_DIR/backend/.env" << EOF
# Django Settings
SECRET_KEY=$SECRET_KEY
DEBUG=False
ALLOWED_HOSTS=$DOMAIN,www.$DOMAIN
DJANGO_SETTINGS_MODULE=tms.settings.production

# Database
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_HOST=localhost
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379/1

# Security
SECURE_SSL_REDIRECT=$( [ "$USE_SSL" = "y" ] && echo "True" || echo "False" )
SESSION_COOKIE_SECURE=$( [ "$USE_SSL" = "y" ] && echo "True" || echo "False" )
CSRF_COOKIE_SECURE=$( [ "$USE_SSL" = "y" ] && echo "True" || echo "False" )

# CORS
CORS_ALLOWED_ORIGINS=$( [ "$USE_SSL" = "y" ] && echo "https://$DOMAIN" || echo "http://$DOMAIN" )

# Logging
LOG_DIR=$INSTALL_DIR/backend/logs
EOF

    # Secure the env file
    chmod 600 "$INSTALL_DIR/backend/.env"
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/backend/.env"
    
    # Backend setup
    cd "$INSTALL_DIR/backend"
    sudo -u "$SERVICE_USER" python3.11 -m venv venv
    sudo -u "$SERVICE_USER" ./venv/bin/pip install --upgrade pip
    sudo -u "$SERVICE_USER" ./venv/bin/pip install -r requirements/production.txt
    
    # Run migrations
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py migrate --noinput
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py collectstatic --noinput
    
    # Create admin user
    sudo -u "$SERVICE_USER" ./venv/bin/python manage.py shell << PYTHON_EOF
from apps.accounts.models import User
if not User.objects.filter(email='$ADMIN_USER_EMAIL').exists():
    User.objects.create_superuser(
        email='$ADMIN_USER_EMAIL',
        password='$ADMIN_PASSWORD',
        first_name='Admin',
        last_name='User'
    )
    print('Superuser created!')
else:
    print('Superuser already exists.')
PYTHON_EOF
    
    # Frontend setup
    cd "$INSTALL_DIR/frontend"
    
    # Create frontend env with correct API URL
    cat > "$INSTALL_DIR/frontend/.env" << EOF
VITE_API_URL=/api
EOF
    
    sudo -u "$SERVICE_USER" npm ci
    sudo -u "$SERVICE_USER" npm run build
}

# Nginx configuration
configure_nginx() {
    print_step "Configuring Nginx with security headers..."
    
    # Create webroot for certbot
    mkdir -p /var/www/certbot
    
    if [ "$USE_SSL" = "y" ]; then
        # HTTPS configuration
        cat > /etc/nginx/sites-available/tms << EOF
# Rate limiting zone
limit_req_zone \$binary_remote_addr zone=tms_limit:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_conn_zone \$binary_remote_addr zone=conn_limit:10m;

# Upstream for gunicorn
upstream tms_backend {
    server 127.0.0.1:8000 fail_timeout=0;
}

# HTTP server - only for certbot and redirect
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    
    # Allow certbot challenges
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://login.microsoftonline.com https://*.ciamlogin.com; frame-src 'self' https://login.microsoftonline.com https://*.ciamlogin.com; form-action 'self' https://login.microsoftonline.com https://*.ciamlogin.com; frame-ancestors 'self';" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    
    # Connection limits
    limit_conn conn_limit 20;
    
    # Client body size (for file uploads)
    client_max_body_size 10M;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;
    
    # Static files (frontend build)
    location / {
        root $INSTALL_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # API requests
    location /api {
        limit_req zone=api_limit burst=50 nodelay;
        
        proxy_pass http://tms_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Django admin (extra rate limiting)
    location /admin {
        limit_req zone=tms_limit burst=5 nodelay;
        
        proxy_pass http://tms_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # Media files
    location /media {
        alias $INSTALL_DIR/backend/media;
        
        # Prevent script execution in uploads
        location ~* \.(php|py|pl|cgi|sh|asp|aspx|jsp)$ {
            deny all;
        }
    }
    
    # Static files (Django)
    location /static {
        alias $INSTALL_DIR/backend/staticfiles;
    }
    
    # Block common attack patterns
    location ~* /(\.git|\.env|\.htaccess|\.htpasswd|wp-admin|wp-login|phpmyadmin) {
        deny all;
        return 404;
    }
    
    # Block file extensions
    location ~* \.(bak|config|sql|fla|psd|ini|log|sh|swp|dist)$ {
        deny all;
        return 404;
    }
}
EOF
    else
        # HTTP-only configuration (no SSL)
        cat > /etc/nginx/sites-available/tms << EOF
# Rate limiting zone
limit_req_zone \$binary_remote_addr zone=tms_limit:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_conn_zone \$binary_remote_addr zone=conn_limit:10m;

# Upstream for gunicorn
upstream tms_backend {
    server 127.0.0.1:8000 fail_timeout=0;
}

# HTTP server
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Connection limits
    limit_conn conn_limit 20;
    
    # Client body size (for file uploads)
    client_max_body_size 10M;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;
    
    # Static files (frontend build)
    location / {
        root $INSTALL_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
        
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # API requests
    location /api {
        limit_req zone=api_limit burst=50 nodelay;
        
        proxy_pass http://tms_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Django admin
    location /admin {
        limit_req zone=tms_limit burst=5 nodelay;
        
        proxy_pass http://tms_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # Media files
    location /media {
        alias $INSTALL_DIR/backend/media;
        
        location ~* \.(php|py|pl|cgi|sh|asp|aspx|jsp)$ {
            deny all;
        }
    }
    
    # Static files (Django)
    location /static {
        alias $INSTALL_DIR/backend/staticfiles;
    }
    
    # Block common attack patterns
    location ~* /(\.git|\.env|\.htaccess|\.htpasswd|wp-admin|wp-login|phpmyadmin) {
        deny all;
        return 404;
    }
}
EOF
    fi

    # Enable site
    ln -sf /etc/nginx/sites-available/tms /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test configuration (only if not using SSL yet - certs don't exist)
    if [ "$USE_SSL" != "y" ]; then
        nginx -t
    fi
}

# Supervisor configuration
configure_supervisor() {
    print_step "Configuring Supervisor for process management..."
    
    cat > /etc/supervisor/conf.d/tms.conf << EOF
[program:tms]
command=$INSTALL_DIR/backend/venv/bin/gunicorn tms.wsgi:application -b 127.0.0.1:8000 -w 4 --max-requests 1000 --max-requests-jitter 50 --timeout 30 --graceful-timeout 10 --keep-alive 5
directory=$INSTALL_DIR/backend
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/tms/gunicorn.log
stderr_logfile=/var/log/tms/gunicorn-error.log
environment=DJANGO_SETTINGS_MODULE="tms.settings.production"
EOF

    mkdir -p /var/log/tms
    chown "$SERVICE_USER:$SERVICE_USER" /var/log/tms
    
    supervisorctl reread
    supervisorctl update
}

# SSL certificate setup
setup_ssl() {
    if [ "$USE_SSL" != "y" ]; then
        print_step "Skipping SSL setup (disabled by user)"
        return
    fi
    
    print_step "Setting up SSL certificate with Let's Encrypt..."
    
    # Create webroot for certbot
    mkdir -p /var/www/certbot
    
    # Stop nginx temporarily to get certificate
    systemctl stop nginx || true
    
    # Get certificate using standalone mode (more reliable)
    certbot certonly --standalone \
        -d "$DOMAIN" \
        --email "$ADMIN_EMAIL" \
        --agree-tos \
        --non-interactive \
        --expand
    
    # Setup auto-renewal if requested
    if [ "$AUTO_RENEW_SSL" = "y" ]; then
        print_step "Setting up automatic SSL certificate renewal..."
        
        # Enable certbot timer
        systemctl enable certbot.timer
        systemctl start certbot.timer
        
        # Add renewal hook to restart nginx
        mkdir -p /etc/letsencrypt/renewal-hooks/deploy
        cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'HOOK_EOF'
#!/bin/bash
systemctl reload nginx
HOOK_EOF
        chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
        
        echo "  Auto-renewal configured (runs twice daily)"
    else
        print_warning "Auto-renewal disabled. Remember to renew manually!"
        echo "  Command: certbot renew"
    fi
    
    # Restart nginx with SSL
    systemctl start nginx
}

# Final security hardening
final_hardening() {
    print_step "Final security hardening..."
    
    # Secure SSH
    sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
    sed -i 's/#MaxAuthTries 6/MaxAuthTries 3/' /etc/ssh/sshd_config
    sed -i 's/#LoginGraceTime 2m/LoginGraceTime 60/' /etc/ssh/sshd_config
    
    # Disable unused network protocols
    echo "net.ipv6.conf.all.disable_ipv6 = 1" >> /etc/sysctl.conf 2>/dev/null || true
    echo "net.ipv4.conf.all.rp_filter = 1" >> /etc/sysctl.conf
    echo "net.ipv4.conf.default.rp_filter = 1" >> /etc/sysctl.conf
    echo "net.ipv4.icmp_echo_ignore_broadcasts = 1" >> /etc/sysctl.conf
    echo "net.ipv4.conf.all.accept_source_route = 0" >> /etc/sysctl.conf
    echo "net.ipv4.conf.default.accept_source_route = 0" >> /etc/sysctl.conf
    echo "net.ipv4.tcp_syncookies = 1" >> /etc/sysctl.conf
    sysctl -p 2>/dev/null || true
    
    # Set proper permissions
    chmod 750 "$INSTALL_DIR"
    chmod 640 "$INSTALL_DIR/backend/.env"
    
    # Secure logs
    chmod 750 "$INSTALL_DIR/backend/logs"
    
    # Secure media uploads directory
    chmod 750 "$INSTALL_DIR/backend/media"
    
    # Remove world-readable permissions from sensitive files
    find "$INSTALL_DIR/backend" -name "*.py" -exec chmod 640 {} \;
    find "$INSTALL_DIR/backend" -name "*.json" -exec chmod 640 {} \;
    
    systemctl restart sshd
}

# Save credentials
save_credentials() {
    print_step "Saving credentials..."
    
    CREDS_FILE="$INSTALL_DIR/CREDENTIALS.txt"
    
    if [ "$USE_SSL" = "y" ]; then
        URL_PREFIX="https"
    else
        URL_PREFIX="http"
    fi
    
    cat > "$CREDS_FILE" << EOF
╔════════════════════════════════════════════════════════════╗
║               TMS Installation Credentials                 ║
║           KEEP THIS FILE SECURE - DELETE AFTER BACKUP      ║
╚════════════════════════════════════════════════════════════╝

Application URL: $URL_PREFIX://$DOMAIN

Admin Account:
  Email:    $ADMIN_USER_EMAIL
  Password: [as entered during installation]

Service Account:
  User:     $SERVICE_USER

Database:
  Name:     $DB_NAME
  User:     $DB_USER
  Password: $DB_PASSWORD

Django Secret Key: $SECRET_KEY

SSL Certificate:
  Enabled:      $( [ "$USE_SSL" = "y" ] && echo "Yes" || echo "No" )
  Auto-renew:   $( [ "$AUTO_RENEW_SSL" = "y" ] && echo "Yes" || echo "No" )

Installation Directory: $INSTALL_DIR

Directory Permissions (owned by $SERVICE_USER):
  $INSTALL_DIR                     - Application files
  $INSTALL_DIR/backend/media       - Uploaded files
  $INSTALL_DIR/backend/staticfiles - Static assets
  $INSTALL_DIR/backups             - Database backups
  /var/log/tms                     - Application logs

Next Steps:
1. Configure SMTP settings in web interface:
   Instellingen → E-mail

2. IMPORTANT: Backup and then DELETE this file!
   cp $CREDS_FILE ~/tms-credentials-backup.txt
   rm $CREDS_FILE

Commands:
  tms-update              - Update to latest version
  tms-backup              - Create a backup
  supervisorctl status    - Check service status
  supervisorctl restart tms - Restart backend
  systemctl status nginx  - Check nginx status

Backups:
  Automatic daily backup at 02:00 (cron)
  Backup location: $INSTALL_DIR/backups/

Security Checklist:
  [ ] Delete this credentials file
$( [ "$USE_SSL" = "y" ] && echo "  [ ] Test SSL: https://www.ssllabs.com/ssltest/?d=$DOMAIN" )
  [ ] Verify firewall: ufw status
  [ ] Check fail2ban: fail2ban-client status
  [ ] Test health: curl $URL_PREFIX://$DOMAIN/api/health/

EOF

    chmod 600 "$CREDS_FILE"
    chown root:root "$CREDS_FILE"
}

# Create maintenance scripts
create_maintenance_scripts() {
    print_step "Creating maintenance scripts..."
    
    # Update script
    cat > /usr/local/bin/tms-update << EOF
#!/bin/bash
set -e
cd $INSTALL_DIR

echo "Updating TMS..."

# Pull latest code
sudo -u $SERVICE_USER git pull origin main

# Update backend
cd backend
sudo -u $SERVICE_USER ./venv/bin/pip install -r requirements/production.txt
sudo -u $SERVICE_USER ./venv/bin/python manage.py migrate --noinput
sudo -u $SERVICE_USER ./venv/bin/python manage.py collectstatic --noinput

# Update frontend
cd ../frontend
sudo -u $SERVICE_USER npm ci
sudo -u $SERVICE_USER npm run build

# Restart services
supervisorctl restart tms
systemctl reload nginx

echo "TMS updated successfully!"
EOF
    chmod +x /usr/local/bin/tms-update
    
    # Backup script
    cat > /usr/local/bin/tms-backup << EOF
#!/bin/bash
BACKUP_DIR="$INSTALL_DIR/backups"
TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
mkdir -p "\$BACKUP_DIR"

echo "Creating backup..."

# Backup database
PGPASSWORD=$DB_PASSWORD pg_dump -h localhost -U $DB_USER $DB_NAME > "\$BACKUP_DIR/db_\$TIMESTAMP.sql"

# Backup media
tar -czf "\$BACKUP_DIR/media_\$TIMESTAMP.tar.gz" -C $INSTALL_DIR/backend media/

# Set correct ownership
chown $SERVICE_USER:$SERVICE_USER "\$BACKUP_DIR"/*

# Keep only last 7 backups
find "\$BACKUP_DIR" -type f -mtime +7 -delete

echo "Backup completed: \$BACKUP_DIR"
ls -la "\$BACKUP_DIR"
EOF
    chmod +x /usr/local/bin/tms-backup
    
    # Setup daily backups (cron)
    (crontab -l 2>/dev/null | grep -v "tms-backup"; echo "0 2 * * * /usr/local/bin/tms-backup >> /var/log/tms/backup.log 2>&1") | crontab -
}

# Main installation
main() {
    print_header
    check_root
    check_ubuntu_version
    get_user_input
    
    install_dependencies
    configure_firewall
    configure_fail2ban
    configure_auto_updates
    create_service_user
    setup_database
    setup_application
    configure_nginx
    configure_supervisor
    
    # For SSL, we need to get cert first, then start nginx
    if [ "$USE_SSL" = "y" ]; then
        setup_ssl
        # Now test and start nginx with SSL config
        nginx -t
        systemctl start nginx
    else
        systemctl start nginx
    fi
    
    supervisorctl start tms
    
    final_hardening
    create_maintenance_scripts
    save_credentials
    
    # Determine URL
    if [ "$USE_SSL" = "y" ]; then
        FINAL_URL="https://$DOMAIN"
    else
        FINAL_URL="http://$DOMAIN"
    fi
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Installation Complete!                           ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Your TMS is running at: ${BLUE}$FINAL_URL${NC}"
    echo ""
    echo -e "Admin login: ${YELLOW}$ADMIN_USER_EMAIL${NC}"
    echo ""
    echo -e "${YELLOW}Service Account:${NC}"
    echo "  User:        $SERVICE_USER"
    echo "  Services:    Gunicorn runs as $SERVICE_USER"
    echo ""
    echo -e "${YELLOW}Database:${NC}"
    echo "  Name:        $DB_NAME"
    echo "  User:        $DB_USER"
    echo ""
    if [ "$USE_SSL" = "y" ]; then
        echo -e "${YELLOW}SSL Certificate:${NC}"
        echo "  Status:      Active"
        echo "  Auto-renew:  $( [ "$AUTO_RENEW_SSL" = "y" ] && echo "Enabled" || echo "Disabled" )"
        echo ""
    fi
    echo -e "${YELLOW}Directories (owned by $SERVICE_USER):${NC}"
    echo "  $INSTALL_DIR                     - Application"
    echo "  $INSTALL_DIR/backend/media       - Uploads"
    echo "  $INSTALL_DIR/backups             - Backups"
    echo "  /var/log/tms                     - Logs"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  tms-update              - Update to latest version"
    echo "  tms-backup              - Create a backup"
    echo "  supervisorctl status    - Check service status"
    echo ""
    echo -e "${RED}IMPORTANT: Read and then delete:${NC}"
    echo "  $INSTALL_DIR/CREDENTIALS.txt"
    echo ""
}

main "$@"
