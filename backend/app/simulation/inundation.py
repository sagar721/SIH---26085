"""Finite-volume local-inertial overland-flow solver for the analysis grid."""

import math
from typing import Any, Dict, List, Optional, Tuple

from app.gis.analysis_grid import generate_analysis_grid
from app.services.dem_service import dem_service
from app.simulation.risk import classify_flood_risk

GRAVITY_M_S2 = 9.80665
MAX_SUBSTEP_SECONDS = 10.0


def _grid_neighbors(cells: List[Dict[str, Any]]) -> List[Tuple[int, int, float]]:
    """Return unique east/north neighbor pairs and their metric center distance."""
    with_bbox = [cell for cell in cells if cell.get("bbox")]
    if not with_bbox:
        return []
    longitudes = sorted({round(float(cell["bbox"]["min_lon"]), 8) for cell in with_bbox})
    latitudes = sorted({round(float(cell["bbox"]["min_lat"]), 8) for cell in with_bbox})
    by_index = {
        (longitudes.index(round(float(cell["bbox"]["min_lon"]), 8)), latitudes.index(round(float(cell["bbox"]["min_lat"]), 8))): index
        for index, cell in enumerate(cells) if cell.get("bbox")
    }
    pairs: List[Tuple[int, int, float]] = []
    for (x_index, y_index), source_index in by_index.items():
        for neighbor_key in ((x_index + 1, y_index), (x_index, y_index + 1)):
            target_index = by_index.get(neighbor_key)
            if target_index is None:
                continue
            source, target = cells[source_index], cells[target_index]
            dx = (target["center"]["lon"] - source["center"]["lon"]) * 111000.0 * math.cos(math.radians(source["center"]["lat"]))
            dy = (target["center"]["lat"] - source["center"]["lat"]) * 111000.0
            pairs.append((source_index, target_index, max(math.hypot(dx, dy), 1.0)))
    return pairs


