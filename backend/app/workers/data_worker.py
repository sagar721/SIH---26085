import asyncio
import logging
from typing import Optional
from app.data_sources import PROVIDERS

logger = logging.getLogger("mflood.data_worker")


class DataWorker:
    """Background maintenance worker for provider health checks and cache housekeeping."""
    def __init__(self, check_interval_seconds: int = 300):
        self.interval = check_interval_seconds
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(f"DataWorker started (interval: {self.interval}s)")

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("DataWorker stopped")

    async def _loop(self):
        while self._running:
            try:
                await asyncio.sleep(self.interval)
                await self.perform_health_checks()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in DataWorker maintenance loop: {e}", exc_info=True)

    async def perform_health_checks(self):
        for name, provider in PROVIDERS.items():
            try:
                status = await provider.health_check()
                logger.debug(f"DataWorker health probe [{name}]: {status.value}")
            except Exception as ex:
                logger.warning(f"DataWorker health probe failed for [{name}]: {ex}")


data_worker = DataWorker()
