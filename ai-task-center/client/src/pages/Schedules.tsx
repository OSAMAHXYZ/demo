import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, clock } from '../api';

interface Schedule {
  id: string;
  task_id: string;
  task: string;
  label: string;
  frequency: string;
  time_of_day: string | null;
  timezone: string;
  active: number;
  next_run_at: string | null;
  cron: string;
}

export function Schedules() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [error, setError] = useState('');

  function load() {
    api<Schedule[]>('/api/schedules').then(setItems).catch((err: Error) => setError(err.message));
  }
  useEffect(load, []);

  async function pause(item: Schedule) {
    await api(`/api/tasks/${item.task_id}/${item.active ? 'pause' : 'resume'}`, { method: 'POST' });
    load();
  }

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">Schedules</h2>
      {error && <p className="text-rose-600">{error}</p>}
      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">{item.task}</h3>
                <p className="text-sm text-slate-500">{item.label} · {item.timezone}</p>
                <p className="text-sm">Next: {clock(item.next_run_at, true)} · {item.active ? 'Active' : 'Paused'}</p>
              </div>
              <div className="flex gap-2 text-sm">
                <button className="rounded-xl border px-3 py-2" onClick={() => pause(item).catch((err: Error) => setError(err.message))}>{item.active ? 'Pause' : 'Resume'}</button>
                <Link className="rounded-xl border px-3 py-2" to={`/tasks/${item.task_id}`}>Edit</Link>
                <button className="rounded-xl border px-3 py-2" onClick={() => api(`/api/schedules/${item.id}`, { method: 'DELETE' }).then(load).catch((err: Error) => setError(err.message))}>Delete</button>
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="text-sm text-slate-500">Open a task and save a schedule.</p>}
      </div>
    </div>
  );
}
