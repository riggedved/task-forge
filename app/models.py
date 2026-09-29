from sqlalchemy import Column, Integer, String, JSON, Float, ForeignKey
from app.database import Base
import time


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String, nullable=False)
    payload = Column(JSON, nullable=False)
    priority = Column(Integer, default=1)
    status = Column(String, default="PENDING")
    retry_count = Column(Integer, default=0)

    worker_id = Column(String, nullable=True)
    lease_until = Column(Float, nullable=True)

    idempotency_key = Column(String, unique=True, nullable=True)

    created_at = Column(Float, default=time.time)
    started_at = Column(Float, nullable=True)
    completed_at = Column(Float, nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    message = Column(String, nullable=False)
    created_at = Column(Float, default=time.time, index=True)


class Worker(Base):
    __tablename__ = "workers"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String, unique=True, nullable=False, index=True)
    status = Column(String, default="STARTING", nullable=False, index=True)
    current_job_id = Column(Integer, nullable=True)
    started_at = Column(Float, default=time.time, nullable=False)
    last_heartbeat = Column(Float, default=time.time, nullable=False)
    stopped_at = Column(Float, nullable=True)


class WorkerEvent(Base):
    __tablename__ = "worker_events"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String, nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    message = Column(String, nullable=False)
    created_at = Column(Float, default=time.time, index=True)