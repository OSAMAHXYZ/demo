const tones: Record<string, string> = {
  SUCCESS: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  RECOVERED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  RUNNING: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  FAILED: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  CANCELLED: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  SCHEDULED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  paused: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

export function Status({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${tones[value] || tones.SCHEDULED}`}>{value}</span>;
}
