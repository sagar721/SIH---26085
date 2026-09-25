"""Thread-safe SQLite store for simulations and operational alerts."""

import asyncio
from copy import deepcopy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from sqlalchemy import create_engine, text

from app.core.logging import get_logger
from app.core.config import settings
from app.models.database import engine as configured_engine

logger = get_logger("runtime_store")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = BASE_DIR / settings.RUNTIME_STORE_PATH

if settings.DATABASE_URL:
    RUNTIME_ENGINE = configured_engine or create_engine(settings.DATABASE_URL, pool_pre_ping=True)
    RUNTIME_BACKEND = "POSTGRESQL"
else:
    RUNTIME_ENGINE = create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False},
    )
    RUNTIME_BACKEND = "SQLITE"


class RuntimeStore:
    def __init__(self) -> None:
        self.simulations: Dict[str, Dict[str, Any]] = {}
        self.alerts: List[Dict[str, Any]] = []
        self._subscribers: List[asyncio.Queue] = []
        self._locks_by_loop: Dict[Any, asyncio.Lock] = {}
        self._init_db()
        self._load_persisted_state()

    @property
    def _lock(self) -> asyncio.Lock:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop not in self._locks_by_loop:
            self._locks_by_loop[loop] = asyncio.Lock()
        return self._locks_by_loop[loop]

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _init_db(self) -> None:
        """Initialize runtime tables in the configured persistence database."""
        try:
            if RUNTIME_BACKEND == "SQLITE":
                DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            alert_id_definition = "BIGSERIAL PRIMARY KEY" if RUNTIME_BACKEND == "POSTGRESQL" else "INTEGER PRIMARY KEY AUTOINCREMENT"
            with RUNTIME_ENGINE.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS persistent_simulations (
                        simulation_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        data_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """))
                conn.execute(text(f"""
                    CREATE TABLE IF NOT EXISTS persistent_alerts (
                        id {alert_id_definition},
                        alert_id TEXT UNIQUE,
                        severity TEXT NOT NULL,
                        data_json TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """))
            logger.info(f"Initialized {RUNTIME_BACKEND} runtime store")
        except Exception as e:
            logger.error(f"Failed to initialize runtime store: {e}", exc_info=True)

    def _load_persisted_state(self) -> None:
        """Restore past simulations and alerts from database into memory."""
        try:
            with RUNTIME_ENGINE.connect() as conn:
                simulations = conn.execute(text("SELECT simulation_id, data_json FROM persistent_simulations"))
                for sim_id, raw_json in simulations:
                    try:
                        self.simulations[sim_id] = json.loads(raw_json)
                    except Exception:
                        continue

                alerts = conn.execute(text("SELECT data_json FROM persistent_alerts ORDER BY id ASC LIMIT 500"))
                for (raw_json,) in alerts:
                    try:
                        self.alerts.append(json.loads(raw_json))
                    except Exception:
                        continue
            logger.info(
                f"Restored runtime state: {len(self.simulations)} simulations, {len(self.alerts)} alerts"
            )
        except Exception as e:
            logger.warning(f"Could not load persisted runtime store state: {e}")

    async def save_simulation(self, simulation_id: str, record: Dict[str, Any]) -> None:
        """Concurrency-safe, durable update of simulation status and results.

        Commits durable state before exposing it to local readers: if the DB
        write fails, the exception propagates instead of being silently
        logged-and-swallowed, so callers never believe a status update
        succeeded when it wasn't actually persisted.
        """
        async with self._lock:
            def _persist():
                try:
                    with RUNTIME_ENGINE.begin() as conn:
                        conn.execute(
                            text("""
                            INSERT INTO persistent_simulations (simulation_id, status, created_at, data_json, updated_at)
                            VALUES (:simulation_id, :status, :created_at, :data_json, :updated_at)
                            ON CONFLICT(simulation_id) DO UPDATE SET
                                status = excluded.status,
                                data_json = excluded.data_json,
                                updated_at = excluded.updated_at
                            """),
                            {
                                "simulation_id": simulation_id,
                                "status": record.get("status", "UNKNOWN"),
                                "created_at": record.get("created_at", self.now()),
                                "data_json": json.dumps(record),
                                "updated_at": self.now(),
                            },
                        )
                except Exception as ex:
                    logger.error(f"Failed to persist simulation {simulation_id} to DB: {ex}")
                    raise

            await asyncio.to_thread(_persist)
            self.simulations[simulation_id] = deepcopy(record)
        logger.debug(f"Simulation '{simulation_id}' saved with status: {record.get('status')}")

    async def get_simulation(self, simulation_id: str) -> Optional[Dict[str, Any]]:
        """Concurrency-safe retrieval of simulation record."""
        async with self._lock:
            record = self.simulations.get(simulation_id)
            return deepcopy(record) if record else None

    async def add_alert(self, alert: Dict[str, Any]) -> None:
        """Add an operational alert to the local alert buffer and durable database."""
        async with self._lock:
            self.alerts.append(alert)
            if len(self.alerts) > 1000:
                self.alerts.pop(0)

            def _persist_alert():
                try:
                    alert_id = alert.get("alert_id") or alert.get("id") or str(len(self.alerts))
                    with RUNTIME_ENGINE.begin() as conn:
                        conn.execute(
                            text("""
                            INSERT INTO persistent_alerts (alert_id, severity, data_json, created_at)
                            VALUES (:alert_id, :severity, :data_json, :created_at)
                            ON CONFLICT(alert_id) DO NOTHING
                            """),
                            {
                                "alert_id": alert_id,
                                "severity": alert.get("severity", "MODERATE"),
                                "data_json": json.dumps(alert),
                                "created_at": alert.get("created_at", self.now()),
                            },
                        )
                except Exception as ex:
                    logger.error(f"Failed to persist alert to DB: {ex}")

            await asyncio.to_thread(_persist_alert)
        logger.info(f"New alert recorded: {alert.get('alert_id', 'unknown')}")

    async def publish(self, event_type: str, payload: Dict[str, Any]) -> None:
        """Broadcast live event to all connected subscriber queues with overflow handling."""
        event = {"event": event_type, "timestamp": self.now(), "payload": payload}
        async with self._lock:
            active_subscribers = list(self._subscribers)

        for queue in active_subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue is full; dropping event to preserve throughput")
                continue

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(queue)
        logger.debug(f"New subscriber connected; active listeners: {len(self._subscribers)}")
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        async with self._lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)
        logger.debug(f"Subscriber disconnected; active listeners: {len(self._subscribers)}")

    @property
    def durability(self) -> str:
        """Expose the actual persistence backend used by runtime records."""
        if RUNTIME_BACKEND == "SQLITE":
            return f"SQLITE:{DB_PATH}"
        return RUNTIME_BACKEND


runtime_store = RuntimeStore()
