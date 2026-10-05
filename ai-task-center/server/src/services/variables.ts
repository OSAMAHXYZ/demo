import path from 'node:path';
import { config } from '../config.js';
import { decrypt } from '../crypto/secrets.js';
import { one, rows } from '../database/db.js';

export function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

export function formatDate(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function builtinVariables(timeZone: string, taskId: string) {
  const now = new Date();
  const today = formatDate(now, timeZone);
  const yesterday = formatDate(new Date(now.getTime() - 86400000), timeZone);
  const month = zonedParts(now, timeZone).month;
  const map: Record<string, string> = {
    TODAY: today,
    YESTERDAY: yesterday,
    CURRENT_DATE: today,
    CURRENT_MONTH: month,
    REPORT_DATE: today,
    DOWNLOAD_FOLDER: path.join(config.dataDir, 'downloads', taskId),
  };
  for (const row of rows<{ name: string; username_enc: string; password_enc: string }>('SELECT name, username_enc, password_enc FROM credentials')) {
    const key = row.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    map[`${key}_USERNAME`] = decrypt(row.username_enc);
    map[`${key}_PASSWORD`] = decrypt(row.password_enc);
    map[key] = decrypt(row.password_enc);
  }
  const setting = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'timezone');
  map.TIMEZONE = setting?.value || timeZone;
  return map;
}

const SECRET = /PASSWORD|SECRET|TOKEN/i;

export function applyVariables(input: string, vars: Record<string, string>, revealSecrets: boolean) {
  return input.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (full, name: string) => {
    if (!(name in vars)) return full;
    if (!revealSecrets && SECRET.test(name)) return '********';
    return vars[name];
  });
}

export function publicVariables(vars: Record<string, string>) {
  return Object.keys(vars).filter((name) => !SECRET.test(name) || name.endsWith('_USERNAME'));
}
