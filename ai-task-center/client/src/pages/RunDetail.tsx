import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, clock } from '../api';
import { Status } from '../components/Status';

interface Detail {
  id: string;
  task_id: string;
  task: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  failed_step: number | null;
  recovered: number;
  duration: string | null;
  steps: Array<{ id: string; position: number; label: string; status: string; message: string | null; started_at: string; screenshot_id: string | null; recovery_json: string | null }>;
  screenshots: Array<{ id: string; step_position: number | null; status: string | null; created_at: string }>;
}

export function RunDetail() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let stop = false;
    const load = () => api<Detail>(`/api/runs/${id}`).then((next) => { if (!stop) setRun(next); }).catch((err: Error) => setError(err.message));
    load();
    const timer = window.setInterval(load, 1200);
    return () => { stop = true; window.clearInterval(timer); };
  }, [id]);

  if (!run) return <p>{error || 'Loading run…'}</p>;
  const latest = [...run.screenshots].reverse()[0];
  const current = [...run.steps].reverse().find((step) => step.status === 'RUNNING') || [...run.steps].reverse()[0];

  async function retry() {
    const result = await api<{ runId: string }>(`/api/tasks/${run.task_id}/run`, { method: 'POST' });
    navigate(`/runs/${result.runId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">{clock(run.started_at)} · {run.duration || 'in progress'}</p>
          <h2 className="text-2xl font-semibold">{run.task}</h2>
        </div>
        <Status value={run.status} />
      </div>
      {run.status === 'FAILED' && (
        <section className="rounded-2xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100">
          <h3 className="font-semibold">Task failed</h3>
          <p>Failed step: {run.failed_step || '—'} {current ? `· ${current.label}` : ''}</p>
          <p>Reason: {run.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-xl bg-rose-700 px-3 py-2 text-sm text-white" onClick={() => retry().catch((err: Error) => setError(err.message))}>Retry</button>
            <Link className="rounded-xl border px-3 py-2 text-sm" to={`/tasks/${run.task_id}`}>Edit workflow</Link>
            {latest && <a className="rounded-xl border px-3 py-2 text-sm" href={`/api/screenshots/${latest.id}/file`} target="_blank" rel="noreferrer">View screenshot</a>}
          </div>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <ol className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {run.steps.map((step) => (
            <li key={step.id} className="mb-2 text-sm">
              <span className="mr-2">{step.status === 'SUCCESS' || step.status === 'RECOVERED' ? '✓' : step.status === 'FAILED' ? '!' : '●'}</span>
              {step.label}
              {step.recovery_json && <span className="block text-xs text-sky-600">Recovered</span>}
            </li>
          ))}
          {run.steps.length === 0 && <li className="text-sm text-slate-500">Waiting for the first step…</li>}
        </ol>
        <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {latest ? <img className="max-h-[420px] w-full rounded-xl object-contain" src={`/api/screenshots/${latest.id}/file`} alt="Latest screenshot" /> : <div className="grid h-64 place-items-center rounded-xl bg-slate-100 text-sm text-slate-500 dark:bg-slate-800">Screenshot appears after the first captured step.</div>}
          <p className="mt-3 text-sm">Current action: {current?.message || current?.label || 'Starting browser'}</p>
        </div>
      </div>
      <section className="rounded-2xl bg-slate-950 p-4 font-mono text-sm text-slate-100">
        {run.steps.map((step) => (
          <p key={step.id}>{clock(step.started_at)} {step.status} {step.message}</p>
        ))}
        {run.error && run.status !== 'FAILED' && <p>{run.error}</p>}
      </section>
      {run.status === 'RUNNING' && <button className="rounded-xl border px-3 py-2" onClick={() => api(`/api/tasks/${run.task_id}/cancel`, { method: 'POST' }).catch((err: Error) => setError(err.message))}>Cancel</button>}
      {error && <p className="text-rose-600">{error}</p>}
    </div>
  );
}
