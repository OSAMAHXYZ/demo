/**
 * Field positions for قائمة فحص السيارات وقت التسليم / delivery_check_note
 * [tag, x, y, w, h, align?] — fractions of page width/height
 */
const CHECK_NOTE_FIELDS = [
  // Right column — branch block (labels on right, values on left)
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

// White cover boxes to hide pre-printed sample data on the check-note image
// [x, y, w, h] as fractions of page width/height
const CHECK_NOTE_COVERS = [
  // Right col values — branch info
  [0.29, 0.074, 0.30, 0.108],
  // Left col values — owner/user info
  [0.07, 0.074, 0.28, 0.108],
  // Date + time line
  [0.07, 0.154, 0.52, 0.020],
  // VIN / chassis
  [0.09, 0.184, 0.44, 0.022],
  // Guest name at bottom
  [0.44, 0.866, 0.38, 0.024],
  // Delivery officer name at bottom
  [0.07, 0.866, 0.32, 0.024]
];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS };
}
