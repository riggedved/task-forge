'use client';

import React from 'react';
import { Health, RedisMetrics, WorkersResponse } from '../types';

interface HeaderProps {
  health?: Health | null;
  redisMetrics?: RedisMetrics | null;
  workers?: WorkersResponse | null;
}

export const Header: React.FC<HeaderProps> = ({ health, redisMetrics, workers }) => {
  const isHealthy = health?.status === 'ok';
  const activeWorkerCount =
    workers?.workers.filter((w) => w.status !== 'STOPPED' && w.status !== 'OFFLINE').length || 0;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-lowest/90 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.4)]">
      <div className="h-14 w-full px-margin flex items-center justify-between">
        {/* Left: Branding & Cluster */}
        <div className="flex items-center gap-space-md">
          {/* Logo icon representation */}
          <div className="flex items-center justify-center w-8 h-8 rounded bg-primary/10 text-primary border border-primary/20">
            <span className="material-symbols-outlined text-[20px] text-tertiary">bolt</span>
          </div>

          <div className="flex items-baseline gap-space-sm">
            <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface font-semibold">
              TASK FORGE
            </span>
            <span className="hidden xl:inline text-on-surface-variant font-mono-sm text-mono-sm opacity-80">
              Distributed Job Processing Playground
            </span>
          </div>

          <div className="hidden md:flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container text-on-surface-variant font-mono-sm text-mono-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
            <span className="text-on-surface font-medium">Cluster:</span>
            <span>FastAPI + Redis + PostgreSQL</span>
          </div>
        </div>

        {/* Right: Live Cluster Status & Controls */}
        <div className="flex items-center gap-space-md">
          {/* Health indicator */}
          <div className="hidden lg:flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container font-mono-sm text-mono-sm">
            {isHealthy ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
                </span>
                <span className="text-tertiary font-semibold tracking-wider uppercase">SYSTEM ONLINE</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-error"></span>
                <span className="text-error font-semibold tracking-wider uppercase">BACKEND OFFLINE</span>
              </>
            )}
          </div>

          {/* Quick cluster telemetry */}
          <div className="hidden 2xl:flex items-center gap-space-md font-mono-sm text-mono-sm text-on-surface-variant px-space-sm py-space-xs rounded bg-surface-container-low">
            <div>
              Redis{' '}
              <span className={redisMetrics?.connected ? 'text-tertiary font-mono-sm' : 'text-error font-mono-sm'}>
                {redisMetrics?.connected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="w-1 h-1 rounded-full bg-outline-variant"></div>
            <div>
              Postgres{' '}
              <span className={health?.database === 'connected' ? 'text-primary font-mono-sm' : 'text-error font-mono-sm'}>
                {health?.database === 'connected' ? 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="w-1 h-1 rounded-full bg-outline-variant"></div>
            <div>
              Workers{' '}
              <span className="text-tertiary font-mono-sm font-semibold">
                {activeWorkerCount} In-Flight
              </span>
            </div>
          </div>

          {/* Icons & Avatar */}
          <div className="flex items-center gap-space-xs">
            <button
              className="p-space-xs rounded bg-surface-container hover:bg-surface-container-high hover:text-on-surface text-on-surface-variant transition-colors flex items-center justify-center cursor-pointer"
              title="Documentation"
              type="button"
              onClick={() => window.open('http://127.0.0.1:8000/docs', '_blank')}
            >
              <span className="material-symbols-outlined text-[20px]">menu_book</span>
            </button>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center ml-space-xs text-on-primary font-mono-sm font-semibold">
              <span className="material-symbols-outlined text-[18px]">developer_mode</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
