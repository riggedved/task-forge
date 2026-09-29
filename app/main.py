import os
import sys
import subprocess
import uuid
import time
from typing import Any
from fastapi import FastAPI, HTTPException, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal, engine, Base
from app.models import Job, JobEvent, Worker, WorkerEvent
from app.redis_client import redis_client
from app.events import record_job_event, record_worker_event
from app.schemas import (
    JobCreateRequest,
    JobCreateResponse,
    JobDetailResponse,
    StatsResponse,
    WorkersResponse,
    WorkerItem,
    WorkerResponse,
    WorkerStartRequest,
    WorkerStartResponse,
    WorkerStopResponse,
    WorkerEventItem,
    WorkerEventsResponse,
    ActivityResponse,
    JobEventItem,
    QueueDepthResponse,
    RedisMetricsResponse,
    JobLogsResponse,
    LogItem,
    ThroughputResponse,
    LatencyResponse,
    QueueWaitMetrics,
    HealthResponse
)

# Ensure database tables exist
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Task Forge API",
    description="Distributed job queue backend API and observability layer",
    version="1.0.0"
)

# Enable CORS for playground UI access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

READY_QUEUE = "job_queue"
PROCESSING_QUEUE = "processing_queue"
DELAYED_QUEUE = "delayed_queue"
FAILED_QUEUE = "failed_queue"

# In-memory dictionary tracking managed subprocesses by worker_id
_managed_workers: dict[str, subprocess.Popen] = {}
WORKER_HEARTBEAT_TIMEOUT = 30.0  # seconds until worker without heartbeat considered OFFLINE


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------
# Health & Status
# ---------------------------------------------------------

@app.get("/")
def home():
    return {"message": "Job Queue API is running"}


@app.get("/health", response_model=HealthResponse)
def get_health(db: Session = Depends(get_db)):
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "disconnected"

    redis_status = "connected"
    try:
        if not redis_client.ping():
            redis_status = "disconnected"
    except Exception:
        redis_status = "disconnected"

    overall_status = "ok" if (db_status == "connected" and redis_status == "connected") else "degraded"

    return HealthResponse(
        status=overall_status,
        database=db_status,
        redis=redis_status
    )


@app.get("/stats", response_model=StatsResponse)
def get_stats(db: Session = Depends(get_db)):
    total = db.query(Job).count()
    pending = db.query(Job).filter(Job.status == "PENDING").count()
    processing = db.query(Job).filter(Job.status == "PROCESSING").count()
    completed = db.query(Job).filter(Job.status == "COMPLETED").count()
    failed = db.query(Job).filter(Job.status == "FAILED").count()

    return StatsResponse(
        total=total,
        pending=pending,
        processing=processing,
        completed=completed,
        failed=failed
    )


# ---------------------------------------------------------
# Job Ingestion & Retrieval
# ---------------------------------------------------------

@app.post("/create-job", response_model=JobCreateResponse, status_code=status.HTTP_201_CREATED)
def create_job(job: JobCreateRequest, db: Session = Depends(get_db)):
    # 1. Idempotency pre-check
    if job.idempotency_key:
        existing_job = db.query(Job).filter(
            Job.idempotency_key == job.idempotency_key
        ).first()

        if existing_job:
            return existing_job

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
        return existing_job

    # 2. Redis queue routing
    if job.delay_seconds > 0:
        execute_at = time.time() + job.delay_seconds
        redis_client.zadd(
            DELAYED_QUEUE,
            {f"{new_job.id}:{new_job.priority}": execute_at}
        )
    else:
        redis_client.zadd(
            READY_QUEUE,
            {str(new_job.id): -new_job.priority}
        )

    # 3. Log lifecycle event
    delay_info = f", delayed {job.delay_seconds}s" if job.delay_seconds > 0 else ""
    record_job_event(
        db,
        new_job.id,
        "JOB_CREATED",
        f"Job {new_job.id} created (type: {new_job.type}, priority: {new_job.priority}{delay_info})",
        commit=True
    )

    return new_job


@app.get("/jobs", response_model=list[JobDetailResponse])
def get_jobs(
    status: str | None = None,
    type: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    skip: int = Query(default=0, ge=0),
    db: Session = Depends(get_db)
):
    query = db.query(Job)
    if status:
        query = query.filter(Job.status == status.upper())
    if type:
        query = query.filter(Job.type == type)

    jobs = query.order_by(Job.id.desc()).offset(skip).limit(limit).all()
    return jobs


