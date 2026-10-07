/**
 * Plan Tracker calculation tests (Node).
 * Run: node report-sheet/plan-tracker.test.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

const RES = "Retail Electronic Sales";
const FLEET = "Fleet";

function d(y, m, day) {
  return new Date(y, m - 1, day);
}

function veh(vin, searchArea, age, agDate, extra) {
  return Object.assign({
    vin,
    searchArea,
    allocationAge: age,
    allocationDate: agDate,
    product: "CAMRY",
    suffix: "G",
  }, extra || {});
}

function pack(month, dayMap) {
  const days = {};
  Object.keys(dayMap).forEach((dk) => {
    days[dk] = { id: dk, vehicles: dayMap[dk] };
  });
  return { month, days };
}

function build(dayMap, month) {
  return PT.buildModel(pack(month || "2025-09", dayMap), { silent: true });
}

function loadPlanTracker() {
  const code = fs.readFileSync(path.join(__dirname, "plan-tracker.js"), "utf8");
  const sandbox = {
    console,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ click() {}, set href(_) {}, get href() { return ""; } }),
    },
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    Blob: function Blob() {},
    setTimeout,
    globalThis: null,
    window: null,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "plan-tracker.js" });
  return sandbox.PlanTracker;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertEq"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const PT = loadPlanTracker();
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    console.error(` FAIL  ${name}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Plan Tracker tests\n");

test("normalizeVin trims and uppercases", () => {
  assertEq(PT.normalizeVin("  abc123  "), "ABC123");
  assertEq(PT.normalizeVin(""), "");
  assertEq(PT.normalizeVin(null), "");
});

test("isRES matches contains Retail Electronic Sales", () => {
  assert(PT.isRES({ searchArea: RES }));
  assert(PT.isRES({ searchArea: "  retail electronic sales  " }));
  assert(!PT.isRES({ searchArea: FLEET }));
  assert(!PT.isRES({ searchArea: "" }));
});

test("Test 1 — Duplicate VIN same day", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN001", RES, 0, d(2025, 9, 13)),
    ],
  });
  const day = model.daily[0];
  assertEq(day.dailyUniqueRESAge0, 1, "daily RES age 0");
  assertEq(day.newPlanAllocations, 1, "plan allocation");
  assertEq(model.kpis.allocated, 1, "cumulative allocated");
  assertEq(model.quality.duplicateVin, 1, "duplicate flagged");
});

test("Test 2 — Same VIN next day does not double-count plan", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
    "2025-09-14": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  assertEq(model.daily[0].newPlanAllocations, 1, "13 Sep allocation");
  assertEq(model.daily[1].newPlanAllocations, 0, "14 Sep allocation");
  assertEq(model.daily[1].cumulativePlanAllocations, 1, "cumulative");
  assertEq(model.kpis.allocated, 1);
  // Daily RES age 0 still 1 on day 14 (independent of 315)
  assertEq(model.daily[1].dailyUniqueRESAge0, 1, "daily RES age 0 still visible");
});

test("Test 3 — Transfer into RES is not a plan receipt", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", FLEET, 0, d(2025, 9, 13))],
    "2025-09-14": [veh("VIN001", RES, 0, d(2025, 9, 14))],
  });
  assertEq(model.daily[1].transferIn.length, 1, "transfer in");
  assertEq(model.daily[1].newPlanAllocations, 0, "plan allocation");
  assertEq(model.kpis.allocated, 0);
  assertEq(model.firstAreaByVin.get("VIN001"), FLEET);
  assert(model.movements.some((m) => m.movementType === "TRANSFERRED INTO RES"));
});

test("Test 4 — Genuine new allocation", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  assertEq(model.daily[0].newPlanAllocations, 1);
  assertEq(model.daily[0].cumulativePlanAllocations, 1);
  assertEq(model.kpis.allocated, 1);
  assertEq(model.kpis.remaining, 314);
  assert(model.movements.some((m) => m.movementType === "NEW ALLOCATION"));
});

test("Test 5 — Prior-month stock is free stock", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 8, 20))],
  });
  assertEq(model.daily[0].freeStockCount, 1, "free stock");
  assertEq(model.daily[0].newPlanAllocations, 0, "plan allocation");
  assertEq(model.kpis.freeStock, 1);
  assertEq(model.kpis.allocated, 0);
  assertEq(model.kpis.totalReceived, 1);
  assertEq(model.kpis.progress, 0);
});

test("Test 6 — RES disappears; historical allocation kept", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
    "2025-09-14": [],
  });
  assertEq(model.daily[0].newPlanAllocations, 1);
  assertEq(model.daily[1].disappearedTarget, 1, "disappeared RES");
  assertEq(model.daily[1].cumulativePlanAllocations, 1, "historical plan kept");
  assertEq(model.kpis.allocated, 1);
  assert(model.movements.some((m) => m.movementType === "DISAPPEARED"));
});

test("Daily RES Age 0 example (duplicates + non-RES excluded)", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 0, d(2025, 9, 13)),
      veh("VIN003", RES, 1, d(2025, 9, 12)),
      veh("VIN004", FLEET, 0, d(2025, 9, 13)),
    ],
  });
  assertEq(model.daily[0].dailyUniqueRESAge0, 2, "VIN001 + VIN002");
  assertEq(model.daily[0].newPlanAllocations, 2, "both genuine plan receipts");
});

test("Progress never uses daily RES count", () => {
  const model = build({
    "2025-09-13": [
      veh("VIN001", RES, 0, d(2025, 9, 13)),
      veh("VIN002", RES, 1, d(2025, 9, 12)),
      veh("VIN003", RES, 0, d(2025, 8, 1)),
    ],
  });
  // 1 plan + 1 free + 1 aged RES visible
  assertEq(model.daily[0].dailyUniqueRESAge0, 2); // VIN001 age0 + VIN003 age0 free
  assertEq(model.kpis.allocated, 1);
  assertEq(model.kpis.freeStock, 1);
  assertEq(model.kpis.progress, 1 / 315);
  assertEq(model.daily[0].progress, 1 / 315);
});

test("planTrackerDebug shape", () => {
  const model = build({
    "2025-09-13": [veh("VIN001", RES, 0, d(2025, 9, 13))],
  });
  const dbg = model.planTrackerDebug[0];
  assert(dbg.date === "2025-09-13");
  assert(typeof dbg.dailyUniqueRESAge0 === "number");
  assert(Array.isArray(dbg.planReceipts));
  assert(dbg.reconciliation && typeof dbg.reconciliation.difference === "number");
});

test("Reconciliation OK for stay / transfer / disappear", () => {
  const model = build({
    "2025-09-13": [
      veh("A", RES, 0, d(2025, 9, 13)),
      veh("B", FLEET, 0, d(2025, 9, 13)),
    ],
    "2025-09-14": [
      veh("A", RES, 1, d(2025, 9, 13)),
      veh("B", RES, 0, d(2025, 9, 14)),
    ],
    "2025-09-15": [
      veh("B", RES, 1, d(2025, 9, 14)),
    ],
  });
  model.daily.forEach((day) => {
    assert(day.reconOk, `${day.dateKey} recon failed: expected ${day.expectedRES} actual ${day.actualRES}`);
  });
  assertEq(model.kpis.allocated, 1); // only A
  assertEq(model.daily[1].transferIn.length, 1); // B
  assertEq(model.daily[2].disappearedTarget, 1); // A gone
});

test("day 31 stays on the schedule", () => {
  const model = build({
    "2026-10-31": [veh("VIN31", RES, 0, d(2026, 10, 31))],
  }, "2026-10");
  assertEq(model.kpis.allocated, 1);
  const rows = PT.buildScheduleRows(model);
  const row = rows.find((r) => r.mtd === 1);
  assert(row, "schedule row missing");
  assertEq(row.dayCounts[31], 1);
  assertEq(row.dayCounts[1] || 0, 0);
});

test("one VIN keeps the original receipt when status changes", () => {
  const model = build({
    "2026-10-01": [veh("ABC123", RES, 0, d(2026, 10, 1), { product: "RAV4", suffix: "A2", year: "2026" })],
    "2026-10-02": [veh("ABC123", RES, 1, d(2026, 10, 1))],
    "2026-10-03": [veh("ABC123", "Other Search Area", 2, d(2026, 10, 1))],
  }, "2026-10");
  assertEq(model.kpis.allocated, 1);
  assertEq(model.lists.allocated[0].dateKey, "2026-10-01");
  const swapped = PT.buildControlCenter(model);
  assertEq(swapped.register.length, 1);
  assertEq(swapped.register[0].dateKey, "2026-10-01");
  assertEq(swapped.register[0].statusKey, "Swapped");
  assertEq(swapped.register[0].swapArea, "Other Search Area");
  assertEq(swapped.counts.Swapped + swapped.counts.Delivered + swapped.counts.Proforma + swapped.counts["My Stock"], 1);

  model.lists.allocated[0].salesKind = "proforma";
  model.lists.allocated[0].proformaDate = d(2026, 10, 2);
  const pro = PT.buildControlCenter(model);
  assertEq(pro.register.length, 1);
  assertEq(pro.register[0].statusKey, "Proforma");
  assertEq(pro.register[0].dateKey, "2026-10-01");

  model.lists.allocated[0].salesKind = "delivered";
  model.lists.allocated[0].invoiceDate = d(2026, 10, 5);
  const del = PT.buildControlCenter(model);
  assertEq(del.register[0].statusKey, "Delivered");
  assertEq(del.register[0].dateKey, "2026-10-01");
  assert(del.register[0].statusConflict, "delivered plus later non-RES should warn");
});

test("later RES observation is not a swap", () => {
  const model = build({
    "2026-10-01": [veh("STAY1", RES, 0, d(2026, 10, 1))],
    "2026-10-04": [veh("STAY1", RES, 3, d(2026, 10, 1))],
  }, "2026-10");
  const cc = PT.buildControlCenter(model);
  assertEq(cc.register.length, 1);
  assertEq(cc.register[0].statusKey, "My Stock");
});

test("my stock lists RES VINs when the date is not the file day", () => {
  const model = build({
    "2026-10-01": [veh("OLD1", RES, 4, d(2026, 9, 27), { year: "2025" })],
    "2026-10-04": [veh("OLD1", RES, 7, d(2026, 9, 27), { year: "2025" })],
  }, "2026-10");
  assertEq(model.kpis.allocated, 0);
  const rows = PT.myStockRows(model);
  assertEq(rows.length, 1);
  assertEq(rows[0].vin, "OLD1");
  assertEq(rows[0].statusKey, "My Stock");
  assertEq(rows[0].dateKey, "2026-10-01");
  model.lists.current[0].salesKind = "delivered";
  model.lists.current[0].invoiceDate = d(2026, 10, 4);
  assertEq(PT.myStockRows(model).length, 0);
});

test("swapped in is not my allocation", () => {
  const model = build({
    "2026-10-03": [veh("IN123", "Other Search Area", 0, d(2026, 10, 3))],
    "2026-10-04": [veh("IN123", RES, 1, d(2026, 10, 3))],
  }, "2026-10");
  assertEq(model.kpis.allocated, 0);
  const cc = PT.buildControlCenter(model);
  assertEq(cc.register.length, 0);
  const moved = PT.swappedInList(model, cc.register);
  assertEq(moved.length, 1);
  assertEq(moved[0].vin, "IN123");
  assertEq(moved[0].statusKey, "Swapped In");
});

test("each submitted RTL day counts every VIN with RES, age 0, and allocation date equal to that file", () => {
  const model = build({
    "2026-10-03": [
      veh("KEEP3", RES, 0, d(2026, 10, 3)),
      veh("OLDAG", RES, 0, d(2026, 10, 1)),
      veh("AGED", RES, 2, d(2026, 10, 3)),
      veh("FLEET3", FLEET, 0, d(2026, 10, 3)),
    ],
    "2026-10-04": [
      veh("KEEP3", RES, 0, d(2026, 10, 4)),
      veh("STALE", RES, 0, d(2026, 10, 3)),
    ],
    "2026-10-06": [veh("NEW6", RES, 0, d(2026, 10, 6))],
  }, "2026-10");
  const vins = (key) => model.daily.find((day) => day.dateKey === key).fileDayReceipts.map((r) => r.vin).sort().join(",");
  assertEq(model.daily.map((day) => day.dateKey).join(","), "2026-10-03,2026-10-04,2026-10-06");
  assertEq(vins("2026-10-03"), "KEEP3");
  assertEq(vins("2026-10-04"), "KEEP3");
  assertEq(vins("2026-10-06"), "NEW6");
});

test("age on a later file counts as a new car on the allocation date", () => {
  const model = build({
    "2026-10-04": [veh("DAY4", RES, 0, d(2026, 10, 4))],
    "2026-10-05": [
      veh("BACK", RES, 1, d(2026, 10, 4)),
      veh("DAY5", RES, 0, d(2026, 10, 5)),
      veh("DAY4", RES, 1, d(2026, 10, 4)),
      veh("WRONG", RES, 2, d(2026, 10, 4)),
      veh("FLEET5", FLEET, 1, d(2026, 10, 4)),
    ],
  }, "2026-10");
  const vins = (key) => model.daily.find((day) => day.dateKey === key).fileDayReceipts.map((r) => r.vin).sort().join(",");
  assertEq(vins("2026-10-04"), "BACK,DAY4");
  assertEq(vins("2026-10-05"), "DAY5");
});

test("a day stays on the calendar when my allocation is zero", () => {
  const model = build({
    "2026-10-03": [veh("ABC123", RES, 0, d(2026, 10, 3))],
    "2026-10-04": [veh("RES4", RES, 5, d(2026, 10, 3))],
    "2026-10-06": [veh("NEW6", RES, 0, d(2026, 10, 6))],
  }, "2026-10");
  assertEq(model.daily.map((day) => day.dateKey).join(","), "2026-10-03,2026-10-04,2026-10-06");
  const oct4 = model.daily.find((day) => day.dateKey === "2026-10-04");
  assertEq(oct4.resRows.length, 1);
  assertEq(oct4.resRows[0].vin, "RES4");
  assertEq(oct4.planReceipts.length, 0);
  assertEq(model.kpis.allocated, 2);
  assertEq(model.missingDates.join(","), "2026-10-05");
});

test("my stock splits free and undefined by secondary status", () => {
  const model = build({
    "2026-10-03": [
      veh("FREE1", RES, 0, d(2026, 10, 3), { secondaryStatus: "Vehicle allocation completed" }),
      veh("UND1", RES, 0, d(2026, 10, 3), { secondaryStatus: "Waiting" }),
    ],
  }, "2026-10");
  const cc = PT.buildControlCenter(model);
  assertEq(cc.register.length, 2);
  assertEq(cc.register.every((r) => r.statusKey === "My Stock"), true);
  const free = cc.register.filter((r) => PT.isVehicleAllocationCompleted(r.secondaryStatus));
  const undef = cc.register.filter((r) => !PT.isVehicleAllocationCompleted(r.secondaryStatus));
  assertEq(free.length, 1);
  assertEq(free[0].vin, "FREE1");
  assertEq(undef.length, 1);
  assertEq(undef[0].vin, "UND1");
});

test("SFX progress classifies daily-chart VINs", () => {
  const model = build({
    "2026-10-03": [
      veh("WITHIN1", RES, 0, d(2026, 10, 3), { secondaryStatus: "Vehicle allocation completed", product: "HILUX", suffix: "M0" }),
      veh("FLEET1", FLEET, 0, d(2026, 10, 3), { product: "HILUX", suffix: "MH" }),
    ],
    "2026-10-04": [
      veh("WITHIN1", RES, 1, d(2026, 10, 3), { secondaryStatus: "Pro-forma invoice created", product: "HILUX", suffix: "M0" }),
      veh("FLEET1", RES, 9, d(2026, 9, 1), { secondaryStatus: "Vehicle allocation completed", product: "HILUX", suffix: "MH" }),
      veh("NEW1", RES, 4, d(2026, 9, 1), { secondaryStatus: "Waiting", product: "HILUX", suffix: "U0" }),
      veh("HOLD1", RES, 0, d(2026, 10, 4), { secondaryStatus: "Customer hold", product: "HILUX", suffix: "U0" }),
    ],
    "2026-10-05": [
      veh("HOLD1", FLEET, 1, d(2026, 10, 4), { secondaryStatus: "Customer hold", product: "HILUX", suffix: "U0" }),
    ],
  }, "2026-10");
  const day = model.daily.find((d) => d.dateKey === "2026-10-03");
  day.fileDayReceipts.forEach((r) => {
    if (r.vin === "WITHIN1") r.invoiceDate = d(2026, 10, 6);
  });
  const buckets = PT.buildSfxBuckets(model, "2026-10");
  const all = emptyMerge(buckets);
  assertEq(all.within.map((r) => r.vin).sort().join(","), "HOLD1,WITHIN1");
  assertEq(all.delivered.map((r) => r.vin).join(","), "WITHIN1");
  assertEq(all.proforma.map((r) => r.vin).join(","), "WITHIN1");
  assertEq(all.stock.map((r) => r.vin).join(","), "");
  assertEq(all.reserved.map((r) => r.vin).join(","), "HOLD1");
  assertEq(all.swappedOut.map((r) => r.vin).join(","), "HOLD1");
  assertEq(all.swappedIn.map((r) => r.vin).sort().join(","), "FLEET1,NEW1");
});

function emptyMerge(buckets) {
  const out = { within: [], delivered: [], proforma: [], reserved: [], stock: [], swappedOut: [], swappedIn: [] };
  buckets.forEach((bucket) => {
    Object.keys(out).forEach((key) => { out[key] = out[key].concat(bucket[key] || []); });
  });
  return out;
}

test("normalizeVin is stable", () => {
  assertEq(PT.normalizeVin(" ab c-123 "), "ABC123");
  assertEq(PT.normalizeVin(12345), "12345");
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error("Some tests failed");
} else {
  console.log("All good.");
}
