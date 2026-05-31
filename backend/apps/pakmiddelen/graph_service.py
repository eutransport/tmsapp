"""
Microsoft Graph mail service for the pakmiddelen module.

Uses OAuth2 client_credentials (app-only) against Microsoft Entra ID to
obtain a token with the `https://graph.microsoft.com/.default` scope and
then reads the configured mailbox via the Graph REST API.

Required app permission: Mail.ReadWrite (or Mail.Read + Mail.ReadWrite for
mark-as-read). Admin consent must be granted in the tenant.

Security notes:
- Client secret is stored encrypted (`EncryptedCharField`) and never returned
  via the API.
- Tokens are kept in-process only; cached per ``ImapClient`` lifetime is not
  implemented because the use-case is short-lived (one scan).
- All HTTP calls use a 30s timeout.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable
from urllib.parse import quote

import requests

from .imap_service import (
    FetchedMail,
    ImapServiceError,
    build_subject_pattern,
)

logger = logging.getLogger(__name__)

GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
LOGIN_BASE = 'https://login.microsoftonline.com'
HTTP_TIMEOUT = 30
MAX_PAGES = 20  # safety: cap pagination at 20 * 50 = 1000 messages


class GraphServiceError(ImapServiceError):
    """Raised on any Microsoft Graph related failure."""


def _require(value: str | None, name: str) -> str:
    v = (value or '').strip()
    if not v:
        raise GraphServiceError(f'Microsoft Graph: {name} ontbreekt.')
    return v


@dataclass
class _AccessToken:
    value: str
    expires_at: datetime


def get_access_token(config) -> _AccessToken:
    tenant = _require(config.graph_tenant_id, 'Tenant ID')
    client_id = _require(config.graph_client_id, 'Client ID')
    secret = _require(config.graph_client_secret, 'Client Secret')

    url = f'{LOGIN_BASE}/{quote(tenant, safe="-")}/oauth2/v2.0/token'
    data = {
        'grant_type': 'client_credentials',
        'client_id': client_id,
        'client_secret': secret,
        'scope': 'https://graph.microsoft.com/.default',
    }
    try:
        resp = requests.post(url, data=data, timeout=HTTP_TIMEOUT)
    except requests.RequestException as exc:
        raise GraphServiceError(f'Geen verbinding met Microsoft login: {exc}') from exc
    if resp.status_code != 200:
        try:
            payload = resp.json()
        except ValueError:
            payload = {'error': resp.text[:300]}
        desc = payload.get('error_description') or payload.get('error') or resp.text[:300]
        # Strip newlines for clean UI display
        desc = re.sub(r'\s+', ' ', str(desc)).strip()
        raise GraphServiceError(f'Token aanvraag mislukt (HTTP {resp.status_code}): {desc}')
    payload = resp.json()
    token = payload.get('access_token')
    if not token:
        raise GraphServiceError('Token aanvraag gaf geen access_token terug.')
    expires_in = int(payload.get('expires_in', 3600))
    return _AccessToken(
        value=token,
        expires_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


def _headers(token: _AccessToken) -> dict:
    return {
        'Authorization': f'Bearer {token.value}',
        'Accept': 'application/json',
    }


def _mailbox(config) -> str:
    return _require(config.graph_mailbox, 'Mailbox')


def _folder(config) -> str:
    folder = (config.graph_folder or 'Inbox').strip() or 'Inbox'
    # Disallow CR/LF; subpaths with "/" are allowed and resolved below.
    if re.search(r'[\r\n\x00]', folder):
        raise GraphServiceError(f'Ongeldige mailmap: {folder!r}')
    return folder


# Mapping from common localized display names to the Graph well-known names.
_WELL_KNOWN_ALIASES = {
    # Dutch
    'postvak in': 'Inbox',
    'concepten': 'Drafts',
    'verzonden items': 'SentItems',
    'verzonden': 'SentItems',
    'verwijderde items': 'DeletedItems',
    'ongewenste e-mail': 'JunkEmail',
    'ongewenste mail': 'JunkEmail',
    'archief': 'Archive',
    # English
    'inbox': 'Inbox',
    'drafts': 'Drafts',
    'sent items': 'SentItems',
    'sent': 'SentItems',
    'deleted items': 'DeletedItems',
    'junk email': 'JunkEmail',
    'archive': 'Archive',
}


def _resolve_root_folder_id(mailbox: str, token: _AccessToken, name: str) -> str:
    """Resolve the first path segment to a Graph mailFolder id.

    Accepts well-known names (in any supported language) or a literal display
    name; falls back to a $filter lookup on displayName.
    """
    key = name.strip().lower()
    wk = _WELL_KNOWN_ALIASES.get(key)
    if wk:
        # Well-known names can be used directly as the id path segment.
        url = f'{GRAPH_BASE}/users/{quote(mailbox, safe="@.-_")}/mailFolders/{wk}'
        data = _graph_get(url, token)
        fid = data.get('id')
        if not fid:
            raise GraphServiceError(f'Mailmap "{name}" niet gevonden.')
        return fid

    # Otherwise: search the top-level folders by displayName.
    url = f'{GRAPH_BASE}/users/{quote(mailbox, safe="@.-_")}/mailFolders'
    # Graph $filter requires single-quoted string; escape internal quotes.
    safe_name = name.replace("'", "''")
    data = _graph_get(url, token, params={
        '$filter': f"displayName eq '{safe_name}'",
        '$select': 'id,displayName',
        '$top': '5',
    })
    for f in data.get('value', []):
        if f.get('displayName', '').lower() == key:
            return f['id']
    raise GraphServiceError(f'Mailmap "{name}" niet gevonden in postvak.')


def _resolve_child_folder_id(mailbox: str, token: _AccessToken, parent_id: str, name: str) -> str:
    url = f'{GRAPH_BASE}/users/{quote(mailbox, safe="@.-_")}/mailFolders/{parent_id}/childFolders'
    safe_name = name.replace("'", "''")
    data = _graph_get(url, token, params={
        '$filter': f"displayName eq '{safe_name}'",
        '$select': 'id,displayName',
        '$top': '50',
    })
    key = name.strip().lower()
    for f in data.get('value', []):
        if f.get('displayName', '').lower() == key:
            return f['id']
    raise GraphServiceError(f'Submap "{name}" niet gevonden.')


def _resolve_folder_id(mailbox: str, token: _AccessToken, folder_path: str) -> str:
    """Resolve a path like 'Inbox/sub/leaf' or 'Postvak IN/smapone' to a folder id."""
    segments = [s.strip() for s in re.split(r'[\\/]+', folder_path) if s.strip()]
    if not segments:
        segments = ['Inbox']
    fid = _resolve_root_folder_id(mailbox, token, segments[0])
    for seg in segments[1:]:
        fid = _resolve_child_folder_id(mailbox, token, fid, seg)
    return fid


def _messages_url(config, token: _AccessToken) -> str:
    mailbox = quote(_mailbox(config), safe='@.-_')
    folder_path = _folder(config)
    fid = _resolve_folder_id(_mailbox(config), token, folder_path)
    return f'{GRAPH_BASE}/users/{mailbox}/mailFolders/{fid}/messages'


def _graph_get(url: str, token: _AccessToken, params: dict | None = None) -> dict:
    try:
        resp = requests.get(url, headers=_headers(token), params=params, timeout=HTTP_TIMEOUT)
    except requests.RequestException as exc:
        raise GraphServiceError(f'Graph-verbinding mislukt: {exc}') from exc
    if resp.status_code == 401:
        raise GraphServiceError('Graph: token afgewezen (401). Controleer permissions en admin consent.')
    if resp.status_code == 403:
        raise GraphServiceError('Graph: geen toegang (403). Mail.ReadWrite app-permission met admin consent vereist.')
    if resp.status_code == 404:
        raise GraphServiceError('Graph: mailbox of map niet gevonden (404).')
    if resp.status_code >= 400:
        try:
            payload = resp.json()
            err = payload.get('error', {})
            msg = err.get('message') or str(payload)
        except ValueError:
            msg = resp.text[:300]
        raise GraphServiceError(f'Graph fout (HTTP {resp.status_code}): {msg}')
    try:
        return resp.json()
    except ValueError as exc:
        raise GraphServiceError('Graph: ongeldige JSON-response.') from exc


def _graph_patch(url: str, token: _AccessToken, body: dict) -> None:
    try:
        resp = requests.patch(
            url,
            headers={**_headers(token), 'Content-Type': 'application/json'},
            json=body,
            timeout=HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GraphServiceError(f'Graph PATCH mislukt: {exc}') from exc
    if resp.status_code not in (200, 204):
        try:
            payload = resp.json()
            err = payload.get('error', {})
            msg = err.get('message') or str(payload)
        except ValueError:
            msg = resp.text[:300]
        raise GraphServiceError(f'Graph PATCH fout (HTTP {resp.status_code}): {msg}')


def scan_mailbox_graph(
    *,
    config,
    ritnummers: Iterable[str],
    since_date: date,
    until_date: date | None = None,
) -> list[FetchedMail]:
    """Return matched mails for the given ritnummers received on/after since_date.

    If ``until_date`` is given, the Graph $filter also bounds the upper end
    (``receivedDateTime lt until_date+1 day``). This is important for
    historical day-by-day scans to avoid hitting the MAX_PAGES cap on busy
    mailboxes.
    """
    ritnummers_set = {r.strip() for r in ritnummers if r and str(r).strip()}
    if not ritnummers_set:
        return []

    pattern = build_subject_pattern(config.subject_template)
    token = get_access_token(config)

    # ISO 8601 UTC midnight
    since_dt = datetime.combine(since_date, datetime.min.time(), tzinfo=timezone.utc)
    since_iso = since_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    filter_expr = f'receivedDateTime ge {since_iso}'
    if until_date is not None:
        from datetime import timedelta
        until_dt = datetime.combine(
            until_date + timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        until_iso = until_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        filter_expr += f' and receivedDateTime lt {until_iso}'

    url = _messages_url(config, token)
    params = {
        '$select': 'id,subject,internetMessageId,receivedDateTime,isRead',
        '$top': '50',
        '$orderby': 'receivedDateTime desc',
        '$filter': filter_expr,
    }

    results: list[FetchedMail] = []
    pages = 0
    next_url: str | None = url
    next_params: dict | None = params
    while next_url and pages < MAX_PAGES:
        payload = _graph_get(next_url, token, params=next_params)
        for msg in payload.get('value', []):
            subject = msg.get('subject') or ''
            m = pattern.search(subject)
            if not m:
                continue
            rit = m.group('ritnummer').strip()
            if rit not in ritnummers_set:
                continue
            received_at = None
            rd = msg.get('receivedDateTime')
            if rd:
                try:
                    received_at = datetime.fromisoformat(rd.replace('Z', '+00:00'))
                except ValueError:
                    received_at = None
            results.append(FetchedMail(
                uid=msg.get('id', ''),
                subject=subject,
                message_id=msg.get('internetMessageId', '') or '',
                received_at=received_at,
                matched_ritnummer=rit,
            ))
        next_url = payload.get('@odata.nextLink')
        next_params = None  # nextLink already encodes params
        pages += 1
    return results


def mark_messages_read_graph(*, config, message_ids: Iterable[str]) -> None:
    ids = [m for m in message_ids if m]
    if not ids:
        return
    try:
        token = get_access_token(config)
    except GraphServiceError as exc:
        logger.warning('mark_messages_read_graph: token failed: %s', exc)
        return
    mailbox = quote(_mailbox(config), safe='@.-_')
    for mid in ids:
        try:
            _graph_patch(
                f'{GRAPH_BASE}/users/{mailbox}/messages/{quote(mid, safe="-_=")}',
                token,
                {'isRead': True},
            )
        except GraphServiceError as exc:
            logger.warning('mark_messages_read_graph: %s -> %s', mid, exc)


def test_connection_graph(config) -> dict:
    """Try to get a token AND list one message; return {success, message}."""
    try:
        token = get_access_token(config)
        url = _messages_url(config, token)
        payload = _graph_get(url, token, params={'$top': '1', '$select': 'id'})
        count_hint = len(payload.get('value', []))
        return {
            'success': True,
            'message': (
                'Verbinding gelukt. Token verkregen en mailbox toegankelijk '
                f'({"≥1" if count_hint else "0"} bericht zichtbaar).'
            ),
        }
    except GraphServiceError as exc:
        return {'success': False, 'message': str(exc)}
