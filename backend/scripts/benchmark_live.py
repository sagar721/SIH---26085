"""Measure one configured live Mumbai simulation through the durable runtime path."""

import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from app.core.config import settings
from app.models.database import check_database_health
from app.services.gis_service import gis_service
from app.services.runtime_store import RUNTIME_ENGINE
from app.services.simulation_service import simulation_service


async def run() -> dict:
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the live benchmark")
    if not settings.CELERY_BROKER_URL:
        raise RuntimeError("CELERY_BROKER_URL is required for the live benchmark")
    db_status, db_detail = check_database_health()
    if db_status != "CONNECTED":
        raise RuntimeError(f"Database unavailable: {db_detail}")

    roads = gis_service.get_roads()
    drains = gis_service.get_drains()
    if roads.get("status") != "AVAILABLE" or drains.get("status") != "AVAILABLE":
        raise RuntimeError("Required Mumbai GIS layers are unavailable")

    started = time.perf_counter()
    job = await simulation_service.submit(horizon_minutes=15, timestep_minutes=15, mode="LIVE")
    simulation_id = job["simulation_id"]
    deadline = time.perf_counter() + 900
    result = None
    while time.perf_counter() < deadline:
        with RUNTIME_ENGINE.connect() as conn:
            row = conn.execute(
                text("SELECT data_json FROM persistent_simulations WHERE simulation_id = :id"),
                {"id": simulation_id},
            ).scalar_one_or_none()
        if row:
            result = json.loads(row)
            if result.get("status") in {"COMPLETED", "FAILED"}:
                break
        await asyncio.sleep(2)

    if not result or result.get("status") != "COMPLETED":
        raise RuntimeError(f"Live simulation failed or timed out: {result}")

    return {
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "simulation_id": simulation_id,
        "wall_clock_seconds": round(time.perf_counter() - started, 3),
        "grid_cell_count": len(result.get("grid_cells", [])),
        "road_count": len(roads.get("features", [])),
        "drainage_feature_count": len(drains.get("features", [])),
        "timestep_minutes": result.get("timestep_minutes"),
        "horizon_minutes": result.get("horizon_minutes"),
        "model_version": result.get("model_version"),
        "provider_snapshot": result.get("provenance", {}).get("provider_snapshot"),
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), indent=2))
