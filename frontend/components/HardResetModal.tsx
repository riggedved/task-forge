'use client';

import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';

interface HardResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const HardResetModal: React.FC<HardResetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirmReset = async () => {
    setIsResetting(true);
    setError(null);

    try {
      await api.adminHardReset();
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err?.message || 'Unable to reset Task Forge. Please verify backend connectivity.';
      setError(msg);
    } finally {
      setIsResetting(false);
    }
  };

  const handleClose = () => {
    if (isResetting) return;
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-surface-container-low rounded-xl shadow-2xl border border-error/40 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-md py-space-sm bg-surface-container flex items-center justify-between border-b border-surface-container-high/40">
          <div className="flex items-center gap-space-xs text-error">
            <span className="material-symbols-outlined text-[24px]">warning</span>
            <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Hard Reset Task Forge?
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isResetting}
            className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-space-lg flex flex-col gap-space-md">
          <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">
            This will permanently remove all current jobs, job history, queue state, and managed workers.
          </p>

          {/* Action consequences callout */}
          <div className="p-space-sm rounded-lg bg-surface-container-lowest/80 border border-outline-variant/30 flex flex-col gap-1 font-mono-sm text-[12px] text-on-surface-variant">
            <div className="flex items-center gap-1.5 text-error font-semibold">
              <span className="material-symbols-outlined text-[14px]">delete_forever</span>
              <span>The following runtime state will be erased:</span>
            </div>
            <div className="pl-4 flex flex-col gap-0.5 text-on-surface-variant/80">
              <div>&bull; Stop and clear all managed Python workers</div>
              <div>&bull; Purge Redis queues (ready, processing, delayed, failed)</div>
              <div>&bull; Delete PostgreSQL jobs &amp; activity event history</div>
              <div>&bull; Clear worker registry and heartbeats</div>
            </div>
          </div>

          <p className="font-mono-sm text-mono-sm text-error/90 font-medium">
            This action cannot be undone.
          </p>

          {/* Error Message */}
          {error && (
            <div className="p-space-sm rounded bg-error-container text-on-error-container font-mono-sm text-[12px] flex items-start gap-space-xs border border-error/40">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
              <div className="flex-1">
                <div className="font-semibold">Reset Failed</div>
                <div className="opacity-90">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-space-md py-space-sm bg-surface-container flex items-center justify-end gap-space-sm border-t border-surface-container-high/40">
          <button
            type="button"
            onClick={handleClose}
            disabled={isResetting}
            className="px-space-md py-space-xs rounded bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono-sm text-mono-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmReset}
            disabled={isResetting}
            className="px-space-md py-space-xs rounded bg-error text-on-error hover:bg-error/90 font-mono-sm text-mono-sm font-semibold transition-all flex items-center gap-space-xs shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Resetting Task Forge...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>Hard Reset</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
