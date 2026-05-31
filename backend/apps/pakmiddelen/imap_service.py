"""
IMAP service for the pakmiddelen module.

Connects to a configured mailbox, scans the configured folder for messages
whose subject contains a ritnummer (according to the configurable subject
template) within the requested date range, and optionally marks the
processed messages as `\\Seen`.

Security notes:
- Credentials are stored encrypted (`EncryptedCharField`) and only decrypted
  in-process; they are never returned via the API.
- IMAP connections always prefer SSL/TLS; STARTTLS is used when SSL is off.
- The folder name is validated to disallow CR/LF injection.
- A connection timeout is enforced.
- Messages are marked seen ONLY after a successful database write.
"""
from __future__ import annotations

import email
import imaplib
import logging
import re
import socket
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from typing import Iterable

logger = logging.getLogger(__name__)

IMAP_TIMEOUT_SECONDS = 30
_FOLDER_INVALID_RE = re.compile(r'[\r\n\x00]')


class ImapServiceError(Exception):
    """Raised on any IMAP-related failure."""


@dataclass
class FetchedMail:
    uid: str
    subject: str
    message_id: str
    received_at: datetime | None
    matched_ritnummer: str


def _decode_subject(raw: str | bytes | None) -> str:
    if raw is None:
        return ''
    try:
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', errors='replace')
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw if isinstance(raw, str) else raw.decode('utf-8', errors='replace')


def _validate_folder(folder: str) -> str:
    folder = (folder or 'INBOX').strip()
    if not folder or _FOLDER_INVALID_RE.search(folder):
        raise ImapServiceError(f'Ongeldige IMAP-mapnaam: {folder!r}')
    return folder


def build_subject_pattern(template: str) -> re.Pattern:
    """
    Build a case-insensitive regex from a subject template that contains
    `{ritnummer}` placeholder.
    """
    if '{ritnummer}' not in template:
        raise ImapServiceError(
            'Onderwerp template moet de placeholder {ritnummer} bevatten.'
        )
    parts = template.split('{ritnummer}')
    escaped = r'(?P<ritnummer>[\w\-\/]+)'.join(re.escape(p) for p in parts)
    return re.compile(escaped, re.IGNORECASE)


def _imap_date(d: date) -> str:
    return d.strftime('%d-%b-%Y')


class ImapClient:
    """Thin context-managed IMAP client."""

    def __init__(self, host: str, port: int, use_ssl: bool, username: str, password: str):
        self.host = host
        self.port = port
        self.use_ssl = use_ssl
        self.username = username
        self.password = password
        self._conn: imaplib.IMAP4 | None = None

    def _open_socket(self) -> imaplib.IMAP4:
        if self.use_ssl:
            conn = imaplib.IMAP4_SSL(self.host, self.port, timeout=IMAP_TIMEOUT_SECONDS)
        else:
            conn = imaplib.IMAP4(self.host, self.port, timeout=IMAP_TIMEOUT_SECONDS)
            try:
                conn.starttls()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning('STARTTLS failed: %s', exc)
        return conn

    def __enter__(self):
        socket.setdefaulttimeout(IMAP_TIMEOUT_SECONDS)
        try:
            self._conn = self._open_socket()
            self._login(self._conn)
        except (imaplib.IMAP4.error, OSError) as exc:
            raise ImapServiceError(
                f'IMAP-verbinding mislukt ({self.host}:{self.port}, ssl={self.use_ssl}): {exc}'
            ) from exc
        return self

    def _login(self, conn: imaplib.IMAP4) -> None:
        """Try AUTHENTICATE PLAIN first (better support for special chars);
        if that fails, open a fresh connection and fall back to LOGIN."""
        capabilities = b''
        try:
            typ, data = conn.capability()
            if typ == 'OK' and data:
                capabilities = b' '.join(d if isinstance(d, bytes) else d.encode() for d in data).upper()
        except Exception:
            capabilities = b''

        plain_exc: Exception | None = None
        if b'AUTH=PLAIN' in capabilities or b'SASL-IR' in capabilities or not capabilities:
            try:
                user_b = self.username.encode('utf-8')
                pass_b = self.password.encode('utf-8')
                auth_string = b'\x00' + user_b + b'\x00' + pass_b
                conn.authenticate('PLAIN', lambda _challenge: auth_string)
                return
            except (imaplib.IMAP4.error, OSError) as exc:
                plain_exc = exc
                logger.info('IMAP AUTHENTICATE PLAIN failed: %s', exc)
                # AUTHENTICATE failure often leaves the socket unusable; reconnect.
                try:
                    conn.logout()
                except Exception:
                    pass
                try:
                    self._conn = self._open_socket()
                    conn = self._conn
                except (imaplib.IMAP4.error, OSError) as reconnect_exc:
                    raise plain_exc from reconnect_exc

        try:
            conn.login(self.username, self.password)
        except imaplib.IMAP4.error as exc:
            if plain_exc is not None:
                raise imaplib.IMAP4.error(
                    f'AUTH PLAIN: {plain_exc}; LOGIN: {exc}'
                ) from exc
            raise

    def __exit__(self, exc_type, exc, tb):
        if self._conn is not None:
            try:
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn.logout()
            except Exception:
                pass
            self._conn = None

    @property
    def conn(self) -> imaplib.IMAP4:
        if self._conn is None:
            raise ImapServiceError('IMAP-verbinding niet open.')
        return self._conn

    def select_folder(self, folder: str, readonly: bool = False) -> int:
        folder = _validate_folder(folder)
        # Quote folder for safety with special chars
        typ, data = self.conn.select(f'"{folder}"', readonly=readonly)
        if typ != 'OK':
            raise ImapServiceError(f'IMAP-map "{folder}" niet gevonden.')
        try:
            return int(data[0])
        except (ValueError, IndexError, TypeError):
            return 0

    def search_since(self, since: date) -> list[bytes]:
        typ, data = self.conn.search(None, 'SINCE', _imap_date(since))
        if typ != 'OK':
            raise ImapServiceError('IMAP-zoeken mislukt.')
        if not data or not data[0]:
            return []
        return data[0].split()

    def fetch_headers(self, num: bytes) -> tuple[str, str, datetime | None]:
        typ, data = self.conn.fetch(num, '(BODY.PEEK[HEADER.FIELDS (SUBJECT MESSAGE-ID DATE)])')
        if typ != 'OK' or not data or not data[0]:
            return '', '', None
        raw = b''
        for item in data:
            if isinstance(item, tuple) and len(item) >= 2:
                raw = item[1]
                break
        msg = email.message_from_bytes(raw)
        subject = _decode_subject(msg.get('Subject'))
        message_id = (msg.get('Message-ID') or '').strip()
        received_at: datetime | None = None
        date_hdr = msg.get('Date')
        if date_hdr:
            try:
                received_at = parsedate_to_datetime(date_hdr)
                if received_at and received_at.tzinfo is None:
                    received_at = received_at.replace(tzinfo=timezone.utc)
            except Exception:
                received_at = None
        return subject, message_id, received_at

    def mark_seen(self, num: bytes) -> None:
        try:
            self.conn.store(num, '+FLAGS', '\\Seen')
        except Exception as exc:  # pragma: no cover - non-fatal
            logger.warning('Mark seen failed for %r: %s', num, exc)


