'use client';

import React, { useState } from 'react';
import { Job } from '../types';
import { formatTimestamp, formatTimeAgo } from '../lib/utils';
import { api } from '../lib/api';

interface RecentJobsTableProps {
  jobs: Job[];
  selectedJobId?: number | null;
  onSelectJob: (job: Job) => void;
  onInspectPayload: (job: Job) => void;
  onJobUpdated: (job: Job) => void;
}

export const RecentJobsTable: React.FC<RecentJobsTableProps> = ({
  jobs,
  selectedJobId,
  onSelectJob,
  onInspectPayload,
  onJobUpdated,
}) => {
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const counts = {
    ALL: jobs.length,
    PROCESSING: jobs.filter((j) => j.status === 'PROCESSING').length,
    READY: jobs.filter((j) => j.status === 'PENDING').length,
    COMPLETED: jobs.filter((j) => j.status === 'COMPLETED').length,
    FAILED: jobs.filter((j) => j.status === 'FAILED').length,
    CANCELLED: jobs.filter((j) => j.status === 'CANCELLED').length,
  };

  const filteredJobs = jobs.filter((j) => {
    // Filter by tab
    if (activeFilter === 'PROCESSING' && j.status !== 'PROCESSING') return false;
    if (activeFilter === 'READY' && j.status !== 'PENDING') return false;
    if (activeFilter === 'COMPLETED' && j.status !== 'COMPLETED') return false;
    if (activeFilter === 'FAILED' && j.status !== 'FAILED') return false;
    if (activeFilter === 'CANCELLED' && j.status !== 'CANCELLED') return false;

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = String(j.id).includes(q) || `#${j.id}`.includes(q);
      const matchType = j.type.toLowerCase().includes(q);
      const matchWorker = (j.worker_id || '').toLowerCase().includes(q);
      const matchStatus = j.status.toLowerCase().includes(q);
      return matchId || matchType || matchWorker || matchStatus;
    }

    return true;
  });

  const handleRequeue = async (e: React.MouseEvent, job: Job) => {
    e.stopPropagation();
    try {
      const updated = await api.requeueJob(job.id);
      onJobUpdated(updated);
    } catch (err: any) {
      alert(`Failed to requeue: ${err.message}`);
    }
  };

  const handleCancel = async (e: React.MouseEvent, job: Job) => {
    e.stopPropagation();
    try {
      const updated = await api.cancelJob(job.id);
      onJobUpdated(updated);
    } catch (err: any) {
      alert(`Cannot cancel: ${err.message}`);
    }
  };

  return (
    <section id="recent-jobs" className="w-full bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-md border border-surface-container-high/30">
      {/* Header with Filters & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-primary text-[20px]">view_list</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight uppercase">
            Recent Jobs
          </h2>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-space-xs flex-wrap">
          {(
            [
              { key: 'ALL', label: 'All' },
              { key: 'PROCESSING', label: 'Processing' },
              { key: 'READY', label: 'Ready' },
              { key: 'COMPLETED', label: 'Completed' },
              { key: 'FAILED', label: 'Failed' },
              { key: 'CANCELLED', label: 'Cancelled' },
            ] as const
          ).map(({ key, label }) => {
            const isActive = activeFilter === key;
            const count = counts[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFilter(key)}
                className={`px-space-sm py-1 rounded font-mono-sm text-mono-sm transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-primary-container text-on-primary-container font-semibold'
                    : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="flex items-center rounded bg-surface-container px-space-sm py-1.5 focus-within:ring-1 focus-within:ring-primary w-full md:w-64 border border-surface-container-high/30">
          <span className="material-symbols-outlined text-on-surface-variant text-[16px] mr-space-xs">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by ID, worker, status..."
            className="w-full bg-transparent font-mono-sm text-mono-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-on-surface-variant hover:text-on-surface text-mono-sm">✕</button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto rounded bg-surface-container-lowest border border-surface-container-high/30">
        <table className="w-full text-left font-mono-sm text-mono-sm border-collapse">
          <thead>
            <tr className="bg-surface-container text-on-surface-variant font-label-caps text-label-caps uppercase h-9 border-b border-surface-container-high/40">
              <th className="py-space-xs px-space-md">ID</th>
              <th className="py-space-xs px-space-md">Type</th>
              <th className="py-space-xs px-space-md">Priority</th>
              <th className="py-space-xs px-space-md">Status</th>
              <th className="py-space-xs px-space-md">Retries</th>
              <th className="py-space-xs px-space-md">Worker</th>
              <th className="py-space-xs px-space-md">Created</th>
              <th className="py-space-xs px-space-md text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-space-lg text-center text-on-surface-variant/60 font-mono-sm">
                  No jobs match the current filter or search criteria.
                </td>
              </tr>
            ) : (
              filteredJobs.map((j) => {
                const isSelected = selectedJobId === j.id;
                return (
                  <tr
                    key={j.id}
                    onClick={() => onSelectJob(j)}
                    className={`transition-colors cursor-pointer border-b border-surface-container-high/20 ${
                      isSelected
                        ? 'bg-surface-container/80 border-l-2 border-l-primary'
                        : 'hover:bg-surface-container/50'
                    }`}
                  >
                    <td className="py-space-sm px-space-md font-semibold text-primary">
                      #{j.id}
                    </td>
                    <td className="py-space-sm px-space-md text-on-surface">{j.type}</td>
                    <td className="py-space-sm px-space-md font-bold text-tertiary">
                      {j.priority}
                    </td>
                    <td className="py-space-sm px-space-md">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                          j.status === 'PROCESSING'
                            ? 'bg-tertiary/10 text-tertiary'
                            : j.status === 'COMPLETED'
                            ? 'bg-primary/10 text-primary'
                            : j.status === 'FAILED'
                            ? 'bg-error-container text-error'
                            : j.status === 'CANCELLED'
                            ? 'bg-surface-container text-outline'
                            : 'bg-secondary/10 text-secondary'
                        }`}
                      >
                        {j.status === 'PROCESSING' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-ping"></span>
                        )}
                        <span>{j.status}</span>
                      </span>
                    </td>
                    <td className="py-space-sm px-space-md text-on-surface-variant">
                      {j.retry_count}/3
                    </td>
                    <td className="py-space-sm px-space-md text-on-surface-variant truncate max-w-[140px]" title={j.worker_id || '—'}>
                      {j.worker_id ? j.worker_id.slice(0, 10) + '...' : '—'}
                    </td>
                    <td className="py-space-sm px-space-md text-on-surface-variant">
                      {formatTimeAgo(j.created_at)}
                    </td>
                    <td className="py-space-sm px-space-md text-right">
                      <div className="flex items-center justify-end gap-space-xs" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onInspectPayload(j)}
                          className="px-space-xs py-0.5 rounded bg-surface-container hover:bg-surface-container-highest text-on-surface text-[10px] cursor-pointer"
                        >
                          Inspect
                        </button>
                        {j.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={(e) => handleCancel(e, j)}
                            className="px-space-xs py-0.5 rounded bg-surface-container hover:bg-error hover:text-on-error text-error text-[10px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                        {(j.status === 'FAILED' || j.status === 'CANCELLED') && (
                          <button
                            type="button"
                            onClick={(e) => handleRequeue(e, j)}
                            className="px-space-xs py-0.5 rounded bg-surface-container hover:bg-primary hover:text-on-primary text-on-surface text-[10px] cursor-pointer"
                          >
                            Re-run
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
