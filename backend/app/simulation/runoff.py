from typing import Any, Dict


def calculate_rational_runoff(
    rainfall_mm_hr: float,
    area_hectares: float,
    runoff_coefficient: float
) -> Dict[str, Any]:
    """
    Calculate surface runoff using the Rational Method. The 0.278 form uses
    area in km²; with hectares the physically equivalent factor is 0.00278.

    Parameters:
    - rainfall_mm_hr (I): Rainfall intensity in mm/hour (>= 0.0)
    - area_hectares (A): Drainage/catchment surface area in hectares (> 0.0)
    - runoff_coefficient (C): explicitly supplied model parameter (0.0 to 1.0)

    Returns:
    - runoff_m3s (Q): Discharge rate in cubic meters per second (m3/s)
    - result_type: 'DERIVED'
    """
    if rainfall_mm_hr < 0:
        raise ValueError("Rainfall intensity must be non-negative")
    if area_hectares <= 0:
        raise ValueError("Drainage area must be greater than zero")
    if not (0.0 <= runoff_coefficient <= 1.0):
        raise ValueError("Runoff coefficient C must be between 0.0 and 1.0")

    q_m3s = 0.00278 * runoff_coefficient * rainfall_mm_hr * area_hectares

    return {
        "runoff_m3s": round(q_m3s, 4),
        "rainfall_mm_hr": float(rainfall_mm_hr),
        "area_hectares": float(area_hectares),
        "runoff_coefficient": float(runoff_coefficient),
        "coefficient_type": "MODEL_PARAMETER",
        "formula": "Q = 0.00278 * C * I(mm/hr) * A(ha)",
        "result_type": "DERIVED"
    }


def compute_rational_runoff(runoff_coefficient: float, rainfall_intensity_mm_h: float, catchment_area_ha: float) -> float:
    """Convenience function returning discharge in m3/s."""
    res = calculate_rational_runoff(
        rainfall_mm_hr=rainfall_intensity_mm_h,
        area_hectares=catchment_area_ha,
        runoff_coefficient=runoff_coefficient
    )
    return res["runoff_m3s"]


def get_mumbai_runoff_coefficient(land_use: str) -> float:
    """Returns typical runoff coefficients for Mumbai urban environments."""
    mapping = {
        "commercial": 0.85,
        "industrial": 0.80,
        "dense_residential": 0.75,
        "suburban_residential": 0.60,
        "paved_roads": 0.90,
        "open_space": 0.25,
        "parks": 0.20,
    }
    return mapping.get(land_use.lower(), 0.70)
