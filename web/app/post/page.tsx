'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, fmtDate, PRIVACY_AR, TYPE_AR, useApi } from '@/lib/api';
import { Badge, Button, Card, Field, inputCls, Notice, PageTitle, Spinner, StatusBadge } from '@/components/ui';
import { MediaThumb } from '@/components/MediaThumb';

const ACTIVE = ['QUEUED', 'SENDING', 'PROCESSING'];
const EVENT_AR: Record<string, string> = { created: 'أُنشئ', updated: 'عُدّل', approval_requested: 'طُلبت الموافقة', approved: 'وُوفق عليه', approval_invalidated: 'أُبطلت الموافقة بعد تعديل', scheduled: 'جُدول', queued: 'دخل الطابور', sending: 'بدأ الإرسال', init_ok: 'قبلته TikTok للمعالجة', upload_done: 'اكتمل رفع الملف', published: 'أكّدت TikTok نشره', inbox_delivered: 'سُلّم لصندوق TikTok', failed: 'فشل', unknown: 'حالة غير مؤكدة', canceled: 'أُلغي', retry: 'إعادة محاولة يدوية', rate_limited_requeued: 'حد الطلبات: أُعيد لاحقاً', status_check_error: 'تعذّر الاستعلام عن الحالة' };

function PostInner() {
  const id = useSearchParams().get('id') ?? '';
  const { data, loading, reload } = useApi<any>(id ? `/api/posts/${id}` : null, { poll: 6000 });
  const [msg, setMsg] = useState<{ t: 'ok' | 'bad' | 'info'; s: string } | null>(null);
  const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false); const [cap, setCap] = useState(''); const [tags, setTags] = useState(''); const [when, setWhen] = useState('');
  const demo = !!useApi<any>('/api/account').data?.demo;
  const status = data?.post?.status as string | undefined;
  const checking = useRef(false);

  // أثناء المعالجة نسأل TikTok فعلياً (وليس مجرد قراءة قاعدتنا)
  useEffect(() => {
    if (status !== 'PROCESSING') return;
    const t = setInterval(async () => { if (checking.current) return; checking.current = true; try { await api(`/api/posts/${id}/check`, { method: 'POST', body: {} }); await reload(); } finally { checking.current = false; } }, 6000);
    return () => clearInterval(t);
  }, [status, id, reload]);

  async function act(fn: () => Promise<any>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ t: 'ok', s: ok }); await reload(); } catch (e: any) { setMsg({ t: 'bad', s: e.message + (e.details?.length ? ' — ' + e.details.join(' | ') : '') }); } finally { setBusy(false); }
  }
  if (loading || !data) return <Spinner />;
  const { post, preview: pv, events } = data;
  const scheduled = !!post.scheduledAt;

  return (
    <div className="space-y-4">
      <PageTitle sub={`${TYPE_AR[post.type]} · ${post.mode === 'DIRECT' ? 'نشر مباشر' : 'مسودة صندوق TikTok'}`}>تفاصيل المنشور</PageTitle>
      <div className="flex items-center gap-2"><StatusBadge status={post.status} />{pv.aiGenerated && <Badge tone="warn">محتوى AI</Badge>}</div>

      {post.status === 'PUBLISHED' && (demo ? <Notice tone="warn">اكتمل في الوضع التجريبي (TikTok وهمي) — <b>لم يُنشر على حسابك الحقيقي</b>.</Notice> : <Notice tone="ok">أكّدت TikTok نشر المنشور {post.tiktokPostId ? `(معرّف ${post.tiktokPostId})` : ''} ✓</Notice>)}
      {post.status === 'INBOX_DELIVERED' && <Notice tone="ok">سُلّم كمسودة إلى صندوق TikTok. <b>لم يُنشر بعد</b>: افتح تطبيق TikTok وأكمل النشر من إشعار المسودات.</Notice>}
      {post.status === 'PROCESSING' && <Notice tone="info">TikTok تعالج المنشور. يتحدّث تلقائياً — لا تعتبره منشوراً حتى يظهر «منشور ✓».</Notice>}
      {post.status === 'FAILED' && <Notice tone="bad"><b>فشل:</b> {post.failReason}</Notice>}
      {post.status === 'UNKNOWN' && <Notice tone="bad"><b>حالة غير مؤكدة:</b> {post.failReason}<br />قد تكون TikTok نشرته فعلاً. افتح حسابك وتحقق قبل أي إعادة محاولة، حتى لا يتكرر النشر.</Notice>}
      {msg && <Notice tone={msg.t}>{msg.s}</Notice>}

      <Card className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data.post.media.map((m: any) => <div key={m.id} className="h-56 w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-black">{m.kind === 'VIDEO' ? <video src={`/api/media/${m.id}/file`} controls playsInline preload="metadata" className="h-full w-full object-cover" /> : <MediaThumb id={m.id} kind={m.kind} />}</div>)}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">الحساب</dt><dd>{pv.account.displayName} {pv.account.username && <span className="text-muted">@{pv.account.username}</span>}</dd>
          <dt className="text-muted">الوصف</dt><dd className="whitespace-pre-wrap break-words">{pv.type === 'VIDEO' ? pv.title : `${pv.title}${pv.description && pv.description !== pv.title ? '\n\n' + pv.description : ''}`}</dd>
          <dt className="text-muted">الخصوصية</dt><dd>{pv.mode === 'DRAFT_INBOX' ? 'تختارها داخل TikTok عند إكمال المسودة' : <>{PRIVACY_AR[pv.privacy] ?? pv.privacy}{pv.requestedPrivacy !== pv.privacy && <span className="text-warn"> (طلبتَ {PRIVACY_AR[pv.requestedPrivacy] ?? pv.requestedPrivacy})</span>}</>}</dd>
          <dt className="text-muted">التعليقات</dt><dd>{pv.disableComment ? 'متوقفة' : 'مفعّلة'}</dd>
          {pv.type === 'VIDEO' && <><dt className="text-muted">ديو/ستيتش</dt><dd>{pv.disableDuet ? 'ديو متوقف' : 'ديو مفعّل'} · {pv.disableStitch ? 'ستيتش متوقف' : 'ستيتش مفعّل'}</dd></>}
          <dt className="text-muted">الموعد</dt><dd>{scheduled ? fmtDate(post.scheduledAt) : 'عند الموافقة'}</dd>
        </dl>
        {pv.warnings.map((w: string) => <Notice key={w} tone="warn">{w}</Notice>)}
        {pv.errors.map((w: string) => <Notice key={w} tone="bad">{w}</Notice>)}
      </Card>

      {['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(post.status) && (
        <Card className="space-y-3">
          <button className="text-sm text-accent underline" onClick={() => { setEdit(!edit); setCap(post.caption); setTags(post.hashtags.join(' ')); }}>{edit ? 'إخفاء التعديل' : 'تعديل الوصف والهاشتاقات'}</button>
          {edit && <>
            <Field label="الوصف"><textarea className={`${inputCls} min-h-24`} value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
            <Field label="الهاشتاقات"><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
            <Notice tone="info">أي تعديل يُبطل الموافقة السابقة ويلزم طلب موافقة جديدة.</Notice>
            <Button disabled={busy} onClick={() => act(async () => { await api(`/api/posts/${id}`, { method: 'PATCH', body: { caption: cap, hashtags: tags.split(/[\s,،#]+/).filter(Boolean) } }); await api(`/api/posts/${id}/request-approval`, { method: 'POST', body: {} }); setEdit(false); }, 'حُفظ التعديل، وعاد المنشور لانتظار موافقتك')}>حفظ وطلب موافقة جديدة</Button>
          </>}
        </Card>
      )}

      <Card className="space-y-3">
        {post.status === 'DRAFT' && <Button kind="primary" className="w-full" disabled={busy} onClick={() => act(() => api(`/api/posts/${id}/request-approval`, { method: 'POST', body: {} }), 'جاهز للموافقة')}>طلب الموافقة</Button>}
        {post.status === 'AWAITING_APPROVAL' && <>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#fe2c55]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>راجعتُ المعاينة أعلاه وأوافق صراحةً على {pv.mode === 'DIRECT' ? 'نشر' : 'إرسال'} هذا المحتوى بهذه الإعدادات إلى حسابي {pv.account.displayName}. أقرّ بأن النشر يخضع لشروط TikTok، ومنها تأكيد استخدام الموسيقى (Music Usage Confirmation).</span></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button kind="primary" disabled={!ack || busy || pv.errors.length > 0} onClick={() => act(() => api(`/api/posts/${id}/approve`, { body: { contentHash: pv.contentHash, publishNow: !scheduled } }), scheduled ? 'وُوفق عليه وسيُنشر في موعده' : 'وُوفق عليه وبدأ الإرسال')}>{scheduled ? 'موافقة وجدولة' : 'موافقة ونشر الآن'}</Button>
            <Button kind="danger" disabled={busy} onClick={() => act(() => api(`/api/posts/${id}/cancel`, { body: {} }), 'أُلغي')}>إلغاء</Button>
          </div></>}
        {['APPROVED', 'SCHEDULED'].includes(post.status) && <>
          <Button kind="primary" className="w-full" disabled={busy} onClick={() => act(() => api(`/api/posts/${id}/publish`, { body: {} }), 'دخل طابور الإرسال')}>انشر الآن</Button>
          <Field label="أو جدول لموعد"><div className="flex gap-2"><input className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="بكرة الساعة 8 مساء" />
            <Button disabled={busy || !when.trim()} onClick={() => act(() => api(`/api/posts/${id}/schedule`, { body: { text: when } }), 'جُدول')}>جدولة</Button></div></Field>
        </>}
        {['APPROVED', 'SCHEDULED', 'QUEUED'].includes(post.status) && <Button kind="danger" className="w-full" disabled={busy} onClick={() => act(() => api(`/api/posts/${id}/cancel`, { body: {} }), 'أُلغي')}>إلغاء النشر</Button>}
        {ACTIVE.includes(post.status) && <Button disabled={busy} className="w-full" onClick={() => act(async () => { const r = await api(`/api/posts/${id}/check`, { method: 'POST', body: {} }); if (!r.confirmedByTikTok) throw new Error(`الحالة لدى TikTok: ${r.status} — لم يؤكَّد النشر بعد`); }, 'تأكّد من TikTok')}>تحقق الآن من TikTok</Button>}
        {post.status === 'FAILED' && <Button className="w-full" disabled={busy} onClick={() => act(() => api(`/api/posts/${id}/retry`, { body: {} }), 'أُعيدت المحاولة')}>إعادة المحاولة</Button>}
        {post.status === 'UNKNOWN' && <Button kind="danger" className="w-full" disabled={busy} onClick={() => confirm('هل تحققت من حسابك على TikTok وتأكدت أن المنشور لم يُنشر؟ الإعادة قد تنشر نسخة مكررة.') && act(() => api(`/api/posts/${id}/retry`, { body: { force: true } }), 'أُعيدت المحاولة')}>تحققتُ — أعد المحاولة</Button>}
      </Card>

      <Card className="space-y-2"><h2 className="font-semibold">السجل</h2>
        <ol className="space-y-1.5 text-sm">{events.map((e: any) => <li key={e.id} className="flex justify-between gap-3 border-b border-line/60 pb-1.5"><span>{EVENT_AR[e.event] ?? e.event}<span className="text-xs text-muted"> · {e.actor}</span></span><span className="shrink-0 text-xs text-muted">{fmtDate(e.at)}</span></li>)}</ol>
      </Card>
    </div>
  );
}

export default function PostPage() { return <Suspense fallback={<Spinner />}><PostInner /></Suspense>; }
