"""Calibration metrics and operational-readiness gate for flood simulations."""

import math
from typing import Iterable, Sequence


def rmse(predicted: Sequence[float], observed: Sequence[float]) -> float:
    if len(predicted) != len(observed) or not predicted:
        raise ValueError("Predicted and observed series must be non-empty and equal length")
    return math.sqrt(sum((p - o) ** 2 for p, o in zip(predicted, observed)) / len(predicted))


def nash_sutcliffe_efficiency(predicted: Sequence[float], observed: Sequence[float]) -> float:
    if len(predicted) != len(observed) or not predicted:
        raise ValueError("Predicted and observed series must be non-empty and equal length")
    mean_observed = sum(observed) / len(observed)
    denominator = sum((value - mean_observed) ** 2 for value in observed)
    if denominator == 0:
        raise ValueError("Observed series must have non-zero variance")
    return 1.0 - sum((p - o) ** 2 for p, o in zip(predicted, observed)) / denominator


def calibration_report(predicted: Iterable[float], observed: Iterable[float], minimum_nse: float = 0.5) -> dict:
    predicted_values = list(predicted)
    observed_values = list(observed)
    score = nash_sutcliffe_efficiency(predicted_values, observed_values)
    return {
        "status": "CALIBRATED" if score >= minimum_nse else "UNCALIBRATED",
        "rmse_m": round(rmse(predicted_values, observed_values), 6),
        "nse": round(score, 6),
        "minimum_nse": minimum_nse,
        "sample_count": len(observed_values),
        "operational_ready": score >= minimum_nse,
    }
