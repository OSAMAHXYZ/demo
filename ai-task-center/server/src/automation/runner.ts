import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { recoverStep } from '../ai/service.js';
import { config } from '../config.js';
import { id, now, one, rows, run } from '../database/db.js';
import { notify } from '../services/notifications.js';
import { applyVariables, builtinVariables } from '../services/variables.js';
import { selectorList, type SelectorSet } from './selectors.js';

const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Control+A', 'Control+C', 'Control+V']);
const running = new Set<string>();
const cancelled = new Set<string>();

interface StepRow {
  id: string;
  position: number;
  type: string;
  label: string;
  url: string | null;
  value: string | null;
  selectors_json: string;
  timeout_ms: number | null;
}

function selectorsOf(step: StepRow): SelectorSet {
  try { return JSON.parse(step.selectors_json || '{}') as SelectorSet; } catch { return {}; }
}

function safeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https pages can be opened.');
  return url.toString();
}

function inside(root: string, target: string) {
  const base = path.resolve(root);
  const file = path.resolve(target);
  if (file !== base && !file.startsWith(base + path.sep)) throw new Error('File path is outside the task download folder.');
  return file;
}

async function locate(page: Page, selectors: SelectorSet, text: string, timeout: number) {
  const attempts = selectorList(selectors, text);
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      let locator: Locator;
      if (attempt.kind === 'role') {
        const [role, name] = attempt.value.split('|');
        locator = page.getByRole(role as 'button', { name, exact: false }).first();
      } else if (attempt.kind === 'id') locator = page.locator(`#${CSS.escape(attempt.value)}`).first();
      else if (attempt.kind === 'name') locator = page.locator(`[name="${attempt.value.replace(/"/g, '\\"')}"]`).first();
      else if (attempt.kind === 'aria') locator = page.locator(`[aria-label="${attempt.value.replace(/"/g, '\\"')}"]`).first();
      else if (attempt.kind === 'css') locator = page.locator(attempt.value).first();
      else if (attempt.kind === 'xpath') locator = page.locator(`xpath=${attempt.value}`).first();
      else locator = page.getByText(attempt.value, { exact: false }).first();
      await locator.waitFor({ state: 'visible', timeout });
      return { locator, via: attempt.kind };
    } catch (error) {
      errors.push(`${attempt.kind}: ${error instanceof Error ? error.message.split('\n')[0] : 'not found'}`);
    }
  }
  throw new Error(errors.join(' | ') || 'No selector was available');
}

async function snap(page: Page, runId: string, position: number, status: string) {
  const shotId = id();
  const file = path.join(config.dataDir, 'screenshots', `${shotId}.png`);
  await page.screenshot({ path: file, fullPage: false });
  run(
    'INSERT INTO screenshots (id, run_id, step_position, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    shotId, runId, position, file, status, now(),
  );
  return shotId;
}

async function candidates(page: Page) {
  return page.locator('button, a, [role="button"], input, select, [role="link"]').evaluateAll((nodes) => nodes.map((node) => {
    const el = node as HTMLElement;
    return (el.innerText || el.getAttribute('aria-label') || el.getAttribute('value') || el.getAttribute('name') || '').trim();
  }).filter(Boolean).slice(0, 40));
}

