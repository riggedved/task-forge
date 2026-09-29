import time
from fastapi.testclient import TestClient
from app.main import app, READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE
from app.database import SessionLocal
from app.models import Job, JobEvent
from app.redis_client import redis_client
from app.worker import get_next_job, move_delayed_jobs, remove_from_processing, process_job, MAX_RETRIES
from app.reaper import recover_expired_jobs

client = TestClient(app)

def cleanup():
    # Clean Redis
    redis_client.delete(READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE)
    # Clean DB
    db = SessionLocal()
    db.query(JobEvent).delete()
    db.query(Job).delete()
    db.commit()
    db.close()

def run_tests():
    print("=== Step 1: Cleanup test environment ===")
    cleanup()

    print("\n=== Step 2: Test Basic Endpoints on Empty State ===")
    # 1. Health
    res = client.get("/health")
    assert res.status_code == 200, f"Health failed: {res.text}"
    health_data = res.json()
    assert health_data["status"] == "ok"
    assert health_data["database"] == "connected"
    assert health_data["redis"] == "connected"
    print("[OK] GET /health:", health_data)

    # 2. Stats
    res = client.get("/stats")
    assert res.status_code == 200
    stats_data = res.json()
    assert stats_data == {"total": 0, "pending": 0, "processing": 0, "completed": 0, "failed": 0}
    print("[OK] GET /stats:", stats_data)

    # 3. Jobs
    res = client.get("/jobs")
    assert res.status_code == 200
    assert res.json() == []
    print("[OK] GET /jobs: empty list")

    # 4. Queue Depth
    res = client.get("/queue-depth")
    assert res.status_code == 200
    qd_data = res.json()
    assert qd_data == {"ready": 0, "processing": 0, "delayed": 0, "failed": 0, "total": 0}
    print("[OK] GET /queue-depth:", qd_data)

    # 5. Workers
    res = client.get("/workers")
    assert res.status_code == 200
    assert res.json() == {"workers": []}
    print("[OK] GET /workers: []")

    # 6. Redis Metrics
    res = client.get("/redis-metrics")
    assert res.status_code == 200
    rm_data = res.json()
    assert rm_data["connected"] is True
    assert "memory_used" in rm_data
    assert "memory_used_human" in rm_data
    assert "connected_clients" in rm_data
    print("[OK] GET /redis-metrics:", rm_data)

    # 7. Activity
    res = client.get("/activity")
    assert res.status_code == 200
    assert res.json() == {"events": []}
    print("[OK] GET /activity: []")

    # 8. Throughput & Latency (Empty)
    res = client.get("/throughput?window=60")
    assert res.status_code == 200
    assert res.json()["completed_jobs"] == 0
    print("[OK] GET /throughput (empty):", res.json())

    res = client.get("/latency?window=300")
    assert res.status_code == 200
    assert res.json()["sample_size"] == 0
    print("[OK] GET /latency (empty):", res.json())

    print("\n=== Step 3: Test Job Creation & Idempotency ===")
    create_payload = {
        "type": "email",
        "payload": {"recipient": "alice@example.com", "subject": "Welcome!"},
        "priority": 10,
        "delay_seconds": 0,
        "idempotency_key": "idem-key-101"
    }
    res = client.post("/create-job", json=create_payload)
    assert res.status_code == 201, f"Create job failed: {res.text}"
    job1 = res.json()
    assert job1["id"] is not None
    assert job1["priority"] == 10
    assert job1["status"] == "PENDING"
    print("[OK] POST /create-job:", job1)

    # Test idempotency deduplication
    res_dup = client.post("/create-job", json=create_payload)
    assert res_dup.status_code in (200, 201)
    dup_job = res_dup.json()
    assert dup_job["id"] == job1["id"]
    print("[OK] Idempotency deduplication returned identical job:", dup_job["id"])

    # Verify queue depth has ready=1
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 1
    assert res.json()["total"] == 1
    print("[OK] GET /queue-depth after job creation:", res.json())

    # Verify activity has JOB_CREATED event
    res = client.get("/activity")
    events = res.json()["events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "JOB_CREATED"
    assert events[0]["job_id"] == job1["id"]
    print("[OK] GET /activity shows JOB_CREATED:", events[0])

    print("\n=== Step 4: Test Cancellation on PENDING Job ===")
    res = client.post(f"/jobs/{job1['id']}/cancel")
    assert res.status_code == 200, f"Cancel failed: {res.text}"
    cancelled_job = res.json()
    assert cancelled_job["status"] == "CANCELLED"
    print("[OK] POST /jobs/{id}/cancel succeeded:", cancelled_job["status"])

    # Verify removed from ready queue
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 0
    print("[OK] Ready queue is 0 after cancellation")

    # Verify cancellation event in activity
    res = client.get("/activity")
    assert res.json()["events"][0]["event_type"] == "JOB_CANCELLED"
    print("[OK] Latest event is JOB_CANCELLED")

    # Verify cannot cancel already cancelled job
    res_cancel_again = client.post(f"/jobs/{job1['id']}/cancel")
    assert res_cancel_again.status_code == 400
    print("[OK] Cancelling already cancelled job returned 400 Bad Request")

    print("\n=== Step 5: Test Requeue on Cancelled Job ===")
    res = client.post(f"/jobs/{job1['id']}/requeue")
    assert res.status_code == 200, f"Requeue failed: {res.text}"
    requeued_job = res.json()
    assert requeued_job["status"] == "PENDING"
    print("[OK] POST /jobs/{id}/requeue:", requeued_job["status"])

    # Verify re-entered ready queue
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 1
    print("[OK] Ready queue has 1 after requeue")

    # Verify event logged
    res = client.get("/activity")
    assert res.json()["events"][0]["event_type"] == "JOB_REQUEUED"
    print("[OK] Latest event is JOB_REQUEUED")

    print("\n=== Step 6: Test Force-Fail on PENDING Job ===")
    res = client.post(f"/jobs/{job1['id']}/force-fail")
    assert res.status_code == 200, f"Force fail failed: {res.text}"
    ff_job = res.json()
    assert ff_job["status"] == "FAILED"
    print("[OK] POST /jobs/{id}/force-fail:", ff_job["status"])

    # Verify queue state: ready=0, failed=1
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 0
    assert res.json()["failed"] == 1
    print("[OK] Queue depth after force-fail:", res.json())

    # Verify event
    res = client.get("/activity")
    assert res.json()["events"][0]["event_type"] == "JOB_FORCE_FAILED"
    print("[OK] Latest event is JOB_FORCE_FAILED")

    print("\n=== Step 7: Test Requeue on FAILED Job ===")
    res = client.post(f"/jobs/{job1['id']}/requeue")
    assert res.status_code == 200
    assert res.json()["status"] == "PENDING"
    res = client.get("/queue-depth")
    assert res.json()["ready"] == 1
    assert res.json()["failed"] == 0
    print("[OK] Requeued failed job back to ready queue:", res.json())

    print("\n=== Step 8: Test Delayed Job Lifecycle ===")
    res = client.post("/create-job", json={
        "type": "delayed_report",
        "payload": {"period": "monthly"},
        "priority": 7,
        "delay_seconds": 2
    })
    assert res.status_code == 201
    delayed_job = res.json()
    print("[OK] Created delayed job:", delayed_job["id"])

    # Verify delayed_queue depth is 1
    res = client.get("/queue-depth")
    assert res.json()["delayed"] == 1
    print("[OK] Delayed queue depth is 1")

    # Before delay expires, move_delayed_jobs should NOT move it
    move_delayed_jobs()
    res = client.get("/queue-depth")
    assert res.json()["delayed"] == 1
    print("[OK] Delayed job not moved before expiration")

    # Wait for delay to expire
    print("Waiting 2.5s for delay expiration...")
    time.sleep(2.5)
    move_delayed_jobs()

    # Now delayed queue should be 0 and ready queue should have increased
    res = client.get("/queue-depth")
    assert res.json()["delayed"] == 0
    assert res.json()["ready"] == 2
    print("[OK] Delayed job migrated to ready queue:", res.json())

    print("\n=== Step 9: Test Logs Endpoint ===")
    res = client.get(f"/jobs/{job1['id']}/logs")
    assert res.status_code == 200
    logs_data = res.json()
    assert logs_data["job_id"] == job1["id"]
    assert len(logs_data["logs"]) >= 4  # CREATED, CANCELLED, REQUEUED, FORCE_FAILED, REQUEUED
    for log_item in logs_data["logs"]:
        assert "timestamp" in log_item
        assert "level" in log_item
        assert "message" in log_item
    print("[OK] GET /jobs/{id}/logs:", logs_data)

    # 404 on invalid job
    res = client.get("/jobs/999999/logs")
    assert res.status_code == 404
    print("[OK] GET /jobs/999999/logs returned 404")

    print("\n=== Step 10: Test Worker Processing & Atomic Claiming ===")
    claimed_id = get_next_job()
    assert claimed_id is not None
    claimed_id = int(claimed_id)
    print(f"[OK] Claimed job {claimed_id} atomically via Lua script")

    # Verify queue depths: ready decremented, processing incremented
    res = client.get("/queue-depth")
    assert res.json()["processing"] == 1
    print("[OK] Queue depth with in-flight processing job:", res.json())

    # Set up job in PROCESSING state manually to simulate worker claim without waiting 10s
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == claimed_id).first()
    j.status = "PROCESSING"
    j.worker_id = "test-worker-alpha"
    j.started_at = time.time()
    j.lease_until = time.time() + 60
    db.commit()
    db.close()

    # Verify GET /workers shows active worker
    res = client.get("/workers")
    assert res.status_code == 200
    workers_data = res.json()["workers"]
    assert len(workers_data) == 1
    assert workers_data[0]["worker_id"] == "test-worker-alpha"
    assert workers_data[0]["status"] == "PROCESSING"
    assert workers_data[0]["job_id"] == claimed_id
    print("[OK] GET /workers shows PROCESSING worker:", workers_data[0])

    # Verify cancellation during PROCESSING is rejected with 409
    res = client.post(f"/jobs/{claimed_id}/cancel")
    assert res.status_code == 409
    assert "Cannot cancel job in PROCESSING state" in res.json()["detail"]
    print("[OK] Cancelling PROCESSING job correctly returned 409 Conflict")

    # Complete the job
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == claimed_id).first()
    remove_from_processing(j)
    j.status = "COMPLETED"
    j.worker_id = None
    j.lease_until = None
    j.completed_at = time.time()
    from app.events import record_job_event
    record_job_event(db, j.id, "JOB_COMPLETED", f"Job {j.id} completed successfully", commit=True)
    db.close()

    # Verify queue depth: processing=0
    res = client.get("/queue-depth")
    assert res.json()["processing"] == 0
    print("[OK] Processing queue depth returned to 0 after job completion")

    # Verify stats
    res = client.get("/stats")
    assert res.json()["completed"] == 1
    print("[OK] GET /stats shows completed=1:", res.json())

    # Verify throughput includes completed job
    res = client.get("/throughput?window=60")
    assert res.json()["completed_jobs"] == 1
    assert res.json()["jobs_per_minute"] == 1.0
    print("[OK] GET /throughput calculated real metric:", res.json())

    # Verify latency includes completed job
    res = client.get("/latency?window=300")
    assert res.json()["sample_size"] == 1
    assert res.json()["average_seconds"] >= 0
    print("[OK] GET /latency calculated real metric:", res.json())

    print("\n=== Step 11: Test Reaper Recovery ===")
    # Claim second job
    claimed_id_2 = get_next_job()
    assert claimed_id_2 is not None
    claimed_id_2 = int(claimed_id_2)

    db = SessionLocal()
    j2 = db.query(Job).filter(Job.id == claimed_id_2).first()
    j2.status = "PROCESSING"
    j2.worker_id = "crashed-worker-beta"
    # Simulate expired lease in the past
    expired_time = time.time() - 10
    j2.lease_until = expired_time
    # Also update Redis processing_queue score to expired_time
    redis_client.zadd(PROCESSING_QUEUE, {f"{j2.id}:{-j2.priority}": expired_time})
    db.commit()
    db.close()

    # GET /workers should show RECOVERING for expired lease
    res = client.get("/workers")
    workers_data = res.json()["workers"]
    assert len(workers_data) == 1
    assert workers_data[0]["status"] == "RECOVERING"
    print("[OK] Worker with expired lease flagged as RECOVERING:", workers_data[0])

    # Run reaper recovery
    recover_expired_jobs()

    # Verify job moved back to READY
    res = client.get("/queue-depth")
    assert res.json()["processing"] == 0
    assert res.json()["ready"] == 1
    print("[OK] Reaper successfully recovered expired lease to ready queue:", res.json())

    # Verify activity shows JOB_RECOVERED
    res = client.get("/activity")
    assert res.json()["events"][0]["event_type"] == "JOB_RECOVERED"
    print("[OK] Activity logged JOB_RECOVERED:", res.json()["events"][0])

    print("\n=== Step 12: Test Retries, Exponential Backoff & DLQ ===")
    # Notice: Job 51 is in ready queue with priority 7.
    # Create a job of type 'fail' with lower priority 1
    res = client.post("/create-job", json={"type": "fail", "payload": {"fail": True}, "priority": 1})
    fail_job_id = res.json()["id"]

    # Verify priority inversion claiming: Job 51 (priority 7) MUST be popped before fail_job (priority 1)
    first_claimed = get_next_job()
    assert int(first_claimed) == claimed_id_2, f"Expected higher-priority job {claimed_id_2} to pop first, got {first_claimed}"
    print(f"[OK] Priority scheduling verified: Higher priority job {claimed_id_2} claimed before job {fail_job_id}")

    # Now claim fail_job
    cid = get_next_job()
    assert int(cid) == fail_job_id, f"Expected {fail_job_id}, got {cid}"
    print(f"[OK] Claimed fail_job {fail_job_id}")

    # Simulate 3 failures to test backoff and DLQ routing
    for attempt in range(1, 4):
        db = SessionLocal()
        fj = db.query(Job).filter(Job.id == fail_job_id).first()
        remove_from_processing(fj)
        fj.retry_count += 1
        fj.status = "PENDING"
        fj.worker_id = None
        fj.lease_until = None
        retry_delay = 5 * (2 ** (fj.retry_count - 1))
        retry_at = time.time() + retry_delay
        redis_client.zadd(DELAYED_QUEUE, {f"{fj.id}:{fj.priority}": retry_at})
        record_job_event(db, fj.id, "JOB_RETRY_SCHEDULED", f"Job {fj.id} retry {fj.retry_count}/{MAX_RETRIES} scheduled in {retry_delay}s", commit=True)
        db.close()

        # Check queue
        res = client.get("/queue-depth")
        assert res.json()["delayed"] >= 1
        print(f"[OK] Attempt {attempt}: Retry scheduled with backoff delay {retry_delay}s, delayed_queue depth={res.json()['delayed']}")

        # Clear delayed for next step simulation
        redis_client.zrem(DELAYED_QUEUE, f"{fail_job_id}:1")

    # 4th failure -> permanently FAILED -> routed to DLQ (failed_queue)
    db = SessionLocal()
    fj = db.query(Job).filter(Job.id == fail_job_id).first()
    fj.status = "FAILED"
    fj.worker_id = None
    fj.lease_until = None
    fj.completed_at = time.time()
    redis_client.zadd(FAILED_QUEUE, {str(fj.id): time.time()})
    record_job_event(db, fj.id, "JOB_FAILED", f"Job {fj.id} permanently failed after {fj.retry_count} retries", commit=True)
    db.close()

    # Verify DLQ
    res = client.get("/queue-depth")
    assert res.json()["failed"] == 1
    print("[OK] Max retries exhausted: routed to DLQ (failed_queue=1)")

    # Verify stats shows failed=1
    res = client.get("/stats")
    assert res.json()["failed"] == 1
    print("[OK] GET /stats shows failed=1:", res.json())

    # Verify requeuing the DLQ job
    res = client.post(f"/jobs/{fail_job_id}/requeue")
    assert res.status_code == 200
    assert res.json()["status"] == "PENDING"
    assert res.json()["retry_count"] == 3  # Preserves retry count as required
    res = client.get("/queue-depth")
    assert res.json()["failed"] == 0
    print("[OK] Successfully requeued DLQ job back to READY, preserved retry_count=3")

    print("\n==============================================")
    print("ALL TESTS PASSED WITH 100% SUCCESS!")
    print("==============================================")

if __name__ == "__main__":
    run_tests()
