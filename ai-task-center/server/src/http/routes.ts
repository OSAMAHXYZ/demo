import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z, ZodError } from 'zod';
import { analyzeRecording, recoverStep, type RawAction } from '../ai/service.js';
import { listActions, pauseRecording, recordingStatus, startRecording, stopRecording } from '../automation/recorder.js';
import { cancelTask, executeTask, testOneStep } from '../automation/runner.js';
import { aiConfigured, config } from '../config.js';
import { decrypt, encrypt, mask } from '../crypto/secrets.js';
import { id, now, one, rows, run } from '../database/db.js';
import { assertCron, nextRunAt, reloadSchedules, toCron } from '../scheduler/engine.js';
import { formatDate, publicVariables, builtinVariables } from '../services/variables.js';

const ACTIONS = ['OPEN_URL', 'CLICK', 'TYPE', 'SELECT', 'PRESS_KEY', 'WAIT', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'SCREENSHOT', 'EXTRACT_TEXT', 'EXTRACT_TABLE', 'CONDITIONAL', 'LOOP', 'VERIFY', 'AI_ACTION'] as const;
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Control+A', 'Control+C', 'Control+V']);

const stepSchema = z.object({
  type: z.enum(ACTIONS),
  label: z.string().trim().min(1).max(200),
  url: z.string().max(2000).nullable().optional(),
  value: z.string().max(4000).nullable().optional(),
  selectors: z.record(z.string().max(500)).optional(),
  timeoutMs: z.number().int().min(0).max(60000).nullable().optional(),
});

const taskSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  profileId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
  steps: z.array(stepSchema).max(80).optional(),
});

const scheduleSchema = z.object({
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly', 'cron']),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  cron: z.string().max(80).optional(),
  runAt: z.string().max(40).optional(),
  timezone: z.string().min(1).max(64).default(config.timezone),
  active: z.boolean().default(true),
});

function checkUrl(value: string | null | undefined) {
  if (!value) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a full http or https address.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses are allowed.');
}

function checkStep(step: z.infer<typeof stepSchema>) {
  if (step.type === 'OPEN_URL') checkUrl(step.value || step.url);
  if (step.type === 'PRESS_KEY' && step.value && !KEYS.has(step.value)) throw new Error('That key is not allowed.');
  if (step.type === 'WAIT' && step.value && Number.isNaN(Number(step.value))) throw new Error('Wait must be a number of milliseconds.');
}

function saveSteps(taskId: string, steps: z.infer<typeof stepSchema>[]) {
  run('DELETE FROM task_steps WHERE task_id = ?', taskId);
  steps.forEach((step, index) => {
    checkStep(step);
    run(
      'INSERT INTO task_steps (id, task_id, position, type, label, url, value, selectors_json, timeout_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id(), taskId, index + 1, step.type, step.label, step.url || null, step.value ?? null, JSON.stringify(step.selectors || {}), step.timeoutMs ?? null,
    );
  });
}

