'use strict';

/**
 * Delivery Team privacy — never capture or expose customer name,
 * invoice owner, or phone numbers.
 */

const PII_KEYS = Object.freeze(['invoiceOwner', 'userName', 'phone']);

function maskPersonName(_value) {
  return '—';
}

function maskPhone(_value) {
  return '—';
}

function phoneDisplay(_value) {
  return '—';
}

/** Strip PII fields from a raw row (upload / store). */
function stripRawPii(raw) {
  if (!raw || typeof raw !== 'object') return raw || {};
  const out = { ...raw };
  PII_KEYS.forEach((k) => {
    out[k] = '';
  });
  return out;
}

/** Redact PII for API / UI responses (existing store may still hold old values). */
function redactRawPii(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    ...raw,
    invoiceOwner: '—',
    userName: '—',
    phone: '—',
  };
}

module.exports = {
  PII_KEYS,
  maskPersonName,
  maskPhone,
  phoneDisplay,
  stripRawPii,
  redactRawPii,
};
