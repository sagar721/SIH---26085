import pytest
from app.simulation.drainage_capacity import compute_manning_open_channel_capacity
from app.simulation.overflow import compute_drainage_overflow


def test_manning_capacity_calculation():
    # Width 3.0m, Depth 2.0m, slope 0.001, n=0.015 (concrete)
    cap = compute_manning_open_channel_capacity(width_m=3.0, depth_m=2.0, longitudinal_slope=0.001, manning_n=0.015)
    assert cap > 5.0  # Should be physically sensible positive flow
    assert cap < 100.0


def test_drainage_overflow_when_exceeded():
    # Capacity = 10 m³/s, Runoff = 18 m³/s -> Overflow = 8 m³/s
    res = compute_drainage_overflow(runoff_m3_s=18.0, capacity_m3_s=10.0)
    assert res["is_overflowing"] is True
    assert res["overflow_m3_s"] == 8.0
    assert res["utilization_ratio"] == 1.8


def test_drainage_no_overflow_within_capacity():
    res = compute_drainage_overflow(runoff_m3_s=6.0, capacity_m3_s=10.0)
    assert res["is_overflowing"] is False
    assert res["overflow_m3_s"] == 0.0
    assert res["utilization_ratio"] == 0.6
