'use client';

import React, { useState, useEffect } from 'react';
import { Job, JobCreateRequest } from '../types';
import { generateIdempotencyKey } from '../lib/utils';
import { api, ApiError } from '../lib/api';

interface CreateJobPanelProps {
  onJobCreated: (newJob: Job) => void;
  cloneJobData?: Job | null;
}

const TEMPLATES: Record<string, string> = {
  email: JSON.stringify(
    {
      recipient: 'eng-leads@taskforge.dev',
      template: 'weekly_metrics_digest',
      cluster_id: 'us-east-42',
      user_id: 42,
    },
    null,
    2
  ),
  image_processing: JSON.stringify(
    {
      asset_id: 'img_9801_raw.png',
      operations: ['thumbnail_webp', 'blur_hash', 'strip_exif'],
      destination_bucket: 's3://assets.taskforge.dev/cdn/',
    },
    null,
    2
  ),
  data_export: JSON.stringify(
    {
      organization_id: 'org_alpha_9',
      format: 'parquet',
      filters: { created_after: '2026-01-01T00:00:00Z' },
      notify_webhook: 'https://api.internal/v1/webhook',
    },
    null,
    2
  ),
  notification: JSON.stringify(
    {
      channel: 'slack_ops',
      severity: 'warning',
      message: 'Worker node pool memory crossed threshold',
      delivery_window: 'immediate',
    },
    null,
    2
  ),
  fail: JSON.stringify(
    {
      trigger_synthetic_failure: true,
      error_class: 'SimulatedWorkerError',
      retry_budget: 3,
    },
    null,
    2
  ),
};

