'use client';
import Link from 'next/link';
import { fmtDate, useApi } from '@/lib/api';
import { Card, PageTitle, Spinner, StatusBadge } from '@/components/ui';

export default function Logs() {
  const errs = useApi<any[]>('/api/errors', { poll: 15000 }); const audit = useApi<any[]>('/api/audit');
  if (errs.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageTitle sub="كل ما فشل أو تعذّر تأكيده، وسجل العمليات الحساسة">سجل الأخطاء والعمليات</PageTitle>
      <Card className="space-y-2"><h2 className="font-semibold">منشورات تحتاج انتباهك</h2>
        {errs.data?.length ? errs.data.map((p) => (
          <Link key={p.id} href={`/post?id=${p.id}`} className="block rounded-xl border border-line bg-surface-2 p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="truncate">{p.caption || '(بلا وصف)'}</span><StatusBadge status={p.status} /></div><div className="mt-1 break-words text-xs text-bad">{p.failReason}</div><div className="mt-1 text-xs text-muted">{fmtDate(p.updatedAt)}</div></Link>
        )) : <p className="text-sm text-muted">لا شيء. كل شيء سليم ✓</p>}
      </Card>
      <Card className="space-y-1"><h2 className="font-semibold">سجل العمليات</h2>
        {audit.data?.length ? <ul className="divide-y divide-line/60 text-sm">{audit.data.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span><b dir="ltr">{a.action}</b> <span className="text-xs text-muted">{a.actor}</span></span><span className="shrink-0 text-xs text-muted">{fmtDate(a.at)}</span></li>)}</ul> : <p className="text-sm text-muted">فارغ.</p>}
      </Card>
    </div>
  );
}
