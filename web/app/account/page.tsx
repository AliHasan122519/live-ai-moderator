'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, fmtDate, PRIVACY_AR, useApi } from '@/lib/api';
import { Badge, Button, Card, Notice, PageTitle, Spinner } from '@/components/ui';

function Inner() {
  const q = useSearchParams(); const { data, loading, reload } = useApi<any>('/api/account');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<any>, ok: string) { setBusy(true); setMsg(''); try { await fn(); setMsg(ok); await reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }
  if (loading) return <Spinner />;
  const a = data?.account; const info = a?.creatorInfo;
  return (
    <div className="space-y-4">
      <PageTitle sub="الربط عبر OAuth الرسمي من TikTok. لا نخزّن كلمة مرور TikTok أبداً">الحساب والتكامل</PageTitle>
      {q.get('connected') && <Notice tone="ok">تم ربط الحساب بنجاح ✓</Notice>}
      {q.get('error') && <Notice tone="bad">{q.get('error')}</Notice>}
      {msg && <Notice tone="info">{msg}</Notice>}

      {data?.connected ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="h-14 w-14 rounded-full border border-line object-cover" referrerPolicy="no-referrer" /> : <div className="h-14 w-14 rounded-full bg-surface-2" />}
            <div><div className="text-lg font-bold">{a.displayName}</div><div className="text-sm text-muted">{a.username ? `@${a.username}` : 'اسم المستخدم غير متاح'}</div></div>
            <Badge tone="ok">مربوط</Badge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">الصلاحيات</dt><dd className="flex flex-wrap gap-1">{a.scopes.map((s: string) => <Badge key={s} tone="info">{s}</Badge>)}</dd>
            <dt className="text-muted">النشر المباشر</dt><dd>{a.scopes.includes('video.publish') ? 'متاح (video.publish)' : <span className="text-warn">غير متاح — يُرسل كمسودة فقط</span>}</dd>
            <dt className="text-muted">مراجعة التطبيق</dt><dd>{a.audited ? <Badge tone="ok">معتمد</Badge> : <Badge tone="warn">غير معتمد — النشر الخاص فقط</Badge>}</dd>
            <dt className="text-muted">خيارات الخصوصية</dt><dd>{info?.privacy_level_options?.map((o: string) => PRIVACY_AR[o] ?? o).join('، ') ?? '—'}</dd>
            <dt className="text-muted">آخر تحديث للإعدادات</dt><dd>{fmtDate(a.creatorInfoAt)}</dd>
          </dl>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={busy} onClick={() => run(() => api('/api/account/refresh', { method: 'POST', body: {} }), 'حُدّثت إعدادات النشر من TikTok')}>تحديث إعدادات النشر</Button>
            <Button kind="danger" disabled={busy} onClick={() => confirm('إلغاء ربط الحساب؟ ستُبطل الرموز لدى TikTok ويُمسح تخزينها هنا.') && run(() => api('/api/account', { method: 'DELETE' }), 'أُلغي الربط')}>إلغاء الربط</Button>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#fe2c55]" checked={a.audited} onChange={(e) => run(() => api('/api/account/audited', { method: 'PUT', body: { audited: e.target.checked } }), 'حُدّث')} />
            <span>تطبيقي اجتاز مراجعة TikTok (Audit) — فعّلها فقط بعد موافقة TikTok الرسمية، وإلا ستفشل المنشورات العامة. يتيح هذا الخيار إرسال الخصوصية العامة.</span></label>
        </Card>
      ) : (
        <Card className="space-y-3">
          {data?.account?.status === 'NEEDS_REAUTH' && <Notice tone="bad">انتهى الربط ويحتاج تجديداً.</Notice>}
          {!data?.config?.clientKeySet && <Notice tone="warn">لم تُضبط مفاتيح TikTok في الخادم (TIKTOK_CLIENT_KEY/SECRET). اتبع docs/TIKTOK_SETUP.md أولاً.</Notice>}
          <p className="text-sm text-muted">سيُحوَّل إلى TikTok لتسجيل الدخول والموافقة على الصلاحيات: <span dir="ltr">{data?.config?.scopes?.join(', ')}</span></p>
          <Button kind="primary" className="w-full" disabled={busy || !data?.config?.clientKeySet} onClick={() => run(async () => { const r = await api('/api/tiktok/connect'); location.href = r.url; }, 'جارٍ التحويل…')}>ربط حساب TikTok</Button>
        </Card>
      )}
      <Card className="space-y-1 text-xs text-muted"><div>Redirect URI المضبوط: <span dir="ltr">{data?.config?.redirectUri}</span> — يجب أن يطابق حرفياً ما سجّلته في TikTok for Developers.</div></Card>
    </div>
  );
}
export default function Account() { return <Suspense fallback={<Spinner />}><Inner /></Suspense>; }
