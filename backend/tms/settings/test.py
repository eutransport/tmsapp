"""
Instellingen voor het draaien van de testsuite.

Tabellen worden rechtstreeks uit de modellen aangemaakt in plaats van via de
migratieketen. Dat maakt tests snel en onafhankelijk van historische
migratieproblemen in losse apps.
"""
from .base import *  # noqa: F401,F403

DEBUG = False

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}


class _ZonderMigraties:
    def __contains__(self, item):
        return True

    def __getitem__(self, item):
        return None


MIGRATION_MODULES = _ZonderMigraties()

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}

# De licentiecontrole weigert elk /api/-verzoek zolang er geen licentie in de
# database staat. In tests is die er nooit, waardoor elke API-test een 403 kreeg
# in plaats van het gedrag dat getest wordt.
MIDDLEWARE = [m for m in MIDDLEWARE if m != 'apps.licensing.middleware.LicenseMiddleware']  # noqa: F405

CELERY_TASK_ALWAYS_EAGER = True
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
