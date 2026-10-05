import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ACTION_TYPES, api, type Step, type Task } from '../api';

const empty = (): Step => ({ type: 'OPEN_URL', label: 'Open website', value: 'https://' });

export function Editor() {
  const { id = '' } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [schedule, setSchedule] = useState({ frequency: 'daily', timeOfDay: '09:00', timezone: 'Asia/Riyadh', dayOfWeek: 0, dayOfMonth: 1, cron: '0 9 * * *', active: true });
  const navigate = useNavigate();

  useEffect(() => {
    api<Task>(`/api/tasks/${id}`).then((next) => {
      setTask(next);
      setSteps(next.steps);
      if (next.schedule) {
        setSchedule({
          frequency: next.schedule.frequency,
          timeOfDay: next.schedule.time_of_day || '09:00',
          timezone: next.schedule.timezone,
          dayOfWeek: next.schedule.day_of_week || 0,
          dayOfMonth: next.schedule.day_of_month || 1,
          cron: next.schedule.cron_expr || '0 9 * * *',
          active: Boolean(next.schedule.active),
        });
      }
    }).catch((err: Error) => setError(err.message));
    api<Array<{ id: string; name: string }>>('/api/profiles').then(setProfiles).catch(() => undefined);
  }, [id]);

  function patch(index: number, change: Partial<Step>) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...change } : step));
  }

  async function save() {
    if (!task) return;
    const next = await api<Task>(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: task.name,
        description: task.description,
        profileId: task.profile_id,
        status: task.status,
        steps: steps.map((step) => ({ type: step.type, label: step.label, url: step.url, value: step.value, selectors: step.selectors || {} })),
      }),
    });
    setTask(next);
    setSteps(next.steps);
    setSaved('Workflow saved');
  }

  async function saveSchedule() {
    await api(`/api/tasks/${id}/schedule`, { method: 'POST', body: JSON.stringify(schedule) });
    setSaved('Schedule saved. It stays in the database after a restart.');
  }

  async function runNow() {
    const result = await api<{ runId: string }>(`/api/tasks/${id}/run`, { method: 'POST' });
    navigate(`/runs/${result.runId}`);
  }

  if (!task) return <p>{error || 'Loading workflow…'}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input className="bg-transparent text-2xl font-semibold" value={task.name} onChange={(event) => setTask({ ...task, name: event.target.value })} />
        <div className="flex gap-2">
          <button className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white" onClick={() => runNow().catch((err: Error) => setError(err.message))}>Run now</button>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => save().catch((err: Error) => setError(err.message))}>Save</button>
          <Link className="rounded-xl border px-3 py-2 text-sm" to="/runs">History</Link>
        </div>
      </div>
      <textarea className="w-full rounded-2xl border bg-white p-3 dark:bg-slate-900" value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} />
      <label className="block text-sm">Browser profile
        <select className="mt-1 w-full rounded-xl border bg-white p-2 dark:bg-slate-900" value={task.profile_id || ''} onChange={(event) => setTask({ ...task, profile_id: event.target.value || null })}>
          <option value="">Fresh browser</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      {error && <p className="text-rose-600">{error}</p>}
      {saved && <p className="text-emerald-600">{saved}</p>}
      <div className="space-y-3">
        <div className="rounded-2xl bg-indigo-600 px-4 py-3 text-center text-white">Start</div>
        {steps.map((step, index) => (
          <div key={step.id || index}>
            <div className="text-center text-slate-400">↓</div>
            <article className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
              <div className="grid gap-2 md:grid-cols-[160px_1fr]">
                <select className="rounded-lg border bg-transparent p-2" value={step.type} onChange={(event) => patch(index, { type: event.target.value })}>
                  {ACTION_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
                <input className="rounded-lg border bg-transparent p-2" value={step.label} onChange={(event) => patch(index, { label: event.target.value })} />
              </div>
              <input className="mt-2 w-full rounded-lg border bg-transparent p-2" placeholder="Value, URL, text, or {{TODAY}}" value={step.value || ''} onChange={(event) => patch(index, { value: event.target.value })} />
              <p className="mt-1 text-xs text-slate-500">Selectors: {Object.entries(step.selectors || {}).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(' · ') || 'none yet'}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <button onClick={() => setSteps((current) => { const next = [...current]; if (index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Move up</button>
                <button onClick={() => setSteps((current) => { const next = [...current]; if (index < next.length - 1) [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>Move down</button>
                <button onClick={() => setSteps((current) => [...current.slice(0, index + 1), { ...step, id: undefined }, ...current.slice(index + 1)])}>Duplicate</button>
                <button onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}>Delete</button>
                <button onClick={() => api('/api/steps/test', { method: 'POST', body: JSON.stringify({ type: step.type, label: step.label, url: step.url, value: step.value, selectors: step.selectors || {} }) }).then((result: { message: string }) => setSaved(result.message)).catch((err: Error) => setError(err.message))}>Test step</button>
              </div>
            </article>
          </div>
        ))}
        <div className="text-center text-slate-400">↓</div>
        <div className="rounded-2xl bg-slate-900 px-4 py-3 text-center text-white">End</div>
        <button className="rounded-xl border px-3 py-2" onClick={() => setSteps((current) => [...current, empty()])}>Add step</button>
      </div>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">Schedule</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label>Frequency<select className="mt-1 w-full rounded-lg border bg-transparent p-2" value={schedule.frequency} onChange={(event) => setSchedule({ ...schedule, frequency: event.target.value })}><option value="once">Run once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="cron">Custom</option></select></label>
          <label>Time<input className="mt-1 w-full rounded-lg border bg-transparent p-2" type="time" value={schedule.timeOfDay} onChange={(event) => setSchedule({ ...schedule, timeOfDay: event.target.value })} /></label>
          <label>Timezone<input className="mt-1 w-full rounded-lg border bg-transparent p-2" value={schedule.timezone} onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })} /></label>
          {schedule.frequency === 'weekly' && <label>Weekday (0 Sun)<input className="mt-1 w-full rounded-lg border bg-transparent p-2" type="number" min={0} max={6} value={schedule.dayOfWeek} onChange={(event) => setSchedule({ ...schedule, dayOfWeek: Number(event.target.value) })} /></label>}
          {schedule.frequency === 'monthly' && <label>Day<input className="mt-1 w-full rounded-lg border bg-transparent p-2" type="number" min={1} max={28} value={schedule.dayOfMonth} onChange={(event) => setSchedule({ ...schedule, dayOfMonth: Number(event.target.value) })} /></label>}
          {schedule.frequency === 'cron' && <label>Cron<input className="mt-1 w-full rounded-lg border bg-transparent p-2" value={schedule.cron} onChange={(event) => setSchedule({ ...schedule, cron: event.target.value })} /></label>}
          <label className="flex items-center gap-2">Active<input type="checkbox" checked={schedule.active} onChange={(event) => setSchedule({ ...schedule, active: event.target.checked })} /></label>
        </div>
        <button className="mt-3 rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white" onClick={() => saveSchedule().catch((err: Error) => setError(err.message))}>Save schedule</button>
      </section>
    </div>
  );
}
