import os
import sys
import time
import uuid
import threading

from app.redis_client import redis_client
from app.database import SessionLocal
from app.models import Job, Worker
from app.events import record_job_event, record_worker_event


READY_QUEUE = "job_queue"
PROCESSING_QUEUE = "processing_queue"
DELAYED_QUEUE = "delayed_queue"
FAILED_QUEUE = "failed_queue"

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 5

LEASE_DURATION = 60
HEARTBEAT_INTERVAL = 20

# Support WORKER_ID from environment variable or CLI argument, fallback to random UUID
WORKER_ID = os.environ.get("WORKER_ID") or (sys.argv[1] if len(sys.argv) > 1 else f"worker-{uuid.uuid4().hex[:8]}")


# ---------------------------------------------------------
# Worker Registry & Heartbeat Helpers
# ---------------------------------------------------------

def register_worker():
    """Register worker in PostgreSQL as IDLE on startup."""
    db = SessionLocal()
    try:
        worker = db.query(Worker).filter(Worker.worker_id == WORKER_ID).first()
        now = time.time()
        if not worker:
            worker = Worker(
                worker_id=WORKER_ID,
                status="IDLE",
                current_job_id=None,
                started_at=now,
                last_heartbeat=now
            )
            db.add(worker)
            record_worker_event(db, WORKER_ID, "WORKER_STARTED", f"Worker {WORKER_ID} started")
        else:
            worker.status = "IDLE"
            worker.current_job_id = None
            worker.last_heartbeat = now
            worker.stopped_at = None
        db.commit()
    except Exception as e:
        print(f"Error registering worker {WORKER_ID}: {e}")
    finally:
        db.close()


def update_worker_heartbeat():
    """Periodic worker heartbeat update in PostgreSQL."""
    db = SessionLocal()
    try:
        worker = db.query(Worker).filter(Worker.worker_id == WORKER_ID).first()
        if worker and worker.status != "STOPPED":
            worker.last_heartbeat = time.time()
            db.commit()
    except Exception:
        pass
    finally:
        db.close()


def worker_heartbeat_loop(stop_event):
    """Background daemon thread to refresh worker heartbeat every 5s."""
    while not stop_event.wait(5):
        update_worker_heartbeat()


def set_worker_job(job_id: int | None):
    """Update worker status to PROCESSING (with job_id) or IDLE."""
    db = SessionLocal()
    try:
        worker = db.query(Worker).filter(Worker.worker_id == WORKER_ID).first()
        if worker and worker.status != "STOPPED":
            worker.status = "PROCESSING" if job_id is not None else "IDLE"
            worker.current_job_id = job_id
            worker.last_heartbeat = time.time()
            db.commit()
    except Exception as e:
        print(f"Error updating worker job state: {e}")
    finally:
        db.close()


def should_stop() -> bool:
    """Check if a stop signal has been issued for this worker via Redis."""
    try:
        return bool(redis_client.exists(f"worker_stop:{WORKER_ID}"))
    except Exception:
        return False


def stop_worker_cleanly():
    """Mark worker as STOPPED in PostgreSQL and clean up Redis stop flag."""
    db = SessionLocal()
    try:
        worker = db.query(Worker).filter(Worker.worker_id == WORKER_ID).first()
        now = time.time()
        if worker:
            worker.status = "STOPPED"
            worker.current_job_id = None
            worker.stopped_at = now
            worker.last_heartbeat = now
            record_worker_event(db, WORKER_ID, "WORKER_STOPPED", f"Worker {WORKER_ID} stopped cleanly")
            db.commit()
    except Exception as e:
        print(f"Error stopping worker cleanly: {e}")
    finally:
        db.close()
    try:
        redis_client.delete(f"worker_stop:{WORKER_ID}")
    except Exception:
        pass


# ---------------------------------------------------------
# Move delayed jobs → ready queue
# ---------------------------------------------------------

MOVE_DELAYED_JOBS_SCRIPT = """
local jobs = redis.call(
    'ZRANGEBYSCORE',
    KEYS[1],
    '-inf',
    ARGV[1]
)

for _, member in ipairs(jobs) do

    local separator = string.find(member, ':')

    local job_id = string.sub(member, 1, separator - 1)
    local priority = tonumber(
        string.sub(member, separator + 1)
    )

    redis.call(
        'ZREM',
        KEYS[1],
        member
    )

    redis.call(
        'ZADD',
        KEYS[2],
        -priority,
        job_id
    )
end

return #jobs
"""


def move_delayed_jobs():

    current_time = time.time()

    redis_client.eval(
        MOVE_DELAYED_JOBS_SCRIPT,
        2,
        DELAYED_QUEUE,
        READY_QUEUE,
        current_time
    )


# ---------------------------------------------------------
# Claim job atomically
# ---------------------------------------------------------

CLAIM_JOB_SCRIPT = """
local jobs = redis.call(
    'ZPOPMIN',
    KEYS[1],
    1
)

if #jobs == 0 then
    return nil
end

local job_id = jobs[1]
local priority_score = jobs[2]

local lease_until = tonumber(ARGV[1])

redis.call(
    'ZADD',
    KEYS[2],
    lease_until,
    job_id .. ':' .. priority_score
)

return job_id
"""


def get_next_job():

    lease_until = time.time() + LEASE_DURATION

    job_id = redis_client.eval(
        CLAIM_JOB_SCRIPT,
        2,
        READY_QUEUE,
        PROCESSING_QUEUE,
        lease_until
    )

    return job_id


# ---------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------

