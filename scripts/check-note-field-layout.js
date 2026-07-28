/**
 * Field positions for قائمة فحص السيارات وقت التسليم / delivery_check_note
 * [tag, x, y, w, h, align?] — fractions of page width/height
 */
const CHECK_NOTE_FIELDS = [
  // Left column — branch block
  ['wh_branch_name', 0.08, 0.112, 0.34, 0.018, 'end'],
  ['wh_city_address', 0.08, 0.132, 0.34, 0.018, 'end'],
  ['wh_branch_cr', 0.08, 0.152, 0.34, 0.018, 'end'],
  ['wh_branch_phone', 0.08, 0.172, 0.34, 0.018, 'end'],
  ['wh_center_code', 0.08, 0.192, 0.34, 0.018, 'end'],
  ['wh_print_date', 0.08, 0.212, 0.34, 0.018, 'end'],

  // Right column — owner / user block
  ['wh_owner_name', 0.52, 0.112, 0.40, 0.018, 'end'],
  ['wh_user_name', 0.52, 0.132, 0.40, 0.018, 'end'],
  ['wh_user_phone', 0.52, 0.152, 0.40, 0.018, 'end'],
  ['wh_user_email', 0.52, 0.172, 0.40, 0.018, 'end'],
  ['wh_user_id', 0.52, 0.192, 0.40, 0.018, 'end'],
  ['wh_print_time', 0.52, 0.212, 0.40, 0.018, 'end'],

  // Chassis row
  ['wh_chassis', 0.28, 0.248, 0.48, 0.022, 'center'],

  // Bottom signatures
  ['wh_guest_name', 0.12, 0.875, 0.34, 0.022, 'end'],
  ['wh_technicians_name', 0.55, 0.875, 0.36, 0.022, 'end']
];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS };
}
