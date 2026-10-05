import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACTION_TYPES, api, elapsed } from '../api';

interface Action {
  id?: string;
  position?: number;
  type: string;
  url?: string | null;
  title?: string | null;
  label?: string | null;
  value?: string | null;
  selectors?: Record<string, string>;
  screenshot_id?: string | null;
  created_at?: string;
}

interface Analysis {
  source: 'model' | 'rules';
  name: string;
  description: string;
  variables: string[];
  steps: Array<{ type: string; label: string; url?: string; value?: string; selectors?: Record<string, string> }>;
}

const toStep = (action: Action) => {
  const type = action.type === 'navigate' ? 'OPEN_URL' : action.type === 'click' ? 'CLICK' : action.type === 'input' ? 'TYPE' : action.type === 'select' ? 'SELECT' : action.type === 'download' ? 'DOWNLOAD_FILE' : action.type === 'key' ? 'PRESS_KEY' : action.type.toUpperCase();
  return { type: ACTION_TYPES.includes(type as typeof ACTION_TYPES[number]) ? type : 'CLICK', label: action.label || action.type, url: action.url, value: action.type === 'navigate' ? action.url : action.value, selectors: action.selectors };
};

export function RecordPage() {
  const [status, setStatus] = useState<{ id: string; elapsedMs: number; actions: number; status: string } | null>(null);
  const [recordingId, setRecordingId] = useState('');
  const [actions, setActions] = useState<Action[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!status) return;
    const timer = window.setInterval(() => {
      api<typeof status>('/api/recordings/active').then((next) => setStatus(next)).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [Boolean(status)]);

  async function start() {
    setError('');
    setAnalysis(null);
    const next = await api<NonNullable<typeof status>>('/api/recordings/start', { method: 'POST', body: '{}' });
    setStatus(next);
  }

  async function stop() {
    const result = await api<{ id: string; actions: Action[] }>('/api/recordings/stop', { method: 'POST' });
    setStatus(null);
    setRecordingId(result.id);
    setActions(result.actions);
  }

  function update(index: number, patch: Partial<Action>) {
    setActions((current) => current.map((action, i) => i === index ? { ...action, ...patch } : action));
  }

  function move(index: number, direction: -1 | 1) {
    setActions((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveActions() {
    if (!recordingId) return;
    const saved = await api<{ actions: Action[] }>(`/api/recordings/${recordingId}/actions`, { method: 'PUT', body: JSON.stringify({ actions }) });
    setActions(saved.actions);
  }

  async function analyze() {
    setBusy('Analyzing the captured actions…');
    await saveActions();
    const result = await api<Analysis>('/api/ai/analyze-recording', { method: 'POST', body: JSON.stringify({ recordingId }) });
    setAnalysis(result);
    setBusy('');
  }

  async function saveTask() {
    if (!analysis) return;
    const task = await api<{ id: string }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ name: analysis.name, description: analysis.description, steps: analysis.steps }),
    });
    navigate(`/tasks/${task.id}`);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Record task</h2>
      {!status && actions.length === 0 && (
        <button className="rounded-3xl bg-indigo-600 px-8 py-6 text-xl font-semibold text-white shadow-lg" onClick={() => start().catch((err: Error) => setError(err.message))}>Start recording</button>
      )}
      {status && (
        <section className="rounded-3xl bg-white p-6 shadow-sm dark:bg-slate-900">
          <p className="text-sm uppercase tracking-wide text-rose-600">{status.status === 'paused' ? 'Recording paused' : 'Recording active'}</p>
          <p className="font-mono text-4xl">{elapsed(status.elapsedMs)}</p>
          <p className="mt-2">Actions captured: {status.actions}</p>
          <div className="mt-4 flex gap-2">
            <button className="rounded-xl border px-4 py-2" onClick={() => api('/api/recordings/pause', { method: 'POST', body: JSON.stringify({ paused: status.status !== 'paused' }) }).then(setStatus)}>{status.status === 'paused' ? 'Resume' : 'Pause'}</button>
            <button className="rounded-xl bg-rose-600 px-4 py-2 text-white" onClick={() => stop().catch((err: Error) => setError(err.message))}>Stop recording</button>
          </div>
          <p className="mt-3 text-sm text-slate-500">A Chromium window opens on this computer. Use that window for the task. Passwords are stored as encrypted references, not as plain text in the steps.</p>
        </section>
      )}
      {error && <p className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
      {actions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Task recorded</h3>
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-white" onClick={() => analyze().catch((err: Error) => { setBusy(''); setError(err.message); })}>Analyze recording</button>
          </div>
          {actions.map((action, index) => (
            <article key={`${action.id || index}`} className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 md:grid-cols-[72px_1fr_180px]">
              <div className="text-2xl font-semibold text-indigo-600">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <input className="w-full rounded-lg border bg-transparent px-2 py-1" value={action.label || ''} onChange={(event) => update(index, { label: event.target.value })} />
                <p className="mt-1 text-sm text-slate-500">{action.type} {action.url ? `· ${action.url}` : ''}</p>
                <p className="text-sm">{action.value && String(action.value).includes('PASSWORD') ? 'Credential reference' : action.value}</p>
                <p className="text-xs text-slate-400">{action.created_at}</p>
              </div>
              <div>
                {action.screenshot_id && <img className="mb-2 h-24 w-full rounded-lg object-cover" src={`/api/screenshots/${action.screenshot_id}/file`} alt="" />}
                <div className="flex flex-wrap gap-1 text-xs">
                  <button onClick={() => move(index, -1)}>Up</button>
                  <button onClick={() => move(index, 1)}>Down</button>
                  <button onClick={() => setActions((current) => [...current.slice(0, index + 1), { ...action, id: undefined }, ...current.slice(index + 1)])}>Duplicate</button>
                  <button onClick={() => setActions((current) => current.filter((_, i) => i !== index))}>Delete</button>
                  <button onClick={() => api('/api/steps/test', { method: 'POST', body: JSON.stringify(toStep(action)) }).then(() => setError('')).catch((err: Error) => setError(err.message))}>Test step</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {busy && <p>{busy}</p>}
      {analysis && (
        <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-slate-500">{analysis.source === 'model' ? 'Model analysis' : 'Rule-based analysis (no AI key configured)'}</p>
          <input className="mt-2 w-full text-xl font-semibold" value={analysis.name} onChange={(event) => setAnalysis({ ...analysis, name: event.target.value })} />
          <textarea className="mt-2 w-full rounded-xl border bg-transparent p-2" value={analysis.description} onChange={(event) => setAnalysis({ ...analysis, description: event.target.value })} />
          <p className="mt-2 text-sm">Variables: {analysis.variables.length ? analysis.variables.map((item) => `{{${item}}}`).join(', ') : 'None detected'}</p>
          <ol className="mt-3 space-y-2">
            {analysis.steps.map((step, index) => (
              <li key={index} className="rounded-xl border p-3">
                <p className="text-xs text-slate-500">Step {index + 1} · {step.type}</p>
                <input className="w-full bg-transparent font-medium" value={step.label} onChange={(event) => setAnalysis({ ...analysis, steps: analysis.steps.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} />
              </li>
            ))}
          </ol>
          <button className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-white" onClick={() => saveTask().catch((err: Error) => setError(err.message))}>Save task</button>
        </section>
      )}
    </div>
  );
}