@app.get("/jobs/{job_id}", response_model=JobDetailResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


# ---------------------------------------------------------
# Job Control APIs
# ---------------------------------------------------------

@app.post("/jobs/{job_id}/cancel", response_model=JobDetailResponse)
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # State validation rules
    if job.status == "CANCELLED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job is already cancelled."
        )

    if job.status == "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel an already completed job."
        )

    if job.status == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel a failed job. Use requeue to reprocess it."
        )

    if job.status == "PROCESSING":
        # Honest distributed systems constraint: workers cannot be abruptly preempted safely
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot cancel job in PROCESSING state: current worker architecture does not support interrupting running workers."
        )

    if job.status == "PENDING":
        # Remove from ready queue and delayed queue
        redis_client.zrem(READY_QUEUE, str(job.id))
        redis_client.zrem(DELAYED_QUEUE, f"{job.id}:{job.priority}")

        job.status = "CANCELLED"
        job.worker_id = None
        job.lease_until = None
        job.completed_at = time.time()

        record_job_event(
            db,
            job.id,
            "JOB_CANCELLED",
            f"Job {job.id} was cancelled while PENDING"
        )
        db.commit()
        db.refresh(job)
        return job

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Cannot cancel job in {job.status} state."
    )


@app.post("/jobs/{job_id}/force-fail", response_model=JobDetailResponse)
def force_fail_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.status == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job is already in FAILED state."
        )

    if job.status == "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot force-fail an already completed job."
        )

    if job.status == "CANCELLED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot force-fail a cancelled job."
        )

    previous_status = job.status

    # Thorough Redis cleanup across all possible queues to prevent orphaned entries
    redis_client.zrem(READY_QUEUE, str(job.id))
    redis_client.zrem(DELAYED_QUEUE, f"{job.id}:{job.priority}")
    redis_client.zrem(PROCESSING_QUEUE, f"{job.id}:{-job.priority}")

    # Route to Dead-Letter Queue
    redis_client.zadd(FAILED_QUEUE, {str(job.id): time.time()})

    job.status = "FAILED"
    job.worker_id = None
    job.lease_until = None
    job.completed_at = time.time()

    record_job_event(
        db,
        job.id,
        "JOB_FORCE_FAILED",
        f"Job {job.id} force failed from {previous_status} state"
    )

    db.commit()
    db.refresh(job)
    return job


@app.post("/jobs/{job_id}/requeue", response_model=JobDetailResponse)
def requeue_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.status not in ("FAILED", "CANCELLED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only FAILED or CANCELLED jobs can be requeued (current status: {job.status})."
        )

    previous_status = job.status

    # Clean up from any queues before placing in READY
    redis_client.zrem(FAILED_QUEUE, str(job.id))
    redis_client.zrem(DELAYED_QUEUE, f"{job.id}:{job.priority}")
    redis_client.zrem(PROCESSING_QUEUE, f"{job.id}:{-job.priority}")

    # Re-insert into READY queue with inverted priority
    redis_client.zadd(READY_QUEUE, {str(job.id): -job.priority})

    # Reset worker and lease state, reset execution timestamps, preserve retry_count
    job.status = "PENDING"
    job.worker_id = None
    job.lease_until = None
    job.started_at = None
    job.completed_at = None

    record_job_event(
        db,
        job.id,
        "JOB_REQUEUED",
        f"Job {job.id} requeued from {previous_status} to READY queue (priority: {job.priority})"
    )

    db.commit()
    db.refresh(job)
    return job


# ---------------------------------------------------------
# Worker API
# ---------------------------------------------------------

