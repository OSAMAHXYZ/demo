export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as { error?: string } : {};
  if (!response.ok) throw new ApiError(data.error || 'Request failed');
  return data as T;
}

export interface Step {
  id?: string;
  position?: number;
  type: string;
  label: string;
  url?: string | null;
  value?: string | null;
  selectors?: Record<string, string>;
  timeout_ms?: number | null;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  profile_id: string | null;
  steps: Step[];
  schedule: { id: string; frequency: string; time_of_day: string | null; timezone: string; active: number; label: string; next_run_at: string | null; day_of_week: number | null; day_of_month: number | null; cron_expr: string | null } | null;
  lastRun: { id: string; status: string; started_at: string } | null;
  successRate: number | null;
  runCount: number;
}

export const ACTION_TYPES = ['OPEN_URL', 'CLICK', 'TYPE', 'SELECT', 'PRESS_KEY', 'WAIT', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'SCREENSHOT', 'EXTRACT_TEXT', 'EXTRACT_TABLE', 'CONDITIONAL', 'LOOP', 'VERIFY', 'AI_ACTION'] as const;

export function clock(value?: string | null, withDate = false) {
  if (!value) return '—';
  const date = value.includes('T') ? new Date(value) : new Date(`2026-01-01T${value}:00`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    hour: 'numeric',
    minute: '2-digit',
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
  }).format(date);
}

export function elapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}