def calculate_terrain_inundation(
    overflow_m3s: float,
    duration_seconds: float = 900.0,
    grid_cells: Optional[List[Dict[str, Any]]] = None,
    tidal_stage_m: float = 0.0,
    source_cell_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Advance a local-inertial finite-volume shallow-water approximation.

    Cell-interface transfers are equal and opposite, so volume is conserved
    apart from explicitly reported tidal inflow and boundary outflow. This is a
    prototype solver, not a calibrated or certified Saint-Venant model.

    Drainage overflow is injected at source_cell_ids (the grid cells nearest
    the actual drainage/outfall/manhole point locations) rather than spread
    uniformly across every cell in the grid — surcharging water enters the
    terrain at the drainage network's real outfall points, not everywhere at
    once, which was a physically implausible simplification in the earlier
    version of this solver.
    """
    if overflow_m3s < 0 or duration_seconds <= 0:
        raise ValueError("Overflow discharge must be non-negative and duration must be positive")
    if tidal_stage_m < 0:
        raise ValueError("Tidal stage must be non-negative")

    source_cells = grid_cells if grid_cells is not None else generate_analysis_grid()
    if not source_cells:
        return []

    cells: List[Dict[str, Any]] = []
    for source in source_cells:
        center = source["center"]
        elevation = float(source.get("elevation_m", dem_service.get_elevation_at_point(center["lon"], center["lat"])))
        area = float(source["area_m2"])
        depth = max(float(source.get("water_depth_m", source.get("depth_m", 0.0))), 0.0)
        cells.append({**source, "elevation_m": elevation, "area_m2": area, "water_depth_m": depth})

    initial_volume = sum(cell["area_m2"] * cell["water_depth_m"] for cell in cells)
    source_volume = overflow_m3s * duration_seconds
    total_area = sum(cell["area_m2"] for cell in cells)
    bbox_cells = [cell for cell in cells if cell.get("bbox")]
    min_lon = min(cell["bbox"]["min_lon"] for cell in bbox_cells)
    max_lon = max(cell["bbox"]["max_lon"] for cell in bbox_cells)
    min_lat = min(cell["bbox"]["min_lat"] for cell in bbox_cells)
    max_lat = max(cell["bbox"]["max_lat"] for cell in bbox_cells)
    boundary_indices = {
        index for index, cell in enumerate(cells)
        if cell.get("bbox") and (
            cell["bbox"]["min_lon"] == min_lon or cell["bbox"]["max_lon"] == max_lon
            or cell["bbox"]["min_lat"] == min_lat or cell["bbox"]["max_lat"] == max_lat
        )
    }

    substeps = max(1, math.ceil(duration_seconds / MAX_SUBSTEP_SECONDS))
    substep_seconds = duration_seconds / substeps
    neighbors = _grid_neighbors(cells)
    tidal_inflow = 0.0
    boundary_outflow = 0.0

    for _ in range(substeps):
        source_ids = set(source_cell_ids or [])
        source_area = sum(cell["area_m2"] for cell in cells if cell.get("cell_id") in source_ids)
        if not source_ids:
            source_area = total_area
        if source_area <= 0:
            raise ValueError("At least one valid drainage source cell is required")

        for index in boundary_indices:
            cell = cells[index]
            required_depth = max(tidal_stage_m - cell["elevation_m"], 0.0)
            added_volume = max(required_depth - cell["water_depth_m"], 0.0) * cell["area_m2"]
            cell["water_depth_m"] += added_volume / cell["area_m2"]
            tidal_inflow += added_volume

        source_depth = (source_volume / substeps) / source_area
        for cell in cells:
            if not source_ids or cell.get("cell_id") in source_ids:
                cell["water_depth_m"] += source_depth

        transfers: List[Tuple[int, int, float]] = []
        for source_index, target_index, distance_m in neighbors:
            source, target = cells[source_index], cells[target_index]
            head_difference = (source["elevation_m"] + source["water_depth_m"]) - (target["elevation_m"] + target["water_depth_m"])
            if abs(head_difference) < 1e-9:
                continue
            if head_difference < 0:
                source_index, target_index = target_index, source_index
                source, target = target, source
                head_difference = -head_difference
            mean_depth = max((source["water_depth_m"] + target["water_depth_m"]) / 2.0, 1e-4)
            width_m = math.sqrt(min(source["area_m2"], target["area_m2"]))
            discharge = width_m * mean_depth * math.sqrt(GRAVITY_M_S2 * mean_depth) * head_difference / distance_m
            available_volume = source["water_depth_m"] * source["area_m2"]
            transfers.append((source_index, target_index, min(discharge * substep_seconds, available_volume * 0.25)))

        for source_index, target_index, volume in transfers:
            cells[source_index]["water_depth_m"] -= volume / cells[source_index]["area_m2"]
            cells[target_index]["water_depth_m"] += volume / cells[target_index]["area_m2"]

        for index in boundary_indices:
            cell = cells[index]
            excess_head = max(cell["elevation_m"] + cell["water_depth_m"] - tidal_stage_m, 0.0)
            discharge = math.sqrt(cell["area_m2"]) * math.sqrt(GRAVITY_M_S2 * max(cell["water_depth_m"], 1e-6)) * excess_head
            volume = min(discharge * substep_seconds, cell["water_depth_m"] * cell["area_m2"] * 0.25)
            cell["water_depth_m"] -= volume / cell["area_m2"]
            boundary_outflow += volume

    final_volume = sum(cell["area_m2"] * cell["water_depth_m"] for cell in cells)
    expected_volume = initial_volume + source_volume + tidal_inflow - boundary_outflow
    mass_balance_error = final_volume - expected_volume

    return [
        {
            **{key: value for key, value in cell.items() if key != "water_depth_m"},
            "depth_m": round(max(cell["water_depth_m"], 0.0), 3),
            "volume_m3": round(max(cell["water_depth_m"], 0.0) * cell["area_m2"], 2),
            "risk_level": classify_flood_risk(max(cell["water_depth_m"], 0.0))["risk_level"],
            "result_type": "DERIVED",
            "model_type": "LOCAL_INERTIAL_2D",
            "tidal_stage_m": tidal_stage_m,
            "mass_balance_error_m3": round(mass_balance_error, 6),
        }
        for cell in cells
    ]
