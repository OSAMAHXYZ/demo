'use strict';

const assert = require('assert');
const rtl = require('./rtl-inventory');

function row(partial) {
  return {
    vin: 'JTDBR32E830123456',
    product: 'CAMRY',
    searchArea: 'Other',
    location: 'Yard',
    allocationDate: '2026-10-18',
    age: '3',
    secondaryStatus: '',
    fileDate: '2026-10-18',
    ...partial,
  };
}

function sync(state, rows, extra) {
  return rtl.applySync(state, {
    rows,
    at: '2026-10-18T09:00:00.000Z',
    pushId: 'push-1',
    fileName: 'rtl.xlsx',
    ...(extra || {}),
  });
}

const telesales = '7022 Telesales North';
const ecommerce = '7277 eCommerce Sales – Retail';
const retail = 'Retail Electronic Sales';

// 1–3. Push processes every valid VIN once.
{
  const matrix = [
    ['VIN', 'Product', 'Search Area Desc', 'Age', 'Secondary Status Description', 'Allocated Location', 'Allocation Date'],
    [' jtdbR32E830123456 ', 'CAMRY', retail, '0', '', 'Yard', '2026-10-18'],
    ['JTDBR32E830123456', 'CAMRY', retail, '0', '', 'Yard', '2026-10-17'],
    ['', 'RAV4', retail, '0', '', 'Yard', '2026-10-18'],
  ];
  const parsed = rtl.rowsFromMatrix(matrix, '2026-10-18');
  assert.strictEqual(parsed.uniqueVins, 1);
  assert.strictEqual(parsed.duplicates, 1);
  assert.strictEqual(parsed.rejected, 1);
  assert.strictEqual(parsed.rows[0].allocationDate, '2026-10-18');
  const first = sync(rtl.emptyState(), parsed.rows, {
    processed: parsed.processed,
    duplicates: parsed.duplicates,
    rejected: parsed.rejected,
  });
  assert.strictEqual(first.summary.ok, true);
  assert.strictEqual(first.summary.uniqueVins, 1);
  assert.strictEqual(Object.keys(first.state.byVin).length, 1);
}

