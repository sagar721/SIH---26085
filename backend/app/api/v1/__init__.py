from app.api.v1.api import api_router
from app.api.v1 import (
    alerts,
    drainage,
    flood,
    gis,
    health,
    provenance,
    providers,
    rainfall,
    routing,
    simulation,
    updates,
    weather,
)

__all__ = [
    "api_router",
    "alerts",
    "drainage",
    "flood",
    "gis",
    "health",
    "provenance",
    "providers",
    "rainfall",
    "routing",
    "simulation",
    "updates",
    "weather",
]