function logStep(runId: string, position: number, label: string, status: string, message: string, shot: string | null, recovery: unknown) {
  run(
    `INSERT INTO run_steps (id, run_id, position, label, status, message, started_at, ended_at, screenshot_id, recovery_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id(), runId, position, label, status, message, now(), now(), shot, recovery ? JSON.stringify(recovery) : null,
  );
}

async function perform(page: Page, step: StepRow, taskId: string, vars: Record<string, string>) {
  const timeout = step.timeout_ms || 8000;
  const raw = applyVariables(step.value || '', vars, true);
  const selectors = selectorsOf(step);
  if (step.type === 'OPEN_URL') {
    await page.goto(safeUrl(raw || step.url || ''), { waitUntil: 'domcontentloaded', timeout: 30000 });
    return 'Opened page';
  }
  if (step.type === 'WAIT') {
    const ms = Math.max(0, Math.min(30000, Number(raw || 1000)));
    await page.waitForTimeout(ms);
    return `Waited ${ms}ms`;
  }
  if (step.type === 'SCREENSHOT') return 'Screenshot captured';
  if (step.type === 'PRESS_KEY') {
    if (!KEYS.has(raw)) throw new Error('That key is not allowed.');
    await page.keyboard.press(raw);
    return `Pressed ${raw}`;
  }
  if (step.type === 'VERIFY') {
    const body = await page.locator('body').innerText({ timeout });
    if (!body.includes(raw)) throw new Error(`Page does not contain "${raw.slice(0, 80)}"`);
    return 'Verification passed';
  }
  if (step.type === 'EXTRACT_TEXT' || step.type === 'EXTRACT_TABLE') {
    const found = await locate(page, selectors, step.label, timeout);
    const text = await found.locator.innerText();
    vars.EXTRACTED_TEXT = text.slice(0, 2000);
    return `Extracted ${text.slice(0, 80)}`;
  }
  if (step.type === 'DOWNLOAD_FILE') {
    const download = await page.waitForEvent('download', { timeout: 15000 });
    const folder = path.join(config.dataDir, 'downloads', taskId);
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, download.suggestedFilename());
    await download.saveAs(target);
    vars.LAST_DOWNLOAD = target;
    return `Downloaded ${download.suggestedFilename()}`;
  }
  const found = await locate(page, selectors, raw || step.label, timeout);
  if (step.type === 'CLICK' || step.type === 'AI_ACTION') {
    await found.locator.click({ timeout });
    return `Clicked via ${found.via}`;
  }
  if (step.type === 'TYPE') {
    await found.locator.fill(raw, { timeout });
    return raw.includes('PASSWORD') || selectors.inputType === 'password' ? 'Filled a credential' : 'Filled the field';
  }
  if (step.type === 'SELECT') {
    await found.locator.selectOption(raw, { timeout });
    return `Selected ${raw}`;
  }
  if (step.type === 'UPLOAD_FILE') {
    const folder = path.join(config.dataDir, 'downloads', taskId);
    const file = inside(folder, raw || vars.LAST_DOWNLOAD || '');
    await found.locator.setInputFiles(file);
    return 'Uploaded the file';
  }
  if (step.type === 'CONDITIONAL') {
    const body = await page.locator('body').innerText();
    if (!body.includes(raw)) throw new Error(`Condition not met: ${raw.slice(0, 80)}`);
    return 'Condition matched';
  }
  if (step.type === 'LOOP') return 'Loop marker recorded. Each scheduled run executes the workflow once.';
  throw new Error(`Unsupported action ${step.type}`);
}

export async function executeTask(taskId: string, trigger: 'manual' | 'schedule', scheduleId?: string) {
  if (running.has(taskId)) throw new Error('This task is already running.');
  const task = one<{ id: string; name: string; profile_id: string | null; status: string }>('SELECT id, name, profile_id, status FROM tasks WHERE id = ?', taskId);
  if (!task) throw new Error('Task not found');
  const steps = rows<StepRow>('SELECT * FROM task_steps WHERE task_id = ? ORDER BY position', taskId);
  if (!steps.length) throw new Error('This task has no steps.');
  const runId = id();
  running.add(taskId);
  run(
    'INSERT INTO runs (id, task_id, schedule_id, status, trigger, started_at, recovered) VALUES (?, ?, ?, ?, ?, ?, 0)',
    runId, taskId, scheduleId || null, 'RUNNING', trigger, now(),
  );
  const vars = builtinVariables(config.timezone, taskId);
  let context: BrowserContext | null = null;
  let recovered = 0;
  let failedStep: number | null = null;
  try {
    const profile = task.profile_id
      ? one<{ directory: string }>('SELECT directory FROM browser_profiles WHERE id = ?', task.profile_id)
      : undefined;
    context = profile
      ? await chromium.launchPersistentContext(profile.directory, { headless: config.runHeadless, acceptDownloads: true })
      : await (await chromium.launch({ headless: config.runHeadless })).newContext({ acceptDownloads: true });
    const page = context.pages()[0] || await context.newPage();
    for (const step of steps) {
      if (cancelled.has(taskId)) throw new Error('CANCELLED');
      try {
        if (step.type === 'SCREENSHOT' || step.type === 'OPEN_URL' || step.type === 'CLICK') {
          await snap(page, runId, step.position, 'before').catch(() => null);
        }
        const message = await perform(page, step, taskId, vars);
        const shot = await snap(page, runId, step.position, 'success').catch(() => null);
        logStep(runId, step.position, step.label, 'SUCCESS', message, shot, null);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Step failed';
        let shot = await snap(page, runId, step.position, 'error').catch(() => null);
        const visible = await candidates(page).catch(() => [] as string[]);
        const recovery = await recoverStep({ originalLabel: step.label || step.value || '', url: page.url(), candidates: visible }).catch(() => null);
        if (recovery && (step.type === 'CLICK' || step.type === 'AI_ACTION')) {
          try {
            await page.getByText(recovery.match, { exact: false }).first().click({ timeout: 8000 });
            recovered += 1;
            shot = await snap(page, runId, step.position, 'recovered').catch(() => shot);
            logStep(runId, step.position, step.label, 'RECOVERED', `Used "${recovery.match}" after the original target was missing.`, shot, recovery);
            continue;
          } catch {
            /* recovery click failed */
          }
        }
        failedStep = step.position;
        logStep(runId, step.position, step.label, 'FAILED', reason, shot, recovery);
        throw new Error(`Step ${step.position} - ${step.label}: ${reason}`);
      }
    }
    const status = recovered ? 'RECOVERED' : 'SUCCESS';
    run('UPDATE runs SET status = ?, ended_at = ?, recovered = ? WHERE id = ?', status, now(), recovered, runId);
    notify(status === 'SUCCESS' ? 'success' : 'recovery', task.name, `${status} in ${steps.length} steps.`);
    return runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Run failed';
    const stopped = message === 'CANCELLED';
    run(
      'UPDATE runs SET status = ?, ended_at = ?, error = ?, failed_step = ?, recovered = ? WHERE id = ?',
      stopped ? 'CANCELLED' : 'FAILED', now(), stopped ? 'Stopped by the user' : message, failedStep, recovered, runId,
    );
    if (!stopped) notify('failure', task.name, message);
    return runId;
  } finally {
    cancelled.delete(taskId);
    await context?.close().catch(() => undefined);
    running.delete(taskId);
  }
}

export function cancelTask(taskId: string) {
  if (!running.has(taskId)) throw new Error('This task is not running.');
  cancelled.add(taskId);
}

export async function testOneStep(input: { type: string; label?: string; url?: string | null; value?: string | null; selectors?: SelectorSet }) {
  const step: StepRow = {
    id: 'test',
    position: 1,
    type: input.type,
    label: input.label || input.type,
    url: input.url || null,
    value: input.value || null,
    selectors_json: JSON.stringify(input.selectors || {}),
    timeout_ms: 8000,
  };
  const browser = await chromium.launch({ headless: config.runHeadless });
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    const vars = builtinVariables(config.timezone, 'step-test');
    const message = await perform(page, step, 'step-test', vars);
    const shotId = id();
    const file = path.join(config.dataDir, 'screenshots', `${shotId}.png`);
    await page.screenshot({ path: file });
    run('INSERT INTO screenshots (id, step_position, file_path, status, created_at) VALUES (?, ?, ?, ?, ?)', shotId, 1, file, 'test', now());
    return { ok: true, message, url: page.url(), screenshotId: shotId };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function isRunning(taskId: string) {
  return running.has(taskId);
}
