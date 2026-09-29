'use client';

import React from 'react';
import { Stats, Throughput, Latency, RedisMetrics } from '../types';
import { formatDuration } from '../lib/utils';

interface SystemSummaryBarProps {
  stats?: Stats | null;
  throughput?: Throughput | null;
  latency?: Latency | null;
  redisMetrics?: RedisMetrics | null;
  onSimulateLoad: () => void;
  isSimulating: boolean;
  onRefresh: () => void;
}

export const SystemSummaryBar: React.FC<SystemSummaryBarProps> = ({
  stats,
  throughput,
  latency,
  redisMetrics,
  onSimulateLoad,
  isSimulating,
  onRefresh,
}) => {
  const tpText = throughput ? `${throughput.jobs_per_minute.toFixed(1)} j/m` : '0.0 j/m';
  const latText = latency && latency.sample_size > 0 ? formatDuration(latency.average_seconds) : '—';
  const redisMemText = redisMetrics?.memory_used_human || '—';

  return (
    <section id="overview" className="w-full bg-surface-container-low rounded-xl p-space-md shadow-sm flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-space-md border border-surface-container-high/30">
      {/* Left: Counters */}
      <div className="flex flex-wrap items-center gap-space-sm sm:gap-space-md">
        {/* Total Jobs */}
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container">
          <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">Jobs:</span>
          <span className="font-mono-md text-mono-md font-semibold text-on-surface" id="stat-total">
            {stats?.total ?? 0}
          </span>
        </div>

        {/* Processing */}
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container shadow-[0_0_8px_rgba(76,215,246,0.15)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
          </span>
          <span className="font-label-caps text-label-caps uppercase text-tertiary font-semibold">Processing:</span>
          <span className="font-mono-md text-mono-md font-semibold text-tertiary" id="stat-processing">
            {stats?.processing ?? 0}
          </span>
        </div>

        {/* Pending / Ready */}
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container">
          <span className="w-2 h-2 rounded-full bg-secondary"></span>
          <span className="font-label-caps text-label-caps uppercase text-secondary font-semibold">Pending:</span>
          <span className="font-mono-md text-mono-md font-semibold text-secondary" id="stat-pending">
            {stats?.pending ?? 0}
          </span>
        </div>

        {/* Completed */}
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container">
          <span className="w-2 h-2 rounded-full bg-primary"></span>
          <span className="font-label-caps text-label-caps uppercase text-primary font-semibold">Completed:</span>
          <span className="font-mono-md text-mono-md font-semibold text-primary" id="stat-completed">
            {stats?.completed ?? 0}
          </span>
        </div>

        {/* Failed / DLQ */}
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container">
          <span className="w-2 h-2 rounded-full bg-error"></span>
          <span className="font-label-caps text-label-caps uppercase text-error font-semibold">DLQ:</span>
          <span className="font-mono-md text-mono-md font-semibold text-error" id="stat-failed">
            {stats?.failed ?? 0}
          </span>
        </div>

        {/* Cluster Telemetry Spark Metrics */}
        <div className="hidden 2xl:flex items-center gap-space-md pl-space-md text-on-surface-variant font-mono-sm text-mono-sm border-l border-surface-container-high/40">
          <div className="flex items-center gap-space-xs">
            <span className="text-on-surface-variant opacity-70">Throughput</span>
            <span className="text-tertiary font-semibold">{tpText}</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-surface-container-highest"></div>
          <div className="flex items-center gap-space-xs">
            <span className="text-on-surface-variant opacity-70">Avg Latency</span>
            <span className="text-on-surface font-semibold">{latText}</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-surface-container-highest"></div>
          <div className="flex items-center gap-space-xs">
            <span className="text-on-surface-variant opacity-70">Redis Mem</span>
            <span className="text-primary font-semibold">{redisMemText}</span>
          </div>
        </div>
      </div>

      {/* Right: Operational Playground Actions */}
      <div className="flex items-center gap-space-xs flex-wrap">
        <button
          onClick={onRefresh}
          className="px-space-sm py-space-xs rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-mono-sm text-mono-sm transition-all duration-150 flex items-center gap-space-xs active:scale-95 shadow-sm cursor-pointer"
          title="Refresh All State"
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          <span>Refresh</span>
        </button>

        <button
          onClick={onSimulateLoad}
          disabled={isSimulating}
          className="px-space-md py-space-xs rounded bg-surface-container-high hover:bg-surface-bright text-tertiary font-mono-sm text-mono-sm font-semibold transition-all duration-150 flex items-center gap-space-xs active:scale-95 shadow-[0_0_12px_rgba(76,215,246,0.15)] cursor-pointer disabled:opacity-50"
          type="button"
        >
          <span className={`material-symbols-outlined text-[16px] ${isSimulating ? 'animate-spin' : ''}`}>bolt</span>
          <span>{isSimulating ? 'Simulating...' : 'Simulate Load (+5)'}</span>
        </button>
      </div>
    </section>
  );
};
