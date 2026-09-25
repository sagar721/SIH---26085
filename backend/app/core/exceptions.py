"""M-FLOOD custom domain exceptions for data integrity, providers, simulation and GIS."""

from typing import Any, Optional


class MFloodError(Exception):
    """Base exception for all M-FLOOD backend errors."""
    def __init__(self, message: str, details: Optional[Any] = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class DataSourceError(MFloodError):
    """Raised when an external data source provider fails or is unreachable."""
    def __init__(self, provider: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(f"Provider '{provider}' error: {message}", details)
        self.provider = provider


class ProvenanceError(MFloodError):
    """Raised when required provenance attributes are missing or malformed."""
    pass


class GISValidationError(MFloodError):
    """Raised when spatial datasets or geometries fail validation or CRS projection checks."""
    pass


class SimulationError(MFloodError):
    """Raised during simulation execution or parameter validation failure."""
    pass


class RoutingError(MFloodError):
    """Raised when road network graph traversal or safe pathfinding fails."""
    pass
