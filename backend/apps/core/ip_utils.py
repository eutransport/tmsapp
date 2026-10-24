"""
Betrouwbare bepaling van het client-IP achter reverse proxies.

Waarom dit bestaat
------------------
De naïeve aanpak ``X-Forwarded-For.split(',')[0]`` is onveilig: die header
wordt door de client meegestuurd en kan dus vrij worden verzonnen. Voor
logging is dat vervelend, voor geo-blocking is het fataal - een aanvaller zet
simpelweg ``X-Forwarded-For: 1.2.3.4`` en doet zich voor als Nederlands.

Deze module leest de XFF-keten van rechts naar links en negeert daarbij de
adressen van proxies die we zelf vertrouwen. Het eerste adres dat niet van een
vertrouwde proxy komt, is het echte client-IP.

Configuratie (settings):
    TRUSTED_PROXIES      lijst met CIDR's van eigen proxies (nginx, NPM, docker)
    TRUSTED_PROXY_DEPTH  alternatief: aantal proxies voor de applicatie
"""
import ipaddress
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Netwerken die per definitie van onze eigen infrastructuur komen.
_DEFAULT_TRUSTED = (
    '127.0.0.0/8',
    '::1/128',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    'fc00::/7',
)


def _parse_networks(values):
    networks = []
    for value in values or ():
        try:
            networks.append(ipaddress.ip_network(str(value).strip(), strict=False))
        except ValueError:
            logger.warning('Ongeldige CIDR in TRUSTED_PROXIES genegeerd: %r', value)
    return networks


def _trusted_networks():
    configured = getattr(settings, 'TRUSTED_PROXIES', None)
    if configured is None:
        configured = _DEFAULT_TRUSTED
    return _parse_networks(configured)


def parse_ip(value):
    """Zet een string om naar een ip_address, of None bij onzin."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    # IPv6-adressen kunnen tussen blokhaken staan, eventueel met poort.
    if text.startswith('['):
        text = text[1:].split(']', 1)[0]
    elif text.count(':') == 1 and '.' in text:
        # IPv4 met poort, bijvoorbeeld 203.0.113.5:51234
        text = text.split(':', 1)[0]
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def is_trusted_proxy(ip):
    """Komt dit adres van onze eigen proxy-infrastructuur?"""
    address = ip if isinstance(ip, (ipaddress.IPv4Address, ipaddress.IPv6Address)) else parse_ip(ip)
    if address is None:
        return False
    return any(address in network for network in _trusted_networks())


def is_private_ip(ip):
    """Loopback, link-local of RFC1918 - nooit geo-blokkeren."""
    address = ip if isinstance(ip, (ipaddress.IPv4Address, ipaddress.IPv6Address)) else parse_ip(ip)
    if address is None:
        return False
    return address.is_private or address.is_loopback or address.is_link_local


def get_client_ip(request):
    """
    Geef het echte client-IP als string, of een lege string als het onbekend is.

    De XFF-keten wordt van rechts naar links gelezen. Adressen van vertrouwde
    proxies worden overgeslagen; het eerste niet-vertrouwde adres wint. Zo kan
    een client geen IP vervalsen: wat hij zelf meestuurt staat altijd links van
    wat onze eigen proxy heeft toegevoegd.
    """
    remote_addr = parse_ip(request.META.get('REMOTE_ADDR'))

    # Als het directe verbindingsadres geen vertrouwde proxy is, mogen we de
    # XFF-header niet geloven: die komt dan rechtstreeks van de client.
    if remote_addr is not None and not is_trusted_proxy(remote_addr):
        return str(remote_addr)

    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    chain = [parse_ip(part) for part in forwarded.split(',')] if forwarded else []
    chain = [address for address in chain if address is not None]

    depth = getattr(settings, 'TRUSTED_PROXY_DEPTH', None)
    if depth:
        # Expliciet aantal proxies: tel dat aantal vanaf rechts terug.
        index = len(chain) - int(depth)
        if 0 <= index < len(chain):
            return str(chain[index])

    for address in reversed(chain):
        if not is_trusted_proxy(address):
            return str(address)

    # Alleen vertrouwde adressen in de keten (bijvoorbeeld interne healthchecks).
    if chain:
        return str(chain[0])

    real_ip = parse_ip(request.META.get('HTTP_X_REAL_IP'))
    if real_ip is not None:
        return str(real_ip)

    return str(remote_addr) if remote_addr is not None else ''
