# Task Forge ⚡ Distributed Job Queue

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?logo=sqlalchemy)](https://www.sqlalchemy.org/)
[![Uvicorn](https://img.shields.io/badge/Uvicorn-ASGI-2C5BB4)](https://www.uvicorn.org/)
[![Pydantic](https://img.shields.io/badge/Pydantic-v2-E92063?logo=pydantic)](https://docs.pydantic.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Architecture](https://img.shields.io/badge/Architecture-Distributed%20Systems-blueviolet)]()
[![Guarantees](https://img.shields.io/badge/Guarantees-At--Least--Once-success)]()

A high-throughput, fault-tolerant distributed task and job queue engine engineered in Python using **FastAPI**, **Redis**, and **PostgreSQL**.

Built from first principles around core distributed systems primitives, Task Forge provides **at-least-once delivery guarantees**, **atomic zero-lock contention claiming via Redis Lua scripts**, **priority-driven inverted scheduling**, **worker crash recovery via distributed time-bounded leases and asynchronous heartbeats**, **strict idempotency deduplication**, and **exponential backoff retries with dead-letter queueing (DLQ)**.

---

## 📑 Table of Contents

- [System Overview & Guarantees](#-system-overview--guarantees)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
  - [Architectural Block Diagram](#architectural-block-diagram)
  - [End-to-End Lifecycle Flow](#end-to-end-lifecycle-flow)
- [Under the Hood: Deep Dive](#-under-the-hood-deep-dive)
  - [1. Redis Queue Topology & Data Structures](#1-redis-queue-topology--data-structures)
  - [2. Atomic Job Claiming via Lua](#2-atomic-job-claiming-via-lua)
  - [3. Scheduled & Delayed Execution Engine](#3-scheduled--delayed-execution-engine)
  - [4. Distributed Leases & Asynchronous Heartbeats](#4-distributed-leases--asynchronous-heartbeats)
  - [5. Zombie Worker Recovery Daemon (The Reaper)](#5-zombie-worker-recovery-daemon-the-reaper)
  - [6. Exponential Backoff Retries & Dead-Letter Queue (DLQ)](#6-exponential-backoff-retries--dead-letter-queue-dlq)
  - [7. Idempotent Ingestion & Conflict Resolution](#7-idempotent-ingestion--conflict-resolution)
- [Tech Stack](#-tech-stack)
- [Database Schema & State Machine](#-database-schema--state-machine)
- [API Reference](#-api-reference)
  - [Endpoints Summary](#endpoints-summary)
  - [1. Root Health Check](#1-root-health-check)
  - [2. Create / Submit Job](#2-create--submit-job)
  - [3. List All Jobs](#3-list-all-jobs)
  - [4. Get Job Details & Lease Status](#4-get-job-details--lease-status)
- [Project Structure](#-project-structure)
- [Local Development & Setup](#-local-development--setup)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Starting the Services](#starting-the-services)
- [End-to-End Simulation & Verification Guide](#-end-to-end-simulation--verification-guide)
  - [Scenario A: Priority Inversion & Ordering](#scenario-a-priority-inversion--ordering)
  - [Scenario B: Scheduled & Delayed Execution](#scenario-b-scheduled--delayed-execution)
  - [Scenario C: Simulated Failure, Exponential Backoff & DLQ](#scenario-c-simulated-failure-exponential-backoff--dlq)
  - [Scenario D: Worker Crash & Reaper Self-Healing](#scenario-d-worker-crash--reaper-self-healing)
  - [Scenario E: Idempotency Key Deduplication](#scenario-e-idempotency-key-deduplication)
- [Configuration Reference](#-configuration-reference)
- [Production Roadmap & Scalability](#-production-roadmap--scalability)
- [Author & License](#-author--license)

---

## 🛡 System Overview & Guarantees

| Metric / Dimension | Guarantee / Specification | Implementation Details |
| :--- | :--- | :--- |
| **Delivery Semantics** | **At-Least-Once Delivery** | Jobs are preserved in `processing_queue` until terminal ACK is committed. |
| **Claiming Atomicity** | **Zero TOCTOU Contention** | Redis Lua script executes `ZPOPMIN` + `ZADD` atomically within single Redis cycle. |
| **Scheduling Model** | **Priority Inversion Scoring** | Redis Sorted Sets with inverted priority (`-priority`); higher scores pop first. |
| **Delayed Execution** | **Sub-second precision** | Worker sweeps `delayed_queue` via Lua `ZRANGEBYSCORE` comparing against current epoch. |
| **Fault Recovery** | **Time-Bounded Leases (60s)** | Leases auto-expire if heartbeats halt; standalone **Reaper** requeues orphaned tasks. |
| **Heartbeat Thread** | **Background Async Daemon (20s)** | Dedicated Python thread extends Redis & PostgreSQL lease without blocking task execution. |
| **Retry Strategy** | **Exponential Backoff** | $T_{\text{wait}} = 5\text{s} \times 2^{(\text{retry}-1)}$; up to 3 retries before DLQ routing. |
| **Dead-Letter Queue** | **Quarantine Isolation** | Permanently failing jobs are placed in `failed_queue` and flagged `FAILED` in PostgreSQL. |
| **Ingestion Deduplication** | **Strict Idempotency** | PostgreSQL unique constraint on `idempotency_key` with automatic conflict rollback. |
| **Persistence Model** | **Hybrid In-Memory + Relational** | Fast scheduling via Redis in-memory ZSETs; audit & state ledger in PostgreSQL. |

---

## ✨ Key Features

### 1. Priority-Based Scheduling & Inverted Scores
- Jobs are enqueued into a Redis Sorted Set (`job_queue`) with an inverted priority score (`-priority`).
- An urgent job with `priority: 10` is indexed with score `-10`, ensuring it is popped ahead of a job with `priority: 1` (`-1`) when workers execute `ZPOPMIN`.

### 2. Atomic Distributed Job Claiming (Lua Scripts)
- Eliminates Time-Of-Check-To-Time-Of-Use (TOCTOU) race conditions among concurrent worker processes.
- An atomic Lua script pops the top-priority job from `job_queue` and inserts it into `processing_queue` with an initial lease timestamp in a single atomic transaction. No two workers can ever claim the same job.

### 3. Distributed Leases & Asynchronous Heartbeats
- Claimed jobs are granted a temporary lease (default: 60 seconds).
- A lightweight background thread (`heartbeat_loop`) periodically pulses every 20 seconds, renewing the `lease_until` timestamp in both Redis and PostgreSQL.
- Long-running jobs run uninterrupted without risk of premature eviction as long as the worker process remains healthy.

### 4. Crash-Resilient Worker Recovery ("The Reaper")
- If a worker process abruptly dies (`kill -9`, segmentation fault, out-of-memory error, or hardware failure), its heartbeat thread immediately stops.
- A standalone daemon process, the **Reaper**, continuously sweeps `processing_queue` for expired leases (`lease_until < current_time`).
- Expired jobs are safely pulled out of `processing_queue`, have their database status reset to `PENDING`, and are re-inserted into `job_queue` with their original priority.

### 5. Exponential Backoff Retries & Dead-Letter Queue (DLQ)
- Transient execution failures trigger an automated exponential backoff schedule:
  - **Attempt 1**: Requeued to `delayed_queue` with 5s delay.
  - **Attempt 2**: Requeued to `delayed_queue` with 10s delay.
  - **Attempt 3**: Requeued to `delayed_queue` with 20s delay.
- When `MAX_RETRIES` (3) is exceeded, the job is flagged as `FAILED` in PostgreSQL and permanently routed to the `failed_queue` (Dead-Letter Queue) for operational inspection.

### 6. Idempotent Submission & Deduplication Engine
- Producers can attach an optional `idempotency_key` to prevent duplicate task execution caused by network timeouts, retries, or duplicate webhooks.
- Deduplication is guaranteed using database-level `UNIQUE` constraints and atomic exception handling in FastAPI. Duplicate submissions return the existing job instance with zero re-enqueuing.

### 7. Dual-Tier Persistence & Complete Relational Audit Trail
- Redis provides microsecond in-flight queue operations.
- PostgreSQL acts as the source of truth, persisting task payloads, timestamps (`created_at`, `started_at`, `completed_at`), worker assignment UUIDs, retry counters, and final execution statuses.

---

## 🏛 System Architecture

### Architectural Block Diagram

```
                                      +------------------------------------+
                                      |      Clients / API Producers       |
                                      +-----------------+------------------+
                                                        |
                                            HTTP POST /create-job
                                            HTTP GET  /jobs
                                                        |
                                                        v
                                      +------------------------------------+
                                      |          FastAPI Gateway           |
                                      |       (Idempotency & Router)       |
                                      +--------+------------------+--------+
                                               |                  |
                       +-----------------------+                  +-----------------------+
                       | Write Job State & Audit                                          | Enqueue Job Member
                       v                                                                  v
+---------------------------------------------+               +-------------------------------------------------+
|             PostgreSQL Database             |               |                Redis Engine                     |
|                                             |               |                                                 |
|  +---------------------------------------+  |               |  +-------------------------------------------+  |
|  |             jobs Table                |  |               |  |  job_queue (ZSET: -priority)              |  |
|  | - id, type, payload, priority         |  |               |  +---------------------+---------------------+  |
|  | - status (PENDING/PROCESSING/etc.)    |  |               |                        ^                        |
|  | - worker_id, lease_until              |  |               |        Move Due Jobs   |  Atomic Claim (Lua)    |
|  | - retry_count, idempotency_key        |  |               |       (Lua Script)     |  (ZPOPMIN + ZADD)      |
|  | - created_at, started_at, completed_at|  |               |                        |                        v
|  +---------------------------------------+  |               |  +---------------------+-----+   +--------------+-----+  |
|                         ^                   |               |  | delayed_queue (ZSET)      |   | processing_queue   |  |
|                         |                   |               |  | score: execute_at (epoch) |   | score: lease_until |  |
|                         |                   |               |  +---------------------------+   +--------------+-----+  |
+-------------------------|-------------------+               |                                                 |        |
                          |                                   |  +-------------------------------------------+  |        |
                          | Audit / Status Updates            |  | failed_queue (ZSET / Dead-Letter Queue)   |  |        |
                          | & Heartbeat Lease Sync            |  +---------------------+---------------------+  |        |
                          |                                   +------------------------|------------------------+        |
                          |                                                            |                                 |
+-------------------------+------------------------------------------------------------+                                 |
|                                                                                                                        |
|       +----------------------------------------------------------------------------------------------------------------+
|       |
|       v
|  +-------------------------------------------------------------------------------------+
|  |                              Distributed Worker Pool                                |
|  |                                                                                     |
|  |  +---------------------------------------+   +-----------------------------------+  |
|  |  | Worker Node (UUID)                    |   | Worker Node (UUID)                |  |
|  |  |                                       |   |                                   |  |
|  |  |  1. Evaluates Due Delayed Tasks (Lua) |   |  1. Evaluates Due Delayed Tasks   |  |
|  |  |  2. Claims Job Atomically (Lua)       |   |  2. Claims Job Atomically         |  |
|  |  |  3. Spawns Async Heartbeat Thread     |   |  3. Spawns Async Heartbeat Thread |  |
|  |  |  4. Executes Task Logic               |   |  4. Executes Task Logic           |  |
|  |  |  5. ACK / Retries / DLQ Routing       |   |  5. ACK / Retries / DLQ Routing   |  |
|  |  +-------------------+-------------------+   +-----------------+-----------------+  |
|  |                      |                                         |                    |
|  |                      +--------------------+--------------------+                    |
|  |                                           |                                         |
|  |                                           v                                         |
|  |                        +-------------------------------------+                      |
|  |                        |   Background Heartbeat Threads      |                      |
|  |                        |   (Renews lease every 20 seconds)   |                      |
|  |                        +-------------------------------------+                      |
|  +-------------------------------------------------------------------------------------+
|
|       +--------------------------------------------------------------------------------+
|       | Scans expired leases (lease_until < now) every 5s
|       v
|  +-------------------------------------------------------------------------------------+
|  |                            Reaper Recovery Daemon                                   |
|  |                                                                                     |
|  |  1. Finds expired members in processing_queue via ZRANGEBYSCORE                     |
|  |  2. Atomically ZREM expired entry                                                   |
|  |  3. Resets PostgreSQL status to PENDING, clears worker_id & lease_until             |
|  |  4. Re-enqueues job back into job_queue with original priority                      |
|  +-------------------------------------------------------------------------------------+
```

---

### End-to-End Lifecycle Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Producer Client
    participant API as FastAPI Gateway
    participant DB as PostgreSQL
    participant Redis as Redis Engine
    participant Worker as Worker Process
    participant Heartbeat as Heartbeat Thread
    participant Reaper as Reaper Daemon

    Note over Client,API: 1. Ingestion Phase
    Client->>API: POST /create-job (payload, priority, delay_seconds, idempotency_key)
    API->>DB: Check idempotency_key & insert Job (status: PENDING)
    alt Immediate Job (delay_seconds == 0)
        API->>Redis: ZADD job_queue (-priority, job_id)
    else Delayed Job (delay_seconds > 0)
        API->>Redis: ZADD delayed_queue (execute_at, job_id:priority)
    end
    API-->>Client: 200 OK (job_id, status: PENDING)

    Note over Redis,Worker: 2. Scheduling & Claiming Phase
    Worker->>Redis: Run MOVE_DELAYED_JOBS_SCRIPT (migrate due jobs -> job_queue)
    Worker->>Redis: Run CLAIM_JOB_SCRIPT (Atomic ZPOPMIN job_queue -> ZADD processing_queue)
    Redis-->>Worker: job_id returned
    Worker->>DB: UPDATE jobs SET status='PROCESSING', worker_id=UUID, lease_until=now()+60

    Note over Worker,Heartbeat: 3. Execution & Active Heartbeat
    Worker->>Heartbeat: Spawn daemon thread (interval: 20s)
    loop Every 20 seconds
        Heartbeat->>DB: UPDATE jobs SET lease_until = now() + 60
        Heartbeat->>Redis: ZADD processing_queue (new_lease_until, member)
    end
    Worker->>Worker: Execute Task Logic

    Note over Worker,DB: 4. Terminal State (Success / Retry / DLQ)
    alt Task Succeeded
        Worker->>Redis: ZREM processing_queue member
        Worker->>DB: UPDATE jobs SET status='COMPLETED', completed_at=now()
    else Task Failed (retry_count < 3)
        Worker->>Redis: ZREM processing_queue member
        Worker->>DB: UPDATE jobs SET status='PENDING', retry_count += 1
        Worker->>Redis: ZADD delayed_queue (now() + backoff, job_id:priority)
    else Retries Exhausted (retry_count >= 3)
        Worker->>Redis: ZREM processing_queue member
        Worker->>Redis: ZADD failed_queue (now(), job_id)
        Worker->>DB: UPDATE jobs SET status='FAILED', completed_at=now()
    end

    Note over Redis,Reaper: 5. Crash Recovery (Alternative Branch)
    critical Worker Dies / Crashes
        Worker--xHeartbeat: Worker terminates; heartbeat stops
        Reaper->>Redis: ZRANGEBYSCORE processing_queue -inf now()
        Reaper->>Redis: ZREM processing_queue expired_member
        Reaper->>DB: UPDATE jobs SET status='PENDING', worker_id=NULL, lease_until=NULL
        Reaper->>Redis: ZADD job_queue (priority_score, job_id)
    end
```

---

## 🔬 Under the Hood: Deep Dive

### 1. Redis Queue Topology & Data Structures

The system organizes queue states across four distinct Redis Sorted Sets (`ZSET`):

| Queue Name | Redis Key | Member Format | Score Value | Operational Role |
| :--- | :--- | :--- | :--- | :--- |
| **Ready Queue** | `job_queue` | `"<job_id>"` | `-priority` | In-memory priority queue. Popped using `ZPOPMIN`. Lowest score (highest numerical priority) is claimed first. |
| **Delayed Queue** | `delayed_queue` | `"<job_id>:<priority>"` | `execute_at` (Unix epoch float) | Holds scheduled tasks and backoff retries. Migrated to `job_queue` when `execute_at <= current_time`. |
| **Processing Queue** | `processing_queue` | `"<job_id>:<priority_score>"` | `lease_until` (Unix epoch float) | Holds active in-flight tasks. Score represents the lease deadline. Polled by the Reaper for expired leases. |
| **Dead-Letter Queue** | `failed_queue` | `"<job_id>"` | `failed_at` (Unix epoch float) | Holds permanently failed tasks after exhausting `MAX_RETRIES`. Provides quarantined isolation. |

---

### 2. Atomic Job Claiming via Lua

When multiple distributed workers poll for tasks concurrently, conventional multi-step queries (`ZRANGE` followed by `ZREM` and `ZADD`) suffer from race conditions where two workers claim the same task.

Task Forge solves this by executing claiming as a single atomic Lua script:

```lua
local jobs = redis.call('ZPOPMIN', KEYS[1], 1)
if #jobs == 0 then
    return nil
end

local job_id = jobs[1]
local priority_score = jobs[2]
local lease_until = tonumber(ARGV[1])

redis.call('ZADD', KEYS[2], lease_until, job_id .. ':' .. priority_score)
return job_id
```

- **Keys**: `KEYS[1]` (`job_queue`), `KEYS[2]` (`processing_queue`)
- **Arguments**: `ARGV[1]` (`lease_until` timestamp)
- **Guarantee**: Popping from the ready queue and enrolling in the processing queue with lease metadata is strictly atomic. Intermediate states are impossible.

---

### 3. Scheduled & Delayed Execution Engine

Tasks can be scheduled to run in the future using `delay_seconds`. The worker periodically checks and atomically moves all due items from `delayed_queue` into `job_queue` using another Lua script:

```lua
local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])

for _, member in ipairs(jobs) do
    local separator = string.find(member, ':')
    local job_id = string.sub(member, 1, separator - 1)
    local priority = tonumber(string.sub(member, separator + 1))

    redis.call('ZREM', KEYS[1], member)
    redis.call('ZADD', KEYS[2], -priority, job_id)
end

return #jobs
```

This guarantees batch migration without dropping any delayed tasks.

---

### 4. Distributed Leases & Asynchronous Heartbeats

To support long tasks without risking stale locks:
1. When a worker acquires a job, it registers a **60-second lease** (`lease_until = time.time() + 60`).
2. A dedicated daemon thread (`heartbeat_loop`) wakes every **20 seconds**.
3. It refreshes `lease_until` in both PostgreSQL and Redis `processing_queue`.
4. As long as the worker process is running and executing the job, the lease is continuously extended.

---

### 5. Zombie Worker Recovery Daemon (The Reaper)

If a worker node crashes (OOM killer, network partition, process abort):
1. The heartbeat daemon dies with the parent process.
2. The task remains in `processing_queue`, but its `lease_until` score is no longer updated.
3. The **Reaper** process (`app/reaper.py`) evaluates the queue every **5 seconds**:
   ```python
   expired_jobs = redis_client.zrangebyscore("processing_queue", "-inf", time.time())
   ```
4. For each expired member, it atomically executes `ZREM`.
5. If the job status in PostgreSQL is still `PROCESSING`, the Reaper resets its status to `PENDING`, clears `worker_id` and `lease_until`, and pushes it back into `job_queue` with its original priority score.

---

### 6. Exponential Backoff Retries & Dead-Letter Queue (DLQ)

When an unhandled exception occurs in worker logic, the system calculates a deterministic exponential backoff:

$$\text{Retry Delay} = \text{RETRY\_BACKOFF\_BASE} \times 2^{(\text{retry\_count} - 1)}$$

With default settings (`RETRY_BACKOFF_BASE = 5`, `MAX_RETRIES = 3`):

| Execution Attempt | Result | Backoff Delay | Destination Queue | Status |
| :---: | :---: | :---: | :---: | :---: |
| **Initial Run** | Fails | $5 \times 2^0 = 5\text{s}$ | `delayed_queue` | `PENDING` |
| **Retry 1** | Fails | $5 \times 2^1 = 10\text{s}$ | `delayed_queue` | `PENDING` |
| **Retry 2** | Fails | $5 \times 2^2 = 20\text{s}$ | `delayed_queue` | `PENDING` |
| **Retry 3 (Exhausted)** | Fails | None | `failed_queue` (DLQ) | `FAILED` |

---

### 7. Idempotent Ingestion & Conflict Resolution

To avoid duplicate job executions when producers retry network requests:
1. The producer supplies an `idempotency_key` (UUID or domain hash).
2. FastAPI first checks if a job with that key already exists.
3. If not, it attempts to insert the job into PostgreSQL.
4. If a concurrent request attempts to insert the same key simultaneously, PostgreSQL throws an `IntegrityError`. The transaction is rolled back, and the existing job is returned.

---

## 🛠 Tech Stack

### Core Technologies

| Layer | Component | Version | Role in Architecture |
| :--- | :--- | :--- | :--- |
| **API & Gateway** | [FastAPI](https://fastapi.tiangolo.com/) | `0.115+` | High-performance asynchronous REST API framework |
| **Web Server** | [Uvicorn](https://www.uvicorn.org/) | `0.30+` | Lightning-fast ASGI web server implementation |
| **Validation** | [Pydantic](https://docs.pydantic.dev/) | `v2` | Request validation and schema enforcement |
| **In-Memory Broker** | [Redis](https://redis.io/) | `7.0+` | Priority scheduling, atomic Lua script execution, and lease queues |
| **Relational Store** | [PostgreSQL](https://www.postgresql.org/) | `16.0+` | Persistent state storage, audit logging, and unique constraints |
| **ORM & Driver** | [SQLAlchemy](https://www.sqlalchemy.org/) + [psycopg2](https://www.psycopg.org/) | `2.0+` | Database abstraction, migrations, connection management |
| **Language Runtime** | [Python](https://www.python.org/) | `3.12+` | Core programming language for workers, APIs, and daemons |

---

## 🗄 Database Schema & State Machine

### PostgreSQL Table Definition (`jobs`)

```sql
CREATE TABLE jobs (
    id SERIAL PRIMARY KEY,
    type VARCHAR NOT NULL,
    payload JSON NOT NULL,
    priority INTEGER DEFAULT 1,
    status VARCHAR DEFAULT 'PENDING',        -- PENDING, PROCESSING, COMPLETED, FAILED
    retry_count INTEGER DEFAULT 0,
    worker_id VARCHAR NULL,                  -- UUID of claiming worker
    lease_until DOUBLE PRECISION NULL,       -- Unix epoch timestamp of lease deadline
    idempotency_key VARCHAR UNIQUE NULL,     -- Client deduplication token
    created_at DOUBLE PRECISION,             -- Unix epoch creation timestamp
    started_at DOUBLE PRECISION NULL,        -- Unix epoch execution start timestamp
    completed_at DOUBLE PRECISION NULL       -- Unix epoch termination timestamp
);

CREATE INDEX ix_jobs_id ON jobs (id);
CREATE UNIQUE INDEX ix_jobs_idempotency_key ON jobs (idempotency_key);
```

### Job Lifecycle State Machine

```
               [ POST /create-job ]
                        |
                        v
                 +--------------+
                 |   PENDING    |<-----------------------+
                 +-------+------+                        |
                         |                               |
                   Worker Claims                         |
                   (Atomic Lua)                          |
                         |                               |
                         v                               |
                 +--------------+         Reaper         |
                 |  PROCESSING  |------------------------+
                 +-------+------+    (Lease Expired)
                         |
           +-------------+-------------+
           |                           |
        Success                     Failure
           |                           |
           v                           v
    +--------------+            Retry Count < 3?
    |  COMPLETED   |             /            \
    +--------------+          YES              NO
                               |                |
                       Exponential Backoff      v
                       in delayed_queue   +--------------+
                               |          |    FAILED    |
                               +--------->| (Moved to    |
                                          |  DLQ ZSET)   |
                                          +--------------+
```

---

## 🔌 API Reference

### Endpoints Summary

| Method | Endpoint | Description | Idempotent |
| :--- | :--- | :--- | :---: |
| `GET` | `/` | API gateway health check | Yes |
| `POST` | `/create-job` | Submits a new job (supports priority, delay, idempotency) | Yes (with key) |
| `GET` | `/jobs` | Lists all jobs ordered by ID descending | Yes |
| `GET` | `/jobs/{job_id}` | Retrieves status, payload, worker UUID, and lease timestamps | Yes |

---

### 1. Root Health Check
`GET /`

Verifies that the FastAPI application and database connections are operational.

#### Example Request
```bash
curl -X GET http://localhost:8000/
```

#### Example Response (`200 OK`)
```json
{
  "message": "Job Queue API is running"
}
```

---

### 2. Create / Submit Job
`POST /create-job`

Submits a new task to the queue. Automatically routes immediate jobs to `job_queue` and delayed jobs to `delayed_queue`.

#### Request Body Parameters
| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `type` | `string` | **Yes** | — | Task type descriptor (e.g., `send_email`, `transcode_video`, `fail`). |
| `payload` | `object` | **Yes** | — | Arbitrary JSON payload required for task execution. |
| `priority` | `integer` | No | `1` | Numerical priority. Higher values execute first. |
| `delay_seconds` | `integer` | No | `0` | Delay before task becomes eligible for claiming. |
| `idempotency_key` | `string` | No | `null` | Client-provided token to guarantee deduplication. |

#### Example A: Immediate Standard Job
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "generate_invoice",
    "payload": {
      "order_id": 98124,
      "currency": "INR",
      "amount": 4500
    },
    "priority": 5
  }'
```

#### Example B: Scheduled / Delayed Job
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_reminder_sms",
    "payload": {
      "user_id": 5510,
      "message": "Your booking is tomorrow at 10:00 AM"
    },
    "delay_seconds": 60
  }'
```

#### Example C: Idempotent Submission
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sync_customer_crm",
    "payload": { "account_id": "ACC-789" },
    "idempotency_key": "crm-sync-acc-789-v1"
  }'
```

#### Response (`200 OK`)
```json
{
  "id": 1,
  "type": "generate_invoice",
  "payload": {
    "order_id": 98124,
    "currency": "INR",
    "amount": 4500
  },
  "priority": 5,
  "status": "PENDING",
  "idempotency_key": null
}
```

---

### 3. List All Jobs
`GET /jobs`

Retrieves a list of all jobs in the database ordered by `id` descending.

#### Example Request
```bash
curl -X GET http://localhost:8000/jobs
```

#### Response (`200 OK`)
```json
[
  {
    "id": 2,
    "type": "send_reminder_sms",
    "priority": 1,
    "status": "PENDING",
    "retry_count": 0,
    "worker_id": null,
    "created_at": 1759132800.12,
    "started_at": null,
    "completed_at": null
  },
  {
    "id": 1,
    "type": "generate_invoice",
    "priority": 5,
    "status": "COMPLETED",
    "retry_count": 0,
    "worker_id": null,
    "created_at": 1759132700.45,
    "started_at": 1759132702.10,
    "completed_at": 1759132712.15
  }
]
```

---

### 4. Get Job Details & Lease Status
`GET /jobs/{job_id}`

Retrieves complete metadata, active worker UUID, payload, and lease expiry timestamp for a specific job.

#### Example Request
```bash
curl -X GET http://localhost:8000/jobs/1
```

#### Response (`200 OK`)
```json
{
  "id": 1,
  "type": "generate_invoice",
  "payload": {
    "order_id": 98124,
    "currency": "INR",
    "amount": 4500
  },
  "priority": 5,
  "status": "PROCESSING",
  "retry_count": 0,
  "worker_id": "9d41fe0c-1123-45cd-a9bb-f6b0f15c7a10",
  "lease_until": 1759132762.10,
  "created_at": 1759132700.45,
  "started_at": 1759132702.10,
  "completed_at": null
}
```

---

## 📁 Project Structure

```
task-forge/
├── app/
│   ├── __init__.py         # Package initialization
│   ├── database.py         # SQLAlchemy engine, session maker, and declarative Base
│   ├── models.py           # SQLAlchemy Job model (statuses, leases, retry counts)
│   ├── redis_client.py     # Centralized Redis client connection instance
│   ├── main.py             # FastAPI application, routing, and idempotency logic
│   ├── worker.py           # Distributed worker daemon (atomic Lua, heartbeats, retries)
│   └── reaper.py           # Crash recovery daemon (sweeps expired leases every 5s)
├── requirements.txt        # Production Python dependencies
└── README.md               # System documentation and operational runbook
```

---

## 🚀 Local Development & Setup

### Prerequisites

Ensure you have the following installed on your workstation:
1. **Python 3.10+** (Python 3.12 recommended)
2. **PostgreSQL** (running locally on port `5432` with a database named `job_queue`)
3. **Redis** (running locally on port `6379`)

---

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/riggedved/task-forge.git
   cd task-forge
   ```

2. **Create and activate a virtual environment**:
   ```bash
   # Windows (PowerShell):
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # Linux / macOS:
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

---

### Configuration

Ensure your local PostgreSQL and Redis connection credentials match your setup:

1. **Database Configuration** (`app/database.py`):
   ```python
   DATABASE_URL = "postgresql://postgres:your_password@localhost:5432/job_queue"
   ```

2. **Redis Configuration** (`app/redis_client.py`):
   ```python
   redis_client = redis.Redis(
       host="localhost",
       port=6379,
       decode_responses=True
   )
   ```

---

### Starting the Services

Task Forge operates as decoupled microservices. For testing or local execution, open three separate terminal windows:

#### Terminal 1: Start the FastAPI API Server
```bash
uvicorn app.main:app --reload --port 8000
```
> The interactive Swagger UI will be accessible at [http://localhost:8000/docs](http://localhost:8000/docs).

#### Terminal 2: Start One (or More) Worker Processes
```bash
python -m app.worker
```
> You can launch multiple worker instances simultaneously in separate terminals. Each worker generates its own unique UUID and coordinates via Redis without race conditions.

#### Terminal 3: Start the Reaper Recovery Daemon
```bash
python -m app.reaper
```
> The Reaper runs on a continuous 5-second loop, actively protecting against dead or crashed workers.

---

## 🧪 End-to-End Simulation & Verification Guide

### Scenario A: Priority Inversion & Ordering

Demonstrates that higher priority tasks execute ahead of lower priority tasks, regardless of submission order.

1. Submit a low-priority task (`priority: 1`):
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{"type": "batch_export", "payload": {"batch_id": 101}, "priority": 1}'
   ```

2. Submit an urgent high-priority task (`priority: 10`):
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{"type": "critical_alert", "payload": {"alert_id": 999}, "priority": 10}'
   ```

**Observation**:
Observe the worker terminal. Even if Job 1 was submitted first, Job 2 (`priority: 10`) is claimed and executed immediately by the worker because its inverted score (`-10`) is popped first by `ZPOPMIN`.

---

### Scenario B: Scheduled & Delayed Execution

Demonstrates that delayed jobs remain held until their scheduled execution epoch.

1. Submit a delayed job with a 15-second delay:
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{"type": "delayed_sync", "payload": {"task": "hourly_sync"}, "delay_seconds": 15}'
   ```

**Observation**:
- The job sits in `delayed_queue` with score set to `time.time() + 15`.
- The worker loop logs `No jobs in queue`.
- After 15 seconds elapse, the worker's Lua migration script automatically moves the job into `job_queue`.
- The worker claims and processes the job immediately.

---

### Scenario C: Simulated Failure, Exponential Backoff & DLQ

Demonstrates automated error isolation, backoff scheduling, and routing to the Dead-Letter Queue.

1. Submit a task with `type: "fail"` (which triggers a simulated runtime exception):
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{"type": "fail", "payload": {"test_case": "error_handling"}}'
   ```

**Observation**:
1. Worker claims the job and raises `Exception: Simulated job failure`.
2. **Retry 1**: Moved to `delayed_queue` with a 5-second delay ($5 \times 2^0$).
3. **Retry 2**: Reclaimed after 5s, fails again, moved to `delayed_queue` with a 10-second delay ($5 \times 2^1$).
4. **Retry 3**: Reclaimed after 10s, fails again, moved to `delayed_queue` with a 20-second delay ($5 \times 2^2$).
5. **DLQ Quarantine**: After exceeding `MAX_RETRIES` (3), the worker sets the database status to `FAILED` and enqueues the job into `failed_queue`.

---

### Scenario D: Worker Crash & Reaper Self-Healing

Demonstrates resilient recovery when a worker node abruptly terminates mid-execution.

1. Submit a long-running job:
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{"type": "long_task", "payload": {"duration": "10s"}}'
   ```
2. The active worker claims the job and logs:
   ```text
   Processing Job 1
   Type: long_task
   Worker: 7b089c17-4740-42ba-b349-2e70f68e0d6b
   ```
3. **Simulate a crash**: Forcefully terminate the worker terminal process (`Ctrl + C` or `kill -9 <PID>`).
4. **Observation**:
   - The worker process stops, terminating its heartbeat thread.
   - Within 60 seconds (lease duration), the **Reaper** logs:
     ```text
     Recovering Job 1 from worker 7b089c17-4740-42ba-b349-2e70f68e0d6b
     ```
   - The Reaper resets the job status to `PENDING` and re-adds it to `job_queue`.
   - Start a new worker (`python -m app.worker`), and the job is claimed and completed without data loss.

---

### Scenario E: Idempotency Key Deduplication

Demonstrates deduplication protection against duplicate API calls.

1. Send the first request with an idempotency key:
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{
       "type": "charge_customer",
       "payload": {"amount": 2500},
       "idempotency_key": "txn_order_9981"
     }'
   ```
2. Send an identical second request with the same idempotency key:
   ```bash
   curl -X POST http://localhost:8000/create-job \
     -H "Content-Type: application/json" \
     -d '{
       "type": "charge_customer",
       "payload": {"amount": 2500},
       "idempotency_key": "txn_order_9981"
     }'
   ```

**Observation**:
Both requests return the exact same Job ID. Only one record is inserted into PostgreSQL, and only one task is enqueued in Redis.

---

## ⚙️ Configuration Reference

| Parameter | Location | Default Value | Description |
| :--- | :--- | :---: | :--- |
| `DATABASE_URL` | `app/database.py` | `postgresql://...` | Connection URI for the primary PostgreSQL instance. |
| `REDIS_HOST` | `app/redis_client.py` | `localhost` | Hostname for the Redis server. |
| `REDIS_PORT` | `app/redis_client.py` | `6379` | Port for the Redis server. |
| `LEASE_DURATION` | `app/worker.py` | `60` | Number of seconds a worker has to renew its lease before eviction. |
| `HEARTBEAT_INTERVAL` | `app/worker.py` | `20` | Interval in seconds between heartbeat lease renewals. |
| `MAX_RETRIES` | `app/worker.py` | `3` | Maximum retry attempts permitted before dead-letter routing. |
| `RETRY_BACKOFF_BASE` | `app/worker.py` | `5` | Base time multiplier in seconds for exponential backoff. |
| `REAPER_INTERVAL` | `app/reaper.py` | `5` | Sweep frequency in seconds for reclaiming orphaned leases. |

---

## 🗺 Production Roadmap & Scalability

- [ ] **Docker Compose Orchestration**: Containerize the FastAPI gateway, Redis, PostgreSQL, Worker, and Reaper into a unified `docker-compose.yml` stack with volume persistence.
- [ ] **Redis Sentinel / Redis Cluster Support**: Integrate high-availability Redis Sentinel failover support to prevent single points of failure.
- [ ] **Worker Multiprocessing & Concurrency**: Support process pooling (`multiprocessing` / `asyncio`) to allow a single worker instance to handle $N$ concurrent CPU or I/O bound jobs.
- [ ] **Prometheus Metrics & Health Endpoints**: Export real-time operational metrics (queue depth, processing latency, failure rates, active worker count) via `/metrics`.
- [ ] **Dead-Letter Queue Replay API**: Add management endpoints to inspect, purge, or replay failed jobs from `failed_queue` back into `job_queue`.
- [ ] **Webhooks & Callback Notification**: Support HTTP callbacks when a job completes or permanently fails.

---

## 👤 Author & License

**Ved Saxena**  
- GitHub: [@riggedved](https://github.com/riggedved)
- Repository: [https://github.com/riggedved/task-forge](https://github.com/riggedved/task-forge)

Distributed under the [MIT License](LICENSE).
