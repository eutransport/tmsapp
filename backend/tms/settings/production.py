"""
Django settings for TMS project - Production settings.
"""
import os
import logging
from django.core.exceptions import ImproperlyConfigured
from .base import *

DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost').split(',')

# Database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='tms_db'),
        'USER': config('DB_USER', default='tms_user'),
        'PASSWORD': config('DB_PASSWORD'),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5432'),
        'CONN_MAX_AGE': 60,
        'OPTIONS': {
            'connect_timeout': 10,
        },
    }
}

# Security settings
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=False, cast=bool)
SESSION_COOKIE_SECURE = config('SESSION_COOKIE_SECURE', default=True, cast=bool)
CSRF_COOKIE_SECURE = config('CSRF_COOKIE_SECURE', default=True, cast=bool)
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'

# Trust proxy headers (for nginx)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True

# CORS settings
cors_origins = config('CORS_ALLOWED_ORIGINS', default='')
CORS_ALLOWED_ORIGINS = [o.strip() for o in cors_origins.split(',') if o.strip()]
CORS_ALLOW_CREDENTIALS = True

# Cache — REDIS_URL is required in production. Failing fast is safer than
# silently falling back to a per-process in-memory cache, which would break
# sessions, throttling and login rate-limits across gunicorn workers.
REDIS_URL = config('REDIS_URL', default='')
if not REDIS_URL:
    raise ImproperlyConfigured(
        'REDIS_URL environment variable is required in production. '
        'Set it via .env or docker-compose (e.g. redis://:<pw>@redis:6379/1).'
    )
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': REDIS_URL,
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
        }
    }
}

# Email - Production SMTP
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = config('EMAIL_HOST', default='')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='noreply@example.com')

# Static files
STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.ManifestStaticFilesStorage'

# Celery Configuration — CELERY_BROKER_URL comes from env (compose sets it to
# redis://:<pw>@redis:6379/0). Fall back to REDIS_URL, which is now mandatory.
CELERY_BROKER_URL = config('CELERY_BROKER_URL', default=REDIS_URL)
CELERY_RESULT_BACKEND = config('CELERY_RESULT_BACKEND', default=CELERY_BROKER_URL)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE if 'TIME_ZONE' in dir() else 'Europe/Amsterdam'
# CELERY_BEAT_SCHEDULE is inherited from base.py — do not override here

# Logging - Production (console only for Docker compatibility)
# Docker captures stdout/stderr automatically, no file logging needed
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
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
    },
}


# ----------------------------------------------------------------------------
# Sentry error tracking (opt-in via SENTRY_DSN env var)
# ----------------------------------------------------------------------------
# Leave SENTRY_DSN empty to disable. When set, exceptions and 5xx responses
# are reported to the configured Sentry / GlitchTip instance.
SENTRY_DSN = config('SENTRY_DSN', default='')
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[
                DjangoIntegration(),
                CeleryIntegration(),
                LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
            ],
            environment=config('SENTRY_ENVIRONMENT', default='production'),
            release=config('SENTRY_RELEASE', default=None),
            traces_sample_rate=config('SENTRY_TRACES_SAMPLE_RATE', default=0.0, cast=float),
            send_default_pii=False,
        )
    except Exception as exc:  # pragma: no cover - never break boot on Sentry failure
        logging.getLogger(__name__).warning('Sentry init failed: %s', exc)


# ----------------------------------------------------------------------------
# Content Security Policy (django-csp) — REPORT-ONLY
# ----------------------------------------------------------------------------
# Runs in report-only mode: the browser sends violation reports (if a report
# endpoint is configured) but does NOT block anything. This lets us collect
# real-world CSP violations without breaking pages. Flip to enforcing mode
# by setting CSP_REPORT_ONLY=false after reviewing reports.
try:
    _csp_installed = 'csp.middleware.CSPMiddleware' not in MIDDLEWARE
    if _csp_installed:
        # Append near the end so it wraps all responses.
        MIDDLEWARE = MIDDLEWARE + ['csp.middleware.CSPMiddleware']

    CSP_REPORT_ONLY = config('CSP_REPORT_ONLY', default=True, cast=bool)
    # Match the permissive policy nginx currently ships so we don't create
    # violations for legitimate app behavior.
    CSP_DEFAULT_SRC = ("'self'",)
    CSP_SCRIPT_SRC = ("'self'", "'unsafe-inline'", "'unsafe-eval'")
    CSP_STYLE_SRC = ("'self'", "'unsafe-inline'", 'https://fonts.googleapis.com')
    CSP_FONT_SRC = ("'self'", 'data:', 'https://fonts.gstatic.com')
    CSP_IMG_SRC = ("'self'", 'data:', 'blob:', 'https:')
    CSP_CONNECT_SRC = ("'self'", 'https:', 'wss:')
    CSP_FRAME_ANCESTORS = ("'self'",)
    CSP_OBJECT_SRC = ("'none'",)
    CSP_BASE_URI = ("'self'",)
    CSP_FORM_ACTION = ("'self'",)
    _report_uri = config('CSP_REPORT_URI', default='')
    if _report_uri:
        CSP_REPORT_URI = _report_uri
except Exception as exc:  # pragma: no cover
    logging.getLogger(__name__).warning('CSP configuration skipped: %s', exc)
