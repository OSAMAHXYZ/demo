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
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function contactFile() {
  return workbook('Export', [
    ['Lead Number', 'Initial Contact', 'Employee Responsible', 'Created Date', 'Status', 'Source', 'Centre Name', 'Lead Type'],
    ['00123', 'Yes', 'Sara Nasser', '01.10.2026', 'Contacted', 'Web', 'Jeddah', 'New'],
    ['00123', 'Yes', 'Sara Nasser', '02.10.2026', 'Contacted', 'Web', 'Jeddah', 'New'],
    ['200', 'No', 'Ali', '03.10.2026', 'Not Contacted', 'Walk-in', 'Riyadh', 'Used'],
    ['200', 'No', 'Omar', '03.10.2026', 'Contacted', 'Walk-in', 'Riyadh', 'Used'],
    ['300', 'Yes', 'Ali M', '04.10.2026', 'In Progress', 'Web', 'Jeddah', 'New'],
    ['400', '', 'Nora', '05.10.2026', 'Mystery', 'Event', 'Dammam', 'Fleet'],
    ['500', 'Yes', 'Hadi', 'not-a-date', 'Contacted', 'Web', 'Jeddah', 'New'],
    ['', 'Yes', 'Blank', '06.10.2026', 'Contacted', 'Web', 'Jeddah', 'New'],
    ['700', 'Yes', 'Contact Only', '07.10.2026', 'Not Contacted', 'Web', 'Jeddah', 'New'],
  ]);
}

