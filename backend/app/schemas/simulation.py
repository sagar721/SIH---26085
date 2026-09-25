from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    horizon_minutes: int = Field(default=180, ge=1, le=180)
    timestep_minutes: int = Field(default=15, ge=1, le=60)
    mode: Optional[str] = Field(default=None, pattern="^(LIVE|FORECAST|SCENARIO)$")
    scenario_rainfall_mm_hr: Optional[float] = Field(default=None, ge=0.0, le=500.0)


class SimulationSubmitResponse(BaseModel):
    simulation_id: str
    status: str
    created_at: str
    horizon_minutes: int
    timestep_minutes: int
    result_type: str = "DERIVED"


class SimulationStatusResponse(BaseModel):
    id: str
    simulation_id: str
    status: str = Field(..., description="QUEUED, RUNNING, COMPLETED, FAILED")
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    peak_flood_depth_m: Optional[float] = None
    error: Optional[str] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)
    result_type: str = "DERIVED"


class SimulationTimelineResponse(BaseModel):
    simulation_id: str
    format: str
    horizon_minutes: int
    timestep_minutes: int
    result_type: str = "DERIVED"
    timesteps: List[Dict[str, Any]] = Field(default_factory=list)
    steps: List[Dict[str, Any]] = Field(default_factory=list)
