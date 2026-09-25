import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from uuid import uuid4
from typing import Any, Dict, List, Optional
from shapely.geometry import LineString, Point, shape

from app.core.logging import get_logger
from app.core.config import settings
from app.data_sources import PROVIDERS
from app.gis.analysis_grid import generate_analysis_grid
from app.services.dem_service import dem_service
from app.services.drainage_service import drainage_service
from app.services.gis_service import gis_service
from app.services.runtime_store import runtime_store
from app.simulation.inundation import calculate_terrain_inundation
from app.simulation.overflow import calculate_drainage_overflow
from app.simulation.risk import classify_flood_risk
from app.simulation.runoff import calculate_rational_runoff
from app.simulation.time_to_critical import calculate_time_to_critical

logger = get_logger("simulation_service")


class SimulationService:
    """Asynchronous, coupled urban flood nowcasting simulation engine."""

    async def submit(
        self,
        horizon_minutes: int = 180,
        timestep_minutes: int = 15,
        mode: Optional[str] = None,
        scenario_rainfall_mm_hr: Optional[float] = None,
    ) -> Dict[str, Any]:
        if horizon_minutes <= 0 or horizon_minutes > 180 or timestep_minutes <= 0 or horizon_minutes % timestep_minutes:
            raise ValueError("horizon_minutes must be 1..180 and divisible by timestep_minutes")
        mode = ("SCENARIO" if mode is None and scenario_rainfall_mm_hr is not None else mode or "LIVE").upper()
        if mode not in {"LIVE", "FORECAST", "SCENARIO"}:
            raise ValueError("mode must be LIVE, FORECAST, or SCENARIO")
        if mode == "SCENARIO" and scenario_rainfall_mm_hr is None:
            raise ValueError("scenario_rainfall_mm_hr is required in SCENARIO mode")
        if mode != "SCENARIO" and scenario_rainfall_mm_hr is not None:
            raise ValueError("scenario_rainfall_mm_hr is only valid in SCENARIO mode")

        input_config = {"horizon_minutes": horizon_minutes, "timestep_minutes": timestep_minutes, "mode": mode,
                        "scenario_rainfall_mm_hr": scenario_rainfall_mm_hr}
        config_hash = hashlib.sha256(json.dumps(input_config, sort_keys=True).encode()).hexdigest()
        for existing in runtime_store.simulations.values():
            if existing.get("status") in {"QUEUED", "RUNNING"} and existing.get("config_hash") == config_hash:
                return deepcopy(existing)

        simulation_id = str(uuid4())
        record = {
            "simulation_id": simulation_id,
            "status": "QUEUED",
            "created_at": runtime_store.now(),
            "horizon_minutes": horizon_minutes,
            "timestep_minutes": timestep_minutes,
            "mode": mode,
            "config_hash": config_hash,
            "model_version": "local-inertial-2d-v1",
            "task_id": None,
            "started_at": None,
            "finished_at": None,
            "timeline": [],
            "scenario_rainfall_mm_hr": scenario_rainfall_mm_hr,
            "flooded_roads": {},
            "affected_roads": {"type": "FeatureCollection", "features": []},
            "critical_locations": {"type": "FeatureCollection", "features": []},
            "grid_cells": [],
            "provenance": {
                "model": "Coupled Rational Method + 2.5D Terrain Redistribution",
                "result_type": "DERIVED",
                "assumptions": [
                    "Surface runoff modeled with Rational Method Q = 0.00278 * C * I * A",
                    "Overland volume redistribution based on local depression susceptibility",
                ],
            },
            "error": None,
            "durability": runtime_store.durability,
        }
        await runtime_store.save_simulation(simulation_id, record)
        await runtime_store.publish("JOB_QUEUED", {"simulation_id": simulation_id, "status": "QUEUED"})
        logger.info(f"Queued simulation '{simulation_id}' (horizon={horizon_minutes}m, dt={timestep_minutes}m)")
        if settings.CELERY_BROKER_URL:
            from app.workers.tasks import run_simulation_task
            try:
                dispatched = run_simulation_task.delay(simulation_id)
                record["task_id"] = dispatched.id
                await runtime_store.save_simulation(simulation_id, record)
            except Exception as exc:
                record["status"] = "FAILED"
                record["error"] = f"Celery broker unavailable: {exc}"
                record["finished_at"] = runtime_store.now()
                await runtime_store.save_simulation(simulation_id, record)
                raise RuntimeError(record["error"]) from exc
        elif settings.ALLOW_INPROCESS_SIMULATION_FALLBACK:
            logger.warning("Using explicitly enabled in-process simulation fallback")
            asyncio.create_task(self._run(simulation_id))
        else:
            record["status"] = "FAILED"
            record["error"] = "Durable Celery broker is not configured"
            await runtime_store.save_simulation(simulation_id, record)
            raise RuntimeError("CELERY_BROKER_URL is required for simulation jobs")
        return record

    async def _run(self, simulation_id: str) -> None:
        record = self.get(simulation_id)
        if not record:
            return

        record["status"] = "RUNNING"
        record["started_at"] = runtime_store.now()
        await runtime_store.save_simulation(simulation_id, record)
        await runtime_store.publish("JOB_STARTED", {"simulation_id": simulation_id})

        try:
            # 1. Gather Weather / Rainfall input
            rainfall_rates: List[float] = []
            weather = PROVIDERS.get("open_meteo")
            study_area = __import__("app.core.config", fromlist=["settings"]).settings.load_study_area()

            if weather:
                try:
                    w_data = await weather.fetch(**study_area["center"])
                    record["provenance"]["weather"] = {
                        "provider": weather.name,
                        "status": w_data.get("status"),
                        "retrieved_at": w_data.get("retrieved_at"),
                        "source_type": weather.source_type.value,
                        "valid_time": w_data.get("valid_time"),
                        "location": w_data.get("location"),
                        "url": w_data.get("url"),
                    }
                    retrieved_at = w_data.get("retrieved_at")
                    if record.get("mode") in {"LIVE", "FORECAST"}:
                        if w_data.get("status") != "CONNECTED" or not retrieved_at:
                            raise RuntimeError("Rainfall forecast unavailable; provider response is not valid")
                        retrieved_time = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
                        age_seconds = (datetime.now(timezone.utc) - retrieved_time).total_seconds()
                        if age_seconds < 0 or age_seconds > settings.WEATHER_MAX_AGE_SECONDS:
                            raise RuntimeError(f"Rainfall input is stale ({age_seconds:.0f}s old)")
                    # Extract hourly rain forecast
                    hourly_rain = w_data.get("hourly", {}).get("precipitation", [])
                    current = w_data.get("current", {})
                    current_rain = current.get("precipitation")
                    if record.get("mode") == "LIVE":
                        if w_data.get("status") != "CONNECTED" or current_rain is None:
                            raise RuntimeError("Current weather observation unavailable")
                        rainfall_rates = [float(current_rain)] * 12
                    elif hourly_rain:
                        rainfall_rates = [float(r) for r in hourly_rain[:12]]
                except Exception as ex:
                    record["provenance"]["weather"] = {"provider": weather.name, "status": "ERROR", "error": str(ex)}

            # A simulation must be reproducible from an explicit scenario or a live forecast.
            # Never replace missing provider data with an unlabeled weather event.
            scenario_rain = record.get("scenario_rainfall_mm_hr")
            if record.get("mode") == "SCENARIO":
                rainfall_rates = [float(scenario_rain)] * 12
                record["provenance"]["rainfall_source"] = "SCENARIO_INPUT"
            elif record.get("mode") in {"LIVE", "FORECAST"} and not rainfall_rates:
                raise RuntimeError(
                    "Rainfall forecast unavailable; provide scenario_rainfall_mm_hr "
                    "or retry when the weather provider is available"
                )
            else:
                record["provenance"]["rainfall_source"] = "OPEN_METEO_CURRENT" if record.get("mode") == "LIVE" else "OPEN_METEO_FORECAST"
                record["provenance"]["rainfall_is_observed"] = record.get("mode") == "LIVE"
            record["provenance"]["provider_snapshot"] = record["provenance"].get("weather")
            record["input_hash"] = hashlib.sha256(json.dumps({"rainfall": rainfall_rates, "provider": record["provenance"].get("provider_snapshot")}, sort_keys=True).encode()).hexdigest()
            await runtime_store.save_simulation(simulation_id, record)
            await runtime_store.publish("INPUTS_READY", {"simulation_id": simulation_id, "input_hash": record["input_hash"]})
            await runtime_store.publish("RAINFALL_READY", {"simulation_id": simulation_id, "mode": record.get("mode")})

            # 2. Setup Analysis Grid & Total Catchment Area
            grid_cells = generate_analysis_grid()
            await runtime_store.publish("GIS_READY", {"simulation_id": simulation_id, "grid_cell_count": len(grid_cells)})
            total_catchment_ha = sum(cell["area_hectares"] for cell in grid_cells)
            avg_runoff_c = 0.75  # Urban Mumbai built-up catchment

            # 3. Assess Drainage Network Total Capacity
            drainage = drainage_service.get_drainage_network()
            if drainage.get("status") != "AVAILABLE" or not drainage.get("features"):
                raise RuntimeError(f"Drainage network unavailable: {drainage.get('error', 'empty dataset')}")
            drain_features = drainage.get("features", [])
            known_capacities = [
                f["properties"]["capacity_m3s"]
                for f in drain_features
                if f.get("properties", {}).get("capacity_m3s") is not None
            ]
            configured_capacity = settings.DRAINAGE_OUTFALL_CAPACITY_M3S
            if known_capacities:
                total_drain_capacity_m3s = sum(known_capacities)
                capacity_type = "SOURCE_ATTRIBUTES"
            elif configured_capacity is not None:
                total_drain_capacity_m3s = configured_capacity
                capacity_type = "CONFIGURED_ASSUMPTION"
            else:
                raise RuntimeError(
                    "Drainage capacity unavailable; ingest source attributes or configure "
                    "DRAINAGE_OUTFALL_CAPACITY_M3S explicitly"
                )
            record["provenance"]["drainage_capacity_m3s"] = total_drain_capacity_m3s
            record["provenance"]["drainage_capacity_type"] = capacity_type
            await runtime_store.publish("DRAINAGE_READY", {"simulation_id": simulation_id, "feature_count": len(drain_features)})

            # 4. Time-Stepped Simulation Loop
            timeline = []
            horizon_mins = record["horizon_minutes"]
            dt_mins = record["timestep_minutes"]
            num_steps = horizon_mins // dt_mins
            dt_seconds = dt_mins * 60.0

            cumulative_water_cells = grid_cells
            peak_flood_depth = 0.0
            latest_inundated_cells = []

            for step_idx in range(num_steps):
                t_mins = step_idx * dt_mins
                # Sample rainfall rate for this hour
                rain_idx = min(step_idx // max(1, (60 // dt_mins)), len(rainfall_rates) - 1)
                rain_mm_hr = rainfall_rates[rain_idx]

                # Runoff Q (m3/s)
                runoff_res = calculate_rational_runoff(rain_mm_hr, total_catchment_ha, avg_runoff_c)
                total_runoff_m3s = runoff_res["runoff_m3s"]

                # Overflow Q (m3/s)
                overflow_res = calculate_drainage_overflow(total_runoff_m3s, total_drain_capacity_m3s)
                overflow_m3s = overflow_res["overflow_m3s"]

                # Terrain Inundation (water depth in each cell) — runoff/overflow is
                # injected at the actual drainage/outfall/manhole source locations,
                # not spread uniformly across the whole grid.
                manholes = drainage_service.gis_service.get_manholes() if hasattr(drainage_service, "gis_service") else gis_service.get_manholes()
                mapped_sources = drain_features + (manholes.get("features", []) if manholes.get("status") == "AVAILABLE" else [])
                if not mapped_sources:
                    raise RuntimeError("Mapped drainage/outfall/manhole point locations unavailable")
                source_cells = []
                for source in mapped_sources:
                    source_shape = shape(source["geometry"])
                    if source_shape.is_empty:
                        continue
                    point = source_shape.representative_point()
                    nearest = min(grid_cells, key=lambda cell: point.distance(Point(cell["center"]["lon"], cell["center"]["lat"])))
                    source_cells.append(nearest["cell_id"])
                if not source_cells:
                    raise RuntimeError("Mapped drainage/outfall/manhole geometries are invalid")
                inundated_cells = calculate_terrain_inundation(
                    overflow_m3s=overflow_m3s,
                    duration_seconds=dt_seconds,
                    grid_cells=cumulative_water_cells,
                    tidal_stage_m=settings.TIDAL_STAGE_M,
                    source_cell_ids=source_cells,
                )
                cumulative_water_cells = inundated_cells
                latest_inundated_cells = inundated_cells

                step_max_depth = max((c["depth_m"] for c in inundated_cells), default=0.0)
                if step_max_depth > peak_flood_depth:
                    peak_flood_depth = step_max_depth

                risk_class = classify_flood_risk(step_max_depth)

                timeline.append({
                    "step_index": step_idx,
                    "timestep_minutes": t_mins,
                    "rainfall_mm_hr": rain_mm_hr,
                    "total_runoff_m3s": total_runoff_m3s,
                    "overflow_m3s": overflow_m3s,
                    "max_depth_m": round(step_max_depth, 3),
                    "risk_level": risk_class["risk_level"],
                    "drainage_status": overflow_res["status"],
                    "drainage_capacity_m3s": total_drain_capacity_m3s,
                    "tidal_stage_m": settings.TIDAL_STAGE_M,
                    "timestamp": runtime_store.now(),
                    "result_type": "DERIVED",
                })

            record["timeline"] = timeline

            record["provenance"]["hydraulic_diagnostics"] = {
                "input_volume_m3": sum(c.get("volume_m3", 0.0) for c in latest_inundated_cells),
                "mass_balance_error_m3": max((abs(c.get("mass_balance_error_m3", 0.0)) for c in latest_inundated_cells), default=0.0),
            }
            await runtime_store.publish("SIMULATION_PROGRESS", {"simulation_id": simulation_id, "progress": 1.0})

            # 5. Spatially intersect each road against all flood cells (real
            # LineString/Polygon geometric intersection, not a single-midpoint
            # bbox sample — a long road can cross several cells with different
            # depths, and a midpoint sample can miss a flooded stretch entirely).
            flooded_roads_map = {}
            affected_road_features = []
            roads_data = gis_service.get_roads()

            for r_feat in roads_data.get("features", []):
                geom = r_feat.get("geometry")
                if not geom or geom.get("type") != "LineString":
                    continue
                coords = geom.get("coordinates", [])
                if not coords:
                    continue

                road = LineString(coords)
                depths = [cell["depth_m"] for cell in latest_inundated_cells if road.intersects(shape(cell["geometry"]))]
                road_depth = max(depths, default=0.0)
                affected_length_ratio = sum(road.intersection(shape(cell["geometry"])).length for cell in latest_inundated_cells if road.intersects(shape(cell["geometry"]))) / max(road.length, 1e-9)

                props = dict(r_feat.get("properties") or {})
                road_id = str(props.get("id") or props.get("osm_id") or len(affected_road_features))
                flooded_roads_map[road_id] = road_depth

                if road_depth >= 0.05:
                    risk_info = classify_flood_risk(road_depth)
                    props.update({
                        "predicted_depth_m": road_depth,
                        "affected_length_ratio": round(min(affected_length_ratio, 1.0), 3),
                        "risk_level": risk_info["risk_level"],
                        "is_blocked": road_depth >= 0.30,
                        "label": "DERIVED FLOOD-IMPACT ESTIMATE",
                        "result_type": "DERIVED",
                    })
                    affected_road_features.append({
                        "type": "Feature",
                        "geometry": geom,
                        "properties": props,
                    })

            record["flooded_roads"] = flooded_roads_map
            record["affected_roads"] = {
                "type": "FeatureCollection",
                "features": affected_road_features,
                "label": "DERIVED FLOOD-IMPACT ESTIMATE",
                "result_type": "DERIVED",
            }

            # 6. Intersect with Critical Infrastructure & Trigger Alerts
            crit_data = gis_service.get_critical_infrastructure()
            affected_crit_features = []

            for c_feat in crit_data.get("features", []):
                geom = c_feat.get("geometry")
                if not geom or geom.get("type") != "Point":
                    continue
                c_lon, c_lat = geom["coordinates"][0], geom["coordinates"][1]

                infra_depth = 0.0
                for cell in latest_inundated_cells:
                    bbox = cell.get("bbox") or cell.get("cell", {}).get("bbox", {})
                    if not bbox:
                        continue
                    if bbox["min_lon"] <= c_lon <= bbox["max_lon"] and bbox["min_lat"] <= c_lat <= bbox["max_lat"]:
                        infra_depth = cell["depth_m"]
                        break

                props = dict(c_feat.get("properties") or {})
                if infra_depth >= 0.05:
                    risk_info = classify_flood_risk(infra_depth)
                    props.update({
                        "predicted_depth_m": infra_depth,
                        "risk_level": risk_info["risk_level"],
                        "result_type": "DERIVED",
                    })
                    affected_crit_features.append({
                        "type": "Feature",
                        "geometry": geom,
                        "properties": props,
                    })

                    # If critical water depth reached, emit real operational alert!
                    if infra_depth >= 0.30:
                        facility_name = props.get("name") or props.get("amenity") or "Critical Facility"
                        await runtime_store.add_alert({
                            "alert_id": f"ALERT_{simulation_id[:8]}_{len(runtime_store.alerts)+1}",
                            "simulation_id": simulation_id,
                            "severity": "CRITICAL",
                            "title": f"Inundation Threat at {facility_name}",
                            "location_name": facility_name,
                            "predicted_depth_m": infra_depth,
                            "basis": f"Simulated flood depth of {infra_depth}m exceeds 0.30m critical threshold under {peak_flood_depth}m peak storm event",
                            "source_type": "DERIVED",
                            "coordinates": [c_lon, c_lat],
                        })

            record["critical_locations"] = {
                "type": "FeatureCollection",
                "features": affected_crit_features,
                "result_type": "DERIVED",
            }

            # Store GeoJSON polygons of inundated cells for /flood/depth
            record["grid_cells"] = [
                {
                    "type": "Feature",
                    "geometry": c["geometry"],
                    "properties": {
                        "cell_id": c["cell_id"],
                        "depth_m": c["depth_m"],
                        "risk_level": c["risk_level"],
                        "elevation_m": c["elevation_m"],
                        "volume_m3": c["volume_m3"],
                        "result_type": "DERIVED",
                    },
                }
                for c in latest_inundated_cells
                if c["depth_m"] > 0.0
            ]

            record["status"] = "COMPLETED"
            record["finished_at"] = runtime_store.now()
            record["peak_flood_depth_m"] = round(peak_flood_depth, 3)

            await runtime_store.save_simulation(simulation_id, record)
            logger.info(
                f"Simulation '{simulation_id}' COMPLETED successfully (peak_depth={peak_flood_depth}m, affected_roads={len(affected_road_features)})"
            )
            await runtime_store.publish(
                "JOB_COMPLETED",
                {
                    "simulation_id": simulation_id,
                    "status": "COMPLETED",
                    "peak_depth_m": round(peak_flood_depth, 3),
                    "affected_roads": len(affected_road_features),
                },
            )

        except Exception as e:
            logger.error(f"Simulation {simulation_id} failed with error: {e}", exc_info=True)
            record["status"] = "FAILED"
            record["error"] = str(e)
            record["finished_at"] = runtime_store.now()
            await runtime_store.save_simulation(simulation_id, record)
            await runtime_store.publish(
                "JOB_FAILED",
                {"simulation_id": simulation_id, "status": "FAILED", "error": str(e)},
            )

    def get(self, simulation_id: str) -> Optional[Dict[str, Any]]:
        record = runtime_store.simulations.get(simulation_id)
        return deepcopy(record) if record else None


simulation_service = SimulationService()
