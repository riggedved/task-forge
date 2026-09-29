export function formatTimestamp(epochSeconds?: number | null): string {
  if (!epochSeconds) return '—';
  const d = new Date(epochSeconds * 1000);
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 1);
}

export function formatTimeAgo(epochSeconds?: number | null): string {
  if (!epochSeconds) return '';
  const now = Date.now() / 1000;
  const diff = Math.max(0, Math.floor(now - epochSeconds));
  if (diff < 2) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(2)}s`;
}

export function generateIdempotencyKey(): string {
  return 'idemp_' + Math.random().toString(16).substring(2, 12);
}