export const CreateJobPanel: React.FC<CreateJobPanelProps> = ({
  onJobCreated,
  cloneJobData,
}) => {
  const [jobType, setJobType] = useState<string>('email');
  const [priority, setPriority] = useState<number>(10);
  const [delaySeconds, setDelaySeconds] = useState<number>(0);
  const [payloadText, setPayloadText] = useState<string>(TEMPLATES['email']);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Handle clone action from Live Job
  useEffect(() => {
    if (cloneJobData) {
      setJobType(cloneJobData.type);
      setPriority(cloneJobData.priority);
      setPayloadText(JSON.stringify(cloneJobData.payload || {}, null, 2));
      setIdempotencyKey(generateIdempotencyKey());
      setErrorMsg(null);
      setSuccessMsg(`Cloned settings from Job #${cloneJobData.id}`);
    }
  }, [cloneJobData]);

  const handleTypeChange = (type: string) => {
    setJobType(type);
    if (TEMPLATES[type]) {
      setPayloadText(TEMPLATES[type]);
    }
    setErrorMsg(null);
  };

  const handleFormatPayload = () => {
    try {
      const parsed = JSON.parse(payloadText);
      setPayloadText(JSON.stringify(parsed, null, 2));
      setErrorMsg(null);
    } catch (e: any) {
      setErrorMsg(`Invalid JSON: ${e.message}`);
    }
  };

  const handleResetPayload = () => {
    setPayloadText(TEMPLATES[jobType] || '{}');
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    let parsedPayload: Record<string, any>;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch (e: any) {
      setErrorMsg(`JSON Syntax Error: ${e.message}`);
      return;
    }

    const payload: JobCreateRequest = {
      type: jobType,
      payload: parsedPayload,
      priority,
      delay_seconds: delaySeconds,
      idempotency_key: idempotencyKey.trim() || undefined,
    };

    setIsSubmitting(true);
    try {
      const newJob = await api.createJob(payload);
      setSuccessMsg(`Job #${newJob.id} created successfully (${newJob.status})!`);
      setIdempotencyKey(generateIdempotencyKey());
      onJobCreated(newJob);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit job to cluster.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const priorityLabel =
    priority === 10 ? 'P10 (Urgent)' : priority === 5 ? 'P5 (Standard)' : 'P1 (Background)';
  const delayLabel = delaySeconds === 0 ? '0s (Immediate)' : `${delaySeconds}s delay`;

  const linesCount = payloadText.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(linesCount, 6) }, (_, i) => i + 1);

  return (
    <div id="create-job" className="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-md border border-surface-container-high/30">
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[20px]">queue</span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
              Create Job
            </h2>
          </div>
          <span className="px-space-xs py-0.5 rounded bg-surface-container font-mono-sm text-mono-sm text-primary font-medium">
            POST /create-job
          </span>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
          Submit an asynchronous task into the distributed priority pipeline.
        </p>
      </div>

      {errorMsg && (
        <div className="p-space-sm rounded bg-error-container text-on-error-container text-body-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-on-error-container font-mono-sm">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-space-sm rounded bg-primary-container text-on-primary-container text-body-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-on-primary-container font-mono-sm">✕</button>
        </div>
      )}

      <form
        className="flex flex-col gap-space-md"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Job Type Selector */}
        <div className="flex flex-col gap-space-xs">
          <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            Job Type
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-space-xs">
            {[
              { type: 'email', label: 'email' },
              { type: 'image_processing', label: 'image' },
              { type: 'data_export', label: 'export' },
              { type: 'notification', label: 'notify' },
              { type: 'fail', label: 'fail' },
            ].map(({ type, label }) => {
              const isActive = jobType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTypeChange(type)}
                  className={`py-space-xs px-1 rounded font-mono-sm text-mono-sm text-center transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-primary-container text-on-primary-container font-medium'
                      : type === 'fail'
                      ? 'bg-surface-container text-on-surface-variant hover:text-error'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Priority & Delay Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          {/* Priority */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                Priority
              </label>
              <span className="font-mono-sm text-mono-sm text-tertiary font-semibold">
                {priorityLabel}
              </span>
            </div>
            <div className="flex items-center gap-space-xs bg-surface-container rounded p-space-xs">
              {[1, 5, 10].map((p) => {
                const isSelected = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <span className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight">
              Higher priority pops ahead via Redis ZSET (-priority score).
            </span>
          </div>

          {/* Delay */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                Delay (Seconds)
              </label>
              <span className="font-mono-sm text-mono-sm text-on-surface">
                {delayLabel}
              </span>
            </div>
            <div className="flex items-center gap-space-xs bg-surface-container rounded p-space-xs">
              {[0, 5, 30, 60].map((d) => {
                const isSelected = delaySeconds === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDelaySeconds(d)}
                    className={`flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {d}s
                  </button>
                );
              })}
            </div>
            <span className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight">
              Delayed tasks stage into delayed_queue ZSET first.
            </span>
          </div>
        </div>

        {/* Payload Editor */}
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <label className="font-label-caps text-label-caps uppercase text-on-surface-variant flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-[14px]">data_object</span>
              <span>Payload (JSON)</span>
            </label>
            <div className="flex items-center gap-space-xs">
              <button
                type="button"
                onClick={handleFormatPayload}
                className="font-mono-sm text-mono-sm text-primary hover:underline cursor-pointer"
              >
                Format
              </button>
              <span className="text-on-surface-variant opacity-40">|</span>
              <button
                type="button"
                onClick={handleResetPayload}
                className="font-mono-sm text-mono-sm text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="relative rounded bg-surface-container-lowest overflow-hidden shadow-inner border border-surface-container-high/40">
            <div className="flex items-stretch">
              {/* Line numbers gutter */}
              <div className="select-none py-space-sm px-space-xs font-mono-sm text-mono-sm text-on-surface-variant opacity-40 text-right w-8 bg-surface-container-low flex flex-col leading-5 border-r border-surface-container-high/30">
                {lineNumbers.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                autoComplete="off"
                rows={6}
                spellCheck="false"
                className="w-full bg-transparent text-tertiary font-mono-sm text-mono-sm leading-5 p-space-sm focus:outline-none resize-none selection:bg-primary selection:text-on-primary"
              />
            </div>
          </div>
        </div>

        {/* Idempotency Key */}
        <div className="flex flex-col gap-space-xs">
          <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            Idempotency Key
          </label>
          <div className="flex items-center rounded bg-surface-container px-space-sm py-1.5 focus-within:ring-1 focus-within:ring-primary border border-surface-container-high/30">
            <span className="material-symbols-outlined text-on-surface-variant text-[16px] mr-space-xs">
              fingerprint
            </span>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="e.g. idemp_8fa93c21a4"
              className="w-full bg-transparent font-mono-sm text-mono-sm text-on-surface focus:outline-none placeholder:text-on-surface-variant/40"
            />
            <button
              type="button"
              onClick={() => setIdempotencyKey(generateIdempotencyKey())}
              title="Regenerate Key"
              className="text-on-surface-variant hover:text-on-surface cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant text-[11px]">
            Guarantees at-most-once processing across cluster workers via PostgreSQL UNIQUE constraint.
          </span>
        </div>

        {/* Submit Button CTA */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full mt-space-xs py-space-sm px-space-md rounded bg-primary text-on-primary font-mono-md text-mono-md font-semibold hover:bg-primary-fixed-dim transition-all duration-150 flex items-center justify-center gap-space-sm shadow-[0_0_16px_rgba(192,193,255,0.25)] active:scale-[0.98] cursor-pointer disabled:opacity-60"
        >
          <span className={`material-symbols-outlined text-[20px] ${isSubmitting ? 'animate-spin' : ''}`}>
            bolt
          </span>
          <span>{isSubmitting ? 'CREATING JOB...' : 'CREATE JOB'}</span>
          <span className="ml-space-xs font-mono-sm text-mono-sm px-space-xs py-0.5 rounded bg-on-primary/20 text-on-primary">
            ⌘↵
          </span>
        </button>
      </form>
    </div>
  );
};
