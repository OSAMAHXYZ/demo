import cron from 'node-cron';
import { config } from '../config.js';
import { executeTask } from '../automation/runner.js';
import { id, now, one, rows, run } from '../database/db.js';
import { zonedParts } from '../services/variables.js';

interface ScheduleRow {
  id: string;
  task_id: string;
  frequency: string;
  time_of_day: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  cron_expr: string | null;
  run_at: string | null;
  timezone: string;
  active: number;
}

const jobs = new Map<string, cron.ScheduledTask>();

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toCron(schedule: ScheduleRow) {
  if (schedule.frequency === 'cron') return schedule.cron_expr || '';
  if (schedule.frequency === 'once' && schedule.run_at) {
    const date = new Date(schedule.run_at);
    const parts = zonedParts(date, schedule.timezone || config.timezone);
    return `${Number(parts.minute)} ${Number(parts.hour)} ${Number(parts.day)} ${Number(parts.month)} *`;
  }
  const [hour, minute] = String(schedule.time_of_day || '09:00').split(':').map((part) => Number(part) || 0);
  if (schedule.frequency === 'weekly') return `${minute} ${hour} * * ${schedule.day_of_week ?? 0}`;
  if (schedule.frequency === 'monthly') return `${minute} ${hour} ${schedule.day_of_month ?? 1} * *`;
  return `${minute} ${hour} * * *`;
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = zonedParts(new Date(guess), timeZone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (asUtc - guess));
}

export function nextRunAt(schedule: ScheduleRow) {
  const zone = schedule.timezone || config.timezone;
  if (schedule.frequency === 'once' && schedule.run_at) return schedule.run_at;
  const expr = toCron(schedule);
  if (!cron.validate(expr)) return null;
  const [minute, hour, day, month, weekday] = expr.split(' ');
  const start = Date.now();
  for (let offset = 1; offset < 60 * 24 * 62; offset += 1) {
    const date = new Date(start + offset * 60000);
    const parts = zonedParts(date, zone);
    const checks: Array<[string, string]> = [
      [minute, String(Number(parts.minute))],
      [hour, String(Number(parts.hour))],
      [day, String(Number(parts.day))],
      [month, String(Number(parts.month))],
    ];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const week = String(weekdays.indexOf(parts.weekday));
    if (checks.every(([field, value]) => field === '*' || field.split(',').includes(value)) && (weekday === '*' || weekday === week)) {
      return zonedToUtc(Number(parts.year), Number(parts.month), Number(parts.day), Number(parts.hour), Number(parts.minute), zone).toISOString();
    }
  }
  return null;
}

async function fire(schedule: ScheduleRow) {
  const parts = zonedParts(new Date(), schedule.timezone || config.timezone);
  const windowKey = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${pad(Number(parts.minute))}`;
  try {
    run('INSERT INTO run_locks (task_id, window_key, created_at) VALUES (?, ?, ?)', schedule.task_id, `${schedule.id}:${windowKey}`, now());
  } catch {
    return;
  }
  try {
    await executeTask(schedule.task_id, 'schedule', schedule.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled run failed';
    run(
      'INSERT INTO runs (id, task_id, schedule_id, status, trigger, started_at, ended_at, error, recovered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      id(), schedule.task_id, schedule.id, 'FAILED', 'schedule', now(), now(), message,
    );
  }
  if (schedule.frequency === 'once') {
    run('UPDATE schedules SET active = 0, next_run_at = NULL WHERE id = ?', schedule.id);
    reloadSchedules();
    return;
  }
  const next = nextRunAt(schedule);
  run('UPDATE schedules SET next_run_at = ? WHERE id = ?', next, schedule.id);
}

export function reloadSchedules() {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
  const schedules = rows<ScheduleRow>('SELECT * FROM schedules WHERE active = 1');
  for (const schedule of schedules) {
    const expr = toCron(schedule);
    if (!cron.validate(expr)) continue;
    const job = cron.schedule(expr, () => { void fire(schedule); }, { timezone: schedule.timezone || config.timezone });
    jobs.set(schedule.id, job);
    run('UPDATE schedules SET next_run_at = ? WHERE id = ?', nextRunAt(schedule), schedule.id);
  }
}

export function assertCron(expr: string) {
  if (!/^[\d*/,\-\s]+$/.test(expr) || expr.trim().split(/\s+/).length !== 5 || !cron.validate(expr)) {
    throw new Error('Custom schedule must be a 5-field cron expression.');
  }
}
