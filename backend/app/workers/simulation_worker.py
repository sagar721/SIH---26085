import logging
from typing import Optional
from app.core.config import settings
from app.workers.tasks import run_simulation_task

logger = logging.getLogger("mflood.simulation_worker")


class SimulationWorker:
    """Dispatch simulation jobs to Celery instead of an in-process queue."""

    async def start(self):
        mode = "Celery/Redis" if settings.CELERY_BROKER_URL else "local task fallback"
        logger.info("SimulationWorker ready (%s)", mode)

    async def stop(self):
        logger.info("SimulationWorker stopped")

    async def enqueue(self, sim_id: str, corridor: str, scenario: str, rainfall_intensity: Optional[float] = None, blockage: float = 0.0):
        if not settings.CELERY_BROKER_URL:
            raise RuntimeError("CELERY_BROKER_URL is required to enqueue a durable simulation job")
        run_simulation_task.delay(sim_id)
        logger.info("Dispatched simulation job %s to Celery", sim_id)


simulation_worker = SimulationWorker()
