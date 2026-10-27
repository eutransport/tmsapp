"""
Django settings for TMS project - Base settings.
"""
import os
from datetime import timedelta
from pathlib import Path

from decouple import config

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
# No default value - app will crash if SECRET_KEY is not set in environment
SECRET_KEY = config('SECRET_KEY')

# Application definition
DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
]

LOCAL_APPS = [
    'apps.core',
    'apps.accounts',
    'apps.companies',
    'apps.drivers',
    'apps.fleet',
    'apps.timetracking',
    'apps.planning',
    'apps.invoicing',
    'apps.invoicing.ocr',
    'apps.invoicing.email_import',
    'apps.leave',
    'apps.notifications',
    'apps.documents',
    'apps.dossiers',
    'apps.spreadsheets',
    'apps.maintenance',
    'apps.licensing',
    'apps.tracking',
    'apps.banking',
    'apps.reports',
    'apps.chatbot',
    'apps.pakmiddelen',
    'apps.tasks',
    'apps.loadlist',
    'apps.tolling',
    'apps.opdrachten',
    'apps.geoblocking',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'tms.middleware.OpdrachtgeverScopeMiddleware',
    'tms.middleware.LastActivityMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'apps.core.upload_validation.FileUploadValidationMiddleware',
    'apps.geoblocking.middleware.GeoBlockMiddleware',
    'apps.licensing.middleware.LicenseMiddleware',
]

# Allow embedding in iframes from same origin (needed for PDF preview)
X_FRAME_OPTIONS = 'SAMEORIGIN'

ROOT_URLCONF = 'tms.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'tms.wsgi.application'

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Custom User Model
AUTH_USER_MODEL = 'accounts.User'

# Internationalization
LANGUAGE_CODE = 'nl-nl'
TIME_ZONE = 'Europe/Amsterdam'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']

# Media files (Uploads)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ===========================================
# Geo-blocking
# ===========================================
# Pad naar de MaxMind GeoLite2-Country database. Ophalen/bijwerken met:
#   python manage.py update_geoip_db
GEOIP_DATABASE_PATH = config(
    'GEOIP_DATABASE_PATH',
    default=str(BASE_DIR / 'geoip' / 'GeoLite2-Country.mmdb'),
)
MAXMIND_LICENSE_KEY = config('MAXMIND_LICENSE_KEY', default='')
MAXMIND_ACCOUNT_ID = config('MAXMIND_ACCOUNT_ID', default='')

# Netwerken van onze eigen reverse proxies. Alleen aan deze hosts geloven we
# de X-Forwarded-For header; anders kan een client zijn herkomst vervalsen.
TRUSTED_PROXIES = [
    p.strip()
    for p in config(
        'TRUSTED_PROXIES',
        default='127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7',
    ).split(',')
    if p.strip()
]

# Noodrem: deze adressen worden nooit geo-geblokkeerd. Houd hier je eigen
# vaste IP in, zodat je jezelf niet kunt buitensluiten.
GEOBLOCK_BYPASS_IPS = config('GEOBLOCK_BYPASS_IPS', default='')

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'apps.core.pagination.SafePageNumberPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    # Rate Limiting / Throttling
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '500/hour',          # Anonymous users: 500 requests per hour
        'user': '10000/hour',        # Authenticated users: 10000 requests per hour
        'login': '10/minute',        # Login attempts: 10 per minute
        'registration': '3/hour',    # Registration: 3 per hour per IP
        'password_reset': '5/hour',  # Password reset: 5 per hour
        'mfa_verify': '20/minute',   # MFA verification: 20 per minute
        'burst': '120/minute',       # Burst protection: 120 per minute
        'document_email': '20/hour', # Document email: 20 per hour
        'document_sign': '60/hour',  # Document signing: 60 per hour
        'email_import': '30/hour',   # Email import fetch: 30 per hour
        'loadlist_upload': '20/hour',   # Load-list photo upload (OCR + LLM cost)
        'loadlist_optimize': '60/hour', # Route optimization
        'loadlist_suggest': '120/hour', # Address autocomplete
        'tracking_submit': '120/minute', # GPS position submissions
        'tracking_read': '60/minute',    # Map polling / telematics reads
        'radius_sync': '10/hour',        # Handmatige Radius-sync (zware externe call)
        'radius_export': '30/hour',      # Archief-export naar CSV/Excel/PDF
        'radius_connection': '120/hour',     # Koppelingen aanmaken en wijzigen
        'radius_connection_test': '20/hour',  # Live tokencontrole bij Radius
        'navixy_connection': '120/hour',      # Navixy-koppelingen en trackers beheren
        'navixy_connection_test': '20/hour',  # Live sleutelcontrole bij Navixy
        'tolling_factuur_import': '20/hour',  # Radius-factuur inlezen (PDF parsen)
        'tolling_backup': '30/hour',          # Tolbackup maken of terugzetten
        'rdw_lookup': '300/hour',        # Kenteken opzoeken tijdens het typen
        'rdw_sync': '60/hour',           # Vloot bijwerken bij de RDW
    },
}

