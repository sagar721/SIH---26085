import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    PROJECT_NAME: str = "M-FLOOD"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    # Database
    DATABASE_URL: Optional[str] = None
    RUNTIME_STORE_PATH: str = "data/runtime_store.db"
    CELERY_BROKER_URL: Optional[str] = None
    CELERY_RESULT_BACKEND: Optional[str] = None
    ALLOW_INPROCESS_SIMULATION_FALLBACK: bool = False
    # True by default so a plain local run (no Docker) keeps working with zero
    # extra setup. Set False only for the dedicated `scheduler` process/service
    # (see scripts/run_scheduler.py), so the weather/data refresh loops run in
    # exactly one place instead of twice.
    RUN_SCHEDULED_REFRESHES_IN_API: bool = True
    JWT_SECRET_KEY: Optional[str] = None
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_MINUTES: int = 30
    JWT_REFRESH_TOKEN_DAYS: int = 7
    TIDAL_STAGE_M: float = 0.0
    DRAINAGE_OUTFALL_CAPACITY_M3S: Optional[float] = None
    AUTH_ADMIN_USERNAME: Optional[str] = None
    AUTH_ADMIN_PASSWORD: Optional[str] = None
    AUTH_ADMIN_PASSWORD_HASH: Optional[str] = None
    AUTH_OPERATOR_USERNAME: Optional[str] = None
    AUTH_OPERATOR_PASSWORD: Optional[str] = None
    AUTH_OPERATOR_PASSWORD_HASH: Optional[str] = None
    ALLOW_INSECURE_LOCAL_AUTH: bool = False

    # External OIDC login (see app/core/auth.py verify_oidc_identity). Verification
    # is JWKS/RS256-based against the real provider — there is no local-secret
    # fallback. OIDC_JWKS_URL must be set for OIDC_ENABLED to actually work;
    # otherwise oidc/login fails closed (503), never falls back to trusting an
    # unverified or locally-signed token.
    OIDC_ENABLED: bool = False
    OIDC_PROVIDER_NAME: str = "Google"
    OIDC_ISSUER_URL: Optional[str] = None
    OIDC_CLIENT_ID: Optional[str] = None
    OIDC_JWKS_URL: Optional[str] = None

    # Providers
    TOMORROW_API_KEY: Optional[str] = None
    IMD_API_KEY: Optional[str] = None
    MCGM_RAIN_GAUGE_URL: Optional[str] = None
    IMD_RADAR_URL: Optional[str] = None
    EARTHDATA_TOKEN: Optional[str] = None
    WEATHER_MAX_AGE_SECONDS: int = 900
    BMC_GIS_URL: str = "https://prsrvgisapp.mcgm.gov.in/server/rest/services/mcgm/MCGMGIS_Departments_Master_All_Layers/MapServer"

    # Config paths relative to backend root
    STUDY_AREA_CONFIG: str = "config/study_area.json"
    THRESHOLDS_CONFIG: str = "config/thresholds.json"
    PROVIDERS_CONFIG: str = "config/providers.json"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> List[str]:
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            if v.startswith("["):
                parsed = json.loads(v)
                if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
                    raise ValueError("CORS_ORIGINS must be a JSON string array")
                return parsed
            return [item.strip() for item in v.split(",") if item.strip()]
        raise ValueError("CORS_ORIGINS must be a list or comma-separated string")

    def load_study_area(self) -> Dict[str, Any]:
        p = BASE_DIR / self.STUDY_AREA_CONFIG
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        raise FileNotFoundError(f"Required study-area configuration is missing: {p}")

    def load_thresholds(self) -> Dict[str, Any]:
        p = BASE_DIR / self.THRESHOLDS_CONFIG
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        raise FileNotFoundError(f"Required threshold configuration is missing: {p}")

    def load_providers(self) -> Dict[str, Any]:
        p = BASE_DIR / self.PROVIDERS_CONFIG
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"providers": {}}


settings = Settings()
