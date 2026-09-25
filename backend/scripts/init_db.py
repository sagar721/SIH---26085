import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.models.database import engine, Base
from app.models.entities import StudyArea, DataSource
from app.core.config import settings


def init_database():
    if not settings.DATABASE_URL or engine is None:
        print("DATABASE_URL is not configured. Skipping PostGIS table creation.")
        # Not configuring a database is a documented, supported prototype mode
        # (see .env.example) — it is a deliberate skip, not a startup failure,
        # so callers (e.g. the Dockerfile CMD chain) must not treat this exit
        # code as an error and abort the rest of the boot sequence.
        return True

    print("Connecting to database...")
    try:
        with engine.connect() as conn:
            print("Enabling PostGIS extension...")
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            conn.commit()
            print("PostGIS extension enabled.")

        print("Creating all tables from metadata...")
        Base.metadata.create_all(bind=engine)
        print("Tables created successfully.")
        return True
    except Exception as e:
        print(f"Error during database initialization: {e}")
        return False


if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)
