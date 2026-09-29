import time

from app.database import SessionLocal
from app.models import Job
from app.redis_client import redis_client
from app.events import record_job_event


READY_QUEUE = "job_queue"
PROCESSING_QUEUE = "processing_queue"

REAPER_INTERVAL = 5


def recover_expired_jobs():

    current_time = time.time()

    expired_jobs = redis_client.zrangebyscore(
        PROCESSING_QUEUE,
        "-inf",
        current_time
    )

    if not expired_jobs:
        return

    db = SessionLocal()

    try:

        for member in expired_jobs:

            separator = member.find(":")

            job_id = int(member[:separator])
            priority_score = float(member[separator + 1:])

            # Remove from processing queue.
            removed = redis_client.zrem(
                PROCESSING_QUEUE,
                member
            )

            # Another reaper may have already recovered it.
            if removed != 1:
                continue

            job = db.query(Job).filter(
                Job.id == job_id
            ).first()

            if not job:
                continue

            # Only recover jobs that are still processing.
            if job.status != "PROCESSING":
                continue

            print(
                f"Recovering Job {job.id} "
                f"from worker {job.worker_id}"
            )

            record_job_event(
                db,
                job.id,
                "JOB_RECOVERED",
                f"Job {job.id} recovered from worker {job.worker_id} after lease expiration"
            )

            job.status = "PENDING"
            job.worker_id = None
            job.lease_until = None

            # priority_score is already negative.
            redis_client.zadd(
                READY_QUEUE,
                {
                    str(job.id): priority_score
                }
            )

        db.commit()

    finally:

        db.close()


if __name__ == "__main__":

    while True:

        recover_expired_jobs()

        time.sleep(REAPER_INTERVAL)