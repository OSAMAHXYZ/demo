/**
 * Field positions for قائمة فحص السيارات وقت التسليم (اسامة12.pdf)
 * Pure page fractions only (no px) so screen + print stay aligned.
 * [tag, x, y, w, h, align?]
 */
const CHECK_NOTE_FIELDS = [
  // Left-of-center values (next to إسم المالك / المستخدم / هاتف / رقم الهوية)
  ['wh_owner_name', 0.05, 0.118, 0.33, 0.014, 'end'],
  ['wh_user_name', 0.05, 0.136, 0.33, 0.014, 'end'],
  ['wh_user_phone', 0.05, 0.170, 0.33, 0.014, 'end'],
  ['wh_user_id', 0.05, 0.188, 0.33, 0.014, 'end'],

  // Bottom row of header box (وقت / تاريخ طباعة المستند)
  ['wh_print_time', 0.05, 0.206, 0.30, 0.014, 'end'],
  ['wh_print_date', 0.50, 0.206, 0.22, 0.014, 'end'],

  // Chassis line under the header box
  ['wh_chassis', 0.22, 0.238, 0.42, 0.016, 'center']
];

const CHECK_NOTE_COVERS = [];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
  window.CHECK_NOTE_COVERS = CHECK_NOTE_COVERS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS, CHECK_NOTE_COVERS };
}
