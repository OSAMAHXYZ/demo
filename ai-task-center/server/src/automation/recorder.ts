import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { encrypt } from '../crypto/secrets.js';
import { id, now, one, rows, run } from '../database/db.js';

interface LiveRecording {
  id: string;
  startedAt: number;
  context: BrowserContext;
  actions: number;
  paused: boolean;
  pauseStarted: number;
}

let live: LiveRecording | null = null;

const HOOK = `(() => {
  if (window.__ataInstalled) return;
  window.__ataInstalled = true;
  const cssPath = (el) => {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const describe = (el, type, extra) => {
    const target = el instanceof Element ? el : null;
    const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target : null;
    return {
      type,
      url: location.href,
      title: document.title,
      label: target ? (target.getAttribute('aria-label') || target.innerText || target.getAttribute('name') || '').trim().slice(0, 160) : '',
      id: target && target.id || '',
      fieldName: target ? (target.getAttribute('name') || '') : '',
      role: target ? (target.getAttribute('role') || '') : '',
      ariaLabel: target ? (target.getAttribute('aria-label') || '') : '',
      css: target ? cssPath(target) : '',
      text: target ? (target.innerText || '').trim().slice(0, 120) : '',
      inputType: input ? (input.getAttribute('type') || input.tagName.toLowerCase()) : '',
      isPassword: !!(input && input.getAttribute('type') === 'password'),
      value: extra.value || '',
    };
  };
  document.addEventListener('click', (event) => {
    window.__ataRecord(describe(event.target, 'click', {}));
  }, true);
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    const password = el.getAttribute('type') === 'password';
    const kind = el instanceof HTMLSelectElement ? 'select' : 'input';
    window.__ataRecord(describe(el, kind, { value: password ? el.value : String(el.value || '').slice(0, 500) }));
  }, true);
})();`;

const USER_FIELD = /user|email|login|account/i;

function hostKey(url: string) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toUpperCase() || 'SITE';
  } catch {
    return 'SITE';
  }
}

function saveScreenshot(page: Page, recordingId: string, position: number) {
  const shotId = id();
  const file = path.join(config.dataDir, 'screenshots', `${shotId}.png`);
  return page.screenshot({ path: file, fullPage: false }).then(() => {
    run(
      'INSERT INTO screenshots (id, recording_id, step_position, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      shotId, recordingId, position, file, 'recorded', now(),
    );
    return shotId;
  }).catch(() => null);
}

async function storeAction(recordingId: string, payload: Record<string, unknown>, page: Page | null) {
  if (!live || live.id !== recordingId || live.paused) return;
  const text = (key: string) => String(payload[key] ?? '');
  const url = text('url');
  if (text('type') === 'navigate' && (!url || url === 'about:blank' || url.startsWith('chrome'))) return;
  const position = live.actions + 1;
  let value = text('value');
  const password = payload.isPassword === true || text('inputType') === 'password';
  const username = !password && text('type') === 'input' && USER_FIELD.test(`${text('fieldName')} ${text('id')} ${text('label')}`);
  if (password || username) {
    const name = hostKey(url);
    if (value) {
      const existing = one<{ id: string }>('SELECT id FROM credentials WHERE name = ?', name);
      if (existing && password) run('UPDATE credentials SET password_enc = ? WHERE name = ?', encrypt(value), name);
      else if (existing) run('UPDATE credentials SET username_enc = ? WHERE name = ?', encrypt(value), name);
      else {
        run(
          'INSERT INTO credentials (id, name, username_enc, password_enc, created_at) VALUES (?, ?, ?, ?, ?)',
          id(), name, encrypt(username ? value : ''), encrypt(password ? value : ''), now(),
        );
      }
    }
    value = `{{${name}_${password ? 'PASSWORD' : 'USERNAME'}}}`;
  }
  const selectors = {
    id: text('id'),
    fieldName: text('fieldName'),
    role: text('role'),
    ariaLabel: text('ariaLabel'),
    css: text('css'),
    text: text('text') || text('label'),
    inputType: text('inputType'),
  };
  const actionId = id();
  run(
    `INSERT INTO recording_actions
      (id, recording_id, position, type, url, title, label, value, selectors_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    actionId, recordingId, position, text('type') || 'click', url, text('title'), text('label'), value, JSON.stringify(selectors), now(),
  );
  live.actions = position;
  if (page && (payload.type === 'click' || payload.type === 'navigate')) {
    const shot = await saveScreenshot(page, recordingId, position);
    if (shot) run('UPDATE recording_actions SET screenshot_id = ? WHERE id = ?', shot, actionId);
  }
}

export function recordingStatus() {
  if (!live) return null;
  const elapsedMs = live.paused ? live.pauseStarted - live.startedAt : Date.now() - live.startedAt;
  return { id: live.id, elapsedMs, actions: live.actions, status: live.paused ? 'paused' : 'recording' };
}

export async function startRecording(profileId?: string, taskId?: string) {
  if (live) throw new Error('A recording is already running. Stop it before starting another.');
  const recordingId = id();
  const profile = profileId ? one<{ directory: string }>('SELECT directory FROM browser_profiles WHERE id = ?', profileId) : undefined;
  run(
    'INSERT INTO recordings (id, task_id, status, started_at, profile_id) VALUES (?, ?, ?, ?, ?)',
    recordingId, taskId || null, 'recording', now(), profileId || null,
  );
  try {
    const context = profile
      ? await chromium.launchPersistentContext(profile.directory, { headless: config.recordHeadless })
      : await (await chromium.launch({ headless: config.recordHeadless })).newContext();
    await context.exposeBinding('__ataRecord', async (source, payload: Record<string, unknown>) => {
      await storeAction(recordingId, payload, source.page);
    });
    await context.addInitScript(HOOK);
    const page = context.pages()[0] || await context.newPage();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      void storeAction(recordingId, { type: 'navigate', url: frame.url(), title: '', label: frame.url(), value: frame.url() }, page).catch(() => undefined);
    });
    page.on('download', (download) => {
      const folder = path.join(config.dataDir, 'downloads', recordingId);
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, download.suggestedFilename());
      void download.saveAs(target).then(() => storeAction(recordingId, { type: 'download', url: page.url(), label: download.suggestedFilename(), value: target }, page));
    });
    await page.goto('about:blank');
    live = { id: recordingId, startedAt: Date.now(), context, actions: 0, paused: false, pauseStarted: 0 };
    return recordingStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser could not start';
    run('UPDATE recordings SET status = ?, ended_at = ?, error = ? WHERE id = ?', 'failed', now(), message, recordingId);
    throw new Error(`${message}. Install Chromium with: npx playwright install chromium`);
  }
}

export function pauseRecording(paused: boolean) {
  if (!live) throw new Error('No recording is active.');
  if (paused && !live.paused) live.pauseStarted = Date.now();
  if (!paused && live.paused && live.pauseStarted) live.startedAt += Date.now() - live.pauseStarted;
  live.paused = paused;
  return recordingStatus();
}

export async function stopRecording() {
  if (!live) throw new Error('No recording is active.');
  const recordingId = live.id;
  await live.context.close().catch(() => undefined);
  live = null;
  run('UPDATE recordings SET status = ?, ended_at = ? WHERE id = ?', 'stopped', now(), recordingId);
  return { id: recordingId, actions: listActions(recordingId) };
}

export function listActions(recordingId: string) {
  return rows('SELECT * FROM recording_actions WHERE recording_id = ? ORDER BY position', recordingId).map((row) => ({
    ...row,
    selectors: JSON.parse(String(row.selectors_json || '{}')),
  }));
}