@app.post("/workers", response_model=WorkerStartResponse, status_code=status.HTTP_201_CREATED)
def start_worker(
    request: WorkerStartRequest | None = None,
    db: Session = Depends(get_db)
):
    # 1. Determine unique worker_id
    if request and request.name and request.name.strip():
        worker_id = request.name.strip()
        existing = db.query(Worker).filter(Worker.worker_id == worker_id).first()
        if existing and existing.status in ("STARTING", "IDLE", "PROCESSING", "STOPPING"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Worker with ID '{worker_id}' is already active (status: {existing.status})"
            )
    else:
        worker_id = f"worker-{uuid.uuid4().hex[:8]}"

    # 2. Prepare environment and spawn real worker subprocess
    env = os.environ.copy()
    env["WORKER_ID"] = worker_id
    env["PYTHONUNBUFFERED"] = "1"

    logs_dir = os.path.join(os.getcwd(), "worker_logs")
    os.makedirs(logs_dir, exist_ok=True)
    log_file_path = os.path.join(logs_dir, f"{worker_id}.log")
    log_file = open(log_file_path, "a", encoding="utf-8")

    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.worker", worker_id],
            env=env,
            cwd=os.getcwd(),
            stdout=log_file,
            stderr=log_file
        )
    except Exception as e:
        log_file.close()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to spawn worker process: {str(e)}"
        )

    _managed_workers[worker_id] = proc

    # 3. Register worker record in DB with STARTING status
    now = time.time()
    worker_record = db.query(Worker).filter(Worker.worker_id == worker_id).first()
    if not worker_record:
        worker_record = Worker(
            worker_id=worker_id,
            status="STARTING",
            current_job_id=None,
            started_at=now,
            last_heartbeat=now,
            stopped_at=None
        )
        db.add(worker_record)
    else:
        worker_record.status = "STARTING"
        worker_record.current_job_id = None
        worker_record.started_at = now
        worker_record.last_heartbeat = now
        worker_record.stopped_at = None

    record_worker_event(
        db,
        worker_id,
        "WORKER_STARTED",
        f"Worker process spawned with PID {proc.pid}"
    )
    db.commit()

    return WorkerStartResponse(
        worker_id=worker_id,
        status="STARTING"
    )


@app.post("/workers/{worker_id}/stop", response_model=WorkerStopResponse)
def stop_worker(worker_id: str, db: Session = Depends(get_db)):
    worker = db.query(Worker).filter(Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Worker '{worker_id}' not found in registry"
        )

    if worker.status == "STOPPED":
        return WorkerStopResponse(
            worker_id=worker_id,
            status="STOPPED",
            message=f"Worker {worker_id} is already stopped"
        )

    if worker.status == "OFFLINE":
        return WorkerStopResponse(
            worker_id=worker_id,
            status="OFFLINE",
            message=f"Worker {worker_id} is offline/stale"
        )

    # Set stop flag in Redis (expires in 300s)
    try:
        redis_client.set(f"worker_stop:{worker_id}", "1", ex=300)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to issue stop signal via Redis: {e}"
        )

    # Transition worker status to STOPPING
    worker.status = "STOPPING"
    record_worker_event(
        db,
        worker_id,
        "WORKER_STOPPING",
        f"Graceful stop signal requested for worker {worker_id}"
    )
    db.commit()

    return WorkerStopResponse(
        worker_id=worker_id,
        status="STOPPING",
        message=f"Stop signal sent to worker {worker_id}. It will shut down gracefully."
    )