# Simple JWT Settings
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# ===========================================
# Microsoft Entra External ID (externe gebruikers)
# ===========================================
# Externe mensen loggen in bij Microsoft met hun eigen e-mailadres. Wij
# controleren alleen hun token en geven daarna ons eigen JWT uit, zodat rol en
# module_permissions ongewijzigd blijven werken.
#
# Er zijn twee soorten tenants en ze gebruiken een ander inlogadres:
#
#   workforce  - de gewone Entra ID-tenant van het bedrijf. Externen nodig je
#                uit als gast (B2B). Inlogadres: login.microsoftonline.com,
#                herkend aan ENTRA_TENANT_ID.
#   external   - een aparte Entra External ID-tenant (CIAM) voor klanten.
#                Inlogadres: <naam>.ciamlogin.com, herkend aan
#                ENTRA_TENANT_NAME.
#
# Zolang ENTRA_CLIENT_ID leeg is, staat de koppeling uit en verandert er niets
# aan het inloggen.
ENTRA_TENANT_TYPE = config('ENTRA_TENANT_TYPE', default='workforce').strip().lower()
ENTRA_TENANT_NAME = config('ENTRA_TENANT_NAME', default='')
ENTRA_TENANT_ID = config('ENTRA_TENANT_ID', default='')
ENTRA_CLIENT_ID = config('ENTRA_CLIENT_ID', default='')

# Alleen deze domeinen mogen binnenkomen. Leeg betekent: geen beperking op
# domein, de uitnodiging in Entra bepaalt wie er is.
ENTRA_ALLOWED_EMAIL_DOMAINS = [
    d.strip().lower()
    for d in config('ENTRA_ALLOWED_EMAIL_DOMAINS', default='').split(',')
    if d.strip()
]

# Mag een onbekend e-mailadres automatisch een account krijgen? Standaard niet:
# dan moet een beheerder de gebruiker eerst aanmaken. Dat voorkomt dat iedereen
# die zich bij Microsoft registreert ook meteen in de applicatie staat.
ENTRA_AUTO_CREATE_USERS = config('ENTRA_AUTO_CREATE_USERS', default=False, cast=bool)
ENTRA_DEFAULT_ROLE = config('ENTRA_DEFAULT_ROLE', default='opdrachtgever')

# Een external tenant heeft de naam nodig, een werknemers-tenant de id.
ENTRA_ENABLED = bool(
    ENTRA_CLIENT_ID
    and (ENTRA_TENANT_NAME if ENTRA_TENANT_TYPE == 'external' else ENTRA_TENANT_ID)
)

# DRF Spectacular (API Documentation)
SPECTACULAR_SETTINGS = {
    'TITLE': 'TMS API',
    'DESCRIPTION': 'Transport Management Systeem API',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
        'security': {
            'format': '{asctime} [{levelname}] {name} - {message}',
            'style': '{',
        },
        'audit': {
            'format': '{asctime} | {levelname} | {name} | {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'django.log',
            'formatter': 'verbose',
            'maxBytes': 10 * 1024 * 1024,  # 10MB
            'backupCount': 5,
        },
        'security_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'security.log',
            'formatter': 'security',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 5,
        },
        'audit_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'audit.log',
            'formatter': 'audit',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 5,
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console', 'file'],
            'level': config('DJANGO_LOG_LEVEL', default='INFO'),
            'propagate': False,
        },
        'accounts.security': {
            'handlers': ['console', 'security_file'],
            'level': 'INFO',
            'propagate': False,
        },
        'apps.leave.audit': {
            'handlers': ['console', 'audit_file', 'security_file'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# Create logs directory if it doesn't exist
LOGS_DIR = BASE_DIR / 'logs'
LOGS_DIR.mkdir(exist_ok=True)
