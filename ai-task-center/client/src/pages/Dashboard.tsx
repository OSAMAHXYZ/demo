import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, clock } from '../api';
import { Status } from '../components/Status';

interface DashboardData {
  kpis: { active: number; scheduled: number; success: number; failed: number; successRate: number; runningToday: number };
  recent: Array<{ id: string; task: string; startedAt: string; duration: string | null; status: string; steps: number; screenshotId: string | null }>;
  today: Array<{ time: string | null; task: string; status: string; runId: string | null }>;
  upcoming: Array<{ task: string; time: string | null; nextRunAt: string | null }>;
  running: Array<{ id: string; task: string; startedAt: string }>;
  failedTasks: Array<{ id: string; task: string; startedAt: string; failedStep: number | null }>;
  activity: Array<{ kind: string; title: string; body: string; created_at: string }>;
  automations: Array<{ id: string; name: string; time: string | null; frequency: string | null }>;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api<DashboardData>('/api/dashboard').then(setData).catch((err: Error) => setError(err.message));
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (error) return <p className="rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</p>;
  if (!data) return <p>Loading dashboard…</p>;
  const cards = [
    ['Active Automations', data.kpis.active],
    ['Scheduled Tasks', data.kpis.scheduled],
    ['Successful Runs', data.kpis.success],
    ['Failed Runs', data.kpis.failed],
    ['Success Rate', `${data.kpis.successRate}%`],
    ['Tasks Running Today', data.kpis.runningToday],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-500">Record a task once, then let it run on a schedule.</p>
        </div>
        <Link to="/record" className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm">+ Record New Task</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="mb-3 font-semibold">Active automations</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {data.automations.map((item) => (
            <Link key={item.id} to={`/tasks/${item.id}`} className="rounded-2xl border border-slate-100 p-3 dark:border-slate-800">
              <p className="font-medium">{item.name}</p>
              <p className="text-sm text-slate-500">{item.frequency === 'daily' ? `Every day • ${clock(item.time)}` : item.frequency ? `${item.frequency} • ${clock(item.time)}` : 'No schedule'}</p>
              <p className="mt-2 text-sm text-emerald-600">● Active</p>
            </Link>
          ))}
          {data.automations.length === 0 && <p className="text-sm text-slate-500">No active automations yet.</p>}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          <h3 className="mb-3 font-semibold">Recent automation runs</h3>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th>Task</th><th>Started</th><th>Duration</th><th>Status</th><th>Steps</th><th>Screenshot</th></tr></thead>
              <tbody>
                {data.recent.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2"><Link to={`/runs/${item.id}`} className="font-medium text-indigo-600">{item.task}</Link></td>
                    <td>{clock(item.startedAt, true)}</td>
                    <td>{item.duration || '—'}</td>
                    <td><Status value={item.status} /></td>
                    <td>{item.steps}</td>
                    <td>{item.screenshotId ? <a href={`/api/screenshots/${item.screenshotId}/file`} target="_blank" rel="noreferrer">View</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recent.length === 0 && <p className="py-4 text-sm text-slate-500">Runs appear here after you start a task.</p>}
          </div>
        </section>
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <h3 className="mb-3 font-semibold">Today's schedule</h3>
            {data.today.map((item) => (
              <div key={`${item.task}-${item.time}`} className="mb-3">
                <p className="text-sm text-slate-500">{clock(item.time)}</p>
                <p className="font-medium">{item.task}</p>
                <Status value={item.status} />
              </div>
            ))}
            {data.today.length === 0 && <p className="text-sm text-slate-500">Nothing scheduled.</p>}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <h3 className="mb-3 font-semibold">Running now</h3>
            {data.running.map((item) => <Link key={item.id} to={`/runs/${item.id}`} className="block text-sm">{item.task} · {clock(item.startedAt)}</Link>)}
            {data.running.length === 0 && <p className="text-sm text-slate-500">No task is running.</p>}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <h3 className="mb-3 font-semibold">Failed tasks</h3>
            {data.failedTasks.map((item) => <Link key={item.id} to={`/runs/${item.id}`} className="mb-2 block text-sm">{item.task} · step {item.failedStep || '—'}</Link>)}
            {data.failedTasks.length === 0 && <p className="text-sm text-slate-500">No failed runs.</p>}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <h3 className="mb-3 font-semibold">Upcoming</h3>
            {data.upcoming.map((item) => <p key={item.task} className="mb-2 text-sm">{item.task} · {item.nextRunAt ? clock(item.nextRunAt, true) : clock(item.time)}</p>)}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <h3 className="mb-3 font-semibold">Activity</h3>
            {data.activity.map((item, index) => (
              <div key={index} className="mb-2 border-l-2 border-indigo-500 pl-3 text-sm">
                <p className="font-medium">{item.title}</p>
                <p className="text-slate-500">{item.body}</p>
              </div>
            ))}
            {data.activity.length === 0 && <p className="text-sm text-slate-500">Notifications show up after a run finishes.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
