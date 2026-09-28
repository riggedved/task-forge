import time
import uuid
import threading

from app.redis_client import redis_client
from app.database import SessionLocal
from app.models import Job


QUEUE_NAME = "job_queue"
DELAYED_QUEUE = "delayed_queue"

MAX_RETRIES = 3

LEASE_DURATION = 60
HEARTBEAT_INTERVAL = 20
WORKER_ID = str(uuid.uuid4())


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
        QUEUE_NAME,
        current_time
    )


def get_next_job():
    result = redis_client.zpopmin(
        QUEUE_NAME,
        count=1
    )

    if not result:
        return None

    job_id, score = result[0]

    return job_id


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

    job.lease_until = time.time() + LEASE_DURATION

    db.commit()


def heartbeat_loop(job_id, stop_event):
    while not stop_event.wait(HEARTBEAT_INTERVAL):

        db = SessionLocal()

        try:
            heartbeat(job_id, db)
        finally:
            db.close()


def process_job(job_id):

    db = SessionLocal()

    job = db.query(Job).filter(
        Job.id == int(job_id)
    ).first()

    if not job:
        print(f"Job {job_id} not found")
        db.close()
        return

    # Claim the job
    job.status = "PROCESSING"
    job.worker_id = WORKER_ID
    job.lease_until = time.time() + LEASE_DURATION

    db.commit()

    # Start heartbeat
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

        time.sleep(10)

        # Simulate a failure for testing retries
        if job.type == "fail":
            raise Exception("Simulated job failure")

        print(f"Job {job.id} completed successfully")

        job.status = "COMPLETED"
        job.worker_id = None
        job.lease_until = None

        db.commit()

    except Exception as e:

        print(f"Job {job.id} failed: {e}")

        job.retry_count += 1

        if job.retry_count <= MAX_RETRIES:

            job.status = "PENDING"
            job.worker_id = None
            job.lease_until = None

            redis_client.zadd(
                QUEUE_NAME,
                {str(job.id): -job.priority}
            )

            print(
                f"Retrying Job {job.id} "
                f"(attempt {job.retry_count}/{MAX_RETRIES})"
            )

        else:

            job.status = "FAILED"
            job.worker_id = None
            job.lease_until = None

            print(
                f"Job {job.id} permanently failed "
                f"after {MAX_RETRIES} retries"
            )

        db.commit()

    finally:

        # Stop heartbeat thread
        stop_event.set()

        db.close()


if __name__ == "__main__":

    while True:

        move_delayed_jobs()

        job_id = get_next_job()

        if job_id:
            process_job(job_id)
        else:
            print("No jobs in queue")
            time.sleep(2)