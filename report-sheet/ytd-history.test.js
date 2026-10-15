/**
 * YTD historical import and reconciliation.
 * Run: node report-sheet/ytd-history.test.js
 */
"use strict";

const Y = require("./ytd-history.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const headerParent = ["", "", "", "", "", "January", "January", "January", "September", "September", "September", "October", "October", "October"];
const header = ["Employee Number", "Salesman Name", "Region", "Plant", "Center", "Sales", "Target", "Ach%", "Sales", "Target", "Ach%", "Sales", "Target", "Ach%"];
const matrix = [
  ["Toyota Sales Report", "8 October 2026"],
  headerParent,
  header,
  ["48476", "Ali Muharraq", "West", "Plant A", "Center 1", 10, 12, 83.3, 4, 8, 50, 2, 9, 22],
  ["100", "Noor Saleh", "West", "Plant A", "Center 1", 0, 5, 0, "", 6, "", 1, "", ""],
  ["200", "Same Name", "West", "Plant B", "Center 2", 3, 3, 100, 1, 1, 100, 1, 1, 100],
  ["201", "Same Name", "West", "Plant B", "Center 2", 4, 4, 100, 1, 1, 100, 1, 1, 100],
];

const parsed = Y.parsePerformance(matrix, { sheet: "Salesman Performance" });
assert(parsed.ok, "parse ok");
assert(parsed.asOf === "2026-10-08", "as of " + parsed.asOf);
assert(parsed.partialMonths.indexOf("2026-10") >= 0, "october partial");
assert(parsed.months["2026-01"].employees[0].sales === 10, "january sales");
assert(parsed.months["2026-01"].employees[0].target === 12, "january target");
assert(parsed.months["2026-09"].employees[1].sales == null, "blank september sales stays missing");
assert(parsed.months["2026-09"].employees[1].sales !== 0, "blank is not zero");
assert(parsed.months["2026-01"].employees[1].sales === 0, "numeric zero stays zero");
assert(!parsed.months["2026-11"], "november is not invented");
assert(parsed.months["2026-01"].employees[2].id === "200" && parsed.months["2026-01"].employees[3].id === "201", "same display name with different ids stays two people");

const invoices = [
  { name: "Ali Muharraq", id: "48476", invoice: new Date(2026, 0, 15), qty: 1, vin: "VIN1" },
  { name: "Ali Muharraq", id: "48476", invoice: new Date(2026, 0, 16), qty: 1, vin: "VIN1" },
  { name: "Other Person", id: "999", invoice: new Date(2026, 0, 20), qty: 2, vin: "VIN1" },
  { name: "Noor Saleh", id: "100", invoice: new Date(2026, 0, 2), qty: 3, vin: "VIN2" },
  { name: "Not assigned", id: "", invoice: new Date(2026, 0, 3), qty: 1, vin: "VIN3" },
  { name: "Future", id: "300", invoice: new Date(2026, 10, 1), qty: 4, vin: "VIN4" },
  { name: "Ali Muharraq", id: "48476", invoice: new Date(2026, 9, 4), qty: 1, vin: "VIN5" },
];
const agg = Y.aggregateInvoices(invoices, 2026);
assert(agg["2026-01"].flagged === 1, "conflicting VIN flagged");
assert(agg["2026-01"].employees.get("48476") == null || !agg["2026-01"].employees.get("48476").vins.includes("VIN1"), "conflict VIN not counted");
assert(agg["2026-01"].employees.get("100").actual === 3, "qty used");
assert(agg["2026-01"].unassigned === 1, "unassigned separate");
assert(agg["2026-11"].raw === 4, "november from invoice date");
assert(!agg["2026-10"] || agg["2026-10"].raw !== 4, "november not filed under upload month");

const rawJan = [...agg["2026-01"].employees.values(), { key: "same", id: "", name: "Same Name", actual: 5, unassigned: false, vins: ["VIN9"] }];
const rec = Y.reconcileMonth(parsed.months["2026-01"].employees, rawJan, false);
const noor = rec.find((r) => r.id === "100");
assert(noor && noor.report === 0 && noor.raw === 3 && noor.status === "Mismatch", "id match difference raw minus report");
const same = rec.filter((r) => r.name === "Same Name" && r.status === "Duplicate requiring review");
assert(same.length === 1 && same[0].raw === 5, "ambiguous name is flagged and not merged");
assert(rec.filter((r) => r.id === "200" || r.id === "201").length === 2, "both numbered employees remain");
assert(Y.achievement(3, null) == null, "missing target has no percent");
assert(Y.achievement(3, 0) == null, "zero target has no percent");

const oct = Y.reconcileMonth(parsed.months["2026-10"].employees, [...(agg["2026-10"] ? agg["2026-10"].employees.values() : [])], true);
assert(oct.every((r) => r.status === "Pending / incomplete source" || r.status === "Duplicate requiring review"), "october stays partial");
const aliOct = oct.find((r) => r.id === "48476");
assert(aliOct && aliOct.report === 2 && aliOct.raw === 1, "october report and raw stay separate");
assert(aliOct.raw + aliOct.report === 3, "values are not added into one actual");

const empty = Y.parsePerformance([["Hello"]], {});
assert(!empty.ok && /header/i.test(empty.error), "missing headers reported");

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("ytd-history tests passed");