// 4–8. Special locations, delivery note, and physical delivery stay separate.
{
  const vin = 'JTDKN3DU5E0123456';
  const base = row({ vin, location: telesales, searchArea: 'Showroom' });
  const open = rtl.classifyStock({ row: base, previous: null, salesRaw: {}, deliveryNote: null, viewerId: 'alfadel' });
  assert.strictEqual(open.stockStatus, 'STOCK IN / AVAILABLE');
  const shop = rtl.classifyStock({
    row: row({ vin, location: ecommerce, searchArea: 'Showroom' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'albara',
  });
  assert.strictEqual(shop.stockStatus, 'STOCK IN / AVAILABLE');
  const noted = rtl.classifyStock({
    row: base,
    previous: null,
    salesRaw: {},
    deliveryNote: { active: true, number: 'DN-10' },
    viewerId: 'alfadel',
  });
  assert.strictEqual(noted.stockStatus, 'WITH DELIVERY NOTE / STOCK OUT');
  assert.notStrictEqual(noted.stockStatus, 'DELIVERED');
  const delivered = rtl.classifyStock({
    row: base,
    previous: null,
    salesRaw: { deliveryDate: '2026-10-18', proformaDate: '2026-10-01' },
    deliveryNote: { active: true, number: 'DN-10' },
    viewerId: 'alfadel',
  });
  assert.strictEqual(delivered.stockStatus, 'DELIVERED');
}

// 9. Ruba does not receive the two-location Stock In rule.
{
  const ruba = rtl.classifyStock({
    row: row({ location: telesales, searchArea: 'Showroom' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'ruba',
  });
  assert.notStrictEqual(ruba.stockStatus, 'STOCK IN / AVAILABLE');
  assert.match(ruba.reason, /Ruba/);
  const noted = rtl.classifyStock({
    row: row({ location: telesales, searchArea: 'Showroom' }),
    previous: null,
    salesRaw: {},
    deliveryNote: { active: true, number: 'DN-1' },
    viewerId: 'ruba',
  });
  assert.notStrictEqual(noted.stockStatus, 'WITH DELIVERY NOTE / STOCK OUT');
}

// 10–13. Newest proforma wins. Equal dates keep the last row. Dates parse. Previous month stays eligible.
{
  const picked = rtl.selectSalesRawItems([
    { vin: 'AAA111', raw: { proformaDate: '2026-09-01' } },
    { vin: 'AAA111', raw: { proformaDate: '01/10/2026' } },
    { vin: 'AAA111', raw: { proformaDate: '2026-10-01', product: 'older' } },
    { vin: 'AAA111', raw: { proformaDate: '2026-10-01', product: 'last' } },
    { vin: 'BBB222', raw: { proformaDate: '', proformaInvalid: true, product: 'bad' } },
    { vin: 'BBB222', raw: { proformaDate: '2026-08-02', product: 'good' } },
  ]);
  const aaa = picked.items.find((item) => item.vin === 'AAA111');
  assert.strictEqual(aaa.raw.product, 'last');
  assert.strictEqual(aaa.raw.proformaDate, '2026-10-01');
  const bbb = picked.items.find((item) => item.vin === 'BBB222');
  assert.strictEqual(bbb.raw.product, 'good');
  assert.strictEqual(picked.invalid.length, 1);
  assert.deepStrictEqual(rtl.parseDate('18/10/2026'), { iso: '2026-10-18', valid: true, empty: false });
  assert.deepStrictEqual(rtl.parseDate('2026-10-18'), { iso: '2026-10-18', valid: true, empty: false });
  assert.strictEqual(rtl.parseDate('not-a-date').valid, false);
  assert.strictEqual(rtl.previousMonthEligible({ proformaDate: '2026-09-15', invoiceDate: '' }, '2026-10', '2026-09'), true);
  assert.strictEqual(rtl.previousMonthEligible({ proformaDate: '2026-09-15', invoiceDate: '2026-10-01' }, '2026-10', '2026-09'), false);
}

// 14–16. Swapped in, swapped out, and a missing VIN keep history.
{
  const state = rtl.emptyState();
  const vin = 'JTMAB3FV80D123456';
  sync(state, [row({ vin, searchArea: 'Central', location: 'Yard' })]);
  const swappedIn = sync(state, [row({ vin, searchArea: retail, location: 'Yard', age: '4' })], { pushId: 'push-2', at: '2026-10-18T10:00:00.000Z' });
  assert.strictEqual(state.byVin[vin].stockStatus, 'SWAPPED IN');
  assert.strictEqual(swappedIn.summary.swappedIn, 1);
  sync(state, [row({ vin, searchArea: 'Fleet', location: 'Jeddah', age: '4' })], { pushId: 'push-3', at: '2026-10-18T11:00:00.000Z' });
  assert.strictEqual(state.byVin[vin].stockStatus, 'SWAPPED OUT');
  assert.strictEqual(state.byVin[vin].previousLocation, 'Yard');
  sync(state, [row({ vin: 'OTHERVIN123456789', searchArea: retail, location: 'Yard', age: '0' })], { pushId: 'push-4', at: '2026-10-18T12:00:00.000Z' });
  assert.strictEqual(state.byVin[vin].missing, true);
  assert.strictEqual(state.byVin[vin].stockStatus, 'MISSING FROM RTL');
  assert.strictEqual(state.byVin[vin].location, 'Jeddah');
}

// 16–17. The same push is idempotent. A failed sync can be retried.
{
  const state = rtl.emptyState();
  const rows = [row({ searchArea: retail, age: '0' })];
  const once = sync(state, rows);
  const twice = sync(state, rows);
  assert.strictEqual(twice.duplicate, true);
  assert.strictEqual(state.snapshots.length, 1);
  assert.strictEqual(once.summary.movements, twice.summary.movements);
  const failed = rtl.emptyState();
  const failure = rtl.recordFailure(failed, {
    message: 'workbook unreadable',
    pushId: 'push-x',
    rows,
  });
  assert.strictEqual(failure.ok, false);
  const retried = rtl.applySync(failed, { rows, at: '2026-10-18T13:00:00.000Z', pushId: 'push-x' });
  assert.strictEqual(retried.ok, true);
  assert.strictEqual(Object.keys(failed.byVin).length, 1);
  const again = rtl.applySync(failed, { rows, at: '2026-10-18T14:00:00.000Z', pushId: 'push-x' });
  assert.strictEqual(again.duplicate, true);
}

// 18. A saved delivery note is kept when the VIN leaves the next RTL file.
{
  const state = rtl.emptyState();
  const vin = 'JTNB23HK003123456';
  sync(state, [row({ vin, location: ecommerce, searchArea: 'Showroom' })]);
  state.byVin[vin].deliveryNoteActive = true;
  state.byVin[vin].deliveryNoteNumber = 'DN-22';
  const next = [row({ vin: 'JTNEW000000000001', searchArea: retail, age: '0', location: 'Yard' })];
  rtl.applySync(state, {
    rows: next,
    at: '2026-10-18T15:00:00.000Z',
    pushId: 'push-5',
    notesByVin: { [vin]: { active: true, number: 'DN-22' } },
  });
  assert.strictEqual(state.byVin[vin].missing, true);
  assert.strictEqual(state.byVin[vin].stockStatus, 'WITH DELIVERY NOTE / STOCK OUT');
  assert.strictEqual(state.byVin[vin].deliveryNoteNumber, 'DN-22');
  assert.ok(state.byVin[vin].location);
}

// 19–24. Cities and companies persist in the org state and do not change stock eligibility.
{
  const org = { cities: [], companies: [] };
  const city = rtl.saveCity(org, { name: ' Riyadh ', country: 'Saudi Arabia' }, 'admin');
  assert.strictEqual(org.cities.length, 1);
  assert.throws(() => rtl.saveCity(org, { name: 'riyadh', country: 'Saudi Arabia' }, 'admin'), /already exists/);
  const company = rtl.saveCompany(org, { name: 'ALJ', code: 'ALJ', cityId: city.id }, 'admin');
  assert.strictEqual(company.cityId, city.id);
  assert.throws(() => rtl.saveCompany(org, { name: 'Other', code: 'alj', cityId: city.id }, 'admin'), /code/);
  rtl.saveCity(org, { id: city.id, name: 'Riyadh', country: 'Saudi Arabia', status: 'inactive' }, 'admin');
  assert.strictEqual(org.companies[0].cityId, city.id);
  assert.strictEqual(rtl.publicOrg(org).companies[0].cityName, 'Riyadh');
  assert.throws(() => rtl.saveCity(org, { name: 'Jeddah' }, 'employee'), /admin/);
  const before = rtl.classifyStock({
    row: row({ location: 'Yard', searchArea: 'Showroom' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'alfadel',
  }).stockStatus;
  rtl.saveCity(org, { name: 'Dammam' }, 'admin');
  const after = rtl.classifyStock({
    row: row({ location: 'Yard', searchArea: 'Showroom' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'alfadel',
  }).stockStatus;
  assert.strictEqual(before, after);
  assert.strictEqual(before, 'UNDEFINED / REVIEW REQUIRED');
}

// New allocation is age 0 on the file date. Free stock uses the secondary status. Whitespace in the special location still matches.
{
  const created = rtl.classifyStock({
    row: row({ searchArea: retail, age: '0', allocationDate: '2026-10-18', fileDate: '2026-10-18', secondaryStatus: '' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'alfadel',
  });
  assert.strictEqual(created.stockStatus, 'STOCK IN / AVAILABLE');
  const free = rtl.classifyStock({
    row: row({ searchArea: 'Central', secondaryStatus: 'Vehicle allocation completed', age: '6' }),
    previous: null,
    salesRaw: {},
    deliveryNote: null,
    viewerId: 'alfadel',
  });
  assert.strictEqual(free.stockStatus, 'FREE IN MY STOCK');
  const spaced = rtl.specialLocation('  7022   Telesales   North ');
  assert.ok(spaced);
  assert.strictEqual(rtl.specialLocation('7022 Telesales North Warehouse'), null);
}

console.log('rtl-inventory tests passed');
