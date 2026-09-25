import pytest
from app.simulation.runoff import compute_rational_runoff, get_mumbai_runoff_coefficient


def test_rational_method_basic():
    # Q = 0.00278 * C * I * A
    # C = 0.80, I = 50 mm/hr, A = 100 hectares (1 km²)
    # Q = 0.00278 * 0.80 * 50 * 100 = 11.12 m³/s
    q = compute_rational_runoff(runoff_coefficient=0.80, rainfall_intensity_mm_h=50.0, catchment_area_ha=100.0)
    assert abs(q - 11.12) < 0.05


def test_runoff_coefficient_mapping():
    c_urban = get_mumbai_runoff_coefficient("commercial")
    c_open = get_mumbai_runoff_coefficient("open_space")
    assert c_urban > c_open
    assert 0.1 <= c_urban <= 0.95
    assert 0.1 <= c_open <= 0.95


def test_zero_rainfall_zero_runoff():
    q = compute_rational_runoff(runoff_coefficient=0.85, rainfall_intensity_mm_h=0.0, catchment_area_ha=50.0)
    assert q == 0.0
