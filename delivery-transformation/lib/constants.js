'use strict';

/** Delivery Transformation — isolated module (no shared store with deliveryteam / delivery-hub). */

const STATUSES = Object.freeze([
  'Claimed',
  'PSFU',
  'تم التسليم',
  'جاهز للتسليم',
  'تسليم متقدم',
  'صادرة',
  'مرور',
  'رجوع مرور',
  'بطاقة',
  'فسح',
  'معلقة',
  'الغاء',
]);

const YES_NO = Object.freeze(['Yes', 'No']);

const CARRIERS = Object.freeze([
  'طريق الراسي',
  'درب الرياض',
  'ذكاء جميل',
  'الحسناء',
  'البستان الجميل',
  'سعيد البسامي',
  'اريكو',
  'وسم الثريا',
  'احد الفرسان',
]);

const TRANSFER_CITIES = Object.freeze([
  'الرياض',
  'جدة',
  'الدمام',
  'مكة',
  'المدينة',
  'أبها',
  'تبوك',
  'حائل',
  'الخبر',
  'الجبيل',
]);

/**
 * Users for this isolated app only.
 * - admin: full details + edit
 * - coordinator: Live Sheet VIN + details (read-only, no employee entry)
 * - employee: Live Sheet see + edit (ops entry)
 */
const USERS = Object.freeze([
  { id: 'admin', name: 'Admin', role: 'admin' },
  { id: 'coordinator', name: 'Coordinator', role: 'coordinator' },
  { id: 'rasha', name: 'Rasha', role: 'employee' },
  { id: 'ruba', name: 'Ruba', role: 'employee' },
  { id: 'ibrahim', name: 'Ibrahim', role: 'employee' },
  { id: 'abdullah', name: 'Abdullah', role: 'employee' },
]);

const OPS_FIELDS = Object.freeze([
  'opsStatus',
  'guestSentDate',
  'signatureReceivedDate',
  'accountsSentDate',
  'accountsApprovalDate',
  'vin1502',
  'trafficFile',
  'trafficFeesOps',
  'insuranceOps',
  'registrationIssueDate',
  'transferCity',
  'carrier',
  'notes',
  'guestCenter',
]);

function emptyOps() {
  return {
    opsStatus: '',
    guestSentDate: '',
    signatureReceivedDate: '',
    accountsSentDate: '',
    accountsApprovalDate: '',
    vin1502: '',
    trafficFile: '',
    trafficFeesOps: '',
    insuranceOps: '',
    registrationIssueDate: '',
    transferCity: '',
    carrier: '',
    notes: '',
    guestCenter: '',
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    assignedBy: '',
    assignedAt: '',
    updatedBy: '',
    updatedAt: '',
  };
}

function emptyRaw() {
  return {
    date: '',
    proformaDate: '',
    salesOrder: '',
    vin: '',
    product: '',
    salesType: '',
    invoiceOwner: '',
    userName: '',
    salesAdvisor: '',
    phone: '',
    gtLocation: '',
    vehicleLocation: '',
    pic: '',
  };
}

module.exports = {
  STATUSES,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  USERS,
  OPS_FIELDS,
  emptyOps,
  emptyRaw,
};
