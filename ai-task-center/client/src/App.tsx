import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Editor } from './pages/Editor';
import { RecordPage } from './pages/Record';
import { Runs } from './pages/Runs';
import { RunDetail } from './pages/RunDetail';
import { Schedules } from './pages/Schedules';
import { Screenshots } from './pages/Screenshots';
import { Settings } from './pages/Settings';
import { Tasks } from './pages/Tasks';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<Editor />} />
        <Route path="record" element={<RecordPage />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<RunDetail />} />
        <Route path="screenshots" element={<Screenshots />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
