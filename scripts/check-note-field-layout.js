/**
 * Field positions for قائمة فحص السيارات وقت التسليم (اسامة12.pdf)
 * Only overlay the fields the agent fills.
 * [tag, x, y, w, h, align?] — fractions of page width/height
 *
 * Form header box (RTL):
 *   Center labels: إسم المالك / المستخدم / هاتف / بريد / رقم الهوية / وقت الطباعة
 *   Right labels:  إسم الفرع / المدينة / السجل / هاتف / تاريخ الطباعة
 * Values sit to the LEFT of their Arabic labels.
 */
const CHECK_NOTE_FIELDS = [
  // Owner / user block (left of center labels)
  ['wh_owner_name', 0.05, 0.100, 0.33, 0.015, 'end'],
  ['wh_user_name', 0.05, 0.116, 0.33, 0.015, 'end'],
  ['wh_user_phone', 0.05, 0.132, 0.33, 0.015, 'end'],
  // skip email row (~0.148)
  ['wh_user_id', 0.05, 0.164, 0.33, 0.015, 'end'],

  // Bottom row of header box
  ['wh_print_time', 0.05, 0.180, 0.30, 0.015, 'end'],
  ['wh_print_date', 0.50, 0.180, 0.22, 0.015, 'end'],

  // Chassis line under the header box
  ['wh_chassis', 0.20, 0.208, 0.42, 0.016, 'center']
];

const CHECK_NOTE_COVERS = [];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
  window.CHECK_NOTE_COVERS = CHECK_NOTE_COVERS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS, CHECK_NOTE_COVERS };
}
