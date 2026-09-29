'use client';

import React, { useState, useEffect } from 'react';
import { Job, LogItem } from '../types';
import { formatTimestamp, formatTimeAgo, formatDuration } from '../lib/utils';
import { api, ApiError } from '../lib/api';

interface LiveJobPanelProps {
  job: Job | null;
  onJobUpdated: (updatedJob: Job) => void;
  onInspectPayload: (job: Job) => void;
  onCloneJob: (job: Job) => void;
}

export const LiveJobPanel: React.FC<LiveJobPanelProps> = ({
  job,
  onJobUpdated,
  onInspectPayload,
  onCloneJob,
}) => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // Poll logs and job state while active
  useEffect(() => {
    if (!job?.id) {
      setLogs([]);
      return;
    }

    let isMounted = true;

    const fetchLogs = async () => {
      try {
        const res = await api.getJobLogs(job.id);
        if (isMounted) {
          setLogs(res.logs || []);
        }
      } catch {
        // Silently handle if job not yet refreshed
      }
    };

    fetchLogs();

    // Poll every 1.5 seconds if job is in-flight (PENDING or PROCESSING)
    const isTerminal = job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED';
    if (!isTerminal) {
      const interval = setInterval(async () => {
        fetchLogs();
        try {
          const freshJob = await api.getJob(job.id);
          if (isMounted) {
            onJobUpdated(freshJob);
          }
        } catch {
          // ignore
        }
      }, 1500);

      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }

    return () => {
      isMounted = false;
    };
  }, [job?.id, job?.status]);

  if (!job) {
    return (
      <div id="live-job" className="bg-surface-container-low rounded-xl p-space-lg flex flex-col items-center justify-center min-h-[380px] shadow-md border border-surface-container-high/30 text-center">
        <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-space-sm">
          terminal
        </span>
        <h3 className="font-headline-sm text-headline-sm text-on-surface">No Job Selected</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm mt-1">
          Create a new job from the panel on the left, or select an existing job from the Queue or Recent Jobs table.
        </p>
      </div>
    );
  }

  // Calculate lifecycle step progress
  const isCreated = true;
  const isQueued = job.status === 'PENDING' || job.status === 'PROCESSING' || job.status === 'COMPLETED' || job.status === 'FAILED';
  const isProcessing = job.status === 'PROCESSING' || job.status === 'COMPLETED';
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isCancelled = job.status === 'CANCELLED';

  let progressPercent = '25%';
  if (isCompleted || isFailed || isCancelled) {
    progressPercent = '100%';
  } else if (job.status === 'PROCESSING') {
    progressPercent = '75%';
  } else if (job.status === 'PENDING') {
    progressPercent = '50%';
  }

  // Duration in flight or execution time
  let durationText = '—';
  if (job.started_at && job.completed_at) {
    durationText = formatDuration(job.completed_at - job.started_at);
  } else if (job.started_at) {
    const elapsed = Date.now() / 1000 - job.started_at;
    durationText = `${formatDuration(elapsed)} in flight`;
  }

  // Lease remaining
  let leaseText = '—';
  if (job.lease_until && job.status === 'PROCESSING') {
    const remaining = Math.max(0, Math.round(job.lease_until - Date.now() / 1000));
    leaseText = `${remaining}s remaining`;
  }

  const handleCancel = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsProcessingAction(true);
    try {
      const updated = await api.cancelJob(job.id);
      setActionSuccess(`Job #${job.id} cancelled successfully.`);
      onJobUpdated(updated);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setActionError('Cannot cancel running job: worker architecture executes in-flight jobs non-preemptively. Use "Force Fail" if you need to evict.');
      } else {
        setActionError(err.message || 'Failed to cancel job.');
      }
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleForceFail = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to FORCE FAIL Job #${job.id}? This will remove it from all active processing queues and route it to the Dead-Letter Queue.`
    );
    if (!confirmed) return;

    setActionError(null);
    setActionSuccess(null);
    setIsProcessingAction(true);
    try {
      const updated = await api.forceFailJob(job.id);
      setActionSuccess(`Job #${job.id} moved to FAILED (DLQ).`);
      onJobUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to force-fail job.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleRequeue = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsProcessingAction(true);
    try {
      const updated = await api.requeueJob(job.id);
      setActionSuccess(`Job #${job.id} requeued to READY queue.`);
      onJobUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to requeue job.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div id="live-job" className="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-md relative overflow-hidden border border-surface-container-high/30">
      {/* Top edge glow highlight */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-tertiary to-transparent opacity-60"></div>

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm">
          <span className="px-space-xs py-0.5 rounded bg-surface-container text-tertiary font-mono-sm text-mono-sm uppercase font-semibold">
            Live Job
          </span>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-mono-lg">
            #{job.id} {job.type}
          </h3>
          <span className="px-space-xs py-0.5 rounded bg-surface-container font-mono-sm text-mono-sm text-tertiary font-medium">
            P{job.priority} {job.priority >= 10 ? '(Urgent)' : job.priority >= 5 ? '(Standard)' : '(Background)'}
          </span>
        </div>

        {/* Status Badge */}
        <div
          className={`flex items-center gap-space-xs px-space-sm py-1 rounded font-mono-sm text-mono-sm uppercase font-semibold tracking-wider ${
            job.status === 'PROCESSING'
              ? 'bg-tertiary/10 text-tertiary shadow-[0_0_12px_rgba(76,215,246,0.2)]'
              : job.status === 'COMPLETED'
              ? 'bg-primary/10 text-primary'
              : job.status === 'FAILED'
              ? 'bg-error-container text-error'
              : job.status === 'CANCELLED'
              ? 'bg-surface-container text-on-surface-variant'
              : 'bg-secondary/10 text-secondary'
          }`}
        >
          {job.status === 'PROCESSING' && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
            </span>
          )}
          {job.status === 'PENDING' && <span className="w-2 h-2 rounded-full bg-secondary"></span>}
          {job.status === 'COMPLETED' && <span className="w-2 h-2 rounded-full bg-primary"></span>}
          {job.status === 'FAILED' && <span className="w-2 h-2 rounded-full bg-error"></span>}
          {job.status === 'CANCELLED' && <span className="w-2 h-2 rounded-full bg-outline"></span>}
          <span>{job.status}</span>
        </div>
      </div>

      {actionError && (
        <div className="p-space-sm rounded bg-error-container text-on-error-container text-body-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-on-error-container font-mono-sm">✕</button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-space-sm rounded bg-primary-container text-on-primary-container text-body-sm flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-on-primary-container font-mono-sm">✕</button>
        </div>
      )}

      {/* Horizontal Lifecycle Visualization */}
      <div className="bg-surface-container rounded p-space-md flex flex-col gap-space-sm border border-surface-container-high/40">
        <div className="flex items-center justify-between text-on-surface-variant font-label-caps text-label-caps uppercase">
          <span>Execution Flow</span>
          <span className="font-mono-sm text-mono-sm text-tertiary">
            {durationText !== '—' ? durationText : `Created ${formatTimeAgo(job.created_at)}`}
          </span>
        </div>

        {/* Progress Steps */}
        <div className="grid grid-cols-4 gap-space-xs items-center relative">
          {/* Step 1: Created */}
          <div className="flex flex-col items-center gap-1 text-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono-sm text-mono-sm ${
              isCreated ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant opacity-40'
            }`}>
              <span className="material-symbols-outlined text-[16px]">check</span>
            </div>
            <span className="font-mono-sm text-mono-sm text-primary font-medium">CREATED</span>
            <span className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
              {formatTimestamp(job.created_at)}
            </span>
          </div>

          {/* Step 2: Queued */}
          <div className="flex flex-col items-center gap-1 text-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono-sm text-mono-sm ${
              isQueued ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant opacity-40'
            }`}>
              <span className="material-symbols-outlined text-[16px]">
                {job.status === 'PENDING' ? 'schedule' : 'check'}
              </span>
            </div>
            <span className="font-mono-sm text-mono-sm text-primary font-medium">QUEUED</span>
            <span className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
              {job.status === 'PENDING' ? 'job_queue' : 'ready_queue'}
            </span>
          </div>

          {/* Step 3: Processing */}
          <div className="flex flex-col items-center gap-1 text-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono-sm text-mono-sm ${
              job.status === 'PROCESSING'
                ? 'bg-tertiary text-on-tertiary shadow-[0_0_10px_rgba(76,215,246,0.6)] animate-pulse'
                : isProcessing
                ? 'bg-primary/20 text-primary'
                : 'bg-surface-container-highest text-on-surface-variant opacity-40'
            }`}>
              <span className={`material-symbols-outlined text-[16px] ${job.status === 'PROCESSING' ? 'animate-spin' : ''}`}>
                sync
              </span>
            </div>
            <span className={`font-mono-sm text-mono-sm font-bold ${job.status === 'PROCESSING' ? 'text-tertiary' : 'text-on-surface'}`}>
              PROCESSING
            </span>
            <span className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px] truncate max-w-[80px]">
              {job.worker_id ? job.worker_id.slice(0, 8) : '—'}
            </span>
          </div>

          {/* Step 4: Terminal */}
          <div className={`flex flex-col items-center gap-1 text-center ${isCompleted || isFailed || isCancelled ? 'opacity-100' : 'opacity-40'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono-sm text-mono-sm ${
              isCompleted
                ? 'bg-primary text-on-primary'
                : isFailed
                ? 'bg-error text-on-error'
                : isCancelled
                ? 'bg-outline text-on-surface'
                : 'bg-surface-container-highest text-on-surface-variant'
            }`}>
              <span className="material-symbols-outlined text-[16px]">
                {isCompleted ? 'flag' : isFailed ? 'error' : isCancelled ? 'cancel' : 'flag'}
              </span>
            </div>
            <span className={`font-mono-sm text-mono-sm font-medium ${
              isCompleted ? 'text-primary' : isFailed ? 'text-error' : isCancelled ? 'text-outline' : 'text-on-surface-variant'
            }`}>
              {isCompleted ? 'COMPLETED' : isFailed ? 'FAILED' : isCancelled ? 'CANCELLED' : 'TERMINAL'}
            </span>
            <span className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
              {job.completed_at ? formatTimestamp(job.completed_at) : 'Pending'}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full transition-all duration-500 ${
              isFailed ? 'bg-error' : isCancelled ? 'bg-outline' : 'bg-gradient-to-r from-primary to-tertiary'
            }`}
            style={{ width: progressPercent }}
          ></div>
        </div>

        {/* Operational Guarantees Indicator */}
        <div className="flex items-center justify-between font-mono-sm text-mono-sm text-[11px] text-on-surface-variant pt-1 border-t border-surface-container-high/30">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
            <span>Retries Allowed: {job.retry_count} / 3</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
            <span>DLQ Route: failed_queue</span>
          </span>
        </div>
      </div>

      {/* Live Execution Metadata Table */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-xs bg-surface-container rounded p-space-sm font-mono-sm text-mono-sm border border-surface-container-high/40">
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Worker Node</span>
          <span className="text-tertiary font-semibold truncate mt-0.5" title={job.worker_id || 'None'}>
            {job.worker_id ? job.worker_id.slice(0, 12) + '...' : '—'}
          </span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Retries</span>
          <span className="text-on-surface font-semibold mt-0.5">
            {job.retry_count} / 3 (exp-backoff)
          </span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Created Time</span>
          <span className="text-on-surface mt-0.5">
            {formatTimestamp(job.created_at)}
          </span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Lease Lock</span>
          <span className="text-primary font-semibold mt-0.5">{leaseText}</span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Execution Time</span>
          <span className="text-on-surface mt-0.5">{durationText}</span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Started At</span>
          <span className="text-on-surface font-semibold mt-0.5">
            {formatTimestamp(job.started_at)}
          </span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Idempotency Key</span>
          <span className="text-on-surface font-semibold truncate mt-0.5" title={job.idempotency_key || 'None'}>
            {job.idempotency_key || '—'}
          </span>
        </div>
        <div className="flex flex-col p-space-xs">
          <span className="text-on-surface-variant uppercase text-[10px]">Completed At</span>
          <span className="text-on-surface mt-0.5">
            {formatTimestamp(job.completed_at)}
          </span>
        </div>
      </div>

      {/* Live Worker Terminal Log Stream */}
      <div className="flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <span className="font-label-caps text-label-caps uppercase text-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">terminal</span>
            <span>Lifecycle Logs (/jobs/{job.id}/logs)</span>
          </span>
          <span className="font-mono-sm text-mono-sm text-[11px] text-tertiary flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-ping"></span>
            <span>STREAM LIVE</span>
          </span>
        </div>
        <div
          className="rounded bg-surface-container-lowest p-space-sm font-mono-sm text-mono-sm flex flex-col gap-1 text-[11px] leading-relaxed overflow-x-auto shadow-inner h-32 border border-surface-container-high/40"
        >
          {logs.length === 0 ? (
            <div className="text-on-surface-variant opacity-60">No logged events yet for this job.</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="text-on-surface-variant flex items-baseline gap-2">
                <span className="text-on-surface opacity-50 shrink-0">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span
                  className={`font-semibold shrink-0 ${
                    log.level === 'ERROR'
                      ? 'text-error'
                      : log.level === 'WARN'
                      ? 'text-secondary'
                      : 'text-tertiary'
                  }`}
                >
                  {log.level}
                </span>
                <span className="text-on-surface">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Live Job Control Actions */}
      <div className="flex flex-wrap items-center justify-between gap-space-xs pt-space-xs border-t border-surface-container-high/30">
        <div className="flex items-center gap-space-xs">
          <button
            type="button"
            onClick={() => onInspectPayload(job)}
            className="px-space-sm py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">data_object</span>
            <span>Inspect Payload</span>
          </button>
          <button
            type="button"
            onClick={() => onCloneJob(job)}
            className="px-space-sm py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">content_copy</span>
            <span>Clone as New</span>
          </button>
        </div>

        <div className="flex items-center gap-space-xs">
          {/* Requeue action for FAILED or CANCELLED jobs */}
          {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
            <button
              type="button"
              onClick={handleRequeue}
              disabled={isProcessingAction}
              className="px-space-sm py-1.5 rounded bg-primary text-on-primary hover:bg-primary-fixed-dim font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">replay</span>
              <span>Requeue to Ready</span>
            </button>
          )}

          {/* Force fail action */}
          {job.status !== 'COMPLETED' && job.status !== 'FAILED' && (
            <button
              type="button"
              onClick={handleForceFail}
              disabled={isProcessingAction}
              className="px-space-sm py-1.5 rounded bg-error-container text-error hover:bg-error hover:text-on-error font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">dangerous</span>
              <span>Force Fail</span>
            </button>
          )}

          {/* Cancel action */}
          {job.status === 'PENDING' && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isProcessingAction}
              className="px-space-sm py-1.5 rounded bg-surface-container hover:bg-error hover:text-on-error text-error font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
              <span>Cancel Job</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
