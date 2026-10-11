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
import { api, API_BASE_URL } from '../lib/api';
import { Header } from '../components/Header';
import { SystemSummaryBar } from '../components/SystemSummaryBar';
import { CreateJobPanel } from '../components/CreateJobPanel';
import { LiveJobPanel } from '../components/LiveJobPanel';
import { QueueStateSection } from '../components/QueueStateSection';
import { WorkersSection } from '../components/WorkersSection';
import { RecentActivityFeed } from '../components/RecentActivityFeed';
import { RecentJobsTable } from '../components/RecentJobsTable';
import { PayloadInspectModal } from '../components/PayloadInspectModal';
import { HardResetModal } from '../components/HardResetModal';

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
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [inspectingJob, setInspectingJob] = useState<Job | null>(null);
  const [cloneJobData, setCloneJobData] = useState<Job | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isHardResetModalOpen, setIsHardResetModalOpen] = useState<boolean>(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const selectedJobIdRef = useRef<number | null>(null);
  selectedJobIdRef.current = selectedJob ? selectedJob.id : null;

  const autoFollowRef = useRef<boolean>(true);
  autoFollowRef.current = autoFollow;

  const completedDwellRef = useRef<{ id: number; timestamp: number } | null>(null);

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
        api.getWorkers(true).catch(() => ({ workers: [] })),
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

        const processingJobs = jobsRes.filter((j) => j.status === 'PROCESSING');
        // Sort processing jobs by started_at descending (newest first), then priority descending
        processingJobs.sort((a, b) => (b.started_at || 0) - (a.started_at || 0) || b.priority - a.priority);

        if (autoFollowRef.current) {
          const currentSelected = selectedJobIdRef.current !== null
            ? jobsRes.find((j) => j.id === selectedJobIdRef.current)
            : null;

          if (currentSelected && (currentSelected.status === 'PROCESSING' || currentSelected.status === 'PENDING')) {
            // Currently watched job is still actively processing or pending — keep following it
            setSelectedJob(currentSelected);
            completedDwellRef.current = null;
          } else if (currentSelected) {
            // Currently watched job just finished (COMPLETED, FAILED, CANCELLED)
            setSelectedJob(currentSelected);

            if (!completedDwellRef.current || completedDwellRef.current.id !== currentSelected.id) {
              completedDwellRef.current = { id: currentSelected.id, timestamp: Date.now() };
            }

            // Dwell for 2000ms so user can view the completion state before transitioning
            const elapsedDwell = Date.now() - completedDwellRef.current.timestamp;
            if (elapsedDwell >= 2000) {
              // Find other active processing jobs
              const nextProcessing = processingJobs.find((j) => j.id !== currentSelected.id);
              if (nextProcessing) {
                setSelectedJob(nextProcessing);
                completedDwellRef.current = null;
              } else {
                // If none processing, find next pending job
                const pendingJobs = jobsRes.filter((j) => j.status === 'PENDING');
                if (pendingJobs.length > 0) {
                  pendingJobs.sort((a, b) => b.priority - a.priority || (a.created_at || 0) - (b.created_at || 0));
                  setSelectedJob(pendingJobs[0]);
                  completedDwellRef.current = null;
                }
              }
            }
          } else {
            // No job selected yet: pick freshest processing job, or top pending, or first job
            if (processingJobs.length > 0) {
              setSelectedJob(processingJobs[0]);
            } else if (jobsRes.length > 0) {
              setSelectedJob(jobsRes[0]);
            }
          }
        } else {
          // Pinned mode: keep existing selected job synchronized with fresh data, don't auto-switch
          if (selectedJobIdRef.current !== null) {
            const matching = jobsRes.find((j) => j.id === selectedJobIdRef.current);
            if (matching) {
              setSelectedJob(matching);
            }
          }
        }
      }

      setBackendError(null);
    } catch (err: any) {
      setBackendError(err.message || 'Unable to connect to backend server');
    }
  }, []);

  // Initial load & Polling Interval (1.5 seconds)
  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1500);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Handle new job created from form (automatically follows newly spawned job)
  const handleJobCreated = (newJob: Job) => {
    setJobs((prev) => [newJob, ...prev.filter((j) => j.id !== newJob.id)]);
    setSelectedJob(newJob);
    setAutoFollow(true);
    completedDwellRef.current = null;
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

  // Handle manual selection from list/queue/cards (pins the view so background updates don't switch it)
  const handleManualSelectJob = (job: Job) => {
    setSelectedJob(job);
    setAutoFollow(false);
    completedDwellRef.current = null;
    const el = document.getElementById('live-job');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  // Select job by ID (e.g. from activity or worker cards) -> Pins the view
  const handleSelectJobId = (jobId: number) => {
    setAutoFollow(false);
    completedDwellRef.current = null;
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
      let createdJobs: any[] = [];
      try {
        createdJobs = await api.createJobsBatch(batch);
      } catch {
        // Fallback for older backend versions
        createdJobs = await Promise.all(batch.map((b) => api.createJob(b)));
      }

      // Instant UI update: display jobs in table and update queue depth / stats immediately
      if (Array.isArray(createdJobs) && createdJobs.length > 0) {
        setJobs((prev) => [
          ...createdJobs,
          ...prev.filter((j) => !createdJobs.some((cj) => cj.id === j.id))
        ]);
        setStats((prev) => prev ? {
          ...prev,
          total: prev.total + createdJobs.length,
          pending: prev.pending + createdJobs.length,
        } : prev);
        setQueueDepth((prev) => prev ? {
          ...prev,
          ready: prev.ready + createdJobs.length,
          total: prev.total + createdJobs.length,
        } : prev);
      }

      fetchTelemetry();
    } catch {
      // ignore
    } finally {
      setIsSimulating(false);
    }
  };


  // Handle successful Hard Reset
  const handleHardResetSuccess = async () => {
    setSelectedJob(null);
    selectedJobIdRef.current = null;
    setAutoFollow(true);
    completedDwellRef.current = null;
    setInspectingJob(null);
    setJobs([]);
    setActivity([]);
    setWorkerEvents([]);
    setStats({ total: 0, pending: 0, processing: 0, completed: 0, failed: 0 });
    setQueueDepth({ ready: 0, processing: 0, delayed: 0, failed: 0, total: 0 });
    setWorkers({ workers: [] });
    setResetSuccessMessage('Task Forge reset successfully.');
    setTimeout(() => setResetSuccessMessage(null), 4000);
    await fetchTelemetry();
  };

  return (
    <div className="bg-background min-h-screen text-on-surface">
      {/* Top Header */}
      <Header
        health={health}
        redisMetrics={redisMetrics}
        workers={workers}
        onHardReset={() => setIsHardResetModalOpen(true)}
      />

      {/* Main Content Pane */}
      <main className="w-full pt-14 bg-background min-h-screen px-margin py-space-lg">
        <div className="flex flex-col w-full gap-space-lg max-w-7xl mx-auto">
            {/* Reset Success Notification Banner */}
            {resetSuccessMessage && (
              <div className="p-space-sm rounded-xl bg-primary/10 border border-primary/30 text-primary font-mono-sm text-mono-sm flex items-center justify-between shadow-md animate-in fade-in">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{resetSuccessMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setResetSuccessMessage(null)}
                  className="text-primary/70 hover:text-primary cursor-pointer text-[14px]"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Backend Offline Banner */}
            {backendError && (
              <div className="p-space-sm rounded-xl bg-error-container text-on-error-container font-mono-sm text-mono-sm flex items-center justify-between border border-error/30 shadow-md">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>Backend unavailable: {backendError}. Ensure FastAPI is running at {API_BASE_URL}.</span>
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
                  autoFollow={autoFollow}
                  onToggleAutoFollow={() => setAutoFollow((prev) => !prev)}
                  activeJobs={jobs.filter((j) => j.status === 'PROCESSING')}
                  onSelectJob={(j) => {
                    setSelectedJob(j);
                    selectedJobIdRef.current = j.id;
                  }}
                />
              </div>
            </section>

            {/* 3. QUEUE STATE SECTION (4 Distinct Cards) */}
            <QueueStateSection
              queueDepth={queueDepth}
              jobs={jobs}
              onSelectJob={handleManualSelectJob}
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
              onSelectJob={handleManualSelectJob}
              onInspectPayload={(j) => setInspectingJob(j)}
              onJobUpdated={handleJobUpdated}
            />
          </div>
        </main>

      {/* Payload Inspection Modal */}
      {inspectingJob && (
        <PayloadInspectModal
          job={inspectingJob}
          onClose={() => setInspectingJob(null)}
        />
      )}

      {/* Hard Reset Confirmation Modal */}
      <HardResetModal
        isOpen={isHardResetModalOpen}
        onClose={() => setIsHardResetModalOpen(false)}
        onSuccess={handleHardResetSuccess}
      />
    </div>
  );
}