def heartbeat(job_id, db):

    job = db.query(Job).filter(
        Job.id == int(job_id)
    ).first()

    if not job:
        return

    if job.status != "PROCESSING":
        return

    if job.worker_id != WORKER_ID:
        return

    new_lease_until = time.time() + LEASE_DURATION

    # Update PostgreSQL lease
    job.lease_until = new_lease_until
    db.commit()

    # Update Redis processing lease
    processing_member = f"{job.id}:{-job.priority}"

    redis_client.zadd(
        PROCESSING_QUEUE,
        {
            processing_member: new_lease_until
        }
    )


def heartbeat_loop(job_id, stop_event):

    while not stop_event.wait(HEARTBEAT_INTERVAL):

        db = SessionLocal()

        try:
            heartbeat(job_id, db)

        finally:
            db.close()


# ---------------------------------------------------------
# Remove job from processing queue
# ---------------------------------------------------------

def remove_from_processing(job):

    processing_member = f"{job.id}:{-job.priority}"

    redis_client.zrem(
        PROCESSING_QUEUE,
        processing_member
    )


# ---------------------------------------------------------
# Process job
# ---------------------------------------------------------

def process_job(job_id):

    db = SessionLocal()

    job = db.query(Job).filter(
        Job.id == int(job_id)
    ).first()

    if not job:

        print(f"Job {job_id} not found")

        db.close()

        return

    # -----------------------------------------------------
    # Mark job as processing in PostgreSQL
    # -----------------------------------------------------

    job.status = "PROCESSING"
    job.worker_id = WORKER_ID
    job.lease_until = time.time() + LEASE_DURATION
    job.started_at = time.time()

    record_job_event(
        db,
        job.id,
        "JOB_PROCESSING",
        f"Job {job.id} started processing by worker {WORKER_ID}"
    )

    db.commit()

    # Update worker status to PROCESSING
    set_worker_job(job.id)

    # -----------------------------------------------------
    # Start heartbeat
    # -----------------------------------------------------

    stop_event = threading.Event()

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop,
        args=(job_id, stop_event),
        daemon=True
    )

    heartbeat_thread.start()

    try:

        print(f"Processing Job {job.id}")
        print(f"Type: {job.type}")
        print(f"Payload: {job.payload}")
        print(f"Priority: {job.priority}")
        print(f"Worker: {WORKER_ID}")

        # Simulate work (default 10s, configurable via payload)
        work_duration = 10
        if isinstance(job.payload, dict):
            if "duration" in job.payload:
                work_duration = float(job.payload["duration"])
            elif "sleep" in job.payload:
                work_duration = float(job.payload["sleep"])
        time.sleep(work_duration)

        # Temporary failure simulation
        if job.type == "fail":
            raise Exception("Simulated job failure")

        # -------------------------------------------------
        # Job completed
        # -------------------------------------------------

        print(f"Job {job.id} completed successfully")

        remove_from_processing(job)

        job.status = "COMPLETED"
        job.worker_id = None
        job.lease_until = None
        job.completed_at = time.time()

        record_job_event(
            db,
            job.id,
            "JOB_COMPLETED",
            f"Job {job.id} completed successfully"
        )

        db.commit()

    except Exception as e:

        print(f"Job {job.id} failed: {e}")

        # Remove from processing before retrying
        remove_from_processing(job)

        if job.retry_count < MAX_RETRIES:

            job.retry_count += 1

            job.status = "PENDING"
            job.worker_id = None
            job.lease_until = None

            retry_delay = RETRY_BACKOFF_BASE * (
                2 ** (job.retry_count - 1)
            )

            retry_at = time.time() + retry_delay

            redis_client.zadd(
                DELAYED_QUEUE,
                {
                    f"{job.id}:{job.priority}": retry_at
                }
            )

            record_job_event(
                db,
                job.id,
                "JOB_RETRY_SCHEDULED",
                f"Job {job.id} retry {job.retry_count}/{MAX_RETRIES} scheduled in {retry_delay} seconds"
            )

            print(
                f"Retrying Job {job.id} "
                f"(retry {job.retry_count}/{MAX_RETRIES}) "
                f"in {retry_delay} seconds"
            )

        else:

            job.status = "FAILED"
            job.worker_id = None
            job.lease_until = None
            job.completed_at = time.time()

            redis_client.zadd(
                FAILED_QUEUE,
                {
                    str(job.id): time.time()
                }
            )

            record_job_event(
                db,
                job.id,
                "JOB_FAILED",
                f"Job {job.id} permanently failed after {job.retry_count} retries"
            )

            print(
                f"Job {job.id} permanently failed "
                f"after {job.retry_count} retries"
            )

        db.commit()

    finally:

        # Stop heartbeat thread
        stop_event.set()

        db.close()

        # Reset worker status back to IDLE
        set_worker_job(None)


# ---------------------------------------------------------
# Worker loop
# ---------------------------------------------------------

if __name__ == "__main__":

    print(f"Starting Worker {WORKER_ID}")
    register_worker()

    stop_heartbeat = threading.Event()
    worker_hb_thread = threading.Thread(
        target=worker_heartbeat_loop,
        args=(stop_heartbeat,),
        daemon=True
    )
    worker_hb_thread.start()

    try:
        while True:
            # Check if stop signal has been issued for this worker
            if should_stop():
                print(f"Worker {WORKER_ID} received stop signal. Stopping.")
                break

            # Move scheduled jobs into ready queue
            move_delayed_jobs()

            # Atomically claim a job
            job_id = get_next_job()

            if job_id:

                process_job(job_id)

            else:

                # Check for stop signal more frequently while idle
                for _ in range(4):
                    if should_stop():
                        break
                    time.sleep(0.5)

    except KeyboardInterrupt:
        print(f"\nWorker {WORKER_ID} received KeyboardInterrupt. Shutting down.")
    finally:
        stop_heartbeat.set()
        stop_worker_cleanly()
        print(f"Worker {WORKER_ID} shut down.")