"""
GeoIP-opzoeken en het beoordelen van regels.

De MaxMind GeoLite2-Country database wordt één keer per proces geopend en
daarna hergebruikt. Losse opzoekingen worden kort gecachet, zodat een druk
bezochte sessie niet per request de database raakt.

Belangrijk uitgangspunt: als er iets misgaat (database ontbreekt, bestand
corrupt) blokkeren we niets. Een kapotte geo-database mag nooit het hele
bedrijf buitensluiten.
"""
import ipaddress
import logging
import os
import threading

from django.conf import settings
from django.core.cache import cache

from apps.core.ip_utils import is_private_ip, parse_ip

from .models import (
    COUNTRY_ANY,
    EnforcementMode,
    GeoBlockSettings,
    GeoRule,
    IPRule,
    ROLE_ANONYMOUS,
    ROLE_ANY,
    RuleAction,
)

logger = logging.getLogger(__name__)

_reader = None
_reader_path = None
_reader_lock = threading.Lock()

COUNTRY_CACHE_PREFIX = 'geoblock:country:'
COUNTRY_CACHE_TTL = 3600
RULES_CACHE_KEY = 'geoblock:rules:v1'
RULES_CACHE_TTL = 60

UNKNOWN_COUNTRY = ''


def get_database_path():
    return getattr(
        settings,
        'GEOIP_DATABASE_PATH',
        os.path.join(getattr(settings, 'BASE_DIR', '.'), 'geoip', 'GeoLite2-Country.mmdb'),
    )


def database_available():
    path = get_database_path()
    return bool(path) and os.path.exists(path)


def _get_reader():
    """Open de mmdb-database lui en hergebruik de reader."""
    global _reader, _reader_path

    path = get_database_path()
    if not path or not os.path.exists(path):
        return None

    with _reader_lock:
        if _reader is not None and _reader_path == path:
            return _reader
        try:
            import geoip2.database
        except ImportError:
            logger.warning('geoip2 is niet geïnstalleerd; geo-blocking doet niets.')
            return None
        try:
            if _reader is not None:
                try:
                    _reader.close()
                except Exception:
                    pass
            _reader = geoip2.database.Reader(path)
            _reader_path = path
        except Exception as exc:
            logger.error('Kan GeoIP-database niet openen (%s): %s', path, exc)
            _reader = None
            _reader_path = None
        return _reader


def reset_reader():
    """Sluit de reader, zodat een nieuwe database wordt opgepakt na update."""
    global _reader, _reader_path
    with _reader_lock:
        if _reader is not None:
            try:
                _reader.close()
            except Exception:
                pass
        _reader = None
        _reader_path = None


def lookup_country(ip):
    """
    Geef de ISO-landcode voor een IP, of een lege string als die onbekend is.

    Privé-adressen hebben per definitie geen land.
    """
    address = parse_ip(ip)
    if address is None or is_private_ip(address):
        return UNKNOWN_COUNTRY

    cache_key = f'{COUNTRY_CACHE_PREFIX}{address}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    country = UNKNOWN_COUNTRY
    reader = _get_reader()
    if reader is not None:
        try:
            country = (reader.country(str(address)).country.iso_code or '').upper()
        except Exception:
            # AddressNotFoundError en alles wat er verder misgaat: onbekend land.
            country = UNKNOWN_COUNTRY

    cache.set(cache_key, country, COUNTRY_CACHE_TTL)
    return country


def _load_rules():
    """Haal actieve regels op, kort gecachet om database-druk te vermijden."""
    cached = cache.get(RULES_CACHE_KEY)
    if cached is not None:
        return cached

    ip_rules = []
    for rule in IPRule.objects.filter(active=True):
        try:
            network = ipaddress.ip_network(rule.cidr.strip(), strict=False)
        except ValueError:
            logger.warning('Ongeldige CIDR in IP-regel %s: %r', rule.pk, rule.cidr)
            continue
        ip_rules.append((network, rule.action, rule.label or rule.cidr))

    # Specifieke netwerken eerst, zodat /32 wint van /24.
    ip_rules.sort(key=lambda item: item[0].prefixlen, reverse=True)

    geo_rules = [
        (rule.country_code, rule.role, rule.action, rule.priority)
        for rule in GeoRule.objects.filter(active=True).order_by('priority', 'country_code')
    ]

    data = {'ip_rules': ip_rules, 'geo_rules': geo_rules}
    cache.set(RULES_CACHE_KEY, data, RULES_CACHE_TTL)
    return data


def invalidate_rules_cache():
    cache.delete(RULES_CACHE_KEY)


def _match_ip_rules(address, ip_rules):
    if address is None:
        return None
    for network, action, label in ip_rules:
        if address.version == network.version and address in network:
            return action, f'IP-regel {label}'
    return None


def _rule_specificity(country_code, role):
    """Specifiekere regels wegen zwaarder dan algemene."""
    score = 0
    if country_code != COUNTRY_ANY:
        score += 2
    if role != ROLE_ANY:
        score += 1
    return score


def _match_geo_rules(country, role, geo_rules):
    best = None
    best_key = None
    for rule_country, rule_role, action, priority in geo_rules:
        if rule_country != COUNTRY_ANY and rule_country != (country or ''):
            continue
        if rule_role != ROLE_ANY and rule_role != role:
            continue
        key = (priority, -_rule_specificity(rule_country, rule_role))
        if best_key is None or key < best_key:
            best_key = key
            best = (action, f'Regel {rule_country}/{rule_role}')
    return best


def evaluate(ip, role, config=None):
    """
    Bepaal of een verzoek door mag.

    Geeft een dict terug met de uitkomst. ``allowed`` is wat er daadwerkelijk
    moet gebeuren; ``would_block`` geeft aan dat de regels blokkeren maar dat
    we in monitormodus staan.
    """
    config = config or GeoBlockSettings.load()
    address = parse_ip(ip)

    result = {
        'allowed': True,
        'would_block': False,
        'country': UNKNOWN_COUNTRY,
        'reason': '',
        'role': role,
    }

    if not config.enabled:
        result['reason'] = 'Geo-blocking staat uit'
        return result

    # Intern verkeer (healthchecks, celery, docker-netwerk) nooit blokkeren.
    if address is None:
        result['reason'] = 'Geen IP vastgesteld'
        return result
    if is_private_ip(address):
        result['reason'] = 'Intern netwerk'
        return result

    rules = _load_rules()
    country = lookup_country(address)
    result['country'] = country

    decision = _match_ip_rules(address, rules['ip_rules'])

    if decision is None:
        if not country:
            if config.block_unknown_country:
                decision = (RuleAction.BLOCK, 'Onbekend land')
            else:
                result['reason'] = 'Onbekend land toegestaan'
                return result
        else:
            decision = _match_geo_rules(country, role, rules['geo_rules'])

    if decision is None:
        decision = (config.default_action, 'Standaardactie')

    action, reason = decision
    result['reason'] = reason

    if action == RuleAction.BLOCK:
        if config.mode == EnforcementMode.MONITOR:
            result['would_block'] = True
            result['allowed'] = True
        else:
            result['allowed'] = False

    return result


def role_for_user(user):
    """Vertaal een gebruiker naar de rolwaarde die in regels wordt gebruikt."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return ROLE_ANONYMOUS
    return getattr(user, 'rol', None) or ROLE_ANONYMOUS
