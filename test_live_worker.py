import time
import threading
from fastapi.testclient import TestClient
from app.main import app, READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE
from app.database import SessionLocal
from app.models import Job, JobEvent
from app.redis_client import redis_client
from app.worker import get_next_job, process_job, move_delayed_jobs

client = TestClient(app)

def cleanup():
    redis_client.delete(READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE)
    db = SessionLocal()
    db.query(JobEvent).delete()
    db.query(Job).delete()
    db.commit()
    db.close()

def live_worker_single_cycle():
    move_delayed_jobs()
    job_id = get_next_job()
    if job_id:
        process_job(job_id)

def main():
    print("=== Live Worker Integration Test ===")
    cleanup()

    # 1. Create a job
    res = client.post("/create-job", json={
        "type": "email",
        "payload": {"recipient": "live@example.com"},
        "priority": 5,
        "delay_seconds": 0
    })
    assert res.status_code == 201
    job_id = res.json()["id"]
    print(f"Created Job {job_id}")

    # Verify queue-depth: ready=1
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 1
    print("Queue depth before worker:", res.json())

    # 2. Run worker in background thread
    worker_thread = threading.Thread(target=live_worker_single_cycle, daemon=True)
    worker_thread.start()

    # 3. Poll while processing (within first 2-5 seconds)
    time.sleep(2)
    res_workers = client.get("/workers")
    print("Live GET /workers while processing:", res_workers.json())
    assert len(res_workers.json()["workers"]) == 1
    assert res_workers.json()["workers"][0]["status"] == "PROCESSING"
    assert res_workers.json()["workers"][0]["job_id"] == job_id

    res_qd = client.get("/queue-depth")
    print("Live GET /queue-depth while processing:", res_qd.json())
    assert res_qd.json()["processing"] == 1

    # 4. Wait for worker to finish (time.sleep(10) in process_job)
    print("Waiting for worker to complete execution (approx 9 seconds)...")
    worker_thread.join(timeout=15)

    # 5. Check completed state
    res_job = client.get(f"/jobs/{job_id}")
    job_data = res_job.json()
    print("Completed job data:", job_data)
    assert job_data["status"] == "COMPLETED"
    assert job_data["started_at"] is not None
    assert job_data["completed_at"] is not None
    assert job_data["completed_at"] >= job_data["started_at"]

    # 6. Check stats
    res_stats = client.get("/stats")
    print("Stats after completion:", res_stats.json())
    assert res_stats.json()["completed"] == 1
    assert res_stats.json()["processing"] == 0

    # 7. Check logs
    res_logs = client.get(f"/jobs/{job_id}/logs")
    print("Job logs:", res_logs.json())
    event_types = [l["message"] for l in res_logs.json()["logs"]]
    assert len(res_logs.json()["logs"]) >= 3  # CREATED, PROCESSING, COMPLETED

    # 8. Check throughput & latency
    res_tp = client.get("/throughput?window=60")
    print("Throughput:", res_tp.json())
    assert res_tp.json()["completed_jobs"] == 1

    res_lat = client.get("/latency?window=300")
    print("Latency:", res_lat.json())
    assert res_lat.json()["sample_size"] == 1
    assert res_lat.json()["average_seconds"] >= 9.9  # simulated 10s work

    print("\n>>> LIVE WORKER INTEGRATION TEST PASSED! <<<")

if __name__ == "__main__":
    main()
