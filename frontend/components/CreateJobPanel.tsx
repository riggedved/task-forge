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
      duration: 10,
    },
    null,
    2
  ),
  image_processing: JSON.stringify(
    {
      asset_id: 'img_9801_raw.png',
      operations: ['thumbnail_webp', 'blur_hash', 'strip_exif'],
      destination_bucket: 's3://assets.taskforge.dev/cdn/',
      duration: 10,
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
      duration: 10,
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
      duration: 10,
    },
    null,
    2
  ),
  fail: JSON.stringify(
    {
      trigger_synthetic_failure: true,
      error_class: 'SimulatedWorkerError',
      retry_budget: 3,
      duration: 10,
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

  // Priority state
  const [priority, setPriority] = useState<number>(10);
  const [isCustomPriority, setIsCustomPriority] = useState<boolean>(false);
  const [customPriorityInput, setCustomPriorityInput] = useState<string>('25');

  // Duration state (seconds)
  const [duration, setDuration] = useState<number>(10);
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false);
  const [customDurationInput, setCustomDurationInput] = useState<string>('15');

  // Delay state (seconds)
  const [delaySeconds, setDelaySeconds] = useState<number>(0);
  const [isCustomDelay, setIsCustomDelay] = useState<boolean>(false);
  const [customDelayInput, setCustomDelayInput] = useState<string>('120');

  // Payload & Submission state
  const [payloadText, setPayloadText] = useState<string>(TEMPLATES['email']);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Helper to sync duration into payload JSON if currently valid
  const updatePayloadDuration = (d: number) => {
    try {
      const parsed = JSON.parse(payloadText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        parsed.duration = d;
        setPayloadText(JSON.stringify(parsed, null, 2));
      }
    } catch {
      // payloadText may be currently edited or invalid JSON, ignore
    }
  };

  // Handle clone action from Live Job
  useEffect(() => {
    if (cloneJobData) {
      setJobType(cloneJobData.type);

      // Restore priority
      const p = cloneJobData.priority;
      setPriority(p);
      if ([1, 5, 10].includes(p)) {
        setIsCustomPriority(false);
      } else {
        setIsCustomPriority(true);
        setCustomPriorityInput(String(p));
      }

      // Restore duration if present in payload
      const payloadDuration = cloneJobData.payload?.duration;
      if (typeof payloadDuration === 'number') {
        setDuration(payloadDuration);
        if ([10, 30, 60].includes(payloadDuration)) {
          setIsCustomDuration(false);
        } else {
          setIsCustomDuration(true);
          setCustomDurationInput(String(payloadDuration));
        }
      }

      setPayloadText(JSON.stringify(cloneJobData.payload || {}, null, 2));
      setIdempotencyKey(generateIdempotencyKey());
      setErrorMsg(null);
      setSuccessMsg(`Cloned settings from Job #${cloneJobData.id}`);
    }
  }, [cloneJobData]);

  const handleTypeChange = (type: string) => {
    setJobType(type);
    if (TEMPLATES[type]) {
      try {
        const parsed = JSON.parse(TEMPLATES[type]);
        parsed.duration = duration;
        setPayloadText(JSON.stringify(parsed, null, 2));
      } catch {
        setPayloadText(TEMPLATES[type]);
      }
    }
    setErrorMsg(null);
  };

  // Priority handlers
  const handleSelectPriorityPreset = (p: number) => {
    setIsCustomPriority(false);
    setPriority(p);
  };

  const handleSelectCustomPriority = () => {
    setIsCustomPriority(true);
    const parsed = parseInt(customPriorityInput, 10);
    const valid = isNaN(parsed) || parsed < 1 ? 25 : parsed;
    setCustomPriorityInput(String(valid));
    setPriority(valid);
  };

  const handleCustomPriorityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomPriorityInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      setPriority(parsed);
    }
  };

  // Duration handlers
  const handleSelectDurationPreset = (d: number) => {
    setIsCustomDuration(false);
    setDuration(d);
    updatePayloadDuration(d);
  };

  const handleSelectCustomDuration = () => {
    setIsCustomDuration(true);
    const parsed = parseInt(customDurationInput, 10);
    const valid = isNaN(parsed) || parsed < 1 ? 15 : parsed;
    setCustomDurationInput(String(valid));
    setDuration(valid);
    updatePayloadDuration(valid);
  };

  const handleCustomDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomDurationInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      setDuration(parsed);
      updatePayloadDuration(parsed);
    }
  };

  // Delay handlers
  const handleSelectDelayPreset = (d: number) => {
    setIsCustomDelay(false);
    setDelaySeconds(d);
  };

  const handleSelectCustomDelay = () => {
    setIsCustomDelay(true);
    const parsed = parseInt(customDelayInput, 10);
    const valid = isNaN(parsed) || parsed < 0 ? 120 : parsed;
    setCustomDelayInput(String(valid));
    setDelaySeconds(valid);
  };

  const handleCustomDelayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomDelayInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setDelaySeconds(parsed);
    }
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
    if (TEMPLATES[jobType]) {
      try {
        const parsed = JSON.parse(TEMPLATES[jobType]);
        parsed.duration = duration;
        setPayloadText(JSON.stringify(parsed, null, 2));
      } catch {
        setPayloadText(TEMPLATES[jobType] || '{}');
      }
    } else {
      setPayloadText('{}');
    }
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validate Priority
    const effectivePriority = isCustomPriority ? parseInt(customPriorityInput, 10) : priority;
    if (isNaN(effectivePriority) || effectivePriority < 1) {
      setErrorMsg('Priority must be a valid positive integer (≥ 1).');
      return;
    }

    // Validate Duration
    const effectiveDuration = isCustomDuration ? parseInt(customDurationInput, 10) : duration;
    if (isNaN(effectiveDuration) || effectiveDuration < 1) {
      setErrorMsg('Duration must be a valid positive number of seconds (≥ 1).');
      return;
    }

    // Validate Delay
    const effectiveDelay = isCustomDelay ? parseInt(customDelayInput, 10) : delaySeconds;
    if (isNaN(effectiveDelay) || effectiveDelay < 0) {
      setErrorMsg('Delay must be a valid non-negative integer (≥ 0).');
      return;
    }

    let parsedPayload: Record<string, any>;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch (e: any) {
      setErrorMsg(`JSON Syntax Error: ${e.message}`);
      return;
    }

    // Ensure selected duration is in payload
    parsedPayload.duration = effectiveDuration;

    const payload: JobCreateRequest = {
      type: jobType,
      payload: parsedPayload,
      priority: effectivePriority,
      delay_seconds: effectiveDelay,
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

  const priorityLabel = isCustomPriority
    ? `P${priority} (Custom)`
    : priority === 10
    ? 'P10 (Urgent)'
    : priority === 5
    ? 'P5 (Standard)'
    : 'P1 (Background)';

  const durationLabel = isCustomDuration
    ? `${duration}s (Custom)`
    : `${duration}s (${duration === 10 ? 'Default' : duration === 30 ? 'Medium' : 'Long'})`;

  const delayLabel = isCustomDelay
    ? `${delaySeconds}s (Custom)`
    : delaySeconds === 0
    ? '0s (Immediate)'
    : `${delaySeconds}s delay`;

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
          <button onClick={() => setErrorMsg(null)} className="text-on-error-container font-mono-sm cursor-pointer">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-space-sm rounded bg-primary-container text-on-primary-container text-body-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-on-primary-container font-mono-sm cursor-pointer">✕</button>
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
        {/* 1. Job Type Selector */}
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

        {/* 2. Priority Row */}
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
              Priority
            </label>
            <span className="font-mono-sm text-mono-sm text-tertiary font-semibold">
              {priorityLabel}
            </span>
          </div>
          <div className="flex items-center gap-space-xs bg-surface-container rounded p-space-xs flex-wrap sm:flex-nowrap">
            {[1, 5, 10].map((p) => {
              const isSelected = !isCustomPriority && priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSelectPriorityPreset(p)}
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
            {!isCustomPriority ? (
              <button
                type="button"
                onClick={handleSelectCustomPriority}
                className="flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer text-on-surface-variant hover:text-on-surface"
              >
                Custom
              </button>
            ) : (
              <div className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-0.5 px-2 rounded bg-primary text-on-primary font-mono-sm text-mono-sm font-semibold transition-all">
                <span className="text-[12px] whitespace-nowrap">Custom:</span>
                <input
                  type="number"
                  min={1}
                  value={customPriorityInput}
                  onChange={handleCustomPriorityChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-12 px-1 py-0.5 rounded bg-surface-container-lowest text-on-surface text-center font-mono-sm text-[12px] font-medium focus:outline-none focus:ring-1 focus:ring-secondary border border-surface-container-high/60"
                  placeholder="25"
                />
              </div>
            )}
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight">
            Higher priority pops ahead via Redis ZSET (-priority score).
          </span>
        </div>

        {/* 3. Duration Row */}
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
              Duration (Seconds)
            </label>
            <span className="font-mono-sm text-mono-sm text-tertiary font-semibold">
              {durationLabel}
            </span>
          </div>
          <div className="flex items-center gap-space-xs bg-surface-container rounded p-space-xs flex-wrap sm:flex-nowrap">
            {[10, 30, 60].map((d) => {
              const isSelected = !isCustomDuration && duration === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleSelectDurationPreset(d)}
                  className={`flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {d}
                </button>
              );
            })}
            {!isCustomDuration ? (
              <button
                type="button"
                onClick={handleSelectCustomDuration}
                className="flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer text-on-surface-variant hover:text-on-surface"
              >
                Custom
              </button>
            ) : (
              <div className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-0.5 px-2 rounded bg-primary text-on-primary font-mono-sm text-mono-sm font-semibold transition-all">
                <span className="text-[12px] whitespace-nowrap">Custom:</span>
                <input
                  type="number"
                  min={1}
                  value={customDurationInput}
                  onChange={handleCustomDurationChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-12 px-1 py-0.5 rounded bg-surface-container-lowest text-on-surface text-center font-mono-sm text-[12px] font-medium focus:outline-none focus:ring-1 focus:ring-secondary border border-surface-container-high/60"
                  placeholder="15"
                />
              </div>
            )}
          </div>
        </div>

        {/* 4. Delay Row */}
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <label className="font-label-caps text-label-caps uppercase text-on-surface-variant">
              Delay (Seconds)
            </label>
            <span className="font-mono-sm text-mono-sm text-on-surface">
              {delayLabel}
            </span>
          </div>
          <div className="flex items-center gap-space-xs bg-surface-container rounded p-space-xs flex-wrap sm:flex-nowrap">
            {[0, 5, 30, 60].map((d) => {
              const isSelected = !isCustomDelay && delaySeconds === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleSelectDelayPreset(d)}
                  className={`flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {d}
                </button>
              );
            })}
            {!isCustomDelay ? (
              <button
                type="button"
                onClick={handleSelectCustomDelay}
                className="flex-1 py-1 rounded text-center font-mono-sm text-mono-sm transition-colors cursor-pointer text-on-surface-variant hover:text-on-surface"
              >
                Custom
              </button>
            ) : (
              <div className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-0.5 px-2 rounded bg-primary text-on-primary font-mono-sm text-mono-sm font-semibold transition-all">
                <span className="text-[12px] whitespace-nowrap">Custom:</span>
                <input
                  type="number"
                  min={0}
                  value={customDelayInput}
                  onChange={handleCustomDelayChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-14 px-1 py-0.5 rounded bg-surface-container-lowest text-on-surface text-center font-mono-sm text-[12px] font-medium focus:outline-none focus:ring-1 focus:ring-secondary border border-surface-container-high/60"
                  placeholder="120"
                />
              </div>
            )}
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight">
            Delayed tasks stage into delayed_queue ZSET first.
          </span>
        </div>

        {/* 5. Payload Editor */}
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

        {/* 6. Idempotency Key */}
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

        {/* 7. Submit Button CTA */}
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
