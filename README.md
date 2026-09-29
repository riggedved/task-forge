# Task Forge ⚡ Distributed Job Queue

A resilient, high-throughput distributed task and job queue system engineered in Python using **FastAPI**, **Redis**, and **PostgreSQL**.

Built with distributed systems primitives in mind, Task Forge guarantees **at-least-once delivery**, **atomic job claiming**, **priority-based scheduling**, **worker crash recovery via distributed leases**, **idempotency**, and **exponential backoff retries** with dead-letter queueing.

---

## 📑 Table of Contents

- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [How It Works (Under the Hood)](#-how-it-works-under-the-hood)
  - [1. Queue Data Structures](#1-redis-queue-data-structures)
  - [2. Atomic Job Claiming (Lua Scripts)](#2-atomic-job-claiming)
  - [3. Distributed Leases & Heartbeats](#3-distributed-leases--heartbeats)
  - [4. Worker Crash Recovery (The Reaper)](#4-worker-crash-recovery-the-reaper)
  - [5. Exponential Backoff & Dead Letter Queue](#5-exponential-backoff--dead-letter-queue)
  - [6. Idempotent Job Submission](#6-idempotent-job-submission)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)
  - [Create Job](#1-create-job)
  - [List All Jobs](#2-list-all-jobs)
  - [Get Job Status](#3-get-job-status)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Services](#running-the-services)
- [End-to-End Testing & Simulation](#-end-to-end-testing--simulation)
- [Configuration Reference](#-configuration-reference)
- [License](#-license)

---

## 🏛 System Architecture

The following diagram illustrates the flow of jobs between the API layer, Redis sorted sets, distributed workers, the reaper daemon, and the persistent PostgreSQL database:

```mermaid
flowchart TD
    Client(["🌐 Client / Producer"])

    subgraph API ["FastAPI Web Layer"]
        FastAPIEndpoint["POST /create-job\nGET /jobs\nGET /jobs/{id}"]
    end

    subgraph DB ["PostgreSQL Persistence"]
        PostgresDB[(jobs table\nAudit & State Tracking)]
    end

    subgraph Redis ["Redis Engine (Sorted Sets)"]
        ReadyQueue[("job_queue\n(Sorted by -priority)")]
        DelayedQueue[("delayed_queue\n(Sorted by execute_at)")]
        ProcessingQueue[("processing_queue\n(Sorted by lease_until)")]
        FailedQueue[("failed_queue\n(Dead Letter Queue)")]
    end

    subgraph Workers ["Distributed Worker Pool"]
        Worker1["Worker 1 (UUID)"]
        Worker2["Worker 2 (UUID)"]
        Heartbeat["Background Heartbeat Thread\n(Lease Extension every 20s)"]
    end

    subgraph Recovery ["Failure Recovery"]
        Reaper["Reaper Daemon\n(Scans expired leases every 5s)"]
    end

    %% Client Interactions
    Client -->|Submit Job| FastAPIEndpoint
    Client -->|Query Status| FastAPIEndpoint

    %% API Interactions
    FastAPIEndpoint -->|Save Job State & Idempotency Check| PostgresDB
    FastAPIEndpoint -->|Immediate Job| ReadyQueue
    FastAPIEndpoint -->|Delayed Job (delay_seconds > 0)| DelayedQueue

    %% Worker Interactions
    Worker1 & Worker2 -->|1. Move Due Jobs (Lua)| DelayedQueue
    DelayedQueue -.->|Migrated to| ReadyQueue
    Worker1 & Worker2 -->|2. Atomic Claim (Lua ZPOPMIN)| ReadyQueue
    ReadyQueue -.->|Moved to| ProcessingQueue
    Worker1 & Worker2 -->|3. Update State to PROCESSING| PostgresDB
    Worker1 & Worker2 -.->|Spawns| Heartbeat
    Heartbeat -->|Extend lease_until| ProcessingQueue
    Heartbeat -->|Extend lease_until| PostgresDB

    %% Completion / Failure
    Worker1 & Worker2 -->|Success: ZREM & Status COMPLETED| ProcessingQueue
    Worker1 & Worker2 -->|Success: Update COMPLETED| PostgresDB
    Worker1 & Worker2 -->|Retry: ZREM + Push to Backoff| DelayedQueue
    Worker1 & Worker2 -->|Exhausted: Push to DLQ| FailedQueue
    Worker1 & Worker2 -->|Exhausted: Status FAILED| PostgresDB

    %% Reaper Interactions
    Reaper -->|Polls Expired Leases| ProcessingQueue
    Reaper -->|Requeue Orphaned Jobs| ReadyQueue
    Reaper -->|Reset status to PENDING| PostgresDB
```

---

## ✨ Key Features

- **⚡ Priority Queue Scheduling**: Jobs are prioritized using Redis Sorted Sets with inverted priority scoring. Jobs with higher numerical priority execute before lower priority jobs.
- **⏱ Delayed & Scheduled Execution**: Schedule jobs to run in the future via `delay_seconds`. Handled atomically using Redis `ZRANGEBYSCORE` and Lua scripts.
- **🔒 Distributed Atomic Job Claiming**: Prevents double-claiming across concurrent workers using atomic Lua scripts (`ZPOPMIN` + `ZADD` to the processing queue in a single transaction).
- **💓 Distributed Leases & Heartbeat**: Active jobs acquire a time-limited lease (60s). A background daemon thread periodically renews the lease (every 20s) while work is progressing.
- **🧟 Crash-Resilient Reaper Daemon**: If a worker node crashes or loses network connectivity, its heartbeat ceases. The standalone Reaper detects expired leases and safely requeues jobs back to the ready queue.
- **🔁 Exponential Backoff Retries**: Failed jobs are automatically retried up to 3 times with exponential backoff (`5s * 2^(retry - 1)`: 5s, 10s, 20s) before being marked as permanently failed.
- **💀 Dead-Letter Queue (DLQ)**: Jobs that fail permanently after exceeding maximum retries are moved to a `failed_queue` for investigation and dead-letter monitoring.
- **🔑 At-Most-Once / Idempotent Ingestion**: Clients can pass an `idempotency_key`. The API guarantees deduplication through PostgreSQL unique constraints and conflict resolution.
- **📊 Relational Auditability**: All job payloads, execution logs, timestamps (`created_at`, `started_at`, `completed_at`), statuses, retry counts, and worker IDs are persisted in PostgreSQL.

---

## 🔬 How It Works (Under the Hood)

### 1. Redis Queue Data Structures

The system organizes jobs across four distinct Redis Sorted Sets:

| Queue Name | Redis Type | Member Format | Score Meaning |
| :--- | :--- | :--- | :--- |
| `job_queue` | Sorted Set (`ZSET`) | `<job_id>` | `-priority` (e.g. `-10` before `-1`) |
| `delayed_queue` | Sorted Set (`ZSET`) | `<job_id>:<priority>` | Execution timestamp (`epoch` seconds) |
| `processing_queue` | Sorted Set (`ZSET`) | `<job_id>:<priority_score>` | Lease expiration timestamp (`epoch` seconds) |
| `failed_queue` | Sorted Set (`ZSET`) | `<job_id>` | Failure timestamp (`epoch` seconds) |

---

### 2. Atomic Job Claiming

To prevent race conditions when multiple workers attempt to fetch work simultaneously, claiming is executed via an atomic Lua script:

```lua
local jobs = redis.call('ZPOPMIN', KEYS[1], 1)
if #jobs == 0 then return nil end

local job_id = jobs[1]
local priority_score = jobs[2]
local lease_until = tonumber(ARGV[1])

redis.call('ZADD', KEYS[2], lease_until, job_id .. ':' .. priority_score)
return job_id
```

This guarantees that popping from `job_queue` and adding to `processing_queue` with a lease expiration timestamp occurs without intermediate states.

---

### 3. Distributed Leases & Heartbeats

- When a worker claims a job, it is granted a **60-second lease** (`lease_until = time.time() + 60`).
- A dedicated background thread (`heartbeat_loop`) fires every **20 seconds**.
- The heartbeat refreshes the `lease_until` in both PostgreSQL and Redis `processing_queue`.
- This mechanism enables tasks that take minutes or hours to run safely without premature eviction, while still protecting against hung or severed workers.

---

### 4. Worker Crash Recovery (The Reaper)

If a worker process is terminated (e.g. `kill -9`, out-of-memory, machine shutdown), its background heartbeat terminates immediately.

The **Reaper** process (`app/reaper.py`) runs on a continuous 5-second interval:
1. Queries Redis: `ZRANGEBYSCORE processing_queue -inf <current_epoch>`.
2. Atomically removes expired entries from `processing_queue`.
3. Verifies that the job record in PostgreSQL is still in `PROCESSING` status.
4. Resets the job's status to `PENDING`, clears `worker_id` and `lease_until`.
5. Pushes the job back to `job_queue` retaining its original priority score.

---

### 5. Exponential Backoff & Dead Letter Queue

When an unhandled exception occurs inside a worker task:

$$\text{Retry Delay} = \text{RETRY\_BACKOFF\_BASE} \times 2^{(\text{retry\_count} - 1)}$$

| Attempt | Delay | Destination Queue | Status |
| :---: | :---: | :---: | :---: |
| **Fail 1** | $5 \times 2^0 = 5\text{s}$ | `delayed_queue` | `PENDING` |
| **Fail 2** | $5 \times 2^1 = 10\text{s}$ | `delayed_queue` | `PENDING` |
| **Fail 3** | $5 \times 2^2 = 20\text{s}$ | `delayed_queue` | `PENDING` |
| **Exhausted (>3)** | None | `failed_queue` | `FAILED` |

---

### 6. Idempotent Job Submission

When creating a job, the caller can provide a unique `idempotency_key` (e.g. a UUID or hash of the business operation):
1. **Pre-insert query**: If a record with this key exists in PostgreSQL, the existing job object is returned immediately without re-enqueuing.
2. **Race condition safety**: If two concurrent API calls bypass the pre-insert check, PostgreSQL enforces a database-level `UNIQUE` constraint, catching `IntegrityError`, rolling back, and returning the first registered job.

---

## 📁 Project Structure

```
├── app/
│   ├── __init__.py
│   ├── database.py         # SQLAlchemy engine, session maker, and Base definition
│   ├── models.py           # SQLAlchemy Job model (statuses, leases, retry counts)
│   ├── redis_client.py     # Centralized Redis connection instance
│   ├── main.py             # FastAPI REST application & endpoint definitions
│   ├── worker.py           # Distributed worker process (leases, heartbeats, retries)
│   └── reaper.py           # Standalone recovery daemon for zombie/orphaned jobs
├── requirements.txt        # Project dependencies
└── README.md               # Project documentation
```

---

## 🗄 Database Schema

The `jobs` table in PostgreSQL tracks persistent state and history:

```sql
CREATE TABLE jobs (
    id SERIAL PRIMARY KEY,
    type VARCHAR NOT NULL,
    payload JSON NOT NULL,
    priority INTEGER DEFAULT 1,
    status VARCHAR DEFAULT 'PENDING',        -- PENDING, PROCESSING, COMPLETED, FAILED
    retry_count INTEGER DEFAULT 0,
    worker_id VARCHAR NULL,                  -- UUID of claiming worker
    lease_until DOUBLE PRECISION NULL,       -- Unix timestamp of lease expiry
    idempotency_key VARCHAR UNIQUE NULL,     -- Optional deduplication token
    created_at DOUBLE PRECISION,             -- Unix timestamp
    started_at DOUBLE PRECISION NULL,        -- Unix timestamp
    completed_at DOUBLE PRECISION NULL       -- Unix timestamp
);

CREATE INDEX ix_jobs_id ON jobs (id);
```

---

## 🔌 API Reference

### 1. Create Job

Submit a new job for execution.

- **Method**: `POST`
- **Path**: `/create-job`
- **Headers**: `Content-Type: application/json`

#### Request Body Parameters

| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `type` | `string` | **Yes** | — | Task type descriptor (e.g., `email_notification`, `render_video`, `fail`). |
| `payload` | `object` | **Yes** | — | Arbitrary JSON payload required for the task. |
| `priority` | `integer` | No | `1` | Priority weighting. Higher values are executed first. |
| `delay_seconds` | `integer` | No | `0` | Delay in seconds before the job becomes eligible to run. |
| `idempotency_key`| `string` | No | `null` | Unique identifier to guarantee idempotent creation. |

#### Example Request

```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_welcome_email",
    "payload": {
      "user_id": 1042,
      "email": "user@example.com"
    },
    "priority": 5,
    "delay_seconds": 0,
    "idempotency_key": "signup-user-1042"
  }'
```

#### Example Response (`200 OK`)

```json
{
  "id": 1,
  "type": "send_welcome_email",
  "payload": {
    "user_id": 1042,
    "email": "user@example.com"
  },
  "priority": 5,
  "status": "PENDING",
  "idempotency_key": "signup-user-1042"
}
```

---

### 2. List All Jobs

Retrieve an overview of all jobs ordered by ID descending.

- **Method**: `GET`
- **Path**: `/jobs`

#### Example Request

```bash
curl http://localhost:8000/jobs
```

#### Example Response (`200 OK`)

```json
[
  {
    "id": 1,
    "type": "send_welcome_email",
    "priority": 5,
    "status": "COMPLETED",
    "retry_count": 0,
    "worker_id": null,
    "created_at": 1727600000.12,
    "started_at": 1727600001.45,
    "completed_at": 1727600011.52
  }
]
```

---

### 3. Get Job Status

Retrieve detailed metadata, payload, and lease info for a specific job.

- **Method**: `GET`
- **Path**: `/jobs/{job_id}`

#### Example Request

```bash
curl http://localhost:8000/jobs/1
```

#### Example Response (`200 OK`)

```json
{
  "id": 1,
  "type": "send_welcome_email",
  "payload": {
    "user_id": 1042,
    "email": "user@example.com"
  },
  "priority": 5,
  "status": "PROCESSING",
  "retry_count": 0,
  "worker_id": "7b089c17-4740-42ba-b349-2e70f68e0d6b",
  "lease_until": 1727600061.45,
  "created_at": 1727600000.12,
  "started_at": 1727600001.45,
  "completed_at": null
}
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following services installed and running:

1. **Python 3.10+**
2. **PostgreSQL** (running on port `5432` with a database named `job_queue`)
3. **Redis** (running on port `6379`)

---

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/riggedved/task-forge.git
   cd task-forge
   ```

2. **Create and activate a virtual environment**:
   ```bash
   python -m venv venv

   # On Linux/macOS:
   source venv/bin/activate

   # On Windows (PowerShell):
   .\venv\Scripts\Activate.ps1
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

---

### Configuration

Update your database and Redis connection settings if necessary:

- **Database** (`app/database.py`):
  ```python
  DATABASE_URL = "postgresql://postgres:your_password@localhost:5432/job_queue"
  ```
- **Redis** (`app/redis_client.py`):
  ```python
  redis_client = redis.Redis(
      host="localhost",
      port=6379,
      decode_responses=True
  )
  ```

---

### Running the Services

The system is designed as independent micro-services. For a full production or local test cluster, open separate terminal windows:

#### 1. Start the API Server

```bash
uvicorn app.main:app --reload --port 8000
```
> Interactive API documentation will be available at [http://localhost:8000/docs](http://localhost:8000/docs).

#### 2. Start One or More Workers

You can start multiple worker instances in parallel. Each worker automatically generates a unique UUID:

```bash
python -m app.worker
```

#### 3. Start the Reaper Recovery Daemon

```bash
python -m app.reaper
```

---

## 🧪 End-to-End Testing & Simulation

### Scenario A: Priority Ordering
Submit Job A with `priority: 1` and Job B with `priority: 10`:
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{"type": "report", "payload": {"id": 1}, "priority": 1}'

curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{"type": "urgent_alert", "payload": {"id": 2}, "priority": 10}'
```
> Observe the worker terminal: Job 2 (`priority: 10`) will be claimed and processed ahead of Job 1.

---

### Scenario B: Scheduled / Delayed Execution
Submit a job with a 15-second delay:
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{"type": "delayed_sync", "payload": {"batch": 42}, "delay_seconds": 15}'
```
> The job sits in `delayed_queue` until 15 seconds elapse, after which the worker's Lua script migrates it to `job_queue` for execution.

---

### Scenario C: Simulated Failure, Exponential Backoff & DLQ
Submit a job with `type: "fail"`:
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{"type": "fail", "payload": {"test": "error_simulation"}}'
```
> **Observation**:
> 1. Worker encounters `Exception("Simulated job failure")`.
> 2. Retry 1 schedules in 5 seconds (`2^0 * 5`).
> 3. Retry 2 schedules in 10 seconds (`2^1 * 5`).
> 4. Retry 3 schedules in 20 seconds (`2^2 * 5`).
> 5. After 3 retries, status becomes `FAILED` and member is moved to `failed_queue`.

---

### Scenario D: Worker Crash & Reaper Recovery
1. Submit a long job or standard job.
2. Once the worker prints `Processing Job X`, forcefully kill the worker process (`Ctrl + C` or kill process ID).
3. The heartbeat stops. Within 60 seconds (lease timeout), the running **Reaper** daemon logs:
   ```text
   Recovering Job X from worker <UUID>
   ```
4. Start a new worker; Job X will be immediately re-claimed and executed to completion!

---

## ⚙️ Configuration Reference

| Parameter | Location | Default | Description |
| :--- | :--- | :---: | :--- |
| `LEASE_DURATION` | `app/worker.py` | `60` | Duration (seconds) before an un-heartbeated lease is considered dead. |
| `HEARTBEAT_INTERVAL` | `app/worker.py` | `20` | Interval (seconds) at which the active worker renews its lease. |
| `MAX_RETRIES` | `app/worker.py` | `3` | Maximum retry attempts before routing to the Dead Letter Queue. |
| `RETRY_BACKOFF_BASE` | `app/worker.py` | `5` | Multiplier (seconds) for exponential backoff calculations. |
| `REAPER_INTERVAL` | `app/reaper.py` | `5` | Sweep interval (seconds) for reclaiming orphaned leases. |

---

## 📄 License

Distributed under the [MIT License](LICENSE).
