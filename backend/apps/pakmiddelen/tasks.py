"""Celery tasks for the pakmiddelen module."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='apps.pakmiddelen.tasks.run_scheduled_check')
def run_scheduled_check():
    """
    Beat-driven dispatcher. Runs every minute; checks whether the configured
    schedule_time is due and a run for today has not yet been performed.
    """
    from .models import PakmiddelenConfig
    from .services import run_check

    config = PakmiddelenConfig.get_solo()
    if not config.enabled:
        return 'disabled'

    now_local = timezone.localtime()
    sched = config.schedule_time
    if sched is None:
        return 'no schedule'

    # Run when current time is within [sched, sched + 5 min] AND not already done today.
    today = now_local.date()
    sched_dt = datetime.combine(today, sched, tzinfo=now_local.tzinfo)
    if now_local < sched_dt or now_local > sched_dt + timedelta(minutes=5):
        return 'not due'

    if config.last_run_at:
        last_local = timezone.localtime(config.last_run_at)
        if last_local.date() == today and (config.last_run_status or '') == 'ok':
            return 'already ran'

    logger.info('Running scheduled pakmiddelen check')
    result = run_check(config=config, target_date=today, send_report=True)
    return result


@shared_task(name='apps.pakmiddelen.tasks.run_now')
def run_now(target_date_iso: str | None = None, send_report: bool = True):
    """Manual run-now task (queued via API)."""
    from .models import PakmiddelenConfig
    from .services import run_check

    config = PakmiddelenConfig.get_solo()
    target_date = None
    if target_date_iso:
        try:
            target_date = datetime.fromisoformat(target_date_iso).date()
        except ValueError:
            target_date = None
    return run_check(config=config, target_date=target_date, send_report=send_report)


REMINDER_THRESHOLDS = [30, 14, 7]


@shared_task(name='apps.pakmiddelen.tasks.check_secret_expiry')
def check_secret_expiry():
    """
    Daily task: when the Graph client secret is within 30/14/7 days of expiring,
    send a reminder mail. Each threshold is sent at most once per expiry date.
    """
    from .models import PakmiddelenConfig
    from .notifier import send_secret_expiry_reminder

    config = PakmiddelenConfig.get_solo()
    if config.provider != PakmiddelenConfig.PROVIDER_GRAPH:
        return 'not graph'
    expires_on = config.graph_client_secret_expires_at
    if not expires_on:
        return 'no expiry set'

    today = timezone.localdate()
    days_left = (expires_on - today).days
    if days_left < 0:
        return 'expired'

    sent_raw = config.graph_secret_reminders_sent or []
    # entries are strings like "30@2026-12-31" so they reset when expiry changes
    iso = expires_on.isoformat()
    sent = set(sent_raw)

    fired = []
    for threshold in REMINDER_THRESHOLDS:
        key = f'{threshold}@{iso}'
        if days_left <= threshold and key not in sent:
            try:
                send_secret_expiry_reminder(config, days_left, expires_on)
                sent.add(key)
                fired.append(threshold)
            except Exception as exc:
                logger.exception('Secret expiry reminder (%s days) failed: %s', threshold, exc)
                break  # don't mark as sent; retry tomorrow

    if fired:
        # Keep only entries for the current expiry date to avoid unbounded growth.
        config.graph_secret_reminders_sent = sorted(s for s in sent if s.endswith(f'@{iso}'))
        config.save(update_fields=['graph_secret_reminders_sent', 'updated_at'])
    return {'days_left': days_left, 'fired': fired}
