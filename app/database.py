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

from sqlalchemy.pool import NullPool

# Engine configuration with resilient connection pooling for Supabase
# - pool_pre_ping: tests liveness of connection before checkout, preventing stale drops
# - pool_recycle: proactively recycles connections before cloud timeout (e.g. Supavisor)
# Use NullPool for Supabase pooler (port 6543 or pooler.supabase.com):
# Supavisor handles pooling on the server side, so disabling client-side QueuePool
# prevents pool exhaustion and 30s timeouts during concurrent dashboard requests.
use_null_pool = (
    os.getenv("DB_USE_NULL_POOL", "").lower() in ("true", "1", "yes")
    or ":6543" in DATABASE_URL
    or "pooler.supabase.com" in DATABASE_URL
)

engine_kwargs = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}

if use_null_pool:
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "10"))
    engine_kwargs["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW", "20"))
    engine_kwargs["pool_timeout"] = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    engine_kwargs["pool_recycle"] = int(os.getenv("DB_POOL_RECYCLE", "300"))

engine = create_engine(
    DATABASE_URL,
    **engine_kwargs
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()