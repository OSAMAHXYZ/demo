import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      profile_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT,
      value TEXT,
      selectors_json TEXT NOT NULL DEFAULT '{}',
      timeout_ms INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      profile_id TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS recording_actions (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      url TEXT,
      title TEXT,
      label TEXT,
      value TEXT,
      selectors_json TEXT NOT NULL DEFAULT '{}',
      screenshot_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      frequency TEXT NOT NULL,
      time_of_day TEXT,
      day_of_week INTEGER,
      day_of_month INTEGER,
      cron_expr TEXT,
      run_at TEXT,
      timezone TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      schedule_id TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      error TEXT,
      failed_step INTEGER,
      recovered INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT,
      ended_at TEXT,
      screenshot_id TEXT,
      recovery_json TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      recording_id TEXT,
      step_position INTEGER,
      file_path TEXT NOT NULL,
      status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      username_enc TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_locks (
      task_id TEXT NOT NULL,
      window_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, window_key)
    );
  `);
}

export function id() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export function rows<T = Record<string, unknown>>(sql: string, ...params: Array<string | number | null>) {
  return db.prepare(sql).all(...params) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, ...params: Array<string | number | null>) {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Array<string | number | null>) {
  return db.prepare(sql).run(...params);
}
