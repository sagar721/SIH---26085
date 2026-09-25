from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import Response

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.exceptions import DataSourceError, MFloodError
from app.core.logging import get_logger
from app.core.middleware import RateLimitMiddleware
from app.models.database import check_database_health

logger = get_logger("main")


from app.workers import data_worker, simulation_worker, weather_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.PROJECT_NAME} backend in '{settings.ENVIRONMENT}' mode")
    logger.info("Projected Metric CRS: EPSG:32643 (UTM Zone 43N Mumbai)")
    # Fail-fast startup gate — production deployments only. This never runs
    # for the default ENVIRONMENT=development, so local dev and the
    # frontend-only Demo Mode (which never calls the backend at all) are
    # completely unaffected: nothing here can block a hackathon demo.
    if settings.ENVIRONMENT.lower() == "production":
        db_status, db_detail = check_database_health()
        if db_status != "CONNECTED":
            raise RuntimeError(f"Production startup blocked: database is {db_status} ({db_detail})")
        if not settings.CELERY_BROKER_URL:
            raise RuntimeError("Production startup blocked: CELERY_BROKER_URL is not configured")
        try:
            from redis import Redis
            Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2).ping()
        except Exception as exc:
            raise RuntimeError(f"Production startup blocked: Redis is unavailable ({exc})") from exc
    # RUN_SCHEDULED_REFRESHES_IN_API defaults to True, so a plain local `python
    # scripts/run.py` (no Docker, no separate scheduler process) keeps working
    # exactly as before with zero extra setup. Set it to False only when
    # running the dedicated `scheduler` service (see docker-compose.yml /
    # scripts/run_scheduler.py) so the refresh loops aren't started twice.
    if settings.RUN_SCHEDULED_REFRESHES_IN_API:
        await weather_worker.start()
        await data_worker.start()
    await simulation_worker.start()
    yield
    await simulation_worker.stop()
    if settings.RUN_SCHEDULED_REFRESHES_IN_API:
        await data_worker.stop()
        await weather_worker.stop()
    logger.info(f"Shutting down {settings.PROJECT_NAME} backend")


def create_application() -> FastAPI:
    application = FastAPI(
        title=f"{settings.PROJECT_NAME} API",
        description="M-FLOOD provenance-first flood-risk intelligence API; unavailable inputs never produce fabricated outputs.",
        version="0.1.0",
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # Set up CORS middleware
    if settings.CORS_ORIGINS:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=[str(origin) for origin in settings.CORS_ORIGINS],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Rate limiting middleware (120 req/min with token-bucket algorithm)
    application.add_middleware(RateLimitMiddleware, requests_per_minute=120)

    # Global Exception Handlers
    @application.exception_handler(DataSourceError)
    async def data_source_exception_handler(request: Request, exc: DataSourceError):
        logger.error(f"DataSourceError on {request.url.path}: {exc.message}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "UNAVAILABLE",
                "provider": exc.provider,
                "error": exc.message,
                "details": exc.details,
            },
        )

    @application.exception_handler(MFloodError)
    async def mflood_exception_handler(request: Request, exc: MFloodError):
        logger.error(f"MFloodError on {request.url.path}: {exc.message}")
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "status": "ERROR",
                "error": exc.message,
                "details": exc.details,
            },
        )

    # Include API router
    application.include_router(api_router, prefix=settings.API_V1_STR)

    @application.get("/", tags=["Root"], summary="Root endpoint")
    async def root():
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} API",
            "docs": "/docs",
            "health": f"{settings.API_V1_STR}/health",
            "version": "0.1.0",
        }

    @application.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return application


app = create_application()