function scheduleLabel(row: { frequency: string; time_of_day: string | null; day_of_week: number | null; day_of_month: number | null; cron_expr: string | null; timezone: string }) {
  const time = row.time_of_day || '';
  const clock = time ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2026-01-01T${time}:00`)) : '';
  if (row.frequency === 'daily') return `Every day at ${clock}`;
  if (row.frequency === 'weekly') return `Weekly at ${clock}`;
  if (row.frequency === 'monthly') return `Monthly on day ${row.day_of_month} at ${clock}`;
  if (row.frequency === 'cron') return row.cron_expr || 'Custom';
  return 'Run once';
}

function taskView(taskId: string) {
  const task = one<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!task) return null;
  const steps = rows('SELECT * FROM task_steps WHERE task_id = ? ORDER BY position', taskId).map((step) => ({
    ...step,
    selectors: JSON.parse(String(step.selectors_json || '{}')),
  }));
  const schedule = one<Record<string, unknown>>('SELECT * FROM schedules WHERE task_id = ? ORDER BY active DESC LIMIT 1', taskId);
  const taskRuns = rows<{ status: string; started_at: string; id: string }>('SELECT id, status, started_at FROM runs WHERE task_id = ? ORDER BY started_at DESC', taskId);
  const finished = taskRuns.filter((item) => item.status === 'SUCCESS' || item.status === 'FAILED' || item.status === 'RECOVERED');
  const good = finished.filter((item) => item.status === 'SUCCESS' || item.status === 'RECOVERED').length;
  return {
    ...task,
    steps,
    schedule: schedule ? { ...schedule, label: scheduleLabel(schedule as never) } : null,
    lastRun: taskRuns[0] || null,
    successRate: finished.length ? Math.round((good / finished.length) * 100) : null,
    runCount: taskRuns.length,
  };
}

function duration(start: string, end: string | null) {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: aiConfigured(), timezone: config.timezone });
});

router.get('/dashboard', (_req, res) => {
  const tasks = rows<{ id: string; name: string; status: string }>('SELECT id, name, status FROM tasks');
  const schedules = rows<{ id: string; task_id: string; active: number; time_of_day: string | null; next_run_at: string | null; frequency: string }>('SELECT id, task_id, active, time_of_day, next_run_at, frequency FROM schedules');
  const runsAll = rows<{ id: string; task_id: string; status: string; started_at: string; ended_at: string | null; failed_step: number | null; recovered: number; trigger: string }>('SELECT id, task_id, status, started_at, ended_at, failed_step, recovered, trigger FROM runs ORDER BY started_at DESC');
  const today = formatDate(new Date(), config.timezone);
  const nameOf = (taskId: string) => tasks.find((task) => task.id === taskId)?.name || 'Task';
  const stepCount = (runId: string) => Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM run_steps WHERE run_id = ?', runId)?.n || 0);
  const shot = (runId: string) => one<{ id: string }>('SELECT id FROM screenshots WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', runId)?.id || null;
  const todayRuns = runsAll.filter((item) => formatDate(new Date(item.started_at), config.timezone) === today);
  const success = runsAll.filter((item) => item.status === 'SUCCESS' || item.status === 'RECOVERED').length;
  const failed = runsAll.filter((item) => item.status === 'FAILED').length;
  const finished = success + failed;
  res.json({
    kpis: {
      active: tasks.filter((task) => task.status === 'active').length,
      scheduled: schedules.filter((item) => item.active).length,
      success,
      failed,
      successRate: finished ? Math.round((success / finished) * 100) : 0,
      runningToday: new Set(todayRuns.map((item) => item.task_id)).size,
    },
    recent: runsAll.slice(0, 8).map((item) => ({
      id: item.id,
      taskId: item.task_id,
      task: nameOf(item.task_id),
      startedAt: item.started_at,
      duration: duration(item.started_at, item.ended_at),
      status: item.status,
      steps: stepCount(item.id),
      screenshotId: shot(item.id),
      failedStep: item.failed_step,
    })),
    today: schedules.filter((item) => item.active).map((item) => {
      const match = todayRuns.find((runRow) => runRow.task_id === item.task_id);
      return {
        time: item.time_of_day,
        taskId: item.task_id,
        task: nameOf(item.task_id),
        status: match?.status || 'SCHEDULED',
        runId: match?.id || null,
      };
    }),
    upcoming: schedules.filter((item) => item.active).map((item) => ({
      taskId: item.task_id,
      task: nameOf(item.task_id),
      time: item.time_of_day,
      nextRunAt: item.next_run_at,
      frequency: item.frequency,
    })),
    running: runsAll.filter((item) => item.status === 'RUNNING').map((item) => ({ id: item.id, task: nameOf(item.task_id), startedAt: item.started_at })),
    failedTasks: runsAll.filter((item) => item.status === 'FAILED').slice(0, 5).map((item) => ({ id: item.id, taskId: item.task_id, task: nameOf(item.task_id), startedAt: item.started_at, failedStep: item.failed_step })),
    activity: rows<{ kind: string; title: string; body: string; created_at: string }>('SELECT kind, title, body, created_at FROM notifications ORDER BY created_at DESC LIMIT 12'),
    automations: tasks.filter((task) => task.status === 'active').map((task) => {
      const schedule = schedules.find((item) => item.task_id === task.id && item.active);
      return { id: task.id, name: task.name, time: schedule?.time_of_day || null, frequency: schedule?.frequency || null };
    }),
  });
});

router.get('/tasks', (_req, res) => {
  const ids = rows<{ id: string }>('SELECT id FROM tasks ORDER BY updated_at DESC');
  res.json(ids.map((item) => taskView(item.id)));
});

router.get('/tasks/:id', (req, res) => {
  const task = taskView(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/tasks', (req, res) => {
  const body = taskSchema.parse(req.body);
  const taskId = id();
  const stamp = now();
  if (body.profileId && !one('SELECT id FROM browser_profiles WHERE id = ?', body.profileId)) throw new Error('Browser profile not found');
  run(
    'INSERT INTO tasks (id, user_id, name, description, profile_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    taskId, 'local', body.name, body.description, body.profileId || null, body.status || 'active', stamp, stamp,
  );
  if (body.steps) saveSteps(taskId, body.steps);
  res.status(201).json(taskView(taskId));
});

router.put('/tasks/:id', (req, res) => {
  const existing = one('SELECT id FROM tasks WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const body = taskSchema.parse(req.body);
  if (body.profileId && !one('SELECT id FROM browser_profiles WHERE id = ?', body.profileId)) throw new Error('Browser profile not found');
  run(
    'UPDATE tasks SET name = ?, description = ?, profile_id = ?, status = ?, updated_at = ? WHERE id = ?',
    body.name, body.description, body.profileId || null, body.status || 'active', now(), req.params.id,
  );
  if (body.steps) saveSteps(req.params.id, body.steps);
  res.json(taskView(req.params.id));
});

router.delete('/tasks/:id', (req, res) => {
  const runIds = rows<{ id: string }>('SELECT id FROM runs WHERE task_id = ?', req.params.id);
  for (const item of runIds) run('DELETE FROM run_steps WHERE run_id = ?', item.id);
  run('DELETE FROM screenshots WHERE run_id IN (SELECT id FROM runs WHERE task_id = ?)', req.params.id);
  run('DELETE FROM runs WHERE task_id = ?', req.params.id);
  run('DELETE FROM tasks WHERE id = ?', req.params.id);
  reloadSchedules();
  res.json({ ok: true });
});

router.post('/tasks/:id/run', async (req, res) => {
  const runId = await executeTask(req.params.id, 'manual');
  res.status(202).json({ runId });
});

router.post('/tasks/:id/cancel', (req, res) => {
  cancelTask(req.params.id);
  res.json({ ok: true });
});

router.post('/tasks/:id/schedule', (req, res) => {
  const task = one('SELECT id FROM tasks WHERE id = ?', req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const body = scheduleSchema.parse(req.body);
  try { Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new Error('Unknown timezone'); }
  if (body.frequency === 'cron') assertCron(body.cron || '');
  if (body.frequency !== 'cron' && body.frequency !== 'once' && !body.timeOfDay) throw new Error('Choose a time.');
  run('DELETE FROM schedules WHERE task_id = ?', req.params.id);
  const scheduleId = id();
  run(
    `INSERT INTO schedules (id, task_id, frequency, time_of_day, day_of_week, day_of_month, cron_expr, run_at, timezone, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    scheduleId, req.params.id, body.frequency, body.timeOfDay || null, body.dayOfWeek ?? null, body.dayOfMonth ?? null, body.cron || null, body.runAt || null, body.timezone, body.active ? 1 : 0,
  );
  const row = one<Parameters<typeof toCron>[0]>('SELECT * FROM schedules WHERE id = ?', scheduleId);
  if (row && body.active) run('UPDATE schedules SET next_run_at = ? WHERE id = ?', nextRunAt(row), scheduleId);
  run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', body.active ? 'active' : 'paused', now(), req.params.id);
  reloadSchedules();
  res.json(one('SELECT * FROM schedules WHERE id = ?', scheduleId));
});

