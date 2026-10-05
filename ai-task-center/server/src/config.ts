import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.cwd(), '..');
const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'downloads'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true });

function loadEnvFile() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
  }
}
loadEnvFile();

function secret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 16) return process.env.APP_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const created = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, created, { encoding: 'utf8', mode: 0o600 });
  return created;
}

export const config = {
  port: Number(process.env.PORT || 8788),
  host: process.env.HOST || '127.0.0.1',
  dataDir,
  dbFile: path.join(dataDir, 'automation.sqlite'),
  appSecret: secret(),
  aiBaseUrl: (process.env.AI_BASE_URL || '').replace(/\/$/, ''),
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
  timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Riyadh',
  recordHeadless: process.env.RECORD_HEADLESS === 'true',
  runHeadless: process.env.RUN_HEADLESS !== 'false',
};

export function aiConfigured() {
  return Boolean(config.aiBaseUrl && config.aiApiKey);
}
