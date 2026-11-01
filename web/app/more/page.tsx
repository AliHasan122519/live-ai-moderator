import Link from 'next/link';
import { PageTitle } from '@/components/ui';

const ITEMS: Array<[string, string, string]> = [['/schedule', 'المجدول', 'المنشورات المجدولة وإلغاؤها'], ['/drafts', 'المسودات', 'بانتظار الموافقة'], ['/account', 'الحساب والتكامل', 'ربط TikTok والصلاحيات'], ['/settings', 'إعدادات النشر', 'خيارات حسابك على TikTok'], ['/logs', 'سجل الأخطاء والعمليات', 'الفشل وما حدث'], ['/security', 'الأمان', 'رموز MCP وتسجيل الخروج']];
export default function More() {
  return (
    <div className="space-y-4"><PageTitle>المزيد</PageTitle>
      <ul className="space-y-2">{ITEMS.map(([h, t, s]) => <li key={h}><Link href={h} className="block rounded-xl border border-line bg-surface p-4"><div className="font-semibold">{t}</div><div className="text-sm text-muted">{s}</div></Link></li>)}</ul>
    </div>
  );
}
