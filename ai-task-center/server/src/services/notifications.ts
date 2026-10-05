import { id, now, one, run } from '../database/db.js';

const prefKey: Record<string, string> = {
  success: 'notify_success',
  failure: 'notify_failure',
  recovery: 'notify_recovery',
  summary: 'notify_summary',
};

export function notify(kind: 'success' | 'failure' | 'recovery' | 'summary', title: string, body: string) {
  const pref = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', prefKey[kind]);
  if (pref?.value === '0') return;
  run('INSERT INTO notifications (id, kind, title, body, read, created_at) VALUES (?, ?, ?, ?, 0, ?)', id(), kind, title, body, now());
}
