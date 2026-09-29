'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Job,
  Stats,
  QueueDepth,
  WorkersResponse,
  JobEventItem,
  WorkerEventItem,
  RedisMetrics,
  Throughput,
  Latency,
  Health,
} from '../types';
import { api } from '../lib/api';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { SystemSummaryBar } from '../components/SystemSummaryBar';
import { CreateJobPanel } from '../components/CreateJobPanel';
import { LiveJobPanel } from '../components/LiveJobPanel';
import { QueueStateSection } from '../components/QueueStateSection';
import { WorkersSection } from '../components/WorkersSection';
import { RecentActivityFeed } from '../components/RecentActivityFeed';
import { RecentJobsTable } from '../components/RecentJobsTable';
import { PayloadInspectModal } from '../components/PayloadInspectModal';

export default function PlaygroundPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [queueDepth, setQueueDepth] = useState<QueueDepth | null>(null);
  const [workers, setWorkers] = useState<WorkersResponse | null>(null);
  const [activity, setActivity] = useState<JobEventItem[]>([]);
  const [workerEvents, setWorkerEvents] = useState<WorkerEventItem[]>([]);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [throughput, setThroughput] = useState<Throughput | null>(null);
  const [latency, setLatency] = useState<Latency | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [inspectingJob, setInspectingJob] = useState<Job | null>(null);
  const [cloneJobData, setCloneJobData] = useState<Job | null>(null);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  const selectedJobIdRef = useRef<number | null>(null);
  selectedJobIdRef.current = selectedJob ? selectedJob.id : null;

  // Primary data polling cycle
  const fetchTelemetry = useCallback(async () => {
    try {
      const [
        healthRes,
        statsRes,
        qdRes,
        workersRes,
        actRes,
        wActRes,
        rmRes,
        tpRes,
        latRes,
        jobsRes,
      ] = await Promise.all([
        api.getHealth().catch(() => ({ status: 'error', database: 'disconnected', redis: 'disconnected' })),
        api.getStats().catch(() => null),
        api.getQueueDepth().catch(() => null),
        api.getWorkers().catch(() => ({ workers: [] })),
        api.getActivity(50).catch(() => ({ events: [] })),
        api.getWorkerEvents(undefined, 30).catch(() => ({ events: [] })),
        api.getRedisMetrics().catch(() => null),
        api.getThroughput(60).catch(() => null),
        api.getLatency(300).catch(() => null),
        api.getJobs({ limit: 100 }).catch(() => []),
      ]);

      setHealth(healthRes);
      if (statsRes) setStats(statsRes);
      if (qdRes) setQueueDepth(qdRes);
      if (workersRes) setWorkers(workersRes);
      if (actRes?.events) setActivity(actRes.events);
      if (wActRes?.events) setWorkerEvents(wActRes.events);
      if (rmRes) setRedisMetrics(rmRes);
      if (tpRes) setThroughput(tpRes);
      if (latRes) setLatency(latRes);
      if (Array.isArray(jobsRes)) {
        setJobs(jobsRes);

        // Keep selectedJob synchronized with fresh backend data
        if (selectedJobIdRef.current !== null) {
          const matching = jobsRes.find((j) => j.id === selectedJobIdRef.current);
          if (matching) {
            setSelectedJob(matching);
          }
        } else if (jobsRes.length > 0 && !selectedJob) {
          // Default select the latest job
          setSelectedJob(jobsRes[0]);
        }
      }

      setBackendError(null);
    } catch (err: any) {
      setBackendError(err.message || 'Unable to connect to backend server');
    }
  }, [selectedJob]);

  // Initial load & Polling Interval (1.5 seconds)
  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1500);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Handle new job created from form
  const handleJobCreated = (newJob: Job) => {
    setJobs((prev) => [newJob, ...prev.filter((j) => j.id !== newJob.id)]);
    setSelectedJob(newJob);
    fetchTelemetry();
  };

  // Handle job update (cancel, force-fail, requeue, status change)
  const handleJobUpdated = (updatedJob: Job) => {
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
    if (selectedJob?.id === updatedJob.id) {
      setSelectedJob(updatedJob);
    }
    fetchTelemetry();
  };

  // Select job by ID (e.g. from activity or worker cards)
  const handleSelectJobId = (jobId: number) => {
    const found = jobs.find((j) => j.id === jobId);
    if (found) {
      setSelectedJob(found);
    } else {
      api.getJob(jobId).then((fetched) => {
        setSelectedJob(fetched);
        setJobs((prev) => [fetched, ...prev.filter((j) => j.id !== fetched.id)]);
      }).catch(() => {});
    }
    // Scroll to Live Job
    const el = document.getElementById('live-job');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  // Clone job into Create Job panel
  const handleCloneJob = (job: Job) => {
    setCloneJobData(job);
    const el = document.getElementById('create-job');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  // Simulate Load (+5 batch jobs)
  const handleSimulateLoad = async () => {
    setIsSimulating(true);
    const batch = [
      { type: 'email', payload: { recipient: 'batch-1@taskforge.dev' }, priority: 10, delay_seconds: 0 },
      { type: 'image_processing', payload: { asset_id: 'img_sim_01.png' }, priority: 5, delay_seconds: 0 },
      { type: 'data_export', payload: { format: 'json' }, priority: 1, delay_seconds: 0 },
      { type: 'notification', payload: { channel: 'ops_alert' }, priority: 5, delay_seconds: 0 },
      { type: 'fail', payload: { simulate: true }, priority: 1, delay_seconds: 0 },
    ];

    try {
      await Promise.all(batch.map((b) => api.createJob(b)));
      await fetchTelemetry();
    } catch {
      // ignore
    } finally {
      setIsSimulating(false);
    }
  };

  // Navigation handling
  const handleNavigate = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="bg-background min-h-screen text-on-surface">
      {/* Top Header */}
      <Header health={health} redisMetrics={redisMetrics} workers={workers} />

      {/* Left Sidebar */}
      <Sidebar
        redisMetrics={redisMetrics}
        activeSection={activeSection}
        onNavigate={handleNavigate}
      />

      {/* Main Content Pane */}
      <div className="pl-60">
        <main className="w-full pt-14 bg-background min-h-screen px-margin py-space-lg">
          <div className="flex flex-col w-full gap-space-lg max-w-7xl mx-auto">
            {/* Backend Offline Banner */}
            {backendError && (
              <div className="p-space-sm rounded-xl bg-error-container text-on-error-container font-mono-sm text-mono-sm flex items-center justify-between border border-error/30 shadow-md">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>Backend unavailable: {backendError}. Ensure FastAPI is running at http://127.0.0.1:8000.</span>
                </div>
                <button
                  type="button"
                  onClick={fetchTelemetry}
                  className="px-space-xs py-0.5 rounded bg-surface-container text-on-surface hover:bg-surface-container-high cursor-pointer"
                >
                  Retry Connection
                </button>
              </div>
            )}

            {/* 1. TOP METRICS / SYSTEM SUMMARY BAR */}
            <SystemSummaryBar
              stats={stats}
              throughput={throughput}
              latency={latency}
              redisMetrics={redisMetrics}
              onSimulateLoad={handleSimulateLoad}
              isSimulating={isSimulating}
              onRefresh={fetchTelemetry}
            />

            {/* 2. MAIN PLAYGROUND LAYOUT (Two-Column Grid) */}
            <section className="w-full grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
              {/* Left Column: Create Job (5 cols) */}
              <div className="lg:col-span-5">
                <CreateJobPanel
                  onJobCreated={handleJobCreated}
                  cloneJobData={cloneJobData}
                />
              </div>

              {/* Right Column: Live Job (7 cols) */}
              <div className="lg:col-span-7">
                <LiveJobPanel
                  job={selectedJob}
                  onJobUpdated={handleJobUpdated}
                  onInspectPayload={(j) => setInspectingJob(j)}
                  onCloneJob={handleCloneJob}
                />
              </div>
            </section>

            {/* 3. QUEUE STATE SECTION (4 Distinct Cards) */}
            <QueueStateSection
              queueDepth={queueDepth}
              jobs={jobs}
              onSelectJob={(j) => setSelectedJob(j)}
              onJobRequeued={handleJobUpdated}
            />

            {/* 4. WORKERS & RECENT ACTIVITY (Two-Column Lower Section) */}
            <section className="w-full grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
              <WorkersSection
                workers={workers}
                onSelectJobId={handleSelectJobId}
                onRefresh={fetchTelemetry}
              />
              <RecentActivityFeed
                events={activity}
                workerEvents={workerEvents}
                onSelectJobId={handleSelectJobId}
              />
            </section>

            {/* 5. RECENT JOBS TABLE */}
            <RecentJobsTable
              jobs={jobs}
              selectedJobId={selectedJob?.id}
              onSelectJob={(j) => setSelectedJob(j)}
              onInspectPayload={(j) => setInspectingJob(j)}
              onJobUpdated={handleJobUpdated}
            />
          </div>
        </main>
      </div>

      {/* Payload Inspection Modal */}
      {inspectingJob && (
        <PayloadInspectModal
          job={inspectingJob}
          onClose={() => setInspectingJob(null)}
        />
      )}
    </div>
  );
}
