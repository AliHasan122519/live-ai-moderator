'use client';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Card, LinkBtn, Notice, PageTitle, Spinner } from '@/components/ui';
import { PostRow } from '@/components/PostRow';

export default function Home() {
  const dash = useApi<any>('/api/dashboard', { poll: 8000 });
  const acc = useApi<any>('/api/account');
  const awaiting = useApi<any[]>('/api/posts?status=AWAITING_APPROVAL&limit=10', { poll: 8000 });
  if (dash.loading || acc.loading) return <Spinner />;
  const d = dash.data; const c = d?.counts ?? {}; const a = acc.data;
  const n = (k: string) => c[k] ?? 0;
  return (
    <div className="space-y-4">
      <PageTitle sub="مساعدك الشخصي لإدارة محتوى TikTok">الرئيسية</PageTitle>
      {!a?.connected && <Notice tone="warn">حساب TikTok غير مربوط. <Link className="underline" href="/account">اربطه الآن</Link></Notice>}
      {a?.connected && !a.account.audited && <Notice tone="info">تطبيقك غير معتمد من TikTok بعد: المنشورات المباشرة تُنشر بخصوصية «أنا فقط». أكمل مراجعة التطبيق لإتاحة النشر العام.</Notice>}
      {d && !d.ai && <Notice tone="info">توليد الأوصاف بالذكاء الاصطناعي غير مفعّل (أضف ANTHROPIC_API_KEY في الخادم).</Notice>}

      {(awaiting.data?.length ?? 0) > 0 && (
        <Card className="space-y-2 border-warn/40">
          <h2 className="font-semibold">بانتظار موافقتك ({awaiting.data!.length})</h2>
          {awaiting.data!.map((p) => <PostRow key={p.id} p={p} />)}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['منشور ✓', n('PUBLISHED'), 'text-ok'], ['مجدول', n('SCHEDULED'), 'text-accent'], ['قيد المعالجة', n('PROCESSING') + n('SENDING') + n('QUEUED'), 'text-accent'], ['يحتاج انتباه', n('FAILED') + n('UNKNOWN'), 'text-bad']].map(([l, v, cls]) => (
          <Card key={l as string}><div className="text-xs text-muted">{l}</div><div className={`mt-1 text-3xl font-bold tabular-nums ${cls}`}>{v}</div></Card>
        ))}
      </div>
      <div className="flex gap-3"><LinkBtn kind="primary" href="/new">منشور جديد</LinkBtn><LinkBtn href="/media">رفع ملفات</LinkBtn></div>
      <Card className="space-y-2"><h2 className="font-semibold">القادم</h2>
        {d?.upcoming.length ? d.upcoming.map((p: any) => <PostRow key={p.id} p={p} />) : <p className="text-sm text-muted">لا منشورات مجدولة.</p>}
      </Card>
      <Card className="space-y-2"><h2 className="font-semibold">آخر النشاط</h2>
        {d?.recent.length ? d.recent.map((p: any) => <PostRow key={p.id} p={p} />) : <p className="text-sm text-muted">لا نشاط بعد. ابدأ بمنشور جديد.</p>}
      </Card>
    </div>
  );
}
