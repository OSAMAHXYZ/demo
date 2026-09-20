'use strict';

/**
 * Display helpers for customer PII.
 * Delivery Team shows full names and phone numbers to signed-in staff.
 */

function maskPersonName(value) {
  const s = String(value == null ? '' : value).trim();
  return s || '—';
}

function maskPhone(value) {
  const s = String(value == null ? '' : value).trim();
  return s;
}

function phoneDisplay(value) {
  const s = String(value == null ? '' : value).trim();
  return s || '—';
}

/** Pass-through copy (kept for callers that still use redactRawPii). */
function redactRawPii(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return { ...raw };
}

module.exports = {
  maskPersonName,
  maskPhone,
  phoneDisplay,
  redactRawPii,
};
