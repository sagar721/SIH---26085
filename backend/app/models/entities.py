import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    Text,
)
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry

from app.models.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class StudyArea(Base):
    __tablename__ = "study_areas"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    zone_id = Column(String(64), unique=True, nullable=False)
    city = Column(String(100), default="Mumbai")
    crs = Column(String(20), default="EPSG:4326")
    projected_crs = Column(String(20), default="EPSG:32643")
    bbox = Column(JSON, nullable=False)
    geom = Column(Geometry("POLYGON", srid=4326), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class DataSource(Base):
    __tablename__ = "data_sources"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    provider_type = Column(String(64), nullable=False)
    source_url = Column(Text, nullable=True)
    requires_key = Column(Boolean, default=False)
    attribution = Column(Text, nullable=True)
    last_status = Column(String(32), default="NOT_CONFIGURED")
    last_success = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class DataRefreshLog(Base):
    __tablename__ = "data_refresh_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_id = Column(String(64), ForeignKey("data_sources.id"), nullable=False)
    status = Column(String(32), nullable=False)
    duration_ms = Column(Float, nullable=True)
    records_updated = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=utcnow)


class WeatherObservation(Base):
    __tablename__ = "weather_observations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(64), nullable=False)
    observation_time = Column(DateTime(timezone=True), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    precipitation_mm = Column(Float, nullable=False)
    rainfall_rate_mm_hr = Column(Float, nullable=True)
    temperature_c = Column(Float, nullable=True)
    wind_speed_kmh = Column(Float, nullable=True)
    source_type = Column(String(32), default="OBSERVED")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class WeatherForecast(Base):
    __tablename__ = "weather_forecasts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(64), nullable=False)
    forecast_generated_time = Column(DateTime(timezone=True), nullable=False)
    valid_time = Column(DateTime(timezone=True), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    predicted_precipitation_mm = Column(Float, nullable=False)
    precipitation_probability = Column(Float, nullable=True)
    source_type = Column(String(32), default="FORECAST")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Road(Base):
    __tablename__ = "roads"

    id = Column(String(128), primary_key=True)
    name = Column(String(255), nullable=True)
    highway_type = Column(String(64), nullable=True)
    lanes = Column(Integer, nullable=True)
    surface = Column(String(64), nullable=True)
    length_m = Column(Float, nullable=True)
    geom = Column(Geometry("LINESTRING", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="OSM")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Building(Base):
    __tablename__ = "buildings"

    id = Column(String(128), primary_key=True)
    building_type = Column(String(64), nullable=True)
    levels = Column(Integer, nullable=True)
    geom = Column(Geometry("POLYGON", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="OSM")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class StormwaterDrain(Base):
    __tablename__ = "stormwater_drains"

    id = Column(String(128), primary_key=True)
    drain_type = Column(String(64), nullable=True)
    width_m = Column(Float, nullable=True)
    depth_m = Column(Float, nullable=True)
    shape = Column(String(64), nullable=True)
    capacity_m3s = Column(Float, nullable=True)
    capacity_type = Column(String(32), default="ASSUMED_FOR_PROTOTYPE")
    geom = Column(Geometry("LINESTRING", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="BMC_GIS")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class StormwaterManhole(Base):
    __tablename__ = "stormwater_manholes"

    id = Column(String(128), primary_key=True)
    manhole_type = Column(String(64), nullable=True)
    depth_m = Column(Float, nullable=True)
    geom = Column(Geometry("POINT", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="BMC_GIS")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class WaterBody(Base):
    __tablename__ = "water_bodies"

    id = Column(String(128), primary_key=True)
    name = Column(String(255), nullable=True)
    water_type = Column(String(64), nullable=True)
    geom = Column(Geometry("GEOMETRY", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="OSM")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class FloodingSpot(Base):
    __tablename__ = "flooding_spots"

    id = Column(String(128), primary_key=True)
    location_name = Column(String(255), nullable=True)
    severity_history = Column(String(64), nullable=True)
    geom = Column(Geometry("POINT", srid=4326), nullable=False)
    source_dataset = Column(String(64), default="BMC_GIS")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class CriticalInfrastructure(Base):
    __tablename__ = "critical_infrastructure"

    id = Column(String(128), primary_key=True)
    name = Column(String(255), nullable=False)
    category = Column(String(64), nullable=False)  # Hospital, Fire Station, Police, Substation
    geom = Column(Geometry("POINT", srid=4326), nullable=False)
    source_dataset = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Simulation(Base):
    __tablename__ = "simulations"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    status = Column(String(32), default="QUEUED")  # QUEUED, RUNNING, COMPLETED, FAILED
    rainfall_scenario = Column(String(64), nullable=False)
    duration_minutes = Column(Integer, default=180)
    timestep_minutes = Column(Integer, default=15)
    parameters = Column(JSON, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    steps = relationship("SimulationStep", back_populates="simulation", cascade="all, delete-orphan")


class SimulationStep(Base):
    __tablename__ = "simulation_steps"

    id = Column(Integer, primary_key=True, autoincrement=True)
    simulation_id = Column(String(64), ForeignKey("simulations.id"), nullable=False)
    timestep_index = Column(Integer, nullable=False)
    timestep_minutes = Column(Integer, nullable=False)
    valid_time = Column(DateTime(timezone=True), nullable=False)
    rainfall_rate_mm_hr = Column(Float, nullable=False)
    total_runoff_m3s = Column(Float, nullable=False)
    total_overflow_m3s = Column(Float, nullable=False)
    max_flood_depth_m = Column(Float, nullable=False)
    result_type = Column(String(32), default="SIMULATION")
    data_payload = Column(JSON, nullable=True)

    simulation = relationship("Simulation", back_populates="steps")


class RoadRisk(Base):
    __tablename__ = "road_risk"

    id = Column(Integer, primary_key=True, autoincrement=True)
    simulation_id = Column(String(64), ForeignKey("simulations.id"), nullable=False)
    road_id = Column(String(128), nullable=False)
    timestep_minutes = Column(Integer, nullable=False)
    predicted_depth_m = Column(Float, nullable=False)
    risk_level = Column(String(32), nullable=False)  # LOW, MODERATE, HIGH, CRITICAL
    time_to_critical_min = Column(Float, nullable=True)
    is_blocked = Column(Boolean, default=False)
    result_type = Column(String(32), default="DERIVED")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    severity = Column(String(32), nullable=False)  # LOW, MODERATE, HIGH, CRITICAL
    title = Column(String(255), nullable=False)
    location_name = Column(String(255), nullable=False)
    predicted_depth_m = Column(Float, nullable=False)
    time_to_critical_min = Column(Float, nullable=True)
    basis = Column(Text, nullable=False)
    source_type = Column(String(32), default="DERIVED")
    geom = Column(Geometry("POINT", srid=4326), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
