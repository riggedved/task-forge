# Task Forge ⚡ Distributed Job Queue & Developer Playground

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwindcss)](https://tailwindcss.com/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?logo=sqlalchemy)](https://www.sqlalchemy.org/)
[![Uvicorn](https://img.shields.io/badge/Uvicorn-ASGI-2C5BB4)](https://www.uvicorn.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Architecture](https://img.shields.io/badge/Architecture-Distributed%20Systems-blueviolet)]()
[![Guarantees](https://img.shields.io/badge/Guarantees-At--Least--Once-success)]()

A production-grade, fault-tolerant distributed task queue engine and real-time observability playground built in Python with **FastAPI**, **Redis**, **PostgreSQL**, and a modern **Next.js (App Router) + TypeScript** frontend.

Built from first principles around core distributed systems primitives, Task Forge provides **at-least-once delivery guarantees**, **atomic zero-lock claiming via Redis Lua scripts**, **priority-driven inverted scheduling**, **worker crash recovery via time-bounded leases and asynchronous heartbeats**, **strict idempotency deduplication**, **exponential backoff retries with dead-letter queueing (DLQ)**, **real worker process management**, and a **developer playground UI**.

---

## 🛡 System Overview & Guarantees

| Metric / Dimension | Guarantee / Specification | Implementation Details |
| :--- | :--- | :--- |
| **Delivery Semantics** | **At-Least-Once Delivery** | Jobs are preserved in `processing_queue` until terminal ACK is committed. |
| **Claiming Atomicity** | **Zero TOCTOU Contention** | Redis Lua script executes `ZPOPMIN` + `ZADD` atomically within a single Redis cycle. |
| **Scheduling Model** | **Priority Inversion Scoring** | Redis Sorted Sets with inverted priority (`-priority`); higher scores pop first. |
| **Configurable Execution** | **Custom Worker Durations** | Payloads support dynamic execution duration (`duration: N`), natively respected by workers. |
| **Delayed Execution** | **Sub-second precision** | Worker sweeps `delayed_queue` via Lua `ZRANGEBYSCORE` comparing against current epoch. |
| **Fault Recovery** | **Time-Bounded Leases (60s)** | Leases auto-expire if heartbeats halt; standalone & daemon **Reaper** requeues orphaned tasks. |
| **Crash Simulation** | **Immediate Worker Termination** | Stopping a worker terminates the process tree immediately (`taskkill /F` / `SIGKILL`) to test reaper recovery. |
| **Heartbeat Thread** | **Background Async Daemon (20s)** | Dedicated Python thread extends Redis & PostgreSQL lease without blocking task execution. |
| **Retry Strategy** | **Exponential Backoff** | $\text{Delay} = 5\text{s} \times 2^{(\text{retry}-1)}$; up to 3 retries before DLQ routing. |
| **Dead-Letter Queue** | **Quarantine Isolation** | Permanently failing jobs are placed in `failed_queue` and flagged `FAILED` in PostgreSQL. |
| **Ingestion Deduplication** | **Strict Idempotency** | PostgreSQL unique constraint on `idempotency_key` with automatic conflict rollback. |
| **Worker Management** | **Live OS Subprocesses** | Real Python workers spawned on demand from the API/UI with dedicated log file capture. |
| **Observability & UI** | **Next.js Playground** | Live telemetry, visual queue depths, activity streams, job inspector, and admin hard reset. |

---

## ✨ Key Features

### 1. Priority-Based Scheduling & Inverted Scores
- Jobs are enqueued into a Redis Sorted Set (`job_queue`) with an inverted priority score (`-priority`).
- An urgent job with `priority: 25` is indexed with score `-25`, ensuring it is popped ahead of `priority: 10` (`-10`) or `priority: 1` (`-1`) when workers execute `ZPOPMIN`.
- Custom integer priorities ($\ge 1$) can be set freely from the UI or API.

### 2. Atomic Distributed Job Claiming (Lua Scripts)
- Eliminates Time-Of-Check-To-Time-Of-Use (TOCTOU) race conditions among concurrent worker processes.
- An atomic Lua script pops the top-priority job from `job_queue` and inserts it into `processing_queue` with an initial lease timestamp in a single atomic transaction. No two workers can ever claim the same job.

### 3. Distributed Leases & Asynchronous Heartbeats
- Claimed jobs are granted a temporary lease (default: 60 seconds).
- A lightweight background thread (`heartbeat_loop`) periodically pulses every 20 seconds, renewing the `lease_until` timestamp in both Redis and PostgreSQL.
- Long-running jobs run uninterrupted without risk of premature eviction as long as the worker process remains healthy.

### 4. Crash-Resilient Worker Recovery ("The Reaper")
- If a worker process abruptly dies (`kill -9`, termination, segmentation fault, OOM, or via the **Stop Worker** action), its heartbeat thread immediately stops.
- The **Reaper** sweeps `processing_queue` for expired leases (`lease_until < current_time`).
- Expired jobs are safely pulled out of `processing_queue`, have their database status reset to `PENDING`, log a `JOB_RECOVERED` audit event, and are re-inserted into `job_queue` with their original priority score to be processed again.
- An automatic background reaper runs continuously within FastAPI every 5s, in addition to standalone CLI support (`python -m app.reaper`).

### 5. Configurable Job Durations
- Tasks can specify custom execution times via `payload.duration` (e.g. `10s`, `15s`, `30s`, `60s`, or custom positive numbers).
- Workers simulate real processing using `time.sleep(work_duration)` while continuously maintaining active lease renewal.

### 6. Exponential Backoff Retries & Dead-Letter Queue (DLQ)
- Transient execution failures (e.g. job type `fail`) trigger automated exponential backoff:
  - **Attempt 1**: Requeued to `delayed_queue` with 5s delay.
  - **Attempt 2**: Requeued to `delayed_queue` with 10s delay.
  - **Attempt 3**: Requeued to `delayed_queue` with 20s delay.
- When `MAX_RETRIES` (3) is exceeded, the job is flagged as `FAILED` in PostgreSQL and permanently routed to the `failed_queue` (Dead-Letter Queue) for operational inspection.

### 7. Idempotent Submission & Deduplication Engine
- Producers can attach an `idempotency_key` to prevent duplicate task execution caused by network retries or duplicate webhook delivery.
- Deduplication is enforced using PostgreSQL-level `UNIQUE` constraints with atomic rollback. Duplicate submissions return the existing job instance without re-enqueuing.

### 8. Full Worker Lifecycle Management
- Start new worker processes on demand via `POST /workers` or the UI **Start Worker** button.
- Each worker runs as a genuine background Python subprocess, logs to `worker_logs/{worker_id}.log`, registers with PostgreSQL, and emits periodic heartbeats.
- Clicking **Stop Worker** immediately terminates the process tree (`taskkill /F` / `SIGKILL`), allowing you to test crash recovery and observe the Reaper self-healing in real time.

### 9. Development Maintenance & Hard Reset
- A single atomic maintenance control (`POST /admin/hard-reset` or the top-right **Hard Reset** button with modal confirmation) cleans the runtime state:
  - Gracefully terminates all Task Forge-managed worker processes.
  - Purges Redis queues (`job_queue`, `processing_queue`, `delayed_queue`, `failed_queue`, and stop flags).
  - Clears application rows in `jobs`, `job_events`, `workers`, and `worker_events`.
  - Preserves the PostgreSQL schema definitions intact.

### 10. Real-Time Developer Playground Frontend
- A Next.js 16 + React 19 dashboard built using the Stitch design language:
  - **Live Cluster Status**: Health indicators, Redis connection, PostgreSQL connection, and in-flight worker count.
  - **System Summary Bar**: Real-time counters (Total, Pending, Processing, Completed, Failed, DLQ), throughput ($j/m$), average latency, and Redis memory usage.
  - **Vertical Create Job Panel**: Preset buttons and inline custom numeric inputs for Priority, Duration, and Delay, plus a JSON payload editor and idempotency key generator.
  - **Worker Fleet Dashboard**: Live worker cards, statuses (`IDLE`, `PROCESSING`, `STOPPED`, `OFFLINE`), current job links, uptime, and stop controls.
  - **Live Job Inspector & Queue Depth**: Status badges, payload viewer, lease deadline countdown, retry counter, cancel, re-queue, and clone actions.
  - **Real-Time Activity Feed**: Live streaming audit logs of all job and worker events.

---

## 🏛 System Architecture

### Architectural Block Diagram

```text
                                      +------------------------------------+
                                      |     Next.js Playground Frontend    |
                                      |      http://localhost:3000         |
                                      +-----------------+------------------+
                                                        |
                                            HTTP API Requests / Telemetry
                                                        |
                                                        v
                                      +------------------------------------+
                                      |          FastAPI Gateway           |
                                      |       (Idempotency & Router)       |
                                      +--------+------------------+--------+
                                               |                  |
                       +-----------------------+                  +-----------------------+
                       | Write Job & Worker State                                         | Enqueue & Lease Coordination
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
|  +---------------------------------------+  |               |  | delayed_queue (ZSET)      |   | processing_queue   |  |
|  |             workers Table             |  |               |  | score: execute_at (epoch) |   | score: lease_until |  |
|  | - worker_id, status, current_job_id   |  |               |  +---------------------------+   +--------------+-----+  |
|  | - started_at, last_heartbeat          |  |               |                                                 |        |
|  +---------------------------------------+  |               |  +-------------------------------------------+  |        |
|  +---------------------------------------+  |               |  | failed_queue (ZSET / Dead-Letter Queue)   |  |        |
|  |      job_events & worker_events       |  |               |  +---------------------+---------------------+  |        |
|  +---------------------------------------+  |               +------------------------|------------------------+        |
+-------------------------|-------------------+                                        |                                 |
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
|  |  | Worker Node (UUID / PID)              |   | Worker Node (UUID / PID)          |  |
|  |  |                                       |   |                                   |  |
|  |  |  1. Evaluates Due Delayed Tasks (Lua) |   |  1. Evaluates Due Delayed Tasks   |  |
|  |  |  2. Claims Job Atomically (Lua)       |   |  2. Claims Job Atomically         |  |
|  |  |  3. Spawns Async Heartbeat Thread     |   |  3. Spawns Async Heartbeat Thread |  |
|  |  |  4. Executes Task Logic (duration)   |   |  4. Executes Task Logic           |  |
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
|       | Scans expired leases (lease_until < now) every 5s (Standalone + Background Daemon)
|       v
|  +-------------------------------------------------------------------------------------+
|  |                            Reaper Recovery Daemon                                   |
|  |                                                                                     |
|  |  1. Finds expired members in processing_queue via ZRANGEBYSCORE                     |
|  |  2. Atomically ZREM expired entry                                                   |
|  |  3. Resets PostgreSQL status to PENDING, clears worker_id & lease_until             |
|  |  4. Pushes job back to job_queue with original priority score                       |
|  +-------------------------------------------------------------------------------------+
```

---

## 📁 Project Structure

```text
task-forge/
├── app/
│   ├── __init__.py         # Package initialization
│   ├── database.py         # SQLAlchemy engine, session maker, and declarative Base
│   ├── models.py           # SQLAlchemy Job, JobEvent, Worker, WorkerEvent models
│   ├── redis_client.py     # Centralized Redis client connection instance
│   ├── main.py             # FastAPI app, worker management, background reaper, telemetry
│   ├── worker.py           # Distributed worker daemon (atomic Lua, heartbeats, retries)
│   ├── reaper.py           # Standalone crash recovery daemon (sweeps expired leases)
│   ├── events.py           # Audit logging helpers for job and worker events
│   └── schemas.py          # Pydantic v2 schemas for all requests, responses, telemetry
├── frontend/               # Next.js 16 + React 19 + TypeScript + TailwindCSS Playground
│   ├── app/                # App Router (page.tsx, layout.tsx, globals.css)
│   ├── components/         # UI Components:
│   │   ├── Header.tsx           # Cluster health & top-right Hard Reset button
│   │   ├── SystemSummaryBar.tsx # Top counters, throughput, latency, simulate load
│   │   ├── CreateJobPanel.tsx   # Vertical layout with Priority/Duration/Delay selectors
│   │   ├── WorkersSection.tsx   # Worker cards, spawn worker, stop worker (immediate)
│   │   ├── LiveJobDetail.tsx    # Detailed inspection, countdown timer, cancel, re-queue
│   │   ├── RecentJobsTable.tsx  # Interactive jobs table with status filters
│   │   ├── RecentActivityFeed.tsx # Audit log stream with event filtering
│   │   ├── HardResetModal.tsx   # Destructive confirmation modal with progress states
│   │   └── Sidebar.tsx          # Navigation sidebar with quick queue depths
│   ├── lib/                # API client (api.ts) and utility helpers (utils.ts)
│   └── types/              # TypeScript definitions for cluster telemetry & jobs
├── worker_logs/            # Per-worker process stdout/stderr log output
├── test_api_and_system.py  # System integration test suite
├── test_worker_lifecycle.py # Worker lifecycle and crash recovery test suite
├── test_create_job_controls.py # Create Job panel parameters test suite
├── requirements.txt        # Production Python dependencies
└── README.md               # System documentation and operational runbook
```

---

## 🚀 Quick Start Guide

### Prerequisites
1. **Python 3.10+** (Python 3.12 recommended)
2. **Node.js 18+** (for frontend playground)
3. **Supabase PostgreSQL** project (or local PostgreSQL)
4. **Redis** running on port `6379` (or cloud Redis)

---

### Backend Setup

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

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables (`.env`)**:
   Copy `.env.example` to `.env` (or update `.env`) and add your Supabase connection string:
   ```env
   # .env
   DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   SUPABASE_URL=https://[PROJECT_REF].supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

5. **Start the FastAPI Backend**:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   - API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
   - Health Check: [http://localhost:8000/health](http://localhost:8000/health)

---

### Frontend Setup

Open a second terminal window:

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Start the Next.js Dev Server**:
   ```bash
   npm run dev
   ```

4. **Access the Playground UI**:
   Open your browser to:
   ```text
   http://localhost:3000
   ```

---

## 🖥️ Using the Task Forge Frontend (Playground)

The Task Forge frontend is a real-time command center designed to test, visualize, and demonstrate every distributed systems primitive.

### 1. Top Navigation & Cluster Health
- **SYSTEM ONLINE Indicator**: Located at top-right, pulsing green when FastAPI, PostgreSQL, and Redis are connected.
- **Cluster Telemetry**: Displays real-time connection status for Redis, PostgreSQL, and count of in-flight active workers.
- **Hard Reset Action**: Located right next to the SYSTEM ONLINE indicator. Opens a confirmation modal that terminates all managed workers, flushes all Redis queues, and cleans DB records without dropping schemas.

### 2. Operational Metrics & Summary Bar
- **Counter Badges**: Real-time count of total jobs, pending, processing, completed, and failed tasks.
- **Throughput & Latency**: Measures rolling jobs-per-minute ($j/m$) and average end-to-end execution time.
- **Redis Memory Usage**: Displays live memory consumed by queue structures.
- **Refresh Action**: Forces an immediate telemetry sync across all components.
- **Simulate Load (+5)**: Submits a batch of 5 diverse jobs (`email`, `image`, `export`, `notify`, `fail`) at varying priorities to populate the queue instantly.

### 3. Creating Jobs with Configurable Controls
The **Create Job** panel is vertically organized for maximum clarity:

```text
JOB TYPE
[ email ] [ image ] [ export ] [ notify ] [ fail ]

PRIORITY
[ 1 ] [ 5 ] [ 10 ] [ Custom ]   ──> When Custom is clicked: [ Custom: 25 ]
Higher priority pops ahead via Redis ZSET (-priority score).

DURATION (SECONDS)
[ 10 ] [ 30 ] [ 60 ] [ Custom ] ──> When Custom is clicked: [ Custom: 15 ]

DELAY (SECONDS)
[ 0 ] [ 5 ] [ 30 ] [ 60 ] [ Custom ] ──> When Custom is clicked: [ Custom: 120 ]
Delayed tasks stage into delayed_queue ZSET first.
```

- **Job Type**: Preset payload templates with realistic parameters.
- **Priority**: Choose `1` (Background), `5` (Standard), `10` (Urgent), or enter any custom integer (e.g. `25`).
- **Duration (Seconds)**: Configure the simulated processing time. The worker will process the job for this exact duration.
- **Delay (Seconds)**: Choose `0` for immediate processing or a delay (`5s`, `30s`, `60s`, or custom `120s`).
- **Payload Editor**: Formattable JSON editor with line numbers; automatically synchronizes with the duration selector.
- **Idempotency Key**: Pre-populated unique key (with regenerate button) to test deduplication.
- **Submit**: Click **CREATE JOB** or press `Cmd/Ctrl + Enter`.

### 4. Worker Management & Crash Simulation
Located in the **Workers** section:
- **`+ Start Worker`**: Spawns an actual independent Python subprocess running `app.worker`. The worker self-registers as `IDLE` within seconds.
- **Worker Cards**: Displays Worker ID, PID, current state (`IDLE`, `PROCESSING`, `STOPPED`, `OFFLINE`), active job ID link, started timestamp, and heartbeat age.
- **Stop Worker (Crash Simulation)**:
  - Clicking **Stop Worker** (with confirmation) **immediately kills the worker process** (`taskkill /F` / `SIGKILL`).
  - Its heartbeat stops immediately.
  - The job in-flight remains in `PROCESSING` status in the DB and Redis `processing_queue`.
  - Once the 60-second lease expires, the **Reaper** automatically recovers the task, resets it to `PENDING`, and re-adds it to the ready queue!
  - Start a new worker or leave another worker running to watch it pick up and complete the orphaned task!
- **Show Stopped Workers**: Toggle switch to inspect historical or terminated workers.

### 5. Live Job Inspector & Queue Depth
- **Interactive Table**: Filter jobs by status (`ALL`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `DLQ`) or search by Job ID.
- **Job Detail Pane**: Click any job row to view:
  - Full formatted JSON payload.
  - Lifecycle timeline (`Created At`, `Started At`, `Completed At`, `Execution Latency`).
  - Worker assignment UUID.
  - Live lease expiration countdown for in-flight tasks.
  - Actions: **Cancel Job**, **Re-queue to Ready Queue**, or **Clone Settings** into the Create Job panel.
- **Visual Queue Depth**: Progress bars tracking ready, processing, delayed, and dead-letter queue volumes.

### 6. Real-Time Activity Feed
- Streams all cluster events in reverse chronological order:
  - `JOB_CREATED`: Initial task enqueuing.
  - `JOB_PROCESSING`: Atomic claiming by a worker.
  - `JOB_COMPLETED`: Successful task ACK.
  - `JOB_FAILED`: Exception raised, retry scheduled.
  - `JOB_RECOVERED`: Reaper reclaimed an expired lease.
  - `WORKER_STARTED` / `WORKER_STOPPED` / `WORKER_OFFLINE`: Fleet lifecycle events.

---

## 🔌 API Reference

### Endpoints Summary

| Method | Endpoint | Description | Idempotent |
| :--- | :--- | :--- | :---: |
| `GET` | `/health` | Health check verifying PostgreSQL and Redis connections | Yes |
| `POST` | `/create-job` | Submits a new job (supports priority, delay, payload duration, idempotency) | Yes (with key) |
| `GET` | `/jobs` | Lists jobs ordered by ID descending with status/type filtering | Yes |
| `GET` | `/jobs/{job_id}` | Retrieves full job details, worker UUID, lease deadline, retry counter | Yes |
| `POST` | `/jobs/{job_id}/cancel` | Cancels a pending job and evicts it from Redis queues | Yes |
| `POST` | `/jobs/{job_id}/requeue` | Re-queues a failed, cancelled, or completed job back into `job_queue` | No |
| `POST` | `/workers` | Spawns a new real Python worker subprocess | No |
| `POST` | `/workers/{worker_id}/stop` | Terminates worker process immediately (crash simulation for reaper) | Yes |
| `GET` | `/workers` | Lists all active/registered workers with live status and job mapping | Yes |
| `GET` | `/worker-events` | Lists historical worker lifecycle events (start, stop, offline) | Yes |
| `GET` | `/activity` | Retrieves the global cluster job audit stream | Yes |
| `GET` | `/telemetry/redis` | Returns Redis queue sizes and memory consumption metrics | Yes |
| `GET` | `/telemetry/throughput` | Calculates rolling jobs-per-minute throughput | Yes |
| `GET` | `/telemetry/latency` | Returns average execution latency and queue wait time | Yes |
| `POST` | `/admin/hard-reset` | Wipes runtime state: stops workers, flushes Redis queues, purges DB tables | Yes |

---

### Example API Requests

#### 1. Create a Custom Job
```bash
curl -X POST http://localhost:8000/create-job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "data_export",
    "payload": {
      "format": "parquet",
      "destination": "s3://exports/cluster_data.parquet",
      "duration": 15
    },
    "priority": 25,
    "delay_seconds": 10,
    "idempotency_key": "export-batch-901"
  }'
```

#### 2. Start a Managed Worker
```bash
curl -X POST http://localhost:8000/workers \
  -H "Content-Type: application/json" \
  -d '{"name": "worker-alpha"}'
```

#### 3. Stop a Worker Immediately (Crash Simulation)
```bash
curl -X POST http://localhost:8000/workers/worker-alpha/stop
```

#### 4. Cluster Hard Reset
```bash
curl -X POST http://localhost:8000/admin/hard-reset
```

---

## 🧪 Automated Test Suites

Task Forge includes end-to-end Python test suites verifying every component:

```bash
# 1. Full worker lifecycle & reaper crash recovery tests
python test_worker_lifecycle.py

# 2. Create Job controls (Priority, Duration, Delay, Combined)
python test_create_job_controls.py

# 3. Core distributed queue & system tests
python test_api_and_system.py

# 4. Frontend TypeScript validation
cd frontend && npx tsc --noEmit
```

---

## ⚙️ Configuration Reference

| Parameter | Location | Default Value | Description |
| :--- | :--- | :---: | :--- |
| `DATABASE_URL` | `.env` / `app/database.py` | `postgresql://...` | Connection URI for Supabase PostgreSQL (direct or pooler). |
| `SUPABASE_URL` | `.env` / `app/supabase_client.py` | `https://[ID].supabase.co` | Supabase project API endpoint URL. |
| `SUPABASE_ANON_KEY` | `.env` / `app/supabase_client.py` | `eyJ...` | Supabase anonymous / public API key. |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` / `app/supabase_client.py` | `eyJ...` | Supabase service-role secret key (elevated permissions). |
| `DB_SSL_MODE` | `.env` / `app/database.py` | `require` | SSL mode for PostgreSQL database connection. |
| `REDIS_HOST` | `.env` / `app/redis_client.py` | `localhost` | Hostname for the Redis server. |
| `REDIS_PORT` | `.env` / `app/redis_client.py` | `6379` | Port for the Redis server. |
| `REDIS_URL` | `.env` / `app/redis_client.py` | None | Full connection URI for Redis (e.g. Upstash). |
| `LEASE_DURATION` | `app/worker.py` | `60` | Lease duration in seconds before an in-flight task is considered orphaned. |
| `HEARTBEAT_INTERVAL` | `app/worker.py` | `20` | Interval in seconds between heartbeat lease renewals by an active worker. |
| `WORKER_HEARTBEAT_TIMEOUT` | `app/main.py` | `30.0` | Timeout in seconds after which a silent worker is flagged `OFFLINE`. |
| `MAX_RETRIES` | `app/worker.py` | `3` | Maximum retry attempts permitted before dead-letter quarantine. |
| `RETRY_BACKOFF_BASE` | `app/worker.py` | `5` | Base time multiplier in seconds for exponential backoff ($5 \times 2^{\text{attempt}}$). |
| `REAPER_INTERVAL` | `app/reaper.py` | `5` | Sweep frequency in seconds for reclaiming orphaned leases. |

---

## 👤 Author & License

**Ved Saxena**  
- GitHub: [@riggedved](https://github.com/riggedved)
- Repository: [https://github.com/riggedved/task-forge](https://github.com/riggedved/task-forge)

Distributed under the [MIT License](LICENSE).
