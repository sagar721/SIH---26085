from fastapi import APIRouter
from app.api.v1.endpoints import alerts, auth, drainage, flood, gis, health, providers, provenance, rainfall, routing, simulation, updates, weather

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(providers.router, prefix="/providers", tags=["Providers"])
api_router.include_router(weather.router, prefix="/weather", tags=["Weather"])
api_router.include_router(rainfall.router, prefix="/rainfall", tags=["Rainfall"])
api_router.include_router(gis.router, prefix="/gis", tags=["GIS"])
api_router.include_router(drainage.router, prefix="/drainage", tags=["Drainage"])
api_router.include_router(simulation.router, prefix="/simulation", tags=["Simulation"])
api_router.include_router(flood.router, prefix="/flood", tags=["Flood"])
api_router.include_router(routing.router, prefix="/routing", tags=["Flood-aware routing"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["Alerts"])
api_router.include_router(provenance.router, prefix="/provenance", tags=["Provenance"])
api_router.include_router(updates.router, tags=["Live updates"])