@app.get("/workers", response_model=WorkersResponse)
def get_workers(
    include_stopped: bool = Query(default=False, description="Include STOPPED workers"),
    db: Session = Depends(get_db)
):
    now = time.time()

    # 1. Stale / Dead worker detection
    # Any worker in active state whose heartbeat exceeds WORKER_HEARTBEAT_TIMEOUT is marked OFFLINE
    active_statuses = ["STARTING", "IDLE", "PROCESSING", "STOPPING"]
    stale_workers = db.query(Worker).filter(
        Worker.status.in_(active_statuses),
        Worker.last_heartbeat < (now - WORKER_HEARTBEAT_TIMEOUT)
    ).all()

    for sw in stale_workers:
        sw.status = "OFFLINE"
        record_worker_event(
            db,
            sw.worker_id,
            "WORKER_OFFLINE",
            f"Worker {sw.worker_id} heartbeat timed out (> {WORKER_HEARTBEAT_TIMEOUT}s)"
        )
    if stale_workers:
        db.commit()

    # 2. Query registered workers
    query = db.query(Worker)
    if not include_stopped:
        query = query.filter(Worker.status != "STOPPED")
    registered_workers = query.order_by(Worker.started_at.asc()).all()

    workers_dict: dict[str, WorkerResponse] = {}
    for w in registered_workers:
        workers_dict[w.worker_id] = WorkerResponse(
            worker_id=w.worker_id,
            status=w.status,
            current_job_id=w.current_job_id,
            job_id=w.current_job_id,
            started_at=w.started_at,
            last_heartbeat=w.last_heartbeat,
            stopped_at=w.stopped_at
        )

    # 3. Reconcile with active jobs in PROCESSING to ensure lease coordination visibility
    active_jobs = db.query(Job).filter(
        Job.status == "PROCESSING",
        Job.worker_id.isnot(None)
    ).all()

    for job in active_jobs:
        if job.worker_id in workers_dict:
            w_item = workers_dict[job.worker_id]
            w_item.current_job_id = job.id
            w_item.job_id = job.id
            if w_item.status not in ("STOPPING", "OFFLINE"):
                w_item.status = "PROCESSING"
        else:
            # Active job whose worker isn't in registry (e.g. simulated or test worker)
            status_str = "RECOVERING" if (job.lease_until and job.lease_until < now) else "PROCESSING"
            workers_dict[job.worker_id] = WorkerResponse(
                worker_id=job.worker_id,
                status=status_str,
                current_job_id=job.id,
                job_id=job.id,
                started_at=job.started_at or now,
                last_heartbeat=now,
                stopped_at=None
            )

    return WorkersResponse(workers=list(workers_dict.values()))


@app.get("/workers/{worker_id}", response_model=WorkerResponse)
def get_worker(worker_id: str, db: Session = Depends(get_db)):
    worker = db.query(Worker).filter(Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Worker '{worker_id}' not found"
        )
    return WorkerResponse(
        worker_id=worker.worker_id,
        status=worker.status,
        current_job_id=worker.current_job_id,
        job_id=worker.current_job_id,
        started_at=worker.started_at,
        last_heartbeat=worker.last_heartbeat,
        stopped_at=worker.stopped_at
    )


