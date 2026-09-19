'use strict';

/**
 * Privacy helpers — never expose full customer names or phone numbers in UI/API/exports.
 * Name: first character kept, remaining characters replaced with *
 * Phone: never shown (empty / em dash)
 */

function maskPersonName(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'n/a') return s || '—';
  // Preserve spaces/separators; mask each word: A**** B**
  return s.replace(/[^\s]+/g, (word) => {
    const chars = Array.from(word);
    if (!chars.length) return word;
    return chars[0] + '*'.repeat(Math.max(0, chars.length - 1));
  });
}

/** Never display phone numbers. */
function maskPhone(_value) {
  return '';
}

function phoneDisplay(_value) {
  return '—';
}

/** Apply privacy to a Raw Data–style object (mutates copy). */
function redactRawPii(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  if ('userName' in out) out.userName = maskPersonName(out.userName);
  if ('customerName' in out) out.customerName = maskPersonName(out.customerName);
  if ('customer' in out) out.customer = maskPersonName(out.customer);
  if ('guestName' in out) out.guestName = maskPersonName(out.guestName);
  if ('phone' in out) out.phone = maskPhone(out.phone);
  if ('guestPhone' in out) out.guestPhone = maskPhone(out.guestPhone);
  if ('mobile' in out) out.mobile = maskPhone(out.mobile);
  if ('phoneNumber' in out) out.phoneNumber = maskPhone(out.phoneNumber);
  return out;
}

module.exports = {
  maskPersonName,
  maskPhone,
  phoneDisplay,
  redactRawPii,
};
