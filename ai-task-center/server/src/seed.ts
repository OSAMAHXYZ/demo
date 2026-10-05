import path from 'node:path';
import { config } from './config.js';
import { id, now, one, run } from './database/db.js';

export function seed() {
  if (!one('SELECT id FROM users WHERE id = ?', 'local')) {
    run('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)', 'local', 'Local operator', now());
  }
  if (!one('SELECT id FROM browser_profiles WHERE name = ?', 'Work Chrome')) {
    const profileId = id();
    const directory = path.join(config.dataDir, 'profiles', profileId);
    run('INSERT INTO browser_profiles (id, name, directory, created_at) VALUES (?, ?, ?, ?)', profileId, 'Work Chrome', directory, now());
  }
  if (one('SELECT id FROM tasks WHERE name = ?', 'Open Example Website')) return;
  const taskId = id();
  const stamp = now();
  run(
    'INSERT INTO tasks (id, user_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    taskId,
    'local',
    'Open Example Website',
    'Opens example.com, waits, captures a screenshot, and checks that the page says Example Domain.',
    'active',
    stamp,
    stamp,
  );
  const steps = [
    ['OPEN_URL', 'Open example.com', 'https://example.com', 'https://example.com'],
    ['WAIT', 'Wait 2 seconds', null, '2000'],
    ['SCREENSHOT', 'Take screenshot', null, null],
    ['VERIFY', 'Verify page contains Example Domain', null, 'Example Domain'],
  ];
  steps.forEach((step, index) => {
    run(
      'INSERT INTO task_steps (id, task_id, position, type, label, url, value, selectors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id(), taskId, index + 1, step[0], step[1], step[2], step[3], '{}',
    );
  });
  run(
    `INSERT INTO schedules (id, task_id, frequency, time_of_day, timezone, active)
     VALUES (?, ?, 'daily', '09:00', ?, 1)`,
    id(), taskId, config.timezone,
  );
}
