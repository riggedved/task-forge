'use client';

import React from 'react';
import { RedisMetrics } from '../types';

interface SidebarProps {
  redisMetrics?: RedisMetrics | null;
  activeSection: string;
  onNavigate: (section: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  redisMetrics,
  activeSection,
  onNavigate,
}) => {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'speed' },
    { id: 'create-job', label: 'Create Job', icon: 'queue' },
    { id: 'live-job', label: 'Live Job', icon: 'terminal' },
    { id: 'job-queues', label: 'Job Queues', icon: 'view_list' },
    { id: 'worker-nodes', label: 'Worker Nodes', icon: 'memory' },
    { id: 'activity', label: 'Recent Activity', icon: 'rss_feed' },
    { id: 'recent-jobs', label: 'Recent Jobs', icon: 'table_rows' },
  ];

  const memHuman = redisMetrics?.memory_used_human || '—';
  const clients = redisMetrics?.connected_clients ?? '—';

  return (
    <aside className="fixed left-0 top-14 bottom-0 w-60 bg-surface-container-low z-40 flex flex-col justify-between p-space-sm border-r border-surface-container-high/30">
      <div className="flex flex-col gap-space-sm">
        <div className="px-space-sm py-space-xs font-label-caps text-label-caps uppercase text-on-surface-variant tracking-wider">
          Pipelines &amp; Queues
        </div>
        <nav className="flex flex-col gap-space-xs">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
                className={`flex items-center gap-space-sm px-space-sm py-space-xs transition-colors rounded text-left cursor-pointer ${
                  isActive
                    ? 'bg-primary-container text-on-primary-container font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-body-sm text-body-sm'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Real Redis memory & client metric card */}
      <div className="p-space-sm bg-surface-container rounded flex flex-col gap-space-xs shadow-inner">
        <div className="flex items-center justify-between font-label-caps text-label-caps text-on-surface-variant uppercase">
          <span>Redis Memory</span>
          <span className="text-tertiary font-mono-sm">{memHuman}</span>
        </div>
        <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            className="bg-tertiary h-full transition-all duration-500"
            style={{ width: redisMetrics?.connected ? '45%' : '0%' }}
          ></div>
        </div>
        <div className="flex items-center justify-between font-mono-sm text-mono-sm text-on-surface-variant text-[10px]">
          <span>Clients: {clients}</span>
          <span className={redisMetrics?.connected ? 'text-primary' : 'text-error'}>
            {redisMetrics?.connected ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
};
