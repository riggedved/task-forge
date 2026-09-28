import time

from app.database import SessionLocal
from app.models import Job
from app.redis_client import redis_client

QUEUE_NAME = "job_queue"
REAPER_INTERVAL = 5


def recover_expired_jobs():
    db = SessionLocal()

    current_time = time.time()

    expired_jobs = db.query(Job).filter(
        Job.status == "PROCESSING",
        Job.lease_until < current_time
    ).all()

    for job in expired_jobs:

        updated = db.query(Job).filter(
            Job.id == job.id,
            Job.status == "PROCESSING",
            Job.lease_until < current_time
        ).update({
            Job.status: "PENDING",
            Job.worker_id: None,
            Job.lease_until: None
        })

        if updated == 1:
            redis_client.zadd(
                QUEUE_NAME,
                {str(job.id): -job.priority}
            )

            print(
                f"Recovered Job {job.id} "
                f"from worker {job.worker_id}"
            )

    db.commit()
    db.close()


if __name__ == "__main__":

    while True:
        recover_expired_jobs()
        time.sleep(REAPER_INTERVAL)