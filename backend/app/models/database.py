from typing import Optional, Tuple
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

Base = declarative_base()

engine = None
SessionLocal = None

if settings.DATABASE_URL:
    try:
        engine = create_engine(
            settings.DATABASE_URL,
            pool_pre_ping=True,
            echo=False,
        )
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    except Exception as e:
        print(f"Warning: Failed to initialize database engine: {e}")
        engine = None
        SessionLocal = None


def get_db():
    """Dependency for obtaining DB session."""
    if SessionLocal is None:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_health() -> Tuple[str, Optional[str]]:
    """
    Checks database connection and PostGIS status.
    Returns (status, message):
      - ('CONNECTED', 'PostGIS 3.4 enabled')
      - ('NOT_CONFIGURED', 'DATABASE_URL not set')
      - ('UNAVAILABLE', error_detail)
    """
    if not settings.DATABASE_URL:
        return "NOT_CONFIGURED", "DATABASE_URL environment variable is not configured"

    if engine is None:
        return "UNAVAILABLE", "Engine initialization failed"

    try:
        with engine.connect() as conn:
            # Check PostGIS extension
            result = conn.execute(text("SELECT postgis_version();"))
            version = result.scalar()
            return "CONNECTED", f"PostgreSQL with PostGIS {version}"
    except Exception as e:
        return "UNAVAILABLE", str(e)
