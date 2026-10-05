import { useEffect, useState } from 'react';
import { api, clock } from '../api';
import { Status } from '../components/Status';

interface Shot {
  id: string;
  task: string;
  step_position: number | null;
  created_at: string;
  runStatus: string | null;
}

export function Screenshots() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [open, setOpen] = useState<Shot | null>(null);
  useEffect(() => { api<Shot[]>('/api/screenshots').then(setShots).catch(() => undefined); }, []);
  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">Screenshots</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shots.map((shot) => (
          <button key={shot.id} className="rounded-2xl bg-white p-3 text-left shadow-sm dark:bg-slate-900" onClick={() => setOpen(shot)}>
            <img className="h-40 w-full rounded-xl object-cover" src={`/api/screenshots/${shot.id}/file`} alt="" />
            <p className="mt-2 font-medium">{shot.task}</p>
            <p className="text-sm text-slate-500">Step {shot.step_position || '—'} · {clock(shot.created_at, true)} {clock(shot.created_at)}</p>
            {shot.runStatus && <Status value={shot.runStatus} />}
          </button>
        ))}
      </div>
      {shots.length === 0 && <p className="text-sm text-slate-500">Screenshots are stored when a run or recording captures the page.</p>}
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/70 p-4" onClick={() => setOpen(null)}>
          <img className="max-h-[85vh] max-w-5xl rounded-2xl" src={`/api/screenshots/${open.id}/file`} alt={open.task} />
        </div>
      )}
    </div>
  );
}