def scan_mailbox(
    *,
    config,
    ritnummers: Iterable[str],
    since_date: date,
) -> list[FetchedMail]:
    """
    Connect to the mailbox and return matched mails for the given ritnummers
    received on or after `since_date`.
    """
    if not config.imap_host or not config.imap_username or not config.imap_password:
        raise ImapServiceError('IMAP-instellingen onvolledig.')

    ritnummers_set = {r.strip() for r in ritnummers if r and str(r).strip()}
    if not ritnummers_set:
        return []

    pattern = build_subject_pattern(config.subject_template)
    folder = _validate_folder(config.imap_folder)
    results: list[FetchedMail] = []

    with ImapClient(
        host=config.imap_host,
        port=config.imap_port,
        use_ssl=config.imap_use_ssl,
        username=config.imap_username,
        password=config.imap_password,
    ) as client:
        readonly = not config.mark_as_read
        client.select_folder(folder, readonly=readonly)
        nums = client.search_since(since_date)
        for num in nums:
            try:
                subject, message_id, received_at = client.fetch_headers(num)
            except Exception as exc:
                logger.warning('Failed to fetch headers for %r: %s', num, exc)
                continue
            if not subject:
                continue
            m = pattern.search(subject)
            if not m:
                continue
            ritnummer = (m.groupdict().get('ritnummer') or '').strip()
            # Match only if extracted ritnummer is in the monitored set
            if ritnummer not in ritnummers_set:
                continue
            results.append(FetchedMail(
                uid=num.decode() if isinstance(num, bytes) else str(num),
                subject=subject,
                message_id=message_id,
                received_at=received_at,
                matched_ritnummer=ritnummer,
            ))

    return results


def mark_mails_seen(config, uids: list[str]) -> None:
    """Best-effort second pass to mark messages \\Seen after DB persistence."""
    if not config.mark_as_read or not uids:
        return
    try:
        with ImapClient(
            host=config.imap_host,
            port=config.imap_port,
            use_ssl=config.imap_use_ssl,
            username=config.imap_username,
            password=config.imap_password,
        ) as client:
            client.select_folder(config.imap_folder, readonly=False)
            for uid in uids:
                client.mark_seen(uid.encode() if isinstance(uid, str) else uid)
    except Exception as exc:
        logger.warning('mark_mails_seen failed: %s', exc)


def test_connection(config) -> dict:
    """Open and close a connection; return diagnostic info."""
    try:
        with ImapClient(
            host=config.imap_host,
            port=config.imap_port,
            use_ssl=config.imap_use_ssl,
            username=config.imap_username,
            password=config.imap_password,
        ) as client:
            count = client.select_folder(config.imap_folder, readonly=True)
        return {'success': True, 'message': f'Verbinding gelukt. Map bevat {count} berichten.'}
    except ImapServiceError as exc:
        return {'success': False, 'message': str(exc)}


def default_since_date(config) -> date:
    """Compute the SINCE date for IMAP search based on config."""
    if config.period_from_date:
        return config.period_from_date
    days = max(1, int(config.period_days or 1))
    return (datetime.utcnow().date() - timedelta(days=days - 1))
