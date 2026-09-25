"""Celery task entry points for durable background work."""

import asyncio

from app.workers.celery_app import celery_app
from app.core.metrics import SIMULATION_JOBS


@celery_app.task(
    bind=True,
    name="mflood.simulation.run",
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_backoff_max=120,
    retry_jitter=True,
    max_retries=5,
)
def run_simulation_task(self, simulation_id: str) -> None:
    """Execute one persisted simulation in a Celery worker process."""
    from app.services.simulation_service import simulation_service

    try:
        asyncio.run(simulation_service._run(simulation_id))
        record = simulation_service.get(simulation_id)
        if not record or record.get("status") != "COMPLETED":
            raise RuntimeError(record.get("error", "Simulation did not complete") if record else "Simulation record missing")
        SIMULATION_JOBS.labels("completed").inc()
    except Exception:
        SIMULATION_JOBS.labels("failed").inc()
        raise
