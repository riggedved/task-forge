import time
import uuid
import threading

from app.redis_client import redis_client
from app.database import SessionLocal
from app.models import Job


READY_QUEUE = "job_queue"
PROCESSING_QUEUE = "processing_queue"
DELAYED_QUEUE = "delayed_queue"
FAILED_QUEUE = "failed_queue"

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 5

LEASE_DURATION = 60
HEARTBEAT_INTERVAL = 20

WORKER_ID = str(uuid.uuid4())


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

    db.commit()

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

        # Simulate work
        time.sleep(10)

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

            print(
                f"Job {job.id} permanently failed "
                f"after {job.retry_count} retries"
            )

        db.commit()

    finally:

        # Stop heartbeat thread
        stop_event.set()

        db.close()


# ---------------------------------------------------------
# Worker loop
# ---------------------------------------------------------

if __name__ == "__main__":

    while True:

        # Move scheduled jobs into ready queue
        move_delayed_jobs()

        # Atomically claim a job
        job_id = get_next_job()

        if job_id:

            process_job(job_id)

        else:

            print("No jobs in queue")

            time.sleep(2)