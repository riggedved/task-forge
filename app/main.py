from fastapi import FastAPI
from pydantic import BaseModel

from app.database import SessionLocal, engine, Base
from app.models import Job
from sqlalchemy.exc import IntegrityError

from app.redis_client import redis_client
import time

app = FastAPI()

Base.metadata.create_all(bind=engine)

DELAYED_QUEUE = "delayed_queue"

class JobRequest(BaseModel):
    type: str
    payload: dict
    priority: int = 1
    delay_seconds: int = 0
    idempotency_key: str | None = None


@app.get("/")
def home():
    return {"message": "Job Queue API is running"}


@app.post("/create-job")
def create_job(job: JobRequest):

    db = SessionLocal()

    if job.idempotency_key:

        existing_job = db.query(Job).filter(
            Job.idempotency_key == job.idempotency_key
        ).first()

        if existing_job:
            db.close()

            return {
                "id": existing_job.id,
                "type": existing_job.type,
                "payload": existing_job.payload,
                "priority": existing_job.priority,
                "status": existing_job.status,
                "idempotency_key": existing_job.idempotency_key
            }

    new_job = Job(
        type=job.type,
        payload=job.payload,
        priority=job.priority,
        idempotency_key=job.idempotency_key
    )

    db.add(new_job)

    try:
        db.commit()
        db.refresh(new_job)

    except IntegrityError:
        db.rollback()

        existing_job = db.query(Job).filter(
            Job.idempotency_key == job.idempotency_key
        ).first()

        db.close()

        return {
            "id": existing_job.id,
            "type": existing_job.type,
            "payload": existing_job.payload,
            "priority": existing_job.priority,
            "status": existing_job.status,
            "idempotency_key": existing_job.idempotency_key
        }

    if job.delay_seconds > 0:
        execute_at = time.time() + job.delay_seconds

        redis_client.zadd(
            DELAYED_QUEUE,
            {f"{new_job.id}:{new_job.priority}": execute_at}
        )
    else:
        redis_client.zadd(
            "job_queue",
            {str(new_job.id): -new_job.priority}
        )


    db.close()

    return {
        "id": new_job.id,
        "type": new_job.type,
        "payload": new_job.payload,
        "priority": new_job.priority,
        "status": new_job.status,
        "idempotency_key": new_job.idempotency_key
    }


@app.get("/jobs")
def get_jobs():
    db = SessionLocal()

    jobs = db.query(Job).order_by(
        Job.id.desc()
    ).all()

    result = []

    for job in jobs:
        result.append({
            "id": job.id,
            "type": job.type,
            "priority": job.priority,
            "status": job.status,
            "retry_count": job.retry_count,
            "worker_id": job.worker_id,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at
        })

    db.close()

    return result

@app.get("/jobs/{job_id}")
def get_job(job_id: int):
    db = SessionLocal()

    job = db.query(Job).filter(
        Job.id == job_id
    ).first()

    if not job:
        db.close()
        return {"error": "Job not found"}

    result = {
        "id": job.id,
        "type": job.type,
        "payload": job.payload,
        "priority": job.priority,
        "status": job.status,
        "retry_count": job.retry_count,
        "worker_id": job.worker_id,
        "lease_until": job.lease_until,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at
    }

    db.close()

    return result