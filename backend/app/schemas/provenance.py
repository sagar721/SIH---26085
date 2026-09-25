from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DatasetProvenance(BaseModel):
    provider: str
    dataset_name: str
    source_type: str
    source_url: Optional[str] = None
    update_frequency: str
    spatial_coverage: str
    spatial_resolution: Optional[str] = None
    attribution: str
    limitations: str


class ModelSpecification(BaseModel):
    model_name: str
    purpose: str
    governing_equations: List[str]
    inputs: List[str]
    outputs: List[str]
    assumptions_for_prototype: List[str]
    limitations: str


class ProvenanceReport(BaseModel):
    system: str
    sih_problem: str
    primary_city: str
    study_corridor: str
    metric_crs: str
    datasets: List[DatasetProvenance]
    models: List[ModelSpecification]
    rules_compliance: Dict[str, str]
