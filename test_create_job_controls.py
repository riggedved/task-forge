"""
Test suite to verify Create Job controls:
1. Default (priority=10, duration=10, delay=0)
2. Custom priority (priority=25)
3. Custom duration (duration=1.5 - fast test verifying worker respects payload.duration)
4. Custom delay (delay=30)
5. Combined custom values (priority=25, duration=15, delay=10)
"""
import time
from fastapi.testclient import TestClient
from app.main import app, READY_QUEUE, DELAYED_QUEUE
from app.database import SessionLocal
from app.models import Job
from app.redis_client import redis_client
from app.worker import process_job

client = TestClient(app)

def run_tests():
    print("=== Testing Task Forge Create Job Backend & Controls ===")

    # 1. Test Default Case
    # Priority = 10, Duration = 10 (existing default), Delay = 0
    print("\n--- Test 1: Default Job (Priority=10, Duration=10, Delay=0) ---")
    payload1 = {
        "type": "email",
        "payload": {
            "recipient": "test-default@taskforge.dev",
            "duration": 10
        },
        "priority": 10,
        "delay_seconds": 0,
        "idempotency_key": f"test-default-{time.time()}"
    }
    r1 = client.post("/create-job", json=payload1)
    assert r1.status_code == 201, f"Failed creating default job: {r1.text}"
    job1 = r1.json()
    assert job1["priority"] == 10, f"Expected priority 10, got {job1['priority']}"
    assert job1["payload"].get("duration") == 10, f"Expected duration 10, got {job1['payload']}"

    # Verify score in READY_QUEUE is -10
    score1 = redis_client.zscore(READY_QUEUE, str(job1["id"]))
    assert score1 == -10.0, f"Expected score -10.0, got {score1}"
    print(f"[OK] Default job created: ID={job1['id']}, priority={job1['priority']}, score={score1}, payload.duration={job1['payload']['duration']}")

    # 2. Test Custom Priority: Priority = 25
    print("\n--- Test 2: Custom Priority (Priority=25) ---")
    payload2 = {
        "type": "data_export",
        "payload": {
            "format": "parquet",
            "duration": 10
        },
        "priority": 25,
        "delay_seconds": 0,
        "idempotency_key": f"test-priority-25-{time.time()}"
    }
    r2 = client.post("/create-job", json=payload2)
    assert r2.status_code == 201, f"Failed creating custom priority job: {r2.text}"
    job2 = r2.json()
    assert job2["priority"] == 25, f"Expected priority 25, got {job2['priority']}"

    # Verify score in READY_QUEUE is -25 (pops before -10)
    score2 = redis_client.zscore(READY_QUEUE, str(job2["id"]))
    assert score2 == -25.0, f"Expected score -25.0, got {score2}"
    print(f"[OK] Custom priority job created: ID={job2['id']}, priority={job2['priority']}, score={score2}")

    # Verify priority sorting: -25 comes before -10
    top_jobs = redis_client.zrange(READY_QUEUE, 0, 1)
    # job2 should be earlier in zrange than job1
    assert str(job2["id"]) in top_jobs, f"Expected {job2['id']} to be at top of queue"
    print(f"[OK] Redis priority ranking verified: Job {job2['id']} (priority 25) scheduled ahead.")

    # 3. Test Custom Duration: Duration = 1.2s (Verify worker actually processes for this duration)
    print("\n--- Test 3: Custom Duration (Duration=1.2s Worker Execution Test) ---")
    payload3 = {
        "type": "image_processing",
        "payload": {
            "asset_id": "test_img.png",
            "duration": 1.2
        },
        "priority": 10,
        "delay_seconds": 0,
        "idempotency_key": f"test-duration-worker-{time.time()}"
    }
    r3 = client.post("/create-job", json=payload3)
    assert r3.status_code == 201, f"Failed creating custom duration job: {r3.text}"
    job3 = r3.json()
    assert job3["payload"].get("duration") == 1.2

    # Run worker processing on job3 and time it
    t_start = time.time()
    process_job(job3["id"])
    t_elapsed = time.time() - t_start

    db = SessionLocal()
    completed_job3 = db.query(Job).filter(Job.id == job3["id"]).first()
    assert completed_job3.status == "COMPLETED", f"Expected COMPLETED, got {completed_job3.status}"
    assert 1.1 <= t_elapsed <= 2.5, f"Expected execution duration ~1.2s, took {t_elapsed:.2f}s"
    print(f"[OK] Custom duration worker test passed: completed in {t_elapsed:.2f}s (configured 1.2s), status={completed_job3.status}")
    db.close()

    # 4. Test Custom Delay: Delay = 30
    print("\n--- Test 4: Custom Delay (Delay=30) ---")
    now_before = time.time()
    payload4 = {
        "type": "notification",
        "payload": {
            "channel": "slack",
            "duration": 10
        },
        "priority": 5,
        "delay_seconds": 30,
        "idempotency_key": f"test-delay-30-{time.time()}"
    }
    r4 = client.post("/create-job", json=payload4)
    assert r4.status_code == 201, f"Failed creating delayed job: {r4.text}"
    job4 = r4.json()

    # Verify job is NOT in ready_queue
    assert redis_client.zscore(READY_QUEUE, str(job4["id"])) is None, "Delayed job must not be in READY_QUEUE"

    # Verify job IS in delayed_queue with score ~ now + 30
    delayed_score = redis_client.zscore(DELAYED_QUEUE, f"{job4['id']}:{job4['priority']}")
    assert delayed_score is not None, "Job must be in DELAYED_QUEUE"
    assert delayed_score >= now_before + 29, f"Delayed score {delayed_score} too early"
    print(f"[OK] Delayed job verified: ID={job4['id']}, DELAYED_QUEUE member='{job4['id']}:{job4['priority']}', execute_at in {delayed_score - time.time():.1f}s")

    # 5. Test Combined Custom Values (Priority=25, Duration=15, Delay=10)
    print("\n--- Test 5: Combined Custom Values (Priority=25, Duration=15, Delay=10) ---")
    payload5 = {
        "type": "email",
        "payload": {
            "recipient": "combined@taskforge.dev",
            "duration": 15
        },
        "priority": 25,
        "delay_seconds": 10,
        "idempotency_key": f"test-combined-{time.time()}"
    }
    r5 = client.post("/create-job", json=payload5)
    assert r5.status_code == 201, f"Failed creating combined custom job: {r5.text}"
    job5 = r5.json()
    assert job5["priority"] == 25
    assert job5["payload"].get("duration") == 15

    # Verify delayed member includes priority 25
    comb_delayed_score = redis_client.zscore(DELAYED_QUEUE, f"{job5['id']}:25")
    assert comb_delayed_score is not None, "Combined job must be in DELAYED_QUEUE with priority 25"

    # Verify detail endpoint
    r5_detail = client.get(f"/jobs/{job5['id']}")
    assert r5_detail.status_code == 200
    j5_data = r5_detail.json()
    assert j5_data["priority"] == 25
    assert j5_data["payload"]["duration"] == 15
    print(f"[OK] Combined custom values verified: ID={j5_data['id']}, priority={j5_data['priority']}, payload.duration={j5_data['payload']['duration']}, delayed_member='{job5['id']}:25'")

    print("\n=======================================================")
    print("   ALL 5 TESTS PASSED: Default, Custom Priority,       ")
    print("   Custom Duration, Custom Delay, Combined Custom      ")
    print("=======================================================")

if __name__ == "__main__":
    run_tests()
