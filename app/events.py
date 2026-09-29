import time
from sqlalchemy.orm import Session
from app.models import JobEvent, WorkerEvent


def record_job_event(db: Session, job_id: int, event_type: str, message: str, commit: bool = False) -> JobEvent:
    """Record a lifecycle event for a job into the job_events table."""
    event = JobEvent(
        job_id=job_id,
        event_type=event_type,
        message=message,
        created_at=time.time()
    )
    db.add(event)
    if commit:
        db.commit()
    return event


def record_worker_event(db: Session, worker_id: str, event_type: str, message: str, commit: bool = False) -> WorkerEvent:
    """Record a lifecycle event for a worker into the worker_events table."""
    event = WorkerEvent(
        worker_id=worker_id,
        event_type=event_type,
        message=message,
        created_at=time.time()
    )
    db.add(event)
    if commit:
        db.commit()
    return event
