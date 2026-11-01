'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, PRIVACY_AR, useApi } from '@/lib/api';
import { Button, Card, Field, inputCls, Notice, PageTitle, Spinner } from '@/components/ui';
import { MediaThumb } from '@/components/MediaThumb';
import { UploadBox } from '@/components/UploadBox';

export default function NewPost() {
  const router = useRouter();
  const media = useApi<any[]>('/api/media?limit=100'); const acc = useApi<any>('/api/account'); const dash = useApi<any>('/api/dashboard');
  const [sel, setSel] = useState<string[]>([]);
  const [caption, setCaption] = useState(''); const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState(''); // عمداً بلا قيمة افتراضية: يجب أن يختارها المستخدم صراحةً
  const [mode, setMode] = useState<'DIRECT' | 'DRAFT_INBOX'>('DIRECT');
  const [when, setWhen] = useState(''); const [whenInfo, setWhenInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const [ai, setAi] = useState(false); const [noComment, setNoComment] = useState(false);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<{ m: string; d?: string[] } | null>(null); const [alts, setAlts] = useState<string[]>([]);

  const options: string[] = acc.data?.account?.creatorInfo?.privacy_level_options ?? [];
  const canDirect = acc.data?.account?.scopes?.includes('video.publish');
  useEffect(() => { if (acc.data?.account && !canDirect) setMode('DRAFT_INBOX'); }, [acc.data, canDirect]);

  useEffect(() => {
    if (!when.trim()) { setWhenInfo(null); return; }
    const t = setTimeout(async () => {
      try { const r = await api('/api/time/parse', { body: { text: when } }); setWhenInfo(r.ok ? { ok: true, text: r.display } : { ok: false, text: r.hint }); } catch { setWhenInfo(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [when]);

  const picked = useMemo(() => sel.map((id) => media.data?.find((m) => m.id === id)).filter(Boolean), [sel, media.data]);
  const kinds = new Set(picked.map((m: any) => m.kind));
  const selErr = kinds.has('VIDEO') && sel.length > 1 ? 'الفيديو لا يُدمج مع ملفات أخرى' : '';
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function suggest(kind: 'caption' | 'hashtags') {
    setBusy(kind); setErr(null);
    try {
      if (kind === 'caption') { const r = await api('/api/ai/caption', { body: { mediaIds: sel.slice(0, 4), topic, maxChars: 150 } }); setCaption(r.caption); setAlts(r.alternatives); }
      else { const r = await api('/api/ai/hashtags', { body: { mediaIds: sel.slice(0, 4), topic, caption } }); setTags(r.hashtags.join(' ')); }
    } catch (e) { setErr({ m: (e as Error).message }); } finally { setBusy(''); }
  }
  async function submit() {
    setBusy('submit'); setErr(null);
    try {
      const body: any = { mediaIds: sel, caption, hashtags: tags.split(/[\s,،#]+/).filter(Boolean), mode, aiGenerated: ai, disableComment: noComment };
      if (mode === 'DIRECT') body.privacyLevel = privacy;
      if (when.trim()) body.scheduleText = when;
      const r = await api('/api/posts/prepare', { body });
      router.push(`/posts/${r.preview.id}`);
    } catch (e: any) { setErr({ m: e.message, d: e.details }); setBusy(''); }
  }
  if (media.loading || acc.loading) return <Spinner />;
  const needPrivacy = mode === 'DIRECT' && !privacy;
  const disabled = !sel.length || !!selErr || needPrivacy || !!busy || (!!whenInfo && !whenInfo.ok);

  return (
    <div className="space-y-4">
      <PageTitle sub="جهّز المحتوى ثم راجع المعاينة. لن يُنشر شيء قبل موافقتك">منشور جديد</PageTitle>
      {!acc.data?.connected && <Notice tone="bad">اربط حساب TikTok أولاً من «الحساب».</Notice>}

      <Card className="space-y-3">
        <h2 className="font-semibold">1 · الملفات {sel.length > 0 && <span className="text-sm text-muted">({sel.length})</span>}</h2>
        {media.data?.length ? (
          <ul className="grid grid-cols-3 gap-2">{media.data.map((m) => {
            const i = sel.indexOf(m.id);
            return <li key={m.id}><button type="button" onClick={() => toggle(m.id)} aria-pressed={i >= 0} className={`relative block aspect-[9/12] w-full overflow-hidden rounded-xl border-2 bg-black ${i >= 0 ? 'border-accent' : 'border-line'}`}>
              <MediaThumb id={m.id} kind={m.kind} />{i >= 0 && <span className="absolute start-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-black">{i + 1}</span>}
            </button></li>;
          })}</ul>
        ) : <p className="text-sm text-muted">لا ملفات. ارفع من الأسفل.</p>}
        <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm">رفع ملف جديد</summary><div className="mt-3"><UploadBox onDone={media.reload} /></div></details>
        <p className="text-xs text-muted">فيديو واحد، أو صورة، أو 2–35 صورة بالترتيب الذي تضغطه (الأولى غلاف المنشور).</p>
        {selErr && <Notice tone="bad">{selErr}</Notice>}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">2 · الوصف</h2>
        <Field label="موضوع/توجيه للذكاء الاصطناعي (اختياري)"><input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: نصيحة تقنية سريعة للمبتدئين" /></Field>
        <Field label="الوصف"><textarea className={`${inputCls} min-h-28`} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} /></Field>
        {alts.length > 0 && <div className="flex flex-wrap gap-2">{alts.map((a, i) => <button key={i} type="button" onClick={() => setCaption(a)} className="rounded-lg border border-line px-2.5 py-1.5 text-start text-xs text-muted">بديل {i + 1}: {a.slice(0, 40)}…</button>)}</div>}
        <Field label="الهاشتاقات" hint="مفصولة بمسافة، بلا #"><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="تقنية ذكاء_اصطناعي" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!dash.data?.ai || !sel.length || !!busy} onClick={() => suggest('caption')}>{busy === 'caption' ? '…' : '✨ اقترح وصفاً'}</Button>
          <Button disabled={!dash.data?.ai || !!busy} onClick={() => suggest('hashtags')}>{busy === 'hashtags' ? '…' : '＃ اقترح هاشتاقات'}</Button>
        </div>
        {!dash.data?.ai && <p className="text-xs text-muted">الاقتراح بالذكاء الاصطناعي يتطلب ANTHROPIC_API_KEY في الخادم.</p>}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">3 · الخصوصية والنشر</h2>
        <Field label="طريقة الإرسال" hint={canDirect ? 'النشر المباشر ينشر بعد موافقتك. المسودة تصل صندوق TikTok لتكملها من التطبيق' : 'صلاحية النشر المباشر (video.publish) غير ممنوحة، لذا الإرسال كمسودة فقط'}>
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as any)}>{canDirect && <option value="DIRECT">نشر مباشر</option>}<option value="DRAFT_INBOX">مسودة في صندوق TikTok</option></select>
        </Field>
        {mode === 'DIRECT' && (
          <Field label="من يستطيع مشاهدته؟ (اختيارك إلزامي)">
            <select className={inputCls} value={privacy} onChange={(e) => setPrivacy(e.target.value)} required>
              <option value="" disabled>اختر الخصوصية…</option>{options.map((o) => <option key={o} value={o}>{PRIVACY_AR[o] ?? o}</option>)}
            </select>
          </Field>
        )}
        {mode === 'DIRECT' && acc.data?.account && !acc.data.account.audited && <Notice tone="info">تطبيقك غير معتمد بعد: أي خيار تختاره سيُنشر فعلياً بخصوصية «أنا فقط».</Notice>}
        <Field label="موعد النشر (اختياري)" hint="اكتب بالعربية بتوقيت الرياض، مثل: بكرة الساعة 8 مساء"><input className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="اتركه فارغاً للنشر بعد الموافقة" /></Field>
        {whenInfo && <Notice tone={whenInfo.ok ? 'ok' : 'warn'}>{whenInfo.ok ? `سيُجدول: ${whenInfo.text}` : whenInfo.text}</Notice>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#fe2c55]" checked={ai} onChange={(e) => setAi(e.target.checked)} /> محتوى مُولَّد بالذكاء الاصطناعي</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#fe2c55]" checked={noComment} onChange={(e) => setNoComment(e.target.checked)} /> إيقاف التعليقات</label>
      </Card>

      {err && <Notice tone="bad"><b>{err.m}</b>{err.d?.map((d) => <div key={d}>• {d}</div>)}</Notice>}
      <Button kind="primary" className="w-full" disabled={disabled} onClick={submit}>{busy === 'submit' ? 'جارٍ التجهيز…' : 'معاينة وطلب الموافقة'}</Button>
      {needPrivacy && sel.length > 0 && <p className="text-center text-xs text-muted">اختر الخصوصية للمتابعة</p>}
    </div>
  );
}
