import math
from typing import Any, Dict, Optional


def calculate_manning_capacity(
    width_m: float = 1.2,
    depth_m: float = 1.0,
    slope: float = 0.002,
    manning_n: float = 0.015,
    is_closed_conduit: bool = False
) -> Dict[str, Any]:
    """
    Calculate drainage hydraulic flow capacity using Manning's Equation:
    Q = (1 / n) * A * R^(2/3) * S^(1/2)

    Where:
    - n: Manning roughness coefficient (default 0.015 for cast-in-place concrete)
    - A: Flow cross-sectional area (m2)
    - R: Hydraulic radius (m) = A / P
    - S: Longitudinal channel bed slope (m/m)
    """
    if width_m <= 0 or depth_m <= 0 or slope <= 0 or manning_n <= 0:
        raise ValueError("All hydraulic parameters must be positive numbers")

    area_m2 = width_m * depth_m
    if is_closed_conduit:
        wetted_perimeter_m = 2.0 * (width_m + depth_m)
    else:
        wetted_perimeter_m = width_m + 2.0 * depth_m

    hydraulic_radius_m = area_m2 / wetted_perimeter_m

    # Manning's equation
    q_capacity_m3s = (1.0 / manning_n) * area_m2 * (hydraulic_radius_m ** (2.0 / 3.0)) * math.sqrt(slope)

    return {
        "capacity_m3s": round(q_capacity_m3s, 3),
        "capacity_type": "ASSUMED_FOR_PROTOTYPE",
        "parameters": {
            "width_m": width_m,
            "depth_m": depth_m,
            "slope": slope,
            "manning_n": manning_n,
            "is_closed_conduit": is_closed_conduit,
            "area_m2": round(area_m2, 3),
            "wetted_perimeter_m": round(wetted_perimeter_m, 3),
            "hydraulic_radius_m": round(hydraulic_radius_m, 3),
        },
        "assumptions": "Municipal drain dimensions and slopes are assumed prototype standards for Mumbai coastal storm drains where field telemetry is unmeasured."
    }


def compute_manning_open_channel_capacity(
    width_m: float,
    depth_m: float,
    longitudinal_slope: float,
    manning_n: float = 0.015
) -> float:
    """Convenience function returning channel capacity in m3/s."""
    res = calculate_manning_capacity(
        width_m=width_m,
        depth_m=depth_m,
        slope=longitudinal_slope,
        manning_n=manning_n,
        is_closed_conduit=False
    )
    return res["capacity_m3s"]
