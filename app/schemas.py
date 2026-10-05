from pydantic import BaseModel, ConfigDict
from typing import Any


class JobCreateRequest(BaseModel):
    type: str
    payload: dict[str, Any] = {}
    priority: int = 1
    delay_seconds: int = 0
    idempotency_key: str | None = None


class BatchJobCreateRequest(BaseModel):
    jobs: list[JobCreateRequest]


class JobCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    payload: dict[str, Any]
    priority: int
    status: str
    idempotency_key: str | None = None


class JobDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    payload: dict[str, Any]
    priority: int
    status: str
    retry_count: int
    worker_id: str | None = None
    lease_until: float | None = None
    idempotency_key: str | None = None
    created_at: float | None = None
    started_at: float | None = None
    completed_at: float | None = None


class StatsResponse(BaseModel):
    total: int
    pending: int
    processing: int
    completed: int
    failed: int


class WorkerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    worker_id: str
    status: str
    current_job_id: int | None = None
    job_id: int | None = None
    started_at: float | None = None
    last_heartbeat: float | None = None
    stopped_at: float | None = None


# Alias for backward compatibility
WorkerItem = WorkerResponse


class WorkersResponse(BaseModel):
    workers: list[WorkerResponse]


class WorkerStartRequest(BaseModel):
    name: str | None = None


class WorkerStartResponse(BaseModel):
    worker_id: str
    status: str


class WorkerStopResponse(BaseModel):
    worker_id: str
    status: str
    message: str


class WorkerEventItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    worker_id: str
    event_type: str
    message: str
    created_at: float


class WorkerEventsResponse(BaseModel):
    events: list[WorkerEventItem]


class JobEventItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    event_type: str
    message: str
    created_at: float


class ActivityResponse(BaseModel):
    events: list[JobEventItem]


class QueueDepthResponse(BaseModel):
    ready: int
    processing: int
    delayed: int
    failed: int
    total: int


class RedisMetricsResponse(BaseModel):
    connected: bool
    memory_used: int
    memory_used_human: str
    connected_clients: int
    ready_queue: int
    processing_queue: int
    delayed_queue: int
    failed_queue: int


class LogItem(BaseModel):
    timestamp: float
    level: str
    message: str


class JobLogsResponse(BaseModel):
    job_id: int
    logs: list[LogItem]


class ThroughputResponse(BaseModel):
    window_seconds: int
    completed_jobs: int
    jobs_per_minute: float


class QueueWaitMetrics(BaseModel):
    average_seconds: float
    min_seconds: float
    max_seconds: float


class LatencyResponse(BaseModel):
    window_seconds: int | None = None
    sample_size: int
    average_seconds: float
    min_seconds: float
    max_seconds: float
    queue_wait_seconds: QueueWaitMetrics


class HealthResponse(BaseModel):
    status: str
    database: str
    redis: str


class HardResetResponse(BaseModel):
    status: str
    message: str
    workers_stopped: int
    jobs_deleted: int
    job_events_deleted: int
    worker_events_deleted: int
    redis_queues_cleared: list[str]