function crmCsv() {
  const lines = [
    ['Transaction No.', 'Prospect', 'Model', 'Status', 'Employee Responsible', 'Telephone', 'Employee Number', 'Centre'].join('\t'),
    ['00123', 'Prospect A', 'Camry', 'Open', 'Sara Nasser', '0550000001', '1001', 'Jeddah'].join('\t'),
    ['200', 'Prospect B', 'Hilux', 'Won', 'Ali Saleh', '0550000002', '2002', 'Riyadh'].join('\t'),
    ['300', 'Prospect C', 'Yaris', 'Open', 'Ali M', '0550000003', '3003', 'Jeddah'].join('\t'),
    ['400', 'Prospect D', 'Raize', 'Lost', 'Nora', '0550000004', '4004', 'Dammam'].join('\t'),
    ['500', 'Prospect E', 'Corolla', 'Open', 'Hadi', '0550000005', '5005', 'Jeddah'].join('\t'),
    ['800', 'Prospect F', 'Fortuner', 'Open', 'Unmatched Person', '0550000006', '8008', 'Jeddah'].join('\t'),
    ['', 'No Id', 'Camry', 'Open', 'Nobody', '0550000007', '1', 'Jeddah'].join('\t'),
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function main() {
  assert(api.classifyContactStatus('Not Contacted') === 'not_contacted', 'not contacted');
  assert(api.classifyContactStatus('Mystery') === 'unknown', 'unknown stays unknown');
  assert(api.classifyContactStatus('') === 'missing', 'blank is missing');
  assert(api.normalizeId('00123') === '00123', 'leading zeros stay on text');

  const contact = api.parseTable(contactFile(), 'contacts.xlsx', 'contact', XLSX);
  const crm = api.parseTable(crmCsv(), 'crm.txt', 'crm', XLSX);
  assert(!contact.errors.length, contact.errors.join('; '));
  assert(!crm.errors.length, crm.errors.join('; '));
  const lead123 = contact.rows.find((row) => row.leadNumber === '00123');
  assert(lead123, 'parsed lead 00123');
  const dataset = api.buildDataset(contact, crm);
  assert(!dataset.errors.length, dataset.errors.join('; '));
  const rec = dataset.reconciliation;
  assert(rec.matched === 4, `matched ${rec.matched}`);
  assert(rec.crmOnly === 1, `crm only ${rec.crmOnly}`);
  assert(rec.contactOnly === 1, `contact only ${rec.contactOnly}`);
  assert(rec.contactUnresolved === 1, 'conflicting duplicate left unmatched');
  assert(rec.contactMissingId === 1, 'blank lead counted');
  assert(rec.crmMissingId === 1, 'blank transaction counted');
  assert(rec.unknownStatus === 1, 'mystery status counted as unknown');
  const matchedKeys = dataset.records.filter((row) => row.matchKind === 'matched').map((row) => row.leadNumber);
  assert(!matchedKeys.includes('200'), 'unresolved duplicate 200 is not matched');
  const mystery = dataset.records.find((row) => row.leadNumber === '400');
  assert(mystery.bucket === 'unknown', 'mystery is not not-contacted');
  const only = dataset.records.find((row) => row.transactionNo === '800');
  assert(only.bucket === 'unmatched', 'crm only is unmatched');
  const summary = api.summarize(dataset, { employee: '', centre: '', source: '', leadType: '', crm: '', q: '' });
  assert(summary.kpis.totalCrm === 5, `total crm ${summary.kpis.totalCrm}`);
  assert(summary.kpis.matched === 4, 'kpi matched');
  assert(summary.kpis.contacted === 2, `contacted ${summary.kpis.contacted}`);
  assert(summary.kpis.notContacted === 0, 'unknown is not not-contacted');
  assert(summary.kpis.inProgress === 1, 'in progress');
  assert(summary.kpis.contactRate === 50, `rate ${summary.kpis.contactRate}`);
  const sara = summary.employees.find((row) => row.number === '1001');
  const aliM = summary.employees.find((row) => row.name === 'Ali M');
  assert(sara && sara.contactRate === 100, 'sara rate');
  assert(aliM && aliM.key !== sara.key, 'similar names stay separate');
  const leads = api.listLeads(dataset, { employee: '', centre: '', source: '', leadType: '', crm: '', contact: 'unmatched', q: '', sort: 'transactionNo', dir: 'asc', page: 1, pageSize: 25 });
  assert(leads.total === 1 && leads.rows[0].transactionNo === '800', 'unmatched filter');
  assert(!leads.rows[0].telephone, 'list hides telephone');

  const badBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(badBook, XLSX.utils.aoa_to_sheet([['Name'], ['x']]), 'Notes');
  XLSX.utils.book_append_sheet(badBook, XLSX.utils.aoa_to_sheet([['Other'], ['y']]), 'Extra');
  const badBuf = XLSX.write(badBook, { type: 'buffer', bookType: 'xlsx' });
  const bad = api.parseTable(badBuf, 'bad.xlsx', 'contact', XLSX);
  assert(bad.errors.some((line) => /Export worksheet/.test(line)), 'unexpected sheet blocks');
  const noTxn = api.parseTable(Buffer.from('Prospect,Status\nA,Open\n', 'utf8'), 'crm.csv', 'crm', XLSX);
  assert(noTxn.errors.some((line) => /Transaction No/.test(line)), 'missing transaction column');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const routes = [];
  const app = {
    get(routePath, handler) { routes.push({ method: 'GET', routePath, handler }); },
    post(routePath, handler) { routes.push({ method: 'POST', routePath, handler }); },
  };
  api.attachContactPerformance(app, { dir, password: '1234', XLSX, broadcast() {} });

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
    const qs = urlPath.split('?')[1] || '';
    new URLSearchParams(qs).forEach((value, key) => { query[key] = value; });
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

  const denied = await call('POST', '/api/contact-performance/preview', { period: '2026-10' }, false);
  assert(denied.status === 401, 'employee cannot preview');
  const blocked = await call('POST', '/api/contact-performance/preview', {
    period: '2026-10',
    contactFile: { name: 'bad.xlsx', base64: badBuf.toString('base64') },
    crmFile: { name: 'crm.txt', base64: crmCsv().toString('base64') },
  }, true);
  assert(blocked.status === 422, 'invalid file does not publish');
  const metaBefore = await call('GET', '/api/contact-performance/meta');
  assert(!metaBefore.data.activeId, 'failed validation left no active dataset');

  const preview = await call('POST', '/api/contact-performance/preview', {
    period: '2026-10',
    publishedBy: 'Admin',
    contactFile: { name: 'contacts.xlsx', base64: contactFile().toString('base64') },
    crmFile: { name: 'crm.txt', base64: crmCsv().toString('base64') },
  }, true);
  assert(preview.status === 200 && preview.data.draftId, preview.data.error || 'preview failed');
  const stillEmpty = await call('GET', '/api/contact-performance/summary');
  assert(stillEmpty.data.empty, 'preview is not live');
  const published = await call('POST', '/api/contact-performance/publish', { draftId: preview.data.draftId }, true);
  assert(published.status === 200, 'publish');
  const live = await call('GET', '/api/contact-performance/summary');
  assert(live.data.kpis.matched === 4, 'dashboard reads published data');
  assert(live.data.employees.every((row) => row.ach == null), 'no invented ACH');

  const second = await call('POST', '/api/contact-performance/preview', {
    period: '2026-11',
    contactFile: { name: 'contacts.xlsx', base64: contactFile().toString('base64') },
    crmFile: { name: 'crm.txt', base64: crmCsv().toString('base64') },
  }, true);
  const publishedNov = await call('POST', '/api/contact-performance/publish', { draftId: second.data.draftId }, true);
  assert(publishedNov.status === 200, 'second period');
  const history = await call('GET', '/api/contact-performance/history', null, true);
  assert(history.data.publications.length === 2, 'history keeps both periods');
  const october = history.data.publications.find((item) => item.period === '2026-10');
  const rolled = await call('POST', '/api/contact-performance/rollback', { publicationId: october.id }, true);
  assert(rolled.status === 200, 'rollback');
  const after = await call('GET', '/api/contact-performance/meta');
  assert(after.data.activeId === october.id, 'october is active again');
  const nov = history.data.publications.find((item) => item.period === '2026-11');
  const old = await call('GET', `/api/contact-performance/summary?publication=${encodeURIComponent(nov.id)}`);
  assert(old.data.period === '2026-11', 'historical snapshot still loads');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('contact-performance tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
