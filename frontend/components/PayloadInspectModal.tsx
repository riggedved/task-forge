'use client';

import React, { useState } from 'react';
import { Job } from '../types';

interface PayloadInspectModalProps {
  job: Job | null;
  onClose: () => void;
}

export const PayloadInspectModal: React.FC<PayloadInspectModalProps> = ({
  job,
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  if (!job) return null;

  const jsonString = JSON.stringify(job.payload || {}, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        className="w-full max-w-2xl bg-surface-container-low rounded-xl shadow-2xl border border-surface-container-high flex flex-col overflow-hidden animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-md py-space-sm bg-surface-container flex items-center justify-between border-b border-surface-container-high/40">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[20px]">
              data_object
            </span>
            <span className="font-headline-sm text-headline-sm text-on-surface">
              Inspect Job #{job.id} ({job.type})
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Metadata chip bar */}
        <div className="px-space-md py-space-xs bg-surface-container-lowest/60 flex items-center gap-space-md font-mono-sm text-mono-sm text-on-surface-variant border-b border-surface-container-high/20 flex-wrap">
          <div>
            Status: <span className="text-tertiary font-semibold">{job.status}</span>
          </div>
          <div>
            Priority: <span className="text-on-surface font-semibold">{job.priority}</span>
          </div>
          <div>
            Retries: <span className="text-on-surface font-semibold">{job.retry_count}/3</span>
          </div>
          {job.idempotency_key && (
            <div className="truncate max-w-[200px]">
              Key: <span className="text-primary font-semibold">{job.idempotency_key}</span>
            </div>
          )}
        </div>

        {/* JSON Payload body */}
        <div className="p-space-md bg-surface-container-lowest overflow-y-auto max-h-[60vh]">
          <pre className="font-mono-sm text-mono-sm text-tertiary leading-relaxed selection:bg-primary selection:text-on-primary">
            {jsonString}
          </pre>
        </div>

        {/* Footer actions */}
        <div className="px-space-md py-space-sm bg-surface-container flex items-center justify-between border-t border-surface-container-high/40">
          <button
            type="button"
            onClick={handleCopy}
            className="px-space-sm py-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono-sm text-mono-sm flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span>{copied ? 'Copied to Clipboard' : 'Copy JSON'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-space-md py-1.5 rounded bg-primary text-on-primary hover:bg-primary-fixed-dim font-mono-sm text-mono-sm font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
