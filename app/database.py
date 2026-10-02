import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Load environment variables from .env
BASE_DIR = Path(__file__).resolve().parent.parent
env_path = BASE_DIR / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

# Priority: DATABASE_URL -> SUPABASE_DB_URL -> fallback local postgres
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("SUPABASE_DB_URL")
    or "postgresql://postgres:your_new_password@localhost:5432/job_queue"
)

# Normalize postgres:// scheme to postgresql:// for SQLAlchemy compatibility
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Configure connection parameters for cloud PostgreSQL (Supabase)
connect_args = {}

ssl_mode = os.getenv("DB_SSL_MODE")
if ssl_mode:
    connect_args["sslmode"] = ssl_mode
elif ("supabase.co" in DATABASE_URL or "pooler.supabase.com" in DATABASE_URL) and "sslmode" not in DATABASE_URL:
    connect_args["sslmode"] = "require"

# Engine configuration with resilient connection pooling for Supabase
# - pool_pre_ping: tests liveness of connection before checkout, preventing stale drops
# - pool_recycle: proactively recycles connections before cloud timeout (e.g. Supavisor)
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=300
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()