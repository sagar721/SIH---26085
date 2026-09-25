"""Scheduled background worker for weather and provider health refresh (Phase 25)."""

import asyncio
import time
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.data_sources import PROVIDERS
from app.services.runtime_store import runtime_store

logger = get_logger("workers.weather")


class WeatherRefreshWorker:
    """Periodically refreshes weather forecast data and checks provider availability."""

    def __init__(self, interval_seconds: int = 900) -> None:
        self.interval_seconds = interval_seconds  # 15 minutes default
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self.last_run_timestamp: Optional[str] = None
        self.last_run_status: str = "IDLE"

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(f"WeatherRefreshWorker started (interval={self.interval_seconds}s)")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("WeatherRefreshWorker stopped")

    async def _loop(self) -> None:
        # Initial small delay to let server boot cleanly
        await asyncio.sleep(2)
        while self._running:
            try:
                await self.refresh_once()
            except Exception as e:
                logger.error(f"Error during scheduled weather refresh: {e}", exc_info=True)

            try:
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                break

    async def refresh_once(self) -> None:
        """Executes a single refresh pass over providers without hammering APIs."""
        logger.debug("Running scheduled weather refresh...")
        open_meteo = PROVIDERS.get("open_meteo")
        if open_meteo:
            study_area = settings.load_study_area()
            res = await open_meteo.fetch(**study_area["center"])
            status = res.get("status", "UNAVAILABLE")
            self.last_run_timestamp = runtime_store.now()
            self.last_run_status = status

            # Broadcast provider status update to connected WebSocket clients
            await runtime_store.publish(
                "provider_status",
                {
                    "provider": open_meteo.name,
                    "status": status,
                    "timestamp": self.last_run_timestamp,
                    "cached": res.get("cached", False),
                },
            )
            logger.info(f"Scheduled weather refresh completed: {open_meteo.name} -> {status}")


weather_worker = WeatherRefreshWorker(interval_seconds=900)
