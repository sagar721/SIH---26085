from typing import Any, Dict
from fastapi import APIRouter
from app.services.gis_service import gis_service

router = APIRouter()


@router.get("/drains", summary="Storm Water Drains", description="Returns Mumbai storm water drainage network geometry from BMC GIS.")
async def get_drains() -> Dict[str, Any]:
    return gis_service.get_drains()


@router.get("/manholes", summary="Storm Water Manholes", description="Returns storm water manhole locations from BMC GIS.")
async def get_manholes() -> Dict[str, Any]:
    return gis_service.get_manholes()


@router.get("/flooding-spots", summary="Historical Flooding Spots", description="Returns documented municipal flood vulnerability spots from BMC GIS.")
async def get_flooding_spots() -> Dict[str, Any]:
    return gis_service.get_flooding_spots()


@router.get("/critical-infrastructure", summary="Critical Infrastructure", description="Returns hospitals, police, and fire stations from BMC GIS.")
async def get_critical_infrastructure() -> Dict[str, Any]:
    return gis_service.get_critical_infrastructure()


@router.get("/roads", summary="Road Network", description="Returns road network geometry within study area from OpenStreetMap.")
async def get_roads() -> Dict[str, Any]:
    return gis_service.get_roads()


@router.get("/buildings", summary="Building Footprints", description="Returns building footprints within study area from OpenStreetMap.")
async def get_buildings() -> Dict[str, Any]:
    return gis_service.get_buildings()


@router.get("/water-bodies", summary="Water Bodies & River Channels", description="Returns Mithi River and surrounding waterways from OpenStreetMap.")
async def get_water_bodies() -> Dict[str, Any]:
    return gis_service.get_water_bodies()
