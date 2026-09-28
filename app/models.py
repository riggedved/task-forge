from sqlalchemy import Column, Integer, String, JSON, Float
from app.database import Base


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