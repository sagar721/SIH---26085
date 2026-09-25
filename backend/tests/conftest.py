import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

settings.ALLOW_INSECURE_LOCAL_AUTH = True
settings.DRAINAGE_OUTFALL_CAPACITY_M3S = 30.0
settings.ALLOW_INPROCESS_SIMULATION_FALLBACK = True


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
