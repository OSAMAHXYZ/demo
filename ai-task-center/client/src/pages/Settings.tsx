import { useEffect, useState } from 'react';
import { api } from '../api';

interface SettingsData {
  timezone: string;
  aiConfigured: boolean;
  aiModel: string;
  notifySuccess: boolean;
  notifyFailure: boolean;
  notifyRecovery: boolean;
  notifySummary: boolean;
  variables: string[];
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [credentials, setCredentials] = useState<Array<{ id: string; name: string; username: string; password: string }>>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [profileName, setProfileName] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    api<SettingsData>('/api/settings').then(setSettings);
    api<typeof credentials>('/api/credentials').then(setCredentials);
    api<typeof profiles>('/api/profiles').then(setProfiles);
  }
  useEffect(load, []);

  if (!settings) return <p>Loading settings…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">AI provider</h3>
        <p className="mt-2 text-sm text-slate-500">{settings.aiConfigured ? `Connected model setting: ${settings.aiModel}` : 'No AI key is configured. Recording analysis uses the built-in action converter and says so. Add AI_BASE_URL and AI_API_KEY in ai-task-center/.env, then restart the API.'}</p>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">Notifications</h3>
        <div className="mt-3 grid gap-2 text-sm">
          {([
            ['notifySuccess', 'Success notification'],
            ['notifyFailure', 'Failure notification'],
            ['notifyRecovery', 'Recovery notification'],
            ['notifySummary', 'Daily summary'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} /> {label}</label>
          ))}
          <label>Timezone<input className="mt-1 w-full rounded-lg border bg-transparent p-2" value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} /></label>
        </div>
        <button className="mt-3 rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white" onClick={() => api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }).then(() => setMessage('Settings saved')).catch((err: Error) => setMessage(err.message))}>Save preferences</button>
        {message && <p className="mt-2 text-sm">{message}</p>}
        <p className="mt-3 text-xs text-slate-500">In-app notifications are active. Email, Teams, and Slack can use the same notification service later.</p>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">Credentials</h3>
        <p className="mt-1 text-sm text-slate-500">Values are encrypted before they are stored. The page only shows a mask.</p>
        {credentials.map((item) => (
          <div key={item.id} className="mt-3 flex items-center justify-between rounded-xl border p-3 text-sm">
            <div><p className="font-medium">{item.name}</p><p>Username: {item.username || '—'} · Password: {item.password || '—'}</p><p className="text-xs text-slate-500">Use {`{{${item.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_USERNAME}}`} and {`{{${item.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PASSWORD}}`}</p></div>
            <button onClick={() => api(`/api/credentials/${item.id}`, { method: 'DELETE' }).then(load)}>Delete</button>
          </div>
        ))}
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <input className="rounded-lg border bg-transparent p-2" placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className="rounded-lg border bg-transparent p-2" placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input className="rounded-lg border bg-transparent p-2" placeholder="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </div>
        <button className="mt-2 rounded-xl border px-3 py-2 text-sm" onClick={() => api('/api/credentials', { method: 'POST', body: JSON.stringify(form) }).then(() => { setForm({ name: '', username: '', password: '' }); load(); })}>Save credential</button>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">Browser profiles</h3>
        <p className="mt-1 text-sm text-slate-500">A profile keeps the browser session on this computer. Cookies are not shown here.</p>
        {profiles.map((profile) => (
          <div key={profile.id} className="mt-2 flex justify-between text-sm"><span>{profile.name}</span><button onClick={() => api(`/api/profiles/${profile.id}`, { method: 'DELETE' }).then(load)}>Delete</button></div>
        ))}
        <div className="mt-3 flex gap-2">
          <input className="rounded-lg border bg-transparent p-2" placeholder="Profile name" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          <button className="rounded-xl border px-3 py-2" onClick={() => api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: profileName }) }).then(() => { setProfileName(''); load(); })}>Add</button>
        </div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <h3 className="font-semibold">Built-in variables</h3>
        <p className="mt-2 text-sm">{settings.variables.map((name) => `{{${name}}}`).join('  ')}</p>
      </section>
    </div>
  );
}
