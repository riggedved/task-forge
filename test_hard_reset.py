import time
import subprocess
import os
import sys
from fastapi.testclient import TestClient
from app.main import app, READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE, _managed_workers
from app.database import SessionLocal
from app.models import Job, JobEvent, Worker, WorkerEvent
from app.redis_client import redis_client

client = TestClient(app)


def test_hard_reset_lifecycle():
    print("\n=======================================================")
    print("STARTING TASK FORGE HARD RESET VERIFICATION")
    print("=======================================================\n")

    # -------------------------------------------------------------------------
    # STEP 1: Populate system with jobs, queues, workers, events
    # -------------------------------------------------------------------------
    print("=== Step 1: Populate system state with active and queued data ===")

    # 1. Start a real Task Forge-managed worker
    worker_res = client.post("/workers")
    assert worker_res.status_code == 201
    worker_id = worker_res.json()["worker_id"]
    print(f"[OK] Started managed worker: {worker_id}")

    # Wait for worker to register and become IDLE
    worker_ready = False
    for _ in range(15):
        time.sleep(0.2)
        res = client.get("/workers")
        workers = res.json()["workers"]
        w = next((w for w in workers if w["worker_id"] == worker_id), None)
        if w and w["status"] == "IDLE":
            worker_ready = True
            break
    assert worker_ready, f"Worker {worker_id} did not become IDLE"
    print(f"[OK] Worker {worker_id} is alive and IDLE")

    # 2. Create several jobs with varying properties
    res = client.post("/create-job", json={
        "type": "email",
        "payload": {"to": "user1@example.com"},
        "priority": 10
    })
    assert res.status_code == 201
    job1_id = res.json()["id"]

    res = client.post("/create-job", json={
        "type": "report",
        "payload": {"report": "quarterly"},
        "priority": 5
    })
    assert res.status_code == 201
    job2_id = res.json()["id"]

    # 3. Create a delayed job
    res = client.post("/create-job", json={
        "type": "delayed_sync",
        "payload": {"sync": "full"},
        "priority": 3,
        "delay_seconds": 120
    })
    assert res.status_code == 201
    job3_id = res.json()["id"]

    # 4. Create and force-fail a job into failed_queue
    res = client.post("/create-job", json={
        "type": "fail_test",
        "payload": {"error": "forced"},
        "priority": 1
    })
    assert res.status_code == 201
    job4_id = res.json()["id"]
    client.post(f"/jobs/{job4_id}/force-fail")

    # Give a moment for any active job to execute or enter queue
    time.sleep(0.5)

    # Verify queues and state are non-empty
    qd = client.get("/queue-depth").json()
    stats = client.get("/stats").json()
    act = client.get("/activity").json()["events"]
    w_list = client.get("/workers").json()["workers"]

    print(f"[OK] Pre-reset queue depth: {qd}")
    print(f"[OK] Pre-reset stats: {stats}")
    print(f"[OK] Pre-reset activity count: {len(act)}")
    print(f"[OK] Pre-reset workers: {[w['worker_id'] for w in w_list]}")

    assert stats["total"] >= 4, "Should have at least 4 jobs before reset"
    assert qd["total"] >= 1 or stats["processing"] >= 1 or stats["completed"] >= 1
    assert len(act) >= 4, "Should have activity events before reset"
    assert len(w_list) >= 1, "Should have active worker before reset"

    # -------------------------------------------------------------------------
    # STEP 2: Execute POST /admin/hard-reset
    # -------------------------------------------------------------------------
    print("\n=== Step 2: Execute POST /admin/hard-reset ===")
    reset_res = client.post("/admin/hard-reset")
    assert reset_res.status_code == 200, f"Hard reset failed: {reset_res.text}"
    reset_data = reset_res.json()
    print("[OK] Reset response:", reset_data)

    assert reset_data["status"] == "reset"
    assert reset_data["jobs_deleted"] >= 4
    assert reset_data["job_events_deleted"] >= 4
    assert reset_data["workers_stopped"] >= 1
    assert reset_data["worker_events_deleted"] >= 1
    assert set(reset_data["redis_queues_cleared"]) == {
        READY_QUEUE, PROCESSING_QUEUE, DELAYED_QUEUE, FAILED_QUEUE
    }

    # -------------------------------------------------------------------------
    # STEP 3: Verify all APIs return completely empty state
    # -------------------------------------------------------------------------
    print("\n=== Step 3: Verify all telemetry & state APIs return zero ===")

    # 1. GET /stats
    res = client.get("/stats")
    assert res.status_code == 200
    stats_post = res.json()
    assert stats_post == {
        "total": 0,
        "pending": 0,
        "processing": 0,
        "completed": 0,
        "failed": 0
    }
    print("[OK] GET /stats is strictly zero:", stats_post)

    # 2. GET /queue-depth
    res = client.get("/queue-depth")
    assert res.status_code == 200
    qd_post = res.json()
    assert qd_post == {
        "ready": 0,
        "processing": 0,
        "delayed": 0,
        "failed": 0,
        "total": 0
    }
    print("[OK] GET /queue-depth is strictly zero:", qd_post)

    # 3. GET /workers
    res = client.get("/workers")
    assert res.status_code == 200
    assert res.json()["workers"] == []
    print("[OK] GET /workers returned empty list: []")

    # 4. GET /workers?include_stopped=true
    res = client.get("/workers?include_stopped=true")
    assert res.status_code == 200
    assert res.json()["workers"] == []
    print("[OK] GET /workers?include_stopped=true returned empty list: []")

    # 5. GET /activity
    res = client.get("/activity")
    assert res.status_code == 200
    assert res.json()["events"] == []
    print("[OK] GET /activity returned empty list: []")

    # 6. GET /worker-events
    res = client.get("/worker-events")
    assert res.status_code == 200
    assert res.json()["events"] == []
    print("[OK] GET /worker-events returned empty list: []")

    # -------------------------------------------------------------------------
    # STEP 4: Direct DB & Redis verification
    # -------------------------------------------------------------------------
    print("\n=== Step 4: Direct Database & Redis Verification ===")
    db = SessionLocal()
    assert db.query(Job).count() == 0, "Jobs table must be empty"
    assert db.query(JobEvent).count() == 0, "JobEvents table must be empty"
    assert db.query(Worker).count() == 0, "Workers table must be empty"
    assert db.query(WorkerEvent).count() == 0, "WorkerEvents table must be empty"
    db.close()
    print("[OK] Direct PostgreSQL check confirmed 0 rows across jobs, job_events, workers, worker_events")

    assert redis_client.zcard(READY_QUEUE) == 0
    assert redis_client.zcard(PROCESSING_QUEUE) == 0
    assert redis_client.zcard(DELAYED_QUEUE) == 0
    assert redis_client.zcard(FAILED_QUEUE) == 0
    assert len(redis_client.keys("worker_stop:*")) == 0
    print("[OK] Direct Redis check confirmed 0 elements in Task Forge queues and stop flags")

    assert len(_managed_workers) == 0
    print("[OK] Managed worker process pool is empty")

    # -------------------------------------------------------------------------
    # STEP 5: Fresh Start Verification (Section 11)
    # -------------------------------------------------------------------------
    print("\n=== Step 5: Fresh Start / Post-Reset Lifecycle Verification ===")

    # 1. Start a new worker
    fresh_worker_res = client.post("/workers")
    assert fresh_worker_res.status_code == 201
    fresh_worker_id = fresh_worker_res.json()["worker_id"]
    print(f"[OK] Spawned fresh worker: {fresh_worker_id}")

    # Wait for fresh worker to become IDLE
    fresh_idle = False
    for _ in range(15):
        time.sleep(0.2)
        w_res = client.get("/workers")
        workers = w_res.json()["workers"]
        fw = next((w for w in workers if w["worker_id"] == fresh_worker_id), None)
        if fw and fw["status"] == "IDLE":
            fresh_idle = True
            break
    assert fresh_idle, "Fresh worker did not become IDLE"
    print(f"[OK] Fresh worker {fresh_worker_id} successfully entered IDLE state")

    # 2. Create a new job with short duration
    fresh_job_res = client.post("/create-job", json={
        "type": "fresh_task",
        "payload": {"name": "test_after_reset", "duration": 1.5},
        "priority": 10
    })
    assert fresh_job_res.status_code == 201
    fresh_job_id = fresh_job_res.json()["id"]
    print(f"[OK] Created fresh job {fresh_job_id}")

    # 3. Observe job execution and completion
    job_done = False
    for _ in range(30):
        time.sleep(0.3)
        j_res = client.get(f"/jobs/{fresh_job_id}")
        if j_res.status_code == 200 and j_res.json()["status"] == "COMPLETED":
            job_done = True
            break

    assert job_done, f"Fresh job {fresh_job_id} did not reach COMPLETED status"
    print(f"[OK] Fresh job {fresh_job_id} completed successfully!")

    # 4. Verify activity feed has new events from the fresh job
    act_res = client.get("/activity")
    events = act_res.json()["events"]
    assert len(events) >= 2  # CREATED, PROCESSING, COMPLETED
    print(f"[OK] Activity feed logged {len(events)} new events post-reset")

    # 5. Clean up the fresh worker with hard-reset
    final_reset = client.post("/admin/hard-reset")
    assert final_reset.status_code == 200
    print("[OK] Final cleanup hard-reset executed successfully")

    print("\n=======================================================")
    print("ALL HARD RESET TESTS PASSED WITH 100% SUCCESS!")
    print("=======================================================\n")


if __name__ == "__main__":
    test_hard_reset_lifecycle()
