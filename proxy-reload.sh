#!/bin/bash
# =========================================
# Reverse proxy opnieuw laten verwijzen naar de containers
#
# Nginx Proxy Manager zoekt de IP-adressen van tms_backend/tms_frontend
# eenmalig op bij het laden van zijn configuratie. Krijgt een container na
# een rebuild een nieuw IP, dan blijft de proxy het oude adres gebruiken en
# geeft hij 502 op /api — terwijl de containers zelf "healthy" melden.
#
# Een nginx-reload lost dat op. Draai dit na elke rebuild van backend of
# frontend. docker-update.sh roept het automatisch aan.
# =========================================
set -uo pipefail

PROXY_CONTAINER="${PROXY_CONTAINER:-tms_npm}"
PUBLIC_URL="${PUBLIC_URL:-https://tms.moveo-bv.nl}"

if ! docker ps --format '{{.Names}}' | grep -qx "$PROXY_CONTAINER"; then
    echo "WAARSCHUWING: proxycontainer '$PROXY_CONTAINER' draait niet — reload overgeslagen"
    exit 0
fi

echo "Reverse proxy ($PROXY_CONTAINER) herladen..."
if docker exec "$PROXY_CONTAINER" nginx -s reload >/dev/null 2>&1; then
    echo "OK: proxy herladen"
else
    echo "WAARSCHUWING: nginx -s reload mislukte — probeer: docker restart $PROXY_CONTAINER"
    exit 1
fi

# Controleer dat de API publiek bereikbaar is (niet alleen van binnenuit)
API_STATUS="000"
for _ in $(seq 1 10); do
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$PUBLIC_URL/api/health/" 2>/dev/null)
    [ -z "$API_STATUS" ] && API_STATUS="000"
    [ "$API_STATUS" = "200" ] && break
    sleep 2
done

if [ "$API_STATUS" = "200" ]; then
    echo "OK: $PUBLIC_URL/api/health/ geeft HTTP 200"
else
    echo "FOUT: $PUBLIC_URL/api/health/ geeft HTTP $API_STATUS"
    echo "      De app is publiek onbereikbaar, ook al draaien de containers."
    echo "      Probeer: docker restart $PROXY_CONTAINER"
    exit 1
fi
