import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Bell, CalendarClock, Camera, LayoutDashboard, ListChecks, Moon, PlayCircle, Settings, SquareMousePointer, Sun } from 'lucide-react';
import { api } from '../api';

const links = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/tasks', 'Tasks', ListChecks],
  ['/record', 'Record Task', SquareMousePointer],
  ['/schedules', 'Schedules', CalendarClock],
  ['/runs', 'Runs', PlayCircle],
  ['/screenshots', 'Screenshots', Camera],
  ['/settings', 'Settings', Settings],
] as const;

export function Layout() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [notes, setNotes] = useState<Array<{ id: string; title: string; body: string; read: number }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => api<typeof notes>('/api/notifications').then(setNotes).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('ata-theme', next ? 'dark' : 'light');
  }

  const unread = notes.filter((note) => !note.read).length;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 md:min-h-screen md:border-b-0 md:border-r">
        <div className="mb-6 px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Automation</p>
          <h1 className="text-lg font-semibold leading-tight">AI Task Automation Center</h1>
        </div>
        <nav className="flex gap-1 overflow-auto md:block">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `mb-1 flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div>
        <header className="flex items-center justify-end gap-2 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
          <button className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-900" onClick={toggleTheme} aria-label="Toggle color theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="relative">
            <button className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-900" onClick={() => { setOpen((value) => !value); api('/api/notifications/read', { method: 'POST' }).catch(() => undefined); }} aria-label="Notifications">
              <Bell size={18} />
              {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
            </button>
            {open && (
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {notes.length === 0 && <p className="text-sm text-slate-500">No notifications yet.</p>}
                {notes.slice(0, 8).map((note) => (
                  <div key={note.id} className="border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
                    <p className="text-sm font-medium">{note.title}</p>
                    <p className="text-xs text-slate-500">{note.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6"><Outlet /></main>
      </div>
    </div>
  );
}
