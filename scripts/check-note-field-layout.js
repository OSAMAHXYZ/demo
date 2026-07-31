/**
 * Field positions for قائمة فحص السيارات وقت التسليم (اسامة12.pdf)
 * [tag, x, y, w, h, align?] — fractions of page width/height
 */
const CHECK_NOTE_FIELDS = [
  // Right column — branch block values (under Arabic labels)
  ['wh_branch_name', 0.42, 0.105, 0.28, 0.016, 'end'],
  ['wh_city_address', 0.42, 0.122, 0.28, 0.016, 'end'],
  ['wh_branch_cr', 0.42, 0.139, 0.28, 0.016, 'end'],
  ['wh_branch_phone', 0.42, 0.156, 0.28, 0.016, 'end'],
  ['wh_center_code', 0.42, 0.173, 0.18, 0.016, 'end'],

  // Left / middle — owner block
  ['wh_owner_name', 0.08, 0.105, 0.28, 0.016, 'end'],
  ['wh_user_name', 0.08, 0.122, 0.28, 0.016, 'end'],
  ['wh_user_phone', 0.08, 0.139, 0.28, 0.016, 'end'],
  ['wh_user_email', 0.08, 0.156, 0.28, 0.016, 'end'],
  ['wh_user_id', 0.08, 0.173, 0.28, 0.016, 'end'],

  // Print date / time row
  ['wh_print_date', 0.42, 0.195, 0.22, 0.016, 'end'],
  ['wh_print_time', 0.12, 0.195, 0.22, 0.016, 'end'],

  // Chassis row
  ['wh_chassis', 0.12, 0.228, 0.42, 0.018, 'center'],

  // Bottom signatures
  ['wh_guest_name', 0.48, 0.875, 0.36, 0.020, 'end'],
  ['wh_technicians_name', 0.08, 0.875, 0.30, 0.020, 'end']
];

// No white covers — show the PDF form as-is
const CHECK_NOTE_COVERS = [];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
  window.CHECK_NOTE_COVERS = CHECK_NOTE_COVERS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS, CHECK_NOTE_COVERS };
}
