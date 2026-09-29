import time
import subprocess
import os
import sys
from fastapi.testclient import TestClient
from app.main import app, READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE, _managed_workers
from app.database import SessionLocal
from app.models import Job, JobEvent, Worker, WorkerEvent
from app.redis_client import redis_client
from app.reaper import recover_expired_jobs

client = TestClient(app)


def cleanup_all():
    # Stop any running managed worker processes
    for wid, proc in list(_managed_workers.items()):
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            pass
    _managed_workers.clear()

    # Clear redis queues and stop keys
    redis_client.delete(READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE)
    for key in redis_client.keys("worker_stop:*"):
        redis_client.delete(key)

    # Clean DB
    db = SessionLocal()
    db.query(WorkerEvent).delete()
    db.query(JobEvent).delete()
    db.query(Job).delete()
    db.query(Worker).delete()
    db.commit()
    db.close()


def test_worker_lifecycle():
    print("\n=======================================================")
    print("STARTING WORKER LIFECYCLE TESTS")
    print("=======================================================\n")

    cleanup_all()

    # -------------------------------------------------------------------------
    # TEST 1: Start Worker
    # -------------------------------------------------------------------------
    print("=== Test 1: Start Worker Process ===")
    res = client.post("/workers")
    assert res.status_code == 201, f"Failed to start worker: {res.text}"
    data = res.json()
    worker_1_id = data["worker_id"]
    assert worker_1_id.startswith("worker-")
    assert data["status"] == "STARTING"
    print(f"[OK] Started worker: {worker_1_id} with status {data['status']}")

    # Verify real OS process exists in _managed_workers and is running
    assert worker_1_id in _managed_workers
    proc = _managed_workers[worker_1_id]
    assert proc.poll() is None, "Worker process should be running"
    print(f"[OK] Real worker process verified alive with PID {proc.pid}")

    # Wait up to 3s for worker to register and transition to IDLE
    started_idle = False
    for _ in range(15):
        time.sleep(0.2)
        res = client.get("/workers")
        assert res.status_code == 200
        workers = res.json()["workers"]
        w = next((w for w in workers if w["worker_id"] == worker_1_id), None)
        if w and w["status"] == "IDLE":
            started_idle = True
            assert w["current_job_id"] is None
            assert w["started_at"] is not None
            assert w["last_heartbeat"] is not None
            break

    assert started_idle, f"Worker {worker_1_id} did not transition to IDLE"
    print(f"[OK] Worker {worker_1_id} successfully transitioned to IDLE")

    # -------------------------------------------------------------------------
    # TEST 2: Multiple Workers
    # -------------------------------------------------------------------------
    print("\n=== Test 2: Start Multiple Workers ===")
    res2 = client.post("/workers")
    assert res2.status_code == 201
    worker_2_id = res2.json()["worker_id"]
    assert worker_2_id != worker_1_id
    print(f"[OK] Started second worker: {worker_2_id}")

    # Wait for worker 2 to become IDLE
    w2_idle = False
    for _ in range(15):
        time.sleep(0.2)
        res = client.get("/workers")
        workers = res.json()["workers"]
        w2 = next((w for w in workers if w["worker_id"] == worker_2_id), None)
        if w2 and w2["status"] == "IDLE":
            w2_idle = True
            break
    assert w2_idle, f"Worker {worker_2_id} did not transition to IDLE"

    res = client.get("/workers")
    active_worker_ids = [w["worker_id"] for w in res.json()["workers"]]
    assert worker_1_id in active_worker_ids
    assert worker_2_id in active_worker_ids
    print(f"[OK] Both workers {worker_1_id} and {worker_2_id} visible as IDLE in /workers")

    # -------------------------------------------------------------------------
    # TEST 3: Process a Job (IDLE -> PROCESSING -> IDLE)
    # -------------------------------------------------------------------------
    print("\n=== Test 3: Process a Job (IDLE -> PROCESSING -> IDLE) ===")
    create_res = client.post("/create-job", json={
        "type": "data_sync",
        "payload": {"record_count": 50, "duration": 2},  # 2 second duration
        "priority": 5
    })
    assert create_res.status_code == 201
    job_id = create_res.json()["id"]
    print(f"[OK] Created job {job_id} with 2s processing duration")

    # Poll /workers to observe one of the workers transition to PROCESSING
    observed_processing = False
    active_worker = None
    for _ in range(30):
        time.sleep(0.2)
        res = client.get("/workers")
        workers = res.json()["workers"]
        for w in workers:
            if w["status"] == "PROCESSING" and w["current_job_id"] == job_id:
                observed_processing = True
                active_worker = w["worker_id"]
                break
        if observed_processing:
            break

    assert observed_processing, f"Did not observe worker transitioning to PROCESSING for job {job_id}"
    print(f"[OK] Worker {active_worker} transitioned to PROCESSING with current_job_id={job_id}")

    # Wait for job completion and worker transitioning back to IDLE
    job_completed = False
    for _ in range(30):
        time.sleep(0.3)
        res = client.get(f"/jobs/{job_id}")
        if res.status_code == 200 and res.json()["status"] == "COMPLETED":
            job_completed = True
            break

    assert job_completed, f"Job {job_id} did not complete"
    print(f"[OK] Job {job_id} successfully COMPLETED via queue architecture")

    # Verify worker returned to IDLE
    res = client.get(f"/workers/{active_worker}")
    assert res.status_code == 200
    assert res.json()["status"] == "IDLE"
    assert res.json()["current_job_id"] is None
    print(f"[OK] Worker {active_worker} returned to IDLE state")

    # -------------------------------------------------------------------------
    # TEST 4: Stop Idle Worker (IDLE -> STOPPING -> STOPPED)
    # -------------------------------------------------------------------------
    print("\n=== Test 4: Stop Idle Worker (Immediate Shutdown) ===")
    stop_res = client.post(f"/workers/{worker_2_id}/stop")
    assert stop_res.status_code == 200
    assert stop_res.json()["status"] == "STOPPED"
    print(f"[OK] Stop request returned immediate STOPPED for {worker_2_id}")

    # Wait for worker process to cleanly terminate and record STOPPED in DB
    worker_stopped = False
    for _ in range(25):
        time.sleep(0.2)
        res = client.get(f"/workers/{worker_2_id}")
        if res.status_code == 200 and res.json()["status"] == "STOPPED":
            worker_stopped = True
            assert res.json()["stopped_at"] is not None
            break

    assert worker_stopped, f"Worker {worker_2_id} did not transition to STOPPED"
    print(f"[OK] Worker {worker_2_id} successfully transitioned to STOPPED")

    # Verify it disappeared from active workers in GET /workers
    res = client.get("/workers")
    active_ids = [w["worker_id"] for w in res.json()["workers"]]
    assert worker_2_id not in active_ids
    assert worker_1_id in active_ids
    print(f"[OK] Worker {worker_2_id} correctly excluded from active GET /workers")

    # Verify it appears in GET /workers?include_stopped=true
    res = client.get("/workers?include_stopped=true")
    all_ids = [w["worker_id"] for w in res.json()["workers"]]
    assert worker_2_id in all_ids
    print(f"[OK] Worker {worker_2_id} visible with ?include_stopped=true")

    # -------------------------------------------------------------------------
    # TEST 5: Stop Processing Worker (Immediate Shutdown & Reaper Recovery)
    # -------------------------------------------------------------------------
    print("\n=== Test 5: Stop Worker During Job Processing (Immediate Shutdown & Reaper Recovery) ===")
    # Create a job that takes 10 seconds
    create_res = client.post("/create-job", json={
        "type": "long_task",
        "payload": {"duration": 10},
        "priority": 10
    })
    assert create_res.status_code == 201
    job_5_id = create_res.json()["id"]

    # Wait until worker_1 is actively PROCESSING
    is_processing = False
    for _ in range(25):
        time.sleep(0.2)
        res = client.get(f"/workers/{worker_1_id}")
        if res.status_code == 200 and res.json()["status"] == "PROCESSING":
            is_processing = True
            break

    assert is_processing, f"Worker {worker_1_id} should be PROCESSING job {job_5_id}"
    print(f"[OK] Worker {worker_1_id} is actively PROCESSING job {job_5_id}")

    # Send stop request: MUST be immediate shutdown, not graceful
    stop_res = client.post(f"/workers/{worker_1_id}/stop")
    assert stop_res.status_code == 200
    assert stop_res.json()["status"] == "STOPPED", f"Expected immediate STOPPED, got {stop_res.json()['status']}"
    print(f"[OK] Worker {worker_1_id} terminated immediately with status STOPPED")

    # Verify worker record in DB is STOPPED immediately
    res_worker = client.get(f"/workers/{worker_1_id}")
    assert res_worker.status_code == 200 and res_worker.json()["status"] == "STOPPED"

    # Verify job state in DB: it MUST NOT be COMPLETED! It remains PROCESSING with lease intact
    job_res = client.get(f"/jobs/{job_5_id}")
    assert job_res.status_code == 200
    assert job_res.json()["status"] == "PROCESSING", f"Job should remain PROCESSING, got {job_res.json()['status']}"
    print(f"[OK] In-flight job {job_5_id} remained in PROCESSING (lease orphaned, heartbeats stopped)")

    # Simulate lease expiry: advance lease score in Redis and DB to past
    db = SessionLocal()
    j_rec = db.query(Job).filter(Job.id == job_5_id).first()
    past_time = time.time() - 5
    j_rec.lease_until = past_time
    db.commit()
    db.close()
    redis_client.zadd(PROCESSING_QUEUE, {f"{job_5_id}:-10.0": past_time})

    # Trigger reaper recovery
    recover_expired_jobs()

    # Verify job is now recovered to PENDING and back in READY_QUEUE
    job_recovered_res = client.get(f"/jobs/{job_5_id}")
    assert job_recovered_res.status_code == 200
    assert job_recovered_res.json()["status"] == "PENDING"
    assert job_recovered_res.json()["worker_id"] is None
    assert job_recovered_res.json()["lease_until"] is None
    assert redis_client.zscore(READY_QUEUE, str(job_5_id)) == -10.0
    print(f"[OK] Reaper successfully recovered job {job_5_id} back to PENDING and READY_QUEUE")

    # Verify JOB_RECOVERED event was logged
    event_res = client.get("/activity")
    assert event_res.status_code == 200
    events = event_res.json()["events"]
    assert any(e["job_id"] == job_5_id and e["event_type"] == "JOB_RECOVERED" for e in events)
    print(f"[OK] JOB_RECOVERED event confirmed in activity logs")

    # Now start a new worker to verify the recovered job is picked up and completed
    res_w3 = client.post("/workers")
    assert res_w3.status_code == 201
    worker_3_id = res_w3.json()["worker_id"]
    print(f"[OK] Started new worker {worker_3_id} to process recovered job")

    # Wait for the recovered job to complete via the new worker
    re_completed = False
    for _ in range(60):
        time.sleep(0.3)
        res_check = client.get(f"/jobs/{job_5_id}")
        if res_check.status_code == 200 and res_check.json()["status"] == "COMPLETED":
            re_completed = True
            break
    assert re_completed, f"Recovered job {job_5_id} was not processed to completion by new worker"
    print(f"[OK] Recovered job {job_5_id} successfully COMPLETED by worker {worker_3_id}!")

    # -------------------------------------------------------------------------
    # TEST 6: Dead Worker Detection (Heartbeat Timeout -> OFFLINE)
    # -------------------------------------------------------------------------
    print("\n=== Test 6: Dead Worker Detection (Heartbeat Timeout -> OFFLINE) ===")
    # Register a worker and simulate crash by artificially aging last_heartbeat > 30s
    db = SessionLocal()
    dead_worker_id = "worker-crashed-test"
    db.query(Worker).filter(Worker.worker_id == dead_worker_id).delete()
    crashed_worker = Worker(
        worker_id=dead_worker_id,
        status="IDLE",
        current_job_id=None,
        started_at=time.time() - 100,
        last_heartbeat=time.time() - 45  # 45 seconds ago (> 30s timeout)
    )
    db.add(crashed_worker)
    db.commit()
    db.close()

    # Calling GET /workers should trigger stale worker detection and transition to OFFLINE
    res = client.get("/workers")
    assert res.status_code == 200

    # Verify status in DB is now OFFLINE
    res_worker = client.get(f"/workers/{dead_worker_id}")
    assert res_worker.status_code == 200
    assert res_worker.json()["status"] == "OFFLINE"
    print(f"[OK] Dead worker {dead_worker_id} correctly transitioned to OFFLINE")

    # Verify WORKER_OFFLINE event recorded
    events_res = client.get(f"/worker-events?worker_id={dead_worker_id}")
    assert events_res.status_code == 200
    events = events_res.json()["events"]
    assert any(e["event_type"] == "WORKER_OFFLINE" for e in events)
    print(f"[OK] Worker event WORKER_OFFLINE recorded for {dead_worker_id}")

    # -------------------------------------------------------------------------
    # TEST 7: Manual Worker Compatibility (python -m app.worker)
    # -------------------------------------------------------------------------
    print("\n=== Test 7: Manual Worker CLI Compatibility ===")
    manual_id = "worker-manual-cli"
    env = os.environ.copy()
    env["WORKER_ID"] = manual_id
    manual_proc = subprocess.Popen(
        [sys.executable, "-m", "app.worker", manual_id],
        env=env,
        cwd=os.getcwd(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    try:
        # Wait for manual worker to register
        manual_ready = False
        for _ in range(20):
            time.sleep(0.2)
            res = client.get(f"/workers/{manual_id}")
            if res.status_code == 200 and res.json()["status"] == "IDLE":
                manual_ready = True
                break
        assert manual_ready, "Manual worker failed to register as IDLE"
        print(f"[OK] Manual CLI worker {manual_id} successfully self-registered as IDLE")

        # Stop manual worker via API
        client.post(f"/workers/{manual_id}/stop")
        manual_stopped = False
        for _ in range(25):
            time.sleep(0.2)
            res = client.get(f"/workers/{manual_id}")
            if res.status_code == 200 and res.json()["status"] == "STOPPED":
                manual_stopped = True
                break
        assert manual_stopped, "Manual worker failed to stop cleanly"
        print(f"[OK] Manual CLI worker {manual_id} shut down cleanly via stop signal")
    finally:
        try:
            manual_proc.terminate()
            manual_proc.wait(timeout=1)
        except Exception:
            pass

    cleanup_all()

    print("\n=======================================================")
    print("ALL WORKER LIFECYCLE TESTS PASSED WITH 100% SUCCESS!")
    print("=======================================================\n")


if __name__ == "__main__":
    test_worker_lifecycle()
