import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, clock } from '../api';
import { Status } from '../components/Status';

interface RunRow {
  id: string;
  task_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  failed_step: number | null;
  recovered: number;
  duration?: string | null;
}

export function Runs() {
  const [runs, setRuns] = useState<Array<RunRow & { task?: string; shots?: number }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/api/tasks').then(async (tasks) => {
      const lists = await Promise.all(tasks.map(async (task) => {
        const items = await api<RunRow[]>(`/api/tasks/${task.id}/runs`);
        return items.map((item) => ({ ...item, task: task.name }));
      }));
      setRuns(lists.flat().sort((a, b) => b.started_at.localeCompare(a.started_at)));
    }).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">Runs</h2>
      {error && <p className="text-rose-600">{error}</p>}
      <div className="overflow-auto rounded-2xl bg-white shadow-sm dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="p-3">Task</th><th>Date</th><th>Start</th><th>End</th><th>Duration</th><th>Status</th><th>Failed step</th><th>Recovery</th></tr></thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-3"><Link className="font-medium text-indigo-600" to={`/runs/${run.id}`}>{run.task}</Link></td>
                <td>{clock(run.started_at, true)}</td>
                <td>{clock(run.started_at)}</td>
                <td>{clock(run.ended_at)}</td>
                <td>{run.duration || '—'}</td>
                <td><Status value={run.status} /></td>
                <td>{run.failed_step || '—'}</td>
                <td>{run.recovered ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="p-4 text-sm text-slate-500">No executions stored yet.</p>}
      </div>
    </div>
  );
}
