from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(..., description="Overall health status", examples=["ok"])
    app: str = Field(..., description="Application name", examples=["M-FLOOD"])
    version: str = Field(..., description="Application version", examples=["0.1.0"])
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC timestamp of response")
    environment: Optional[str] = Field(default=None, description="Execution environment")


class ProbeResponse(BaseModel):
    status: str = Field(..., description="Probe status: 'live' or 'ready'", examples=["live"])
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC timestamp of probe")
    database_status: Optional[str] = Field(default=None, description="Database state: CONNECTED, NOT_CONFIGURED, or UNAVAILABLE", examples=["CONNECTED"])
    database_detail: Optional[str] = Field(default=None, description="Detailed database or PostGIS information")
    redis_status: Optional[str] = Field(default=None, description="Redis state: CONNECTED, NOT_CONFIGURED, or UNAVAILABLE: <error>")
    celery_status: Optional[str] = Field(default=None, description="Celery worker state: CONNECTED, NOT_CONFIGURED, or UNAVAILABLE")
    providers_status: Optional[str] = Field(default=None, description="At least one external data provider adapter is AVAILABLE, or NOT_CONFIGURED")
