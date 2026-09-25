import pytest
from app.simulation.risk import compute_flood_risk_score, classify_flood_hazard


def test_classify_hazard_levels():
    assert classify_flood_hazard(depth_m=0.05, velocity_m_s=0.1) == "LOW"
    assert classify_flood_hazard(depth_m=0.25, velocity_m_s=0.5) == "MODERATE"
    assert classify_flood_hazard(depth_m=0.45, velocity_m_s=1.0) == "HIGH"
    assert classify_flood_hazard(depth_m=0.80, velocity_m_s=2.0) == "CRITICAL"


def test_flood_risk_score_bounds():
    score = compute_flood_risk_score(
        depth_m=0.4,
        velocity_m_s=0.5,
        vulnerable_population_density=25000.0,
        critical_facilities_count=2
    )
    assert 0.0 <= score <= 1.0
