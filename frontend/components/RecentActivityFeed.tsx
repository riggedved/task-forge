'use client';

import React from 'react';
import { JobEventItem, WorkerEventItem } from '../types';
import { formatTimestamp, formatTimeAgo } from '../lib/utils';

interface RecentActivityFeedProps {
  events: JobEventItem[];
  workerEvents?: WorkerEventItem[];
  onSelectJobId?: (jobId: number) => void;
  onSelectWorkerId?: (workerId: string) => void;
}

interface UnifiedActivityItem {
  key: string;
  source: 'job' | 'worker';
  job_id?: number | null;
  worker_id?: string | null;
  event_type: string;
  message: string;
  created_at: number;
}

export const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({
  events,
  workerEvents = [],
  onSelectJobId,
  onSelectWorkerId,
}) => {
  const getEventDotColor = (type: string, source: 'job' | 'worker') => {
    if (source === 'worker') {
      switch (type) {
        case 'WORKER_STARTED':
          return 'text-tertiary';
        case 'WORKER_STOPPING':
          return 'text-secondary';
        case 'WORKER_STOPPED':
          return 'text-outline';
        case 'WORKER_OFFLINE':
          return 'text-error';
        default:
          return 'text-tertiary';
      }
    }

    switch (type) {
      case 'JOB_CREATED':
      case 'JOB_REQUEUED':
        return 'text-primary';
      case 'JOB_PROCESSING':
      case 'JOB_RECOVERED':
        return 'text-tertiary';
      case 'JOB_COMPLETED':
        return 'text-primary';
      case 'JOB_FAILED':
      case 'JOB_FORCE_FAILED':
        return 'text-error';
      case 'JOB_RETRY_SCHEDULED':
      case 'JOB_CANCELLED':
        return 'text-secondary';
      default:
        return 'text-on-surface-variant';
    }
  };

  const combinedEvents: UnifiedActivityItem[] = [
    ...events.map((e) => ({
      key: `job-${e.id}`,
      source: 'job' as const,
      job_id: e.job_id,
      event_type: e.event_type,
      message: e.message,
      created_at: e.created_at,
    })),
    ...workerEvents.map((w) => ({
      key: `worker-${w.id}`,
      source: 'worker' as const,
      worker_id: w.worker_id,
      event_type: w.event_type,
      message: w.message,
      created_at: w.created_at,
    })),
  ].sort((a, b) => b.created_at - a.created_at);

  const handleClickItem = (item: UnifiedActivityItem) => {
    if (item.source === 'job' && item.job_id && onSelectJobId) {
      onSelectJobId(item.job_id);
    } else if (item.source === 'worker') {
      if (item.worker_id && onSelectWorkerId) {
        onSelectWorkerId(item.worker_id);
      }
      const el = document.getElementById('workers');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div
      id="activity"
      className="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-md border border-surface-container-high/30 scroll-mt-20"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-primary text-[20px]">rss_feed</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight uppercase">
            Recent Activity
          </h2>
        </div>
        <span className="font-mono-sm text-mono-sm text-on-surface-variant flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
          <span>Live Tail ({combinedEvents.length})</span>
        </span>
      </div>

      <div
        className="flex flex-col gap-space-xs font-mono-sm text-mono-sm text-[12px] max-h-[320px] overflow-y-auto"
        id="activity-stream"
      >
        {combinedEvents.length === 0 ? (
          <div className="text-on-surface-variant/60 text-center py-12">
            No activity recorded yet. Create a job or start a worker to observe lifecycle events.
          </div>
        ) : (
          combinedEvents.map((evt) => (
            <div
              key={evt.key}
              onClick={() => handleClickItem(evt)}
              className="p-space-xs rounded hover:bg-surface-container transition-colors flex items-start gap-space-xs cursor-pointer group"
            >
              <span className="text-on-surface-variant opacity-60 shrink-0">
                [{formatTimestamp(evt.created_at)}]
              </span>
              <span className={getEventDotColor(evt.event_type, evt.source)}>●</span>
              <span className="text-on-surface group-hover:text-primary transition-colors">
                {evt.message}{' '}
                <span className="text-on-surface-variant opacity-70">
                  ({formatTimeAgo(evt.created_at)})
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
