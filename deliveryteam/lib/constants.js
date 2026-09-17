'use strict';

/** Delivery Team — shared constants (statuses, cities, carriers, users). */

const STATUSES = Object.freeze([
  'Claimed',
  'PSFU',
  'تم التسليم',
  'جاهز للتسليم',
  'تسليم متقدم',
  'مرور',
  'بطاقة',
  'فسح',
  'رجوع مرور',
  'معلقة',
  'صادرة',
  'الغاء',
]);

const COMPLETED_STATUS = 'Claimed';

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
  'بقيق', 'الدمام', 'الظهران', 'راس تنورة', 'الهفوف', 'الخبر', 'القطيف', 'الجبيل', 'الاحساء',
  'الباحة', 'المخواة', 'بلجرشي', 'المندق', 'الجوف', 'سكاكا', 'القريات', 'عرعر', 'رفحاء', 'طريف',
  'العويقلية', 'الخرج', 'الرياض', 'حفر الباطن', 'المزاحمية', 'المجمعة', 'بريدة', 'عنيزة', 'دخنه',
  'الرس', 'المدينه المنوره', 'ينبع الصناعية', 'ينبع البحر', 'بدر', 'تبوك', 'املج', 'الوجه',
  'جيزان', 'ابو عريش', 'احد المسارحة', 'يشيد', 'حائل', 'ابها', 'خميس مشيط', 'بيشة', 'محايل عسير',
  'مكه المكرمه', 'الطائف', 'جده', 'المستودع', 'رابغ', 'مستورة', 'ثول', 'الليث', 'نجران', 'شرورة',
  'اوتومول', 'الدرب', 'شقراء', 'الجموم', 'القصيم', 'العلا', 'العرضيات', 'عفيف', 'صامطه',
  'حوطة سدير', 'احد رفيده', 'ضباء', 'رجال ألمع', 'الدوادمي', 'وادي الدواسر', 'الزلفي', 'بيش',
  'القنفذه', 'بحره', 'صبيا', 'الغاط', 'مهد الذهب', 'طبرجل', 'الخرمه', 'القويعيه', 'حريملاء',
  'سراة عبيد', 'بارق', 'الأفلاج', 'بللسمر', 'البدع', 'البكيريه', 'نيوم', 'المحارده', 'ظلم',
  'العقيق', 'عسير', 'تثليث', 'حقل', 'رنيه', 'النماص', 'حوطة بني تميم', 'القصب', 'المجارده',
  'النعيريه', 'البدائع', 'سليل', 'الخفجي', 'القوز', 'KAEC', 'المظيلف', 'خليص', 'تنومة', 'المهد',
  'سبت العلايا', 'سيهات', 'تمير', 'الشنان', 'اضم', 'ضرمه', 'شرما', 'خيبر', 'النشيفه', 'اشيقير',
  'تربه الطائف', 'تربه محايل عسير', 'الحيسونيه', 'القحمه', 'الرماح', 'حداء', 'تاروت', 'البشائر',
  'بني عمرو', 'تيماء', 'ظهران الجنوب', 'المويه', 'الحجره', 'الحناكيه', 'خريص', 'السليل',
]);

const EMPLOYEE_NAMES = Object.freeze(['Rasha', 'Ruba', 'Ibrahim', 'Abdullah']);

const USERS = Object.freeze([
  { id: 'admin', name: 'Admin', role: 'admin' },
  { id: 'hanouf', name: 'Hanouf', role: 'hanouf' },
  { id: 'rasha', name: 'Rasha', role: 'employee' },
  { id: 'ruba', name: 'Ruba', role: 'employee' },
  { id: 'ibrahim', name: 'Ibrahim', role: 'employee' },
  { id: 'abdullah', name: 'Abdullah', role: 'employee' },
]);

/** Excel header aliases → canonical raw field keys */
const HEADER_MAP = Object.freeze({
  date: ['date', 'تاريخ'],
  salesOrder: ['sales order no', 'sales order', 'sales order number', 'order number', 'order no', 'so', 'رقم الطلب'],
  vin: ['chassis / vin', 'chassis', 'vin', 'vin number', 'chassis number', 'رقم الشاصي', 'الشاصي'],
  product: ['product', 'product name', 'model', 'المنتج'],
  pic: ['pic'],
  salesType: ['sales type', 'نوع البيع'],
  invoiceOwner: ['invoice owner', 'مالك الفاتورة'],
  userName: ['user name', 'username', 'اسم المستخدم'],
  salesAdvisor: ['s/a', 'sa', 's a', 'sales advisor', 'مستشار المبيعات'],
  proformaDate: ['proforma date', 'proforma invoice date', 'pro forma date', 'تاريخ البروفورما'],
  deliveryDate: ['delivery date', 'تاريخ التسليم'],
  gtLocation: ['gt location', 'gt', 'موقع gt'],
  vehicleLocation: ['vehicle location', 'موقع المركبة', 'location'],
  phone: ['phone number', 'phone', 'mobile', 'رقم الجوال', 'الجوال'],
  status: ['status', 'الحالة'],
  traffic: ['traffic', 'المرور'],
  trafficFees: ['traffic fees', 'رسوم المرور'],
  insurance: ['insurance', 'التأمين'],
  registrationDate: ['registration date', 'تاريخ الاستمارة'],
});

/** Operational fields employees own — never overwritten by Raw Data upload */
const OPS_FIELDS = Object.freeze([
  'guestSentDate',
  'signatureReceivedDate',
  'accountsSentDate',
  'accountsApprovalDate',
  'vin1502',
  'opsStatus',
  'trafficFile',
  'trafficFeesOps',
  'insuranceOps',
  'registrationIssueDate',
  'transferCity',
  'carrier',
  'notes',
  'assignedEmployeeId',
  'assignedEmployeeName',
  'assignedBy',
  'assignedAt',
]);

module.exports = {
  STATUSES,
  COMPLETED_STATUS,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  EMPLOYEE_NAMES,
  USERS,
  HEADER_MAP,
  OPS_FIELDS,
};