router.post('/tasks/:id/pause', (req, res) => {
  run('UPDATE schedules SET active = 0 WHERE task_id = ?', req.params.id);
  run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', 'paused', now(), req.params.id);
  reloadSchedules();
  res.json({ ok: true });
});

router.post('/tasks/:id/resume', (req, res) => {
  run('UPDATE schedules SET active = 1 WHERE task_id = ?', req.params.id);
  run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', 'active', now(), req.params.id);
  reloadSchedules();
  res.json({ ok: true });
});

router.post('/tasks/:id/record', async (req, res) => {
  const task = one<{ profile_id: string | null }>('SELECT profile_id FROM tasks WHERE id = ?', req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.status(201).json(await startRecording(task.profile_id || undefined, req.params.id));
});

router.get('/tasks/:id/runs', (req, res) => {
  res.json(rows('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC', req.params.id).map((item) => ({
    ...item,
    duration: duration(String(item.started_at), item.ended_at ? String(item.ended_at) : null),
  })));
});

router.post('/recordings/start', async (req, res) => {
  const profileId = z.string().uuid().optional().parse(req.body?.profileId);
  res.status(201).json(await startRecording(profileId));
});

router.get('/recordings/active', (_req, res) => {
  res.json(recordingStatus());
});

router.post('/recordings/pause', (req, res) => {
  const paused = z.boolean().parse(req.body?.paused);
  res.json(pauseRecording(paused));
});

router.post('/recordings/stop', async (_req, res) => {
  res.json(await stopRecording());
});

router.get('/recordings/:id', (req, res) => {
  const recording = one('SELECT * FROM recordings WHERE id = ?', req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  res.json({ ...recording, actions: listActions(req.params.id) });
});

router.put('/recordings/:id/actions', (req, res) => {
  const recording = one('SELECT id FROM recordings WHERE id = ?', req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  const actions = z.array(z.object({
    type: z.string().max(40),
    url: z.string().max(2000).optional().nullable(),
    title: z.string().max(300).optional().nullable(),
    label: z.string().max(300).optional().nullable(),
    value: z.string().max(4000).optional().nullable(),
    selectors: z.record(z.string()).optional(),
  })).max(200).parse(req.body.actions);
  run('DELETE FROM recording_actions WHERE recording_id = ?', req.params.id);
  actions.forEach((action, index) => {
    run(
      `INSERT INTO recording_actions (id, recording_id, position, type, url, title, label, value, selectors_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id(), req.params.id, index + 1, action.type, action.url || null, action.title || null, action.label || null, action.value || null, JSON.stringify(action.selectors || {}), now(),
    );
  });
  res.json({ actions: listActions(req.params.id) });
});

router.get('/runs/:id', (req, res) => {
  const item = one<Record<string, unknown>>('SELECT * FROM runs WHERE id = ?', req.params.id);
  if (!item) return res.status(404).json({ error: 'Run not found' });
  const task = one<{ name: string }>('SELECT name FROM tasks WHERE id = ?', String(item.task_id));
  const steps = rows('SELECT * FROM run_steps WHERE run_id = ? ORDER BY position, started_at', req.params.id);
  const screenshots = rows('SELECT id, step_position, status, created_at FROM screenshots WHERE run_id = ? ORDER BY created_at', req.params.id);
  res.json({
    ...item,
    task: task?.name || 'Task',
    duration: duration(String(item.started_at), item.ended_at ? String(item.ended_at) : null),
    steps,
    screenshots,
  });
});

router.get('/screenshots', (_req, res) => {
  const shots = rows<{ id: string; run_id: string | null; step_position: number | null; status: string | null; created_at: string }>(
    'SELECT id, run_id, step_position, status, created_at FROM screenshots ORDER BY created_at DESC LIMIT 200',
  );
  res.json(shots.map((shot) => {
    const runRow = shot.run_id ? one<{ task_id: string; status: string }>('SELECT task_id, status FROM runs WHERE id = ?', shot.run_id) : undefined;
    const task = runRow ? one<{ name: string }>('SELECT name FROM tasks WHERE id = ?', runRow.task_id) : undefined;
    return { ...shot, task: task?.name || 'Recording', runStatus: runRow?.status || shot.status };
  }));
});

router.get('/screenshots/:id/file', (req, res) => {
  const shot = one<{ file_path: string }>('SELECT file_path FROM screenshots WHERE id = ?', req.params.id);
  if (!shot) return res.status(404).end();
  const root = path.resolve(config.dataDir, 'screenshots');
  const file = path.resolve(shot.file_path);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

router.post('/ai/analyze-recording', async (req, res) => {
  const recordingId = z.string().uuid().parse(req.body?.recordingId);
  const actions = listActions(recordingId) as Array<Record<string, unknown>>;
  const raw: RawAction[] = actions.map((action) => ({
    type: String(action.type),
    url: action.url ? String(action.url) : null,
    title: action.title ? String(action.title) : null,
    label: action.label ? String(action.label) : null,
    value: action.value ? String(action.value) : null,
    selectors: (action.selectors || {}) as Record<string, string>,
  }));
  res.json(await analyzeRecording(raw));
});

router.post('/ai/recover-step', async (req, res) => {
  const body = z.object({
    originalLabel: z.string().min(1).max(200),
    url: z.string().max(2000),
    candidates: z.array(z.string().max(200)).max(40),
  }).parse(req.body);
  res.json({ recovery: await recoverStep(body) });
});

router.post('/steps/test', async (req, res) => {
  const step = stepSchema.parse(req.body);
  checkStep(step);
  res.json(await testOneStep(step));
});

router.get('/schedules', (_req, res) => {
  const items = rows<Record<string, unknown>>('SELECT * FROM schedules ORDER BY time_of_day');
  res.json(items.map((item) => ({
    ...item,
    task: one<{ name: string }>('SELECT name FROM tasks WHERE id = ?', String(item.task_id))?.name || 'Task',
    label: scheduleLabel(item as never),
    cron: toCron(item as never),
  })));
});

router.delete('/schedules/:id', (req, res) => {
  run('DELETE FROM schedules WHERE id = ?', req.params.id);
  reloadSchedules();
  res.json({ ok: true });
});

router.get('/credentials', (_req, res) => {
  res.json(rows<{ id: string; name: string; username_enc: string; password_enc: string; created_at: string }>('SELECT id, name, username_enc, password_enc, created_at FROM credentials').map((item) => ({
    id: item.id,
    name: item.name,
    username: decrypt(item.username_enc) ? mask(decrypt(item.username_enc)) : '',
    password: decrypt(item.password_enc) ? '********' : '',
    createdAt: item.created_at,
  })));
});

router.post('/credentials', (req, res) => {
  const body = z.object({
    name: z.string().trim().regex(/^[A-Za-z0-9_ -]{1,40}$/),
    username: z.string().max(200).default(''),
    password: z.string().max(500).default(''),
  }).parse(req.body);
  const existing = one<{ id: string }>('SELECT id FROM credentials WHERE name = ?', body.name);
  if (existing) {
    run('UPDATE credentials SET username_enc = ?, password_enc = ? WHERE id = ?', encrypt(body.username), encrypt(body.password), existing.id);
    return res.json({ id: existing.id });
  }
  const credentialId = id();
  run('INSERT INTO credentials (id, name, username_enc, password_enc, created_at) VALUES (?, ?, ?, ?, ?)', credentialId, body.name, encrypt(body.username), encrypt(body.password), now());
  res.status(201).json({ id: credentialId });
});

router.delete('/credentials/:id', (req, res) => {
  run('DELETE FROM credentials WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

router.get('/profiles', (_req, res) => {
  res.json(rows('SELECT id, name, created_at FROM browser_profiles ORDER BY name'));
});

router.post('/profiles', (req, res) => {
  const name = z.string().trim().min(1).max(60).parse(req.body?.name);
  const profileId = id();
  const directory = path.join(config.dataDir, 'profiles', profileId);
  fs.mkdirSync(directory, { recursive: true });
  run('INSERT INTO browser_profiles (id, name, directory, created_at) VALUES (?, ?, ?, ?)', profileId, name, directory, now());
  res.status(201).json({ id: profileId, name });
});

router.delete('/profiles/:id', (req, res) => {
  run('UPDATE tasks SET profile_id = NULL WHERE profile_id = ?', req.params.id);
  run('DELETE FROM browser_profiles WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

router.get('/notifications', (_req, res) => {
  res.json(rows('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'));
});

router.post('/notifications/read', (_req, res) => {
  run('UPDATE notifications SET read = 1');
  res.json({ ok: true });
});

router.get('/settings', (_req, res) => {
  const stored = Object.fromEntries(rows<{ key: string; value: string }>('SELECT key, value FROM settings').map((item) => [item.key, item.value]));
  res.json({
    timezone: stored.timezone || config.timezone,
    aiConfigured: aiConfigured(),
    aiModel: config.aiModel || '',
    aiBaseUrl: config.aiBaseUrl ? 'configured' : '',
    notifySuccess: stored.notify_success !== '0',
    notifyFailure: stored.notify_failure !== '0',
    notifyRecovery: stored.notify_recovery !== '0',
    notifySummary: stored.notify_summary !== '0',
    variables: publicVariables(builtinVariables(stored.timezone || config.timezone, 'preview')),
  });
});

router.put('/settings', (req, res) => {
  const body = z.object({
    timezone: z.string().min(1).max(64),
    notifySuccess: z.boolean(),
    notifyFailure: z.boolean(),
    notifyRecovery: z.boolean(),
    notifySummary: z.boolean(),
  }).parse(req.body);
  try { Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new Error('Unknown timezone'); }
  const entries: Array<[string, string]> = [
    ['timezone', body.timezone],
    ['notify_success', body.notifySuccess ? '1' : '0'],
    ['notify_failure', body.notifyFailure ? '1' : '0'],
    ['notify_recovery', body.notifyRecovery ? '1' : '0'],
    ['notify_summary', body.notifySummary ? '1' : '0'],
  ];
  for (const [key, value] of entries) {
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }
  res.json({ ok: true });
});

export function httpError(error: unknown) {
  if (error instanceof ZodError) return { status: 400, error: error.issues.map((issue) => issue.message).join(' ') };
  const message = error instanceof Error ? error.message : 'Request failed';
  const status = /not found/i.test(message) ? 404 : /already running/i.test(message) ? 409 : 400;
  return { status, error: message };
}
