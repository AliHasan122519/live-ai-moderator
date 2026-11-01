// صلاحيات رموز API (MCP وغيره). جلسة المالك في اللوحة تملك الكل.
export const SCOPES = {
  read: 'قراءة الحساب والمنشورات والملفات',
  'media:write': 'رفع الملفات وحذفها',
  'post:write': 'إنشاء مسودات وتعديلها وطلب الموافقة والإلغاء',
  'post:approve': 'الموافقة الصريحة على المحتوى (حساس: يتيح إتمام النشر من المحادثة)',
  'post:publish': 'تنفيذ النشر الفوري والجدولة وإعادة المحاولة (بعد الموافقة فقط)',
  'ai:use': 'توليد الأوصاف والهاشتاقات',
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];
/** الافتراضي لرمز MCP: كل شيء عدا الموافقة، فتبقى الموافقة على هاتفك في اللوحة. */
export const DEFAULT_MCP_SCOPES: Scope[] = ['read', 'media:write', 'post:write', 'post:publish', 'ai:use'];
export const isScope = (s: string): s is Scope => s in SCOPES;
