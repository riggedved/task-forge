import {
  Job,
  JobCreateRequest,
  Stats,
  WorkersResponse,
  WorkerStartRequest,
  WorkerStartResponse,
  WorkerStopResponse,
  WorkerEventsResponse,
  ActivityResponse,
  QueueDepth,
  RedisMetrics,
  JobLogsResponse,
  Throughput,
  Latency,
  Health,
  HardResetResponse
} from '../types';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errorMessage = `HTTP Error ${res.status}`;
      let errorData: any = null;
      try {
        errorData = await res.json();
        if (errorData?.detail) {
          errorMessage = typeof errorData.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData.detail);
        }
      } catch {
        errorMessage = await res.text().catch(() => errorMessage);
      }
      throw new ApiError(res.status, errorMessage, errorData);
    }
    return (await res.json()) as T;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, error?.message || 'Unable to connect to backend server. Ensure backend is running.');
  }
}

export const api = {
  getHealth: () => request<Health>('/health'),
  getStats: () => request<Stats>('/stats'),
  getJobs: (params?: { status?: string; type?: string; limit?: number; skip?: number }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') query.append('status', params.status);
    if (params?.type) query.append('type', params.type);
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.skip) query.append('skip', String(params.skip));
    const qs = query.toString();
    return request<Job[]>(`/jobs${qs ? `?${qs}` : ''}`);
  },
  getJob: (jobId: number) => request<Job>(`/jobs/${jobId}`),
  createJob: (data: JobCreateRequest) =>
    request<Job>('/create-job', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  cancelJob: (jobId: number) =>
    request<Job>(`/jobs/${jobId}/cancel`, {
      method: 'POST',
    }),
  forceFailJob: (jobId: number) =>
    request<Job>(`/jobs/${jobId}/force-fail`, {
      method: 'POST',
    }),
  requeueJob: (jobId: number) =>
    request<Job>(`/jobs/${jobId}/requeue`, {
      method: 'POST',
    }),
  getWorkers: (includeStopped = false) =>
    request<WorkersResponse>(`/workers${includeStopped ? '?include_stopped=true' : ''}`),
  startWorker: (data?: WorkerStartRequest) =>
    request<WorkerStartResponse>('/workers', {
      method: 'POST',
      body: data ? JSON.stringify(data) : JSON.stringify({}),
    }),
  stopWorker: (workerId: string) =>
    request<WorkerStopResponse>(`/workers/${encodeURIComponent(workerId)}/stop`, {
      method: 'POST',
    }),
  getWorkerEvents: (workerId?: string, limit = 50) => {
    const query = new URLSearchParams();
    if (workerId) query.append('worker_id', workerId);
    if (limit) query.append('limit', String(limit));
    const qs = query.toString();
    return request<WorkerEventsResponse>(`/worker-events${qs ? `?${qs}` : ''}`);
  },
  getActivity: (limit = 50) => request<ActivityResponse>(`/activity?limit=${limit}`),
  getQueueDepth: () => request<QueueDepth>('/queue-depth'),
  getRedisMetrics: () => request<RedisMetrics>('/redis-metrics'),
  getJobLogs: (jobId: number) => request<JobLogsResponse>(`/jobs/${jobId}/logs`),
  getThroughput: (window = 60) => request<Throughput>(`/throughput?window=${window}`),
  getLatency: (window = 300) => request<Latency>(`/latency?window=${window}`),
  adminHardReset: () =>
    request<HardResetResponse>('/admin/hard-reset', {
      method: 'POST',
    }),
};
