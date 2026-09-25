from fastapi import APIRouter, HTTPException, status
from app.core.config import settings
from app.schemas.health import HealthResponse, ProbeResponse
from app.models.database import check_database_health
from app.data_sources import PROVIDERS

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Application Health Status",
    description="Returns the current operational status, version, and environment of the M-FLOOD API.",
)
async def get_health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.PROJECT_NAME,
        version="0.1.0",
        environment=settings.ENVIRONMENT,
    )


@router.get(
    "/health/live",
    response_model=ProbeResponse,
    status_code=status.HTTP_200_OK,
    summary="Liveness Probe",
    description="Liveness check for Kubernetes/orchestration to verify the server process is responsive.",
)
async def get_liveness() -> ProbeResponse:
    return ProbeResponse(status="live")




@router.get(
    "/health/ready",
    response_model=ProbeResponse,
    status_code=status.HTTP_200_OK,
    summary="Readiness Probe",
    description="Readiness check indicating whether the server and its subsystems (e.g. database) are ready.",
)
async def get_readiness() -> ProbeResponse:
    # Every dependency check below degrades gracefully: an unconfigured
    # dependency reports NOT_CONFIGURED (a normal, expected local-dev state,
    # never an error), and any real connection failure is caught and reported
    # as UNAVAILABLE with the underlying reason — this endpoint itself never
    # raises an unhandled exception, in production or in local development.
    db_status, db_detail = check_database_health()
    redis_status = "NOT_CONFIGURED"
    celery_status = "NOT_CONFIGURED"
    providers_status = "AVAILABLE" if PROVIDERS else "NOT_CONFIGURED"

    if settings.CELERY_BROKER_URL:
        try:
            from redis import Redis
            Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=1, socket_timeout=1).ping()
            redis_status = "CONNECTED"
        except Exception as exc:
            redis_status = f"UNAVAILABLE: {exc}"
        if redis_status == "CONNECTED":
            try:
                from app.workers.celery_app import celery_app
                replies = celery_app.control.inspect(timeout=1).ping() or {}
                celery_status = "CONNECTED" if replies else "UNAVAILABLE"
            except Exception as exc:
                celery_status = f"UNAVAILABLE: {exc}"

    dependency_ready = (
        db_status == "CONNECTED"
        and redis_status == "CONNECTED"
        and celery_status == "CONNECTED"
        and providers_status == "AVAILABLE"
    )
    if not dependency_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "not_ready",
                "database_status": db_status, "database_detail": db_detail,
                "redis_status": redis_status, "celery_status": celery_status, "providers_status": providers_status,
            },
        )
    return ProbeResponse(
        status="ready",
        database_status=db_status,
        database_detail=db_detail,
        redis_status=redis_status,
        celery_status=celery_status,
        providers_status=providers_status,
    )
