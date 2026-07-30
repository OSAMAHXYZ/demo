/**
 * Field positions for قائمة فحص السيارات وقت التسليم / delivery_check_note
 * [tag, x, y, w, h, align?] — fractions of page width/height
 * Preview background is a blank empty form (no sample data).
 */
const CHECK_NOTE_FIELDS = [
  // Right column — branch block
  ['wh_branch_name', 0.30, 0.078, 0.28, 0.016, 'end'],
  ['wh_city_address', 0.30, 0.094, 0.28, 0.016, 'end'],
  ['wh_branch_cr', 0.30, 0.110, 0.28, 0.016, 'end'],
  ['wh_branch_phone', 0.30, 0.126, 0.28, 0.016, 'end'],
  ['wh_center_code', 0.30, 0.142, 0.28, 0.016, 'end'],
  ['wh_print_date', 0.30, 0.158, 0.28, 0.016, 'end'],

  // Left column — owner / user block
  ['wh_owner_name', 0.08, 0.078, 0.28, 0.016, 'end'],
  ['wh_user_name', 0.08, 0.094, 0.28, 0.016, 'end'],
  ['wh_user_phone', 0.08, 0.110, 0.28, 0.016, 'end'],
  ['wh_user_email', 0.08, 0.126, 0.28, 0.016, 'end'],
  ['wh_user_id', 0.08, 0.142, 0.28, 0.016, 'end'],
  ['wh_print_time', 0.08, 0.158, 0.28, 0.016, 'end'],

  // Chassis row
  ['wh_chassis', 0.10, 0.188, 0.42, 0.018, 'center'],

  // Bottom signatures
  ['wh_guest_name', 0.45, 0.870, 0.36, 0.020, 'end'],
  ['wh_technicians_name', 0.08, 0.870, 0.30, 0.020, 'end']
];

// Blank form image — no white covers needed
const CHECK_NOTE_COVERS = [];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
  window.CHECK_NOTE_COVERS = CHECK_NOTE_COVERS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS, CHECK_NOTE_COVERS };
}