@app.get("/worker-events", response_model=WorkerEventsResponse)
def get_worker_events(
    worker_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    query = db.query(WorkerEvent)
    if worker_id:
        query = query.filter(WorkerEvent.worker_id == worker_id)
    events = query.order_by(WorkerEvent.created_at.desc(), WorkerEvent.id.desc()).limit(limit).all()
    return WorkerEventsResponse(
        events=[
            WorkerEventItem(
                id=e.id,
                worker_id=e.worker_id,
                event_type=e.event_type,
                message=e.message,
                created_at=e.created_at
            )
            for e in events
        ]
    )


# ---------------------------------------------------------
# Activity API
# ---------------------------------------------------------

@app.get("/activity", response_model=ActivityResponse)
def get_activity(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    events = db.query(JobEvent).order_by(
        JobEvent.created_at.desc(),
        JobEvent.id.desc()
    ).limit(limit).all()

    return ActivityResponse(
        events=[
            JobEventItem(
                id=e.id,
                job_id=e.job_id,
                event_type=e.event_type,
                message=e.message,
                created_at=e.created_at
            )
            for e in events
        ]
    )


# ---------------------------------------------------------
# Queue Inspection & Redis Metrics
# ---------------------------------------------------------

@app.get("/queue-depth", response_model=QueueDepthResponse)
def get_queue_depth():
    ready = redis_client.zcard(READY_QUEUE) or 0
    processing = redis_client.zcard(PROCESSING_QUEUE) or 0
    delayed = redis_client.zcard(DELAYED_QUEUE) or 0
    failed = redis_client.zcard(FAILED_QUEUE) or 0
    total = ready + processing + delayed + failed

    return QueueDepthResponse(
        ready=ready,
        processing=processing,
        delayed=delayed,
        failed=failed,
        total=total
    )


@app.get("/redis-metrics", response_model=RedisMetricsResponse)
def get_redis_metrics():
    try:
        info = redis_client.info()
        ready = redis_client.zcard(READY_QUEUE) or 0
        processing = redis_client.zcard(PROCESSING_QUEUE) or 0
        delayed = redis_client.zcard(DELAYED_QUEUE) or 0
        failed = redis_client.zcard(FAILED_QUEUE) or 0

        return RedisMetricsResponse(
            connected=True,
            memory_used=int(info.get("used_memory", 0)),
            memory_used_human=str(info.get("used_memory_human", "0B")),
            connected_clients=int(info.get("connected_clients", 0)),
            ready_queue=ready,
            processing_queue=processing,
            delayed_queue=delayed,
            failed_queue=failed
        )
    except Exception:
        return RedisMetricsResponse(
            connected=False,
            memory_used=0,
            memory_used_human="0B",
            connected_clients=0,
            ready_queue=0,
            processing_queue=0,
            delayed_queue=0,
            failed_queue=0
        )


# ---------------------------------------------------------
# Worker Logs for a Job
# ---------------------------------------------------------

@app.get("/jobs/{job_id}/logs", response_model=JobLogsResponse)
def get_job_logs(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    events = db.query(JobEvent).filter(
        JobEvent.job_id == job_id
    ).order_by(JobEvent.created_at.asc(), JobEvent.id.asc()).all()

    logs = []
    for e in events:
        level = "INFO"
        if e.event_type in ("JOB_FAILED", "JOB_FORCE_FAILED"):
            level = "ERROR"
        elif e.event_type in ("JOB_RETRY_SCHEDULED", "JOB_RECOVERED", "JOB_CANCELLED"):
            level = "WARN"

        logs.append(LogItem(
            timestamp=e.created_at,
            level=level,
            message=e.message
        ))

    return JobLogsResponse(
        job_id=job_id,
        logs=logs
    )


# ---------------------------------------------------------
# Throughput & Latency Observability
# ---------------------------------------------------------

@app.get("/throughput", response_model=ThroughputResponse)
def get_throughput(
    window: int = Query(default=60, ge=1, description="Window size in seconds"),
    db: Session = Depends(get_db)
):
    cutoff = time.time() - window
    completed_jobs = db.query(Job).filter(
        Job.status == "COMPLETED",
        Job.completed_at.isnot(None),
        Job.completed_at >= cutoff
    ).count()

    jobs_per_minute = round((completed_jobs / window) * 60.0, 2)

    return ThroughputResponse(
        window_seconds=window,
        completed_jobs=completed_jobs,
        jobs_per_minute=jobs_per_minute
    )


@app.get("/latency", response_model=LatencyResponse)
def get_latency(
    window: int = Query(default=300, ge=1, description="Window size in seconds"),
    db: Session = Depends(get_db)
):
    cutoff = time.time() - window
    completed_jobs = db.query(Job).filter(
        Job.status == "COMPLETED",
        Job.started_at.isnot(None),
        Job.completed_at.isnot(None),
        Job.completed_at >= cutoff
    ).all()

    exec_latencies = []
    wait_latencies = []

    for j in completed_jobs:
        if j.completed_at >= j.started_at:
            exec_latencies.append(j.completed_at - j.started_at)
        if j.created_at and j.started_at >= j.created_at:
            wait_latencies.append(j.started_at - j.created_at)

    sample_size = len(exec_latencies)
    if sample_size == 0:
        return LatencyResponse(
            window_seconds=window,
            sample_size=0,
            average_seconds=0.0,
            min_seconds=0.0,
            max_seconds=0.0,
            queue_wait_seconds=QueueWaitMetrics(
                average_seconds=0.0,
                min_seconds=0.0,
                max_seconds=0.0
            )
        )

    avg_exec = round(sum(exec_latencies) / sample_size, 3)
    min_exec = round(min(exec_latencies), 3)
    max_exec = round(max(exec_latencies), 3)

    if wait_latencies:
        avg_wait = round(sum(wait_latencies) / len(wait_latencies), 3)
        min_wait = round(min(wait_latencies), 3)
        max_wait = round(max(wait_latencies), 3)
    else:
        avg_wait = 0.0
        min_wait = 0.0
        max_wait = 0.0

    return LatencyResponse(
        window_seconds=window,
        sample_size=sample_size,
        average_seconds=avg_exec,
        min_seconds=min_exec,
        max_seconds=max_exec,
        queue_wait_seconds=QueueWaitMetrics(
            average_seconds=avg_wait,
            min_seconds=min_wait,
            max_seconds=max_wait
        )
    )