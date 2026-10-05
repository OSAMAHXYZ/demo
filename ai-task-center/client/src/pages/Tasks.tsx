import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, clock, type Task } from '../api';
import { Status } from '../components/Status';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  function load() {
    api<Task[]>('/api/tasks').then(setTasks).catch((err: Error) => setError(err.message));
  }
  useEffect(load, []);

  async function runNow(id: string) {
    const result = await api<{ runId: string }>(`/api/tasks/${id}/run`, { method: 'POST' });
    navigate(`/runs/${result.runId}`);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Tasks</h2>
        <Link to="/record" className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Record new task</Link>
      </div>
      {error && <p className="mb-3 text-rose-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {tasks.map((task) => (
          <article key={task.id} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{task.name}</h3>
              <Status value={task.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{task.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-slate-500">Schedule</dt><dd>{task.schedule?.label || 'Not scheduled'}</dd></div>
              <div><dt className="text-slate-500">Last run</dt><dd>{task.lastRun ? clock(task.lastRun.started_at, true) : 'Never'}</dd></div>
              <div><dt className="text-slate-500">Success rate</dt><dd>{task.successRate == null ? '—' : `${task.successRate}%`}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white" onClick={() => runNow(task.id).catch((err: Error) => setError(err.message))}>Run now</button>
              <Link className="rounded-xl border px-3 py-2 text-sm" to={`/tasks/${task.id}`}>Edit</Link>
              <Link className="rounded-xl border px-3 py-2 text-sm" to={`/tasks/${task.id}`}>Schedule</Link>
              <Link className="rounded-xl border px-3 py-2 text-sm" to="/runs">History</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
