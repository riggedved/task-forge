export interface Job {
  id: number;
  type: string;
  payload: Record<string, any>;
  priority: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
  retry_count: number;
  worker_id: string | null;
  lease_until: number | null;
  idempotency_key: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}

export interface JobCreateRequest {
  type: string;
  payload: Record<string, any>;
  priority: number;
  delay_seconds: number;
  idempotency_key?: string | null;
}

export interface Stats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export type WorkerStatus =
  | 'STARTING'
  | 'IDLE'
  | 'PROCESSING'
  | 'STOPPING'
  | 'STOPPED'
  | 'OFFLINE'
  | 'RECOVERING'
  | string;

export interface Worker {
  worker_id: string;
  status: WorkerStatus;
  current_job_id: number | null;
  job_id?: number | null;
  started_at: number | null;
  last_heartbeat: number | null;
  stopped_at?: number | null;
}

export type WorkerItem = Worker;

export interface WorkersResponse {
  workers: Worker[];
}

export interface WorkerStartRequest {
  name?: string | null;
}

export interface WorkerStartResponse {
  worker_id: string;
  status: string;
}

export interface WorkerStopResponse {
  worker_id: string;
  status: string;
  message: string;
}

export interface WorkerEventItem {
  id: number;
  worker_id: string;
  event_type: string;
  message: string;
  created_at: number;
}

export interface WorkerEventsResponse {
  events: WorkerEventItem[];
}

export interface JobEventItem {
  id: number;
  job_id: number;
  event_type: string;
  message: string;
  created_at: number;
}

export interface ActivityResponse {
  events: JobEventItem[];
}

export interface QueueDepth {
  ready: number;
  processing: number;
  delayed: number;
  failed: number;
  total: number;
}

export interface RedisMetrics {
  connected: boolean;
  memory_used: number;
  memory_used_human: string;
  connected_clients: number;
  ready_queue: number;
  processing_queue: number;
  delayed_queue: number;
  failed_queue: number;
}

export interface LogItem {
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | string;
  message: string;
}

export interface JobLogsResponse {
  job_id: number;
  logs: LogItem[];
}

export interface Throughput {
  window_seconds: number;
  completed_jobs: number;
  jobs_per_minute: number;
}

export interface QueueWaitMetrics {
  average_seconds: number;
  min_seconds: number;
  max_seconds: number;
}

export interface Latency {
  window_seconds: number | null;
  sample_size: number;
  average_seconds: number;
  min_seconds: number;
  max_seconds: number;
  queue_wait_seconds: QueueWaitMetrics;
}

export interface Health {
  status: string;
  database: string;
  redis: string;
}

export interface HardResetResponse {
  status: string;
  message: string;
  workers_stopped: number;
  jobs_deleted: number;
  job_events_deleted: number;
  worker_events_deleted: number;
  redis_queues_cleared: string[];
}
