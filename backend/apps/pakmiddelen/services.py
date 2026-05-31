"""
Daily check service: scans the mailbox, persists results, sends report.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Iterable

from django.utils import timezone

from .imap_service import (
    ImapServiceError,
    default_since_date,
    mark_mails_seen,
    scan_mailbox,
)
from .graph_service import (
    GraphServiceError,
    mark_messages_read_graph,
    scan_mailbox_graph,
)
from .models import (
    PakmiddelenAuditLog,
    PakmiddelenCheckResult,
    PakmiddelenConfig,
    PakmiddelenRitnummerSelection,
)

logger = logging.getLogger(__name__)


def get_active_ritnummers() -> list[str]:
    return list(
        PakmiddelenRitnummerSelection.objects
        .filter(actief=True)
        .values_list('ritnummer', flat=True)
    )


def run_check(*, config: PakmiddelenConfig | None = None, target_date: date | None = None,
              user=None, ip_address: str | None = None, send_report: bool = True) -> dict:
    """
    Execute the IMAP check + persist + (optionally) send the daily report.

    Returns a dict with summary info.
    """
    config = config or PakmiddelenConfig.get_solo()
    target_date = target_date or timezone.localdate()

    ritnummers = get_active_ritnummers()
    if not ritnummers:
        msg = 'Geen actieve ritnummers geselecteerd.'
        config.last_run_at = timezone.now()
        config.last_run_status = 'skipped'
        config.last_run_message = msg
        config.save(update_fields=['last_run_at', 'last_run_status', 'last_run_message', 'updated_at'])
        return {'success': True, 'matched': 0, 'missing': [], 'message': msg}

    since = default_since_date(config)
    if since > target_date:
        since = target_date

    try:
        if config.provider == PakmiddelenConfig.PROVIDER_GRAPH:
            # Use a tight UTC window around the local date (+/-1 day) to
            # avoid hitting the Graph MAX_PAGES cap on busy mailboxes. The
            # post-filter on local date still ensures correctness.
            from datetime import timedelta
            mails = scan_mailbox_graph(
                config=config,
                ritnummers=ritnummers,
                since_date=target_date - timedelta(days=1),
                until_date=target_date + timedelta(days=1),
            )
        else:
            mails = scan_mailbox(config=config, ritnummers=ritnummers, since_date=since)
    except (ImapServiceError, GraphServiceError) as exc:
        config.last_run_at = timezone.now()
        config.last_run_status = 'error'
        config.last_run_message = str(exc)
        config.save(update_fields=['last_run_at', 'last_run_status', 'last_run_message', 'updated_at'])
        PakmiddelenAuditLog.objects.create(
            action='run_check_failed', user=user, ip_address=ip_address,
            details={'error': str(exc)},
        )
        return {'success': False, 'matched': 0, 'missing': [], 'message': str(exc)}

    # Build results: one row per ritnummer for `target_date`.
    # Match status: any mail received on `target_date` (local date) for that ritnummer.
    matched_uids: list[str] = []
    matched_by_rit: dict[str, dict] = {}
    for m in mails:
        if not m.received_at:
            continue
        local_dt = timezone.localtime(m.received_at) if timezone.is_aware(m.received_at) else m.received_at
        if local_dt.date() != target_date:
            continue
        existing = matched_by_rit.get(m.matched_ritnummer)
        if existing is None or (m.received_at and m.received_at > existing['received_at']):
            matched_by_rit[m.matched_ritnummer] = {
                'subject': m.subject,
                'message_id': m.message_id,
                'received_at': m.received_at,
                'uid': m.uid,
            }
            matched_uids.append(m.uid)

    rows: list[PakmiddelenCheckResult] = []
    for ritnummer in ritnummers:
        info = matched_by_rit.get(ritnummer)
        defaults = {
            'has_bon': bool(info),
            'matched_subject': (info or {}).get('subject', '') or '',
            'mail_message_id': (info or {}).get('message_id', '') or '',
            'mail_received_at': (info or {}).get('received_at'),
        }
        obj, _ = PakmiddelenCheckResult.objects.update_or_create(
            check_date=target_date,
            ritnummer=ritnummer,
            defaults=defaults,
        )
        rows.append(obj)

    # Mark mails as seen only after persistence
    if matched_uids:
        if config.provider == PakmiddelenConfig.PROVIDER_GRAPH:
            if config.mark_as_read:
                mark_messages_read_graph(config=config, message_ids=matched_uids)
        else:
            mark_mails_seen(config, matched_uids)

    missing = [r.ritnummer for r in rows if not r.has_bon]
    matched = sum(1 for r in rows if r.has_bon)

    config.last_run_at = timezone.now()
    config.last_run_status = 'ok'
    config.last_run_message = f'{matched} match(es), {len(missing)} ontbrekend.'
    config.save(update_fields=['last_run_at', 'last_run_status', 'last_run_message', 'updated_at'])

    PakmiddelenAuditLog.objects.create(
        action='run_check', user=user, ip_address=ip_address,
        details={'date': str(target_date), 'matched': matched, 'missing': missing},
    )

    report = {'success': True, 'matched': matched, 'missing': missing,
              'date': str(target_date), 'message': config.last_run_message}

    if send_report and config.notification_recipients:
        from .notifier import send_daily_report
        try:
            send_daily_report(config, target_date, missing, user=user)
            PakmiddelenCheckResult.objects.filter(
                check_date=target_date, ritnummer__in=missing
            ).update(notification_sent=True)
            report['notification_sent'] = True
        except Exception as exc:
            logger.exception('send_daily_report failed: %s', exc)
            report['notification_sent'] = False
            report['notification_error'] = str(exc)

    return report
