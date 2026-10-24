import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.production')
django.setup()

from django.conf import settings  # noqa: E402

from apps.geoblocking import services  # noqa: E402
from apps.geoblocking.models import GeoBlockSettings  # noqa: E402

services.reset_reader()
print('-> database aanwezig :', services.database_available())
print('-> noodrem-IPs       :', getattr(settings, 'GEOBLOCK_BYPASS_IPS', '') or '<geen>')

for ip, wat in (
    ('62.45.106.191', 'jouw eigen IP'),
    ('217.247.0.1', 'Duitsland'),
    ('81.246.0.1', 'Belgie'),
    ('8.8.8.8', 'Verenigde Staten'),
):
    print(f'-> {ip:<16} {wat:<18} land: {services.lookup_country(ip)}')

s = GeoBlockSettings.objects.get(pk=1)
print(f'-> instellingen      : actief={s.enabled} modus={s.mode} standaard={s.default_action}')
