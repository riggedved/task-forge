'use client';

import React from 'react';
import { Job, QueueDepth } from '../types';
import { formatTimeAgo, formatDuration } from '../lib/utils';
import { api } from '../lib/api';

interface QueueStateSectionProps {
  queueDepth: QueueDepth | null;
  jobs: Job[];
  onSelectJob: (job: Job) => void;
  onJobRequeued: (job: Job) => void;
}

export const QueueStateSection: React.FC<QueueStateSectionProps> = ({
  queueDepth,
  jobs,
  onSelectJob,
  onJobRequeued,
}) => {
  const readyJobs = jobs.filter((j) => j.status === 'PENDING').slice(0, 5);
  const processingJobs = jobs.filter((j) => j.status === 'PROCESSING').slice(0, 5);
  const delayedJobs = jobs.filter((j) => j.status === 'PENDING' && j.lease_until === null).slice(0, 5);
  const failedJobs = jobs.filter((j) => j.status === 'FAILED').slice(0, 5);

  const handleRequeue = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    try {
      const requeued = await api.requeueJob(jobId);
      onJobRequeued(requeued);
    } catch (err: any) {
      alert(`Failed to requeue: ${err.message}`);
    }
  };

  return (
    <section id="job-queues" className="w-full flex flex-col gap-space-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-secondary text-[20px]">account_tree</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight uppercase">
            Queue State
          </h2>
          <span className="font-mono-sm text-mono-sm text-on-surface-variant ml-space-xs hidden sm:inline">
            Redis List &amp; Sorted Set Depths
          </span>
        </div>
        <div className="flex items-center gap-space-sm font-mono-sm text-mono-sm text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary"></span> Ready (ZSET)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-tertiary"></span> In-Flight
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-secondary"></span> Delayed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-error"></span> DLQ
          </span>
        </div>
      </div>

      {/* 4 Columns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
        {/* Card 1: Ready Queue */}
        <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="w-2 h-2 rounded-full bg-primary"></span>
              <span className="font-label-caps text-label-caps uppercase text-on-surface font-bold tracking-wider">
                Ready Queue
              </span>
            </div>
            <span className="font-mono-sm text-mono-sm px-space-xs py-0.5 rounded bg-surface-container text-primary font-semibold">
              {queueDepth?.ready ?? 0} jobs
            </span>
          </div>

          <div className="flex flex-col gap-space-xs min-h-[140px]">
            {readyJobs.length === 0 ? (
              <div className="text-on-surface-variant/60 font-mono-sm text-center py-8">
                Queue is empty
              </div>
            ) : (
              readyJobs.map((j) => (
                <div
                  key={j.id}
                  onClick={() => onSelectJob(j)}
                  className="p-space-xs rounded bg-surface-container hover:bg-surface-container-high transition-colors flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="font-mono-sm text-mono-sm text-primary font-semibold">#{j.id}</span>
                    <span className="font-mono-sm text-mono-sm text-on-surface truncate">{j.type}</span>
                  </div>
                  <div className="flex items-center gap-space-xs">
                    <span className="font-mono-sm text-mono-sm text-on-surface-variant">P{j.priority}</span>
                    <span className="font-mono-sm text-mono-sm px-1 rounded bg-surface-container-highest text-on-surface-variant text-[10px]">
                      {formatTimeAgo(j.created_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Card 2: Processing Queue */}
        <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
              </span>
              <span className="font-label-caps text-label-caps uppercase text-tertiary font-bold tracking-wider">
                Processing
              </span>
            </div>
            <span className="font-mono-sm text-mono-sm px-space-xs py-0.5 rounded bg-surface-container text-tertiary font-semibold">
              {queueDepth?.processing ?? 0} jobs
            </span>
          </div>

          <div className="flex flex-col gap-space-xs min-h-[140px]">
            {processingJobs.length === 0 ? (
              <div className="text-on-surface-variant/60 font-mono-sm text-center py-8">
                No active jobs
              </div>
            ) : (
              processingJobs.map((j) => {
                const duration = j.started_at ? formatDuration(Date.now() / 1000 - j.started_at) : 'running';
                return (
                  <div
                    key={j.id}
                    onClick={() => onSelectJob(j)}
                    className="p-space-xs rounded bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col gap-1 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-space-xs">
                        <span className="font-mono-sm text-mono-sm text-tertiary font-bold">#{j.id}</span>
                        <span className="font-mono-sm text-mono-sm text-on-surface">{j.type}</span>
                      </div>
                      <span className="font-mono-sm text-mono-sm text-tertiary text-[10px]">{duration}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono-sm text-on-surface-variant">
                      <span className="truncate max-w-[140px]">➔ {j.worker_id || 'worker'}</span>
                      <span className="text-tertiary">P{j.priority}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Card 3: Delayed (ZSET) */}
        <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-secondary text-[16px]">schedule</span>
              <span className="font-label-caps text-label-caps uppercase text-secondary font-bold tracking-wider">
                Delayed (ZSET)
              </span>
            </div>
            <span className="font-mono-sm text-mono-sm px-space-xs py-0.5 rounded bg-surface-container text-secondary font-semibold">
              {queueDepth?.delayed ?? 0} jobs
            </span>
          </div>

          <div className="flex flex-col gap-space-xs min-h-[140px]">
            {queueDepth?.delayed === 0 ? (
              <div className="text-on-surface-variant/60 font-mono-sm text-center py-8">
                No delayed tasks
              </div>
            ) : (
              <div className="p-space-xs rounded bg-surface-container flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono-sm text-mono-sm text-secondary font-semibold">Delayed Tasks</span>
                  <span className="font-mono-sm text-mono-sm px-1 rounded bg-secondary/10 text-secondary text-[10px] font-semibold">
                    {queueDepth?.delayed} scheduled
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono-sm text-on-surface-variant">
                  <span>Sweep: move_delayed_jobs()</span>
                  <span className="text-secondary font-semibold">ZRANGEBYSCORE</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card 4: FAILED / DLQ */}
        <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-error text-[16px]">error</span>
              <span className="font-label-caps text-label-caps uppercase text-error font-bold tracking-wider">
                DLQ / Dead Letter
              </span>
            </div>
            <span className="font-mono-sm text-mono-sm px-space-xs py-0.5 rounded bg-error-container text-error font-semibold">
              {queueDepth?.failed ?? 0} jobs
            </span>
          </div>

          <div className="flex flex-col gap-space-xs min-h-[140px]">
            {failedJobs.length === 0 ? (
              <div className="text-on-surface-variant/60 font-mono-sm text-center py-8">
                DLQ is clean
              </div>
            ) : (
              failedJobs.map((j) => (
                <div
                  key={j.id}
                  onClick={() => onSelectJob(j)}
                  className="p-space-xs rounded bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col gap-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-xs">
                      <span className="font-mono-sm text-mono-sm text-error font-semibold">#{j.id}</span>
                      <span className="font-mono-sm text-mono-sm text-on-surface">{j.type}</span>
                    </div>
                    <span className="font-mono-sm text-mono-sm text-error text-[10px]">
                      {j.retry_count}/3 retries
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
                      {formatTimeAgo(j.completed_at)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleRequeue(e, j.id)}
                      className="px-space-xs py-0.5 rounded bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface font-mono-sm text-mono-sm text-[10px] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[12px]">replay</span>
                      <span>Re-queue</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
