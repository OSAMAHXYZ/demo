'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const api = require('./contact-performance-api');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function workbook(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Columns deliberately out of the usual order: mapping must use header names. */
function exportFile(month) {
  const m = month || '10';
  return workbook('Export', [
    ['Centre Name', 'Source', 'Initial Contact', 'Lead Type', 'Status', 'Created Date', 'Employee Responsible', 'Lead Number'],
    ['Jeddah', 'Web', 'Contacted', 'New', 'Open', `01.${m}.2026`, 'Sara Nasser', '00123'],
    ['Jeddah', 'Web', 'Not Contacted', 'New', 'Open', `01.${m}.2026`, 'Sara Nasser', '00123'],
    ['', 'Walk-in', 'Not Contacted', 'Used', 'Won', `02.${m}.2026`, 'Ali M', '200'],
    ['Riyadh', 'Web', 'In Progress', 'New', 'Open', `02.${m}.2026`, 'Ali M', '300'],
    ['Dammam', 'Event', 'Mystery', 'Fleet', 'Lost', `03.${m}.2026`, 'Nora', '400'],
    ['Jeddah', 'Web', '', 'New', 'Open', `03.${m}.2026`, 'Nora', '401'],
    ['Jeddah', 'Web', 'contacted', 'New', 'Open', `03.${m}.2026`, 'Sara  Nasser', '500'],
    ['Jeddah', 'Web', 'Contacted', 'New', 'Open', `04.${m}.2026`, '', '600'],
    ['Jeddah', 'Web', 'Contacted', 'New', 'Open', `04.${m}.2026`, 'Hadi', ''],
    [],
    ['Applied filters: Created Date is in October 2026'],
  ]);
}

