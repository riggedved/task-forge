'use client';

import React, { useState } from 'react';
import { WorkersResponse, Worker } from '../types';
import { api, ApiError } from '../lib/api';
import { formatTimeAgo } from '../lib/utils';

interface WorkersSectionProps {
  workers: WorkersResponse | null;
  onSelectJobId?: (jobId: number) => void;
  onRefresh?: () => Promise<void> | void;
}

export const WorkersSection: React.FC<WorkersSectionProps> = ({
  workers,
  onSelectJobId,
  onRefresh,
}) => {
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stoppingWorkerId, setStoppingWorkerId] = useState<string | null>(null);
  const [confirmStopWorkerId, setConfirmStopWorkerId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showStopped, setShowStopped] = useState(false);

  const workerList: Worker[] = workers?.workers || [];
  const activeWorkers = workerList.filter(
    (w) => w.status !== 'STOPPED' && w.status !== 'OFFLINE'
  );
  const stoppedWorkers = workerList.filter(
    (w) => w.status === 'STOPPED' || w.status === 'OFFLINE'
  );
  const displayedWorkers = showStopped ? workerList : activeWorkers;

  const handleStartWorker = async () => {
    setIsStarting(true);
    setStartError(null);
    setStopError(null);
    try {
      const res = await api.startWorker();
      setSuccessMessage(`Worker ${res.worker_id} started successfully`);
      setTimeout(() => setSuccessMessage(null), 4000);
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err: any) {
      const msg = err instanceof ApiError ? err.message : (err?.message || 'Unable to start worker process');
      setStartError(`Unable to start worker: ${msg}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopWorker = async (workerId: string) => {
    setStoppingWorkerId(workerId);
    setStopError(null);
    setStartError(null);
    setConfirmStopWorkerId(null);
    try {
      const res = await api.stopWorker(workerId);
      setSuccessMessage(res.message || `Stop signal sent to ${workerId}`);
      setTimeout(() => setSuccessMessage(null), 4000);
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err: any) {
      const msg = err instanceof ApiError ? err.message : (err?.message || 'Failed to stop worker');
      setStopError(`Failed to stop ${workerId}: ${msg}`);
    } finally {
      setStoppingWorkerId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return 'bg-tertiary/10 text-tertiary border border-tertiary/30';
      case 'IDLE':
        return 'bg-primary/10 text-primary border border-primary/30';
      case 'STARTING':
        return 'bg-secondary/10 text-secondary border border-secondary/30';
      case 'STOPPING':
        return 'bg-secondary-container/30 text-secondary border border-secondary/30';
      case 'OFFLINE':
        return 'bg-error/10 text-error border border-error/30';
      case 'STOPPED':
        return 'bg-surface-container-highest text-outline border border-outline/30';
      case 'RECOVERING':
        return 'bg-secondary/10 text-secondary border border-secondary/30';
      default:
        return 'bg-surface-container text-on-surface-variant border border-outline-variant/30';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return 'bg-tertiary animate-pulse';
      case 'IDLE':
        return 'bg-primary';
      case 'STARTING':
      case 'STOPPING':
      case 'RECOVERING':
        return 'bg-secondary animate-pulse';
      case 'OFFLINE':
        return 'bg-error';
      case 'STOPPED':
        return 'bg-outline';
      default:
        return 'bg-on-surface-variant';
    }
  };

  return (
    <div
      id="workers"
      className="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-md border border-surface-container-high/30 scroll-mt-20"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-tertiary text-[22px]">memory</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight uppercase">
            Workers
          </h2>
          <span className="ml-space-xs font-mono-sm text-mono-sm text-tertiary px-space-xs py-0.5 rounded bg-tertiary/10 border border-tertiary/20 font-semibold">
            {activeWorkers.length} Active
          </span>
        </div>

        <div className="flex items-center gap-space-sm">
          {stoppedWorkers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowStopped(!showStopped)}
              className="text-on-surface-variant hover:text-on-surface font-mono-sm text-[11px] underline cursor-pointer"
            >
              {showStopped ? 'Hide Stopped' : `Show Stopped (${stoppedWorkers.length})`}
            </button>
          )}

          <button
            type="button"
            onClick={handleStartWorker}
            disabled={isStarting}
            className="px-space-sm py-1.5 rounded bg-primary text-on-primary font-mono-sm text-mono-sm font-semibold hover:bg-primary-fixed-dim transition-all flex items-center gap-space-xs cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Spawn a new real worker process"
          >
            {isStarting ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Starting...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>+ Start Worker</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Notifications / Feedback */}
      {successMessage && (
        <div className="p-space-xs px-space-sm rounded bg-primary/10 border border-primary/30 text-primary font-mono-sm text-[12px] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-primary/70 hover:text-primary cursor-pointer text-[14px]"
          >
            ✕
          </button>
        </div>
      )}

      {startError && (
        <div className="p-space-xs px-space-sm rounded bg-error-container text-on-error-container font-mono-sm text-[12px] flex items-center justify-between border border-error/30">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{startError}</span>
          </div>
          <button
            type="button"
            onClick={() => setStartError(null)}
            className="text-on-error-container/70 hover:text-on-error-container cursor-pointer text-[14px]"
          >
            ✕
          </button>
        </div>
      )}

      {stopError && (
        <div className="p-space-xs px-space-sm rounded bg-error-container text-on-error-container font-mono-sm text-[12px] flex items-center justify-between border border-error/30">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">warning</span>
            <span>{stopError}</span>
          </div>
          <button
            type="button"
            onClick={() => setStopError(null)}
            className="text-on-error-container/70 hover:text-on-error-container cursor-pointer text-[14px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Workers List / Empty State */}
      <div className="flex flex-col gap-space-xs min-h-[160px]">
        {displayedWorkers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-space-xl text-center text-on-surface-variant gap-3 border border-dashed border-outline-variant/30 rounded-lg bg-surface-container/40 my-auto">
            <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-[28px]">memory</span>
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                No workers running
              </div>
              <div className="font-body-sm text-[12px] text-on-surface-variant/80">
                Start a worker process to begin consuming and processing jobs from the Redis queue.
              </div>
            </div>
            <button
              type="button"
              onClick={handleStartWorker}
              disabled={isStarting}
              className="mt-1 px-space-md py-space-sm rounded bg-primary text-on-primary font-mono-sm text-mono-sm font-semibold hover:bg-primary-fixed-dim transition-colors flex items-center gap-space-xs cursor-pointer shadow-md disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">play_arrow</span>
              <span>{isStarting ? 'Starting Worker Process...' : '+ Start Worker'}</span>
            </button>
          </div>
        ) : (
          displayedWorkers.map((w) => {
            const isProcessing = w.status === 'PROCESSING';
            const isStopping = w.status === 'STOPPING' || stoppingWorkerId === w.worker_id;
            const isDead = w.status === 'STOPPED' || w.status === 'OFFLINE';
            const activeJobId = w.current_job_id ?? w.job_id;

            return (
              <div
                key={w.worker_id}
                className={`p-space-sm rounded-lg bg-surface-container flex flex-wrap sm:flex-nowrap items-center justify-between gap-space-md hover:bg-surface-container-high transition-colors border ${
                  isProcessing
                    ? 'border-tertiary/30 shadow-[0_0_12px_rgba(76,215,246,0.1)]'
                    : isDead
                    ? 'border-outline-variant/20 opacity-70'
                    : 'border-surface-container-high/40'
                }`}
              >
                {/* Left: Worker ID & Liveness */}
                <div className="flex items-center gap-space-sm min-w-0">
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-space-xs">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getStatusDot(w.status)}`}></span>
                      <span
                        className="font-mono-md text-mono-md text-on-surface font-semibold truncate max-w-[200px] sm:max-w-[240px]"
                        title={w.worker_id}
                      >
                        {w.worker_id}
                      </span>
                    </div>
                    <div className="flex items-center gap-space-xs font-mono-sm text-mono-sm text-on-surface-variant text-[11px] mt-0.5">
                      {w.started_at ? (
                        <span>Started {formatTimeAgo(w.started_at)}</span>
                      ) : (
                        <span>Real Python Process</span>
                      )}
                      {w.last_heartbeat && (
                        <>
                          <span>&bull;</span>
                          <span title={`Heartbeat at ${new Date(w.last_heartbeat * 1000).toLocaleTimeString()}`}>
                            Heartbeat {formatTimeAgo(w.last_heartbeat)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Current Job, Status Badge, and Stop Action */}
                <div className="flex items-center gap-space-md shrink-0">
                  {/* Current Job Info */}
                  <div className="text-right hidden sm:block min-w-[100px]">
                    {activeJobId ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => onSelectJobId && onSelectJobId(activeJobId)}
                          className="font-mono-sm text-mono-sm text-tertiary hover:underline font-semibold cursor-pointer"
                          title="View in Live Job Panel"
                        >
                          Job #{activeJobId}
                        </button>
                        <div className="font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
                          In-Flight Execution
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant/60 text-[11px]">
                          Current Job: —
                        </span>
                        <div className="font-mono-sm text-mono-sm text-on-surface-variant/40 text-[10px]">
                          Idle / Ready
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`px-space-xs py-1 rounded font-mono-sm text-mono-sm uppercase font-semibold text-[11px] tracking-wider ${getStatusBadge(
                      w.status
                    )}`}
                  >
                    {w.status}
                  </span>

                  {/* Stop Action or Confirmation */}
                  <div className="flex items-center">
                    {!isDead && (
                      <>
                        {confirmStopWorkerId === w.worker_id ? (
                          <div className="flex items-center gap-1 bg-surface-container-highest p-1 rounded border border-error/30 animate-in fade-in">
                            <span className="text-[11px] font-mono-sm text-on-surface px-1">Stop?</span>
                            <button
                              type="button"
                              onClick={() => handleStopWorker(w.worker_id)}
                              className="px-1.5 py-0.5 rounded bg-error text-on-error font-mono-sm text-[10px] font-semibold hover:bg-error/90 cursor-pointer"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmStopWorkerId(null)}
                              className="px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant font-mono-sm text-[10px] hover:text-on-surface cursor-pointer"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmStopWorkerId(w.worker_id)}
                            disabled={isStopping}
                            className="px-space-xs py-1 rounded bg-surface-container-highest hover:bg-error/20 hover:text-error text-on-surface-variant font-mono-sm text-[11px] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Gracefully stop this worker process"
                          >
                            {isStopping ? (
                              <>
                                <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                                <span>Stopping...</span>
                              </>
                            ) : (
                              <>
                                <span className="material-symbols-outlined text-[14px]">stop</span>
                                <span>Stop</span>
                              </>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
