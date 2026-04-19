"""
Celery application configuration for async task processing.
"""

from celery import Celery
from celery.schedules import crontab

from core.config import settings

celery_app = Celery(
    "delege",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["services.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=60,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    beat_schedule={
        "expire-subscriptions-daily": {
            "task": "services.tasks.check_subscription_expiry",
            "schedule": crontab(hour=2, minute=0),
        },
        "warn-expiring-subscriptions-daily": {
            "task": "services.tasks.send_expiry_warnings",
            "schedule": crontab(hour=9, minute=0),
        },
    },
)