async function main() {
  assert(api.classifyInitialContact('Contacted') === 'contacted', 'contacted');
  assert(api.classifyInitialContact(' NOT  contacted ') === 'not_contacted', 'not contacted, case and spaces');
  assert(api.classifyInitialContact('In Progress') === 'in_progress', 'in progress');
  assert(api.classifyInitialContact('Mystery') === 'unknown', 'other text is unknown');
  assert(api.classifyInitialContact('') === 'unknown', 'blank is unknown');
  assert(api.normalizeId('00123') === '00123', 'leading zeros stay on text');

  const parsed = api.parseLeadSheet(exportFile(), 'data.xlsx', 'export', XLSX);
  assert(!parsed.errors.length, parsed.errors.join('; '));
  assert(parsed.columns.leadNumber === 7 && parsed.columns.employeeName === 6, 'columns found by header name');
  assert(parsed.skipped.footer === 1, 'footer row skipped');
  assert(parsed.skipped.noEmployee === 1 && parsed.skipped.noLead === 1, 'rows without lead or employee skipped');

  const dataset = api.buildExportDataset(parsed, null);
  assert(!dataset.errors.length, dataset.errors.join('; '));
  assert(dataset.period === '2026-10', `period from created dates ${dataset.period}`);
  assert(dataset.records.length === 6, `deduped leads ${dataset.records.length}`);
  assert(dataset.records.find((row) => row.leadNumber === '00123').bucket === 'contacted', 'first duplicate row wins');
  assert(dataset.reconciliation.duplicates === 1, 'duplicate counted');

  const summary = api.summarize(dataset, {});
  const k = summary.kpis;
  assert(k.total === 6, `total ${k.total}`);
  assert(k.contacted === 2 && k.notContacted === 1 && k.inProgress === 1 && k.unknown === 2, `buckets ${JSON.stringify(k)}`);
  assert(k.contactRate === 33.3, `rate ${k.contactRate}`);
  assert(summary.days.join(',') === '2026-10-01,2026-10-02,2026-10-03', `days ${summary.days}`);
  assert(summary.sources[0] === 'Web', 'sources sorted by volume');
  assert(summary.team.advisors === 3, `advisors ${summary.team.advisors}`);
  const sara = summary.employees.find((row) => row.name.startsWith('Sara'));
  assert(sara && sara.total === 2 && sara.contacted === 2 && sara.contactRate === 100 && sara.rank === 1, 'sara merged across spacing and ranked first');
  assert(sara.daily.length === summary.days.length && sara.daily[0][0] === 1 && sara.daily[2][0] === 1, 'per-advisor daily arrays');
  assert(sara.sources.length === summary.sources.length, 'per-advisor source arrays');
  const nora = summary.employees.find((row) => row.name === 'Nora');
  assert(nora.unknown === 2 && nora.notContacted === 0, 'unknown is not counted as not contacted');
  const ali = summary.employees.find((row) => row.name === 'Ali M');
  assert(ali.rank === 2 && nora.rank === 3, 'tie on 0% broken by volume, then name');

  const leads = api.listLeads(dataset, { advisor: 'name:nora', contact: 'unknown', sort: 'leadNumber', dir: 'asc', page: 1, pageSize: 25 });
  assert(leads.total === 2 && leads.rows[0].leadNumber === '400', 'leads filtered by advisor and status');

  const contactBuf = workbook('Contacts', [
    ['Lead Number', 'Contact Status', 'Prospect'],
    ['400', 'Contacted', 'Prospect D'],
    ['401', '', 'Prospect E'],
  ]);
  const overlay = api.parseLeadSheet(contactBuf, 'contacts.xlsx', 'contact', XLSX);
  assert(!overlay.errors.length, overlay.errors.join('; '));
  const merged = api.buildExportDataset(parsed, overlay);
  const mergedSummary = api.summarize(merged, {});
  assert(mergedSummary.kpis.contacted === 3 && mergedSummary.kpis.unknown === 1, 'contact file overrides Initial Contact');
  assert(merged.records.find((row) => row.leadNumber === '400').prospect === 'Prospect D', 'contact file adds detail');

  const noStatus = api.parseLeadSheet(workbook('Export', [['Lead Number', 'Employee Responsible'], ['1', 'A']]), 'x.xlsx', 'export', XLSX);
  assert(api.buildExportDataset(noStatus, null).errors.length === 1, 'export without Initial Contact and no contact file is blocked');
  const noEmployee = api.parseLeadSheet(workbook('Export', [['Lead Number', 'Initial Contact'], ['1', 'Contacted']]), 'x.xlsx', 'export', XLSX);
  assert(noEmployee.errors.length === 1, 'missing Employee Responsible blocks');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const routes = [];
  const app = {
    get(routePath, handler) { routes.push({ method: 'GET', routePath, handler }); },
    post(routePath, handler) { routes.push({ method: 'POST', routePath, handler }); },
  };
  let broadcasts = 0;
  api.attachContactPerformance(app, { dir, password: '1234', XLSX, broadcast() { broadcasts += 1; } });

  function matchRoute(method, urlPath) {
    const clean = urlPath.split('?')[0];
    return routes.find((route) => {
      if (route.method !== method) return false;
      const names = [];
      const pattern = route.routePath.replace(/:([^/]+)/g, (_all, name) => {
        names.push(name);
        return '([^/]+)';
      });
      const match = clean.match(new RegExp(`^${pattern}$`));
      if (!match) return false;
      route.params = {};
      names.forEach((name, index) => { route.params[name] = decodeURIComponent(match[index + 1]); });
      return true;
    });
  }

  async function call(method, urlPath, body, admin) {
    const route = matchRoute(method, urlPath);
    if (!route) throw new Error(`No route ${method} ${urlPath}`);
    const query = {};
    new URLSearchParams(urlPath.split('?')[1] || '').forEach((value, key) => { query[key] = value; });
    const req = {
      body: body || {},
      query,
      params: route.params || {},
      get(name) { return String(name).toLowerCase() === 'x-admin-password' && admin ? '1234' : ''; },
    };
    let status = 200;
    let data = null;
    const res = {
      status(code) { status = code; return this; },
      json(payload) { data = payload; return this; },
      setHeader() { return this; },
    };
    await route.handler(req, res);
    return { status, data };
  }

  const missing = await call('POST', '/api/contact-performance/preview', { period: '2026-10' });
  assert(missing.status === 400, 'preview without the CRM export is rejected');
  const contactOnly = await call('POST', '/api/contact-performance/preview', { contactFile: { name: 'c.xlsx', base64: contactBuf.toString('base64') } });
  assert(contactOnly.status === 400, 'contact file alone is rejected');
  const blocked = await call('POST', '/api/contact-performance/preview', {
    crmFile: { name: 'bad.xlsx', base64: workbook('Notes', [['Name'], ['x']]).toString('base64') },
  });
  assert(blocked.status === 422, 'invalid file does not publish');
  const metaBefore = await call('GET', '/api/contact-performance/meta');
  assert(!metaBefore.data.activeId, 'failed validation left no active dataset');

  const octBuf = exportFile('10');
  const preview = await call('POST', '/api/contact-performance/preview', {
    period: '2026-01',
    crmFile: { name: 'data_oct.xlsx', base64: octBuf.toString('base64') },
  });
  assert(preview.status === 200 && preview.data.draftId, preview.data.error || 'preview failed');
  assert(preview.data.period === '2026-10', 'period comes from created dates, not the request');
  const stillEmpty = await call('GET', '/api/contact-performance/summary');
  assert(stillEmpty.data.empty, 'preview is not live');
  const published = await call('POST', '/api/contact-performance/publish', { draftId: preview.data.draftId });
  assert(published.status === 200 && broadcasts === 1, 'publish broadcasts');
  const live = await call('GET', '/api/contact-performance/summary');
  assert(live.data.kpis.total === 6 && live.data.team.advisors === 3, 'dashboard reads the published export');
  assert(live.data.fileName === 'data_oct.xlsx' && live.data.period === '2026-10', 'summary carries file and period');
  assert(Array.isArray(live.data.employees[0].daily) && Array.isArray(live.data.days), 'summary carries daily arrays');

  const repeat = await call('POST', '/api/contact-performance/preview', { crmFile: { name: 'data_oct.xlsx', base64: octBuf.toString('base64') } });
  assert(repeat.status === 200 && repeat.data.duplicate === true, 'repeat push of the same file is a duplicate');

  const nov = await call('POST', '/api/contact-performance/preview', { crmFile: { name: 'data_nov.xlsx', base64: exportFile('11').toString('base64') } });
  assert(nov.data.period === '2026-11', 'second period');
  await call('POST', '/api/contact-performance/publish', { draftId: nov.data.draftId });
  const meta = await call('GET', '/api/contact-performance/meta');
  assert(meta.data.period === '2026-11' && meta.data.periods.length === 2, 'new push becomes active, history kept');
  const history = await call('GET', '/api/contact-performance/history', null, true);
  const october = history.data.publications.find((item) => item.period === '2026-10');
  const old = await call('GET', `/api/contact-performance/summary?publication=${encodeURIComponent(october.id)}`);
  assert(old.data.period === '2026-10' && !old.data.active, 'historical snapshot still loads');
  const rolled = await call('POST', '/api/contact-performance/rollback', { publicationId: october.id }, true);
  assert(rolled.status === 200, 'rollback');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('contact-performance tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
