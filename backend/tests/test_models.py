import pytest

from app.simulation.overflow import calculate_drainage_overflow
from app.simulation.runoff import calculate_rational_runoff
from app.simulation.time_to_critical import calculate_time_to_critical
from app.simulation.inundation import calculate_terrain_inundation


def test_rational_method_hectare_units():
    # 50 mm/h, C=.8 over 10 ha is 1.112 m³/s, not 111.2 m³/s.
    assert calculate_rational_runoff(50, 10, 0.8)["runoff_m3s"] == pytest.approx(1.112)


def test_runoff_requires_explicit_coefficient():
    with pytest.raises(TypeError):
        calculate_rational_runoff(10, 1)  # type: ignore[call-arg]


def test_overflow_preserves_capacity_provenance():
    result = calculate_drainage_overflow(2.0, 1.0, capacity_type="SOURCE_ATTRIBUTE")
    assert result["overflow_m3s"] == 1.0
    assert result["capacity_type"] == "SOURCE_ATTRIBUTE"


def test_time_to_critical_does_not_call_missing_data_safe():
    result = calculate_time_to_critical([{"timestep_minutes": 15}])
    assert result["status"] == "UNAVAILABLE"


def test_inundation_solver_reports_mass_conservation_and_tidal_stage():
    cells = [
        {
            "cell_id": "A",
            "center": {"lon": 72.0, "lat": 19.0},
            "area_m2": 100.0,
            "elevation_m": 1.0,
            "bbox": {"min_lon": 72.0, "min_lat": 19.0, "max_lon": 72.01, "max_lat": 19.01},
            "geometry": {"type": "Polygon", "coordinates": []},
        },
        {
            "cell_id": "B",
            "center": {"lon": 72.01, "lat": 19.0},
            "area_m2": 100.0,
            "elevation_m": 1.5,
            "bbox": {"min_lon": 72.01, "min_lat": 19.0, "max_lon": 72.02, "max_lat": 19.01},
            "geometry": {"type": "Polygon", "coordinates": []},
        },
    ]

    result = calculate_terrain_inundation(overflow_m3s=0.1, duration_seconds=10.0, grid_cells=cells, tidal_stage_m=2.0)

    assert all(cell["model_type"] == "LOCAL_INERTIAL_2D" for cell in result)
    assert all(cell["tidal_stage_m"] == 2.0 for cell in result)
    assert all(abs(cell["mass_balance_error_m3"]) < 1e-4 for cell in result)
    assert all(cell["depth_m"] >= 0.0 for cell in result)
