'use client';
import { useState } from 'react';
import { api, fmtDate, useApi } from '@/lib/api';
import { Badge, Button, Card, Field, inputCls, Notice, PageTitle, Spinner } from '@/components/ui';

const DEFAULTS = ['read', 'media:write', 'post:write', 'post:publish', 'ai:use'];
export default function Security() {
  const { data, loading, reload } = useApi<any>('/api/tokens');
  const settings = useApi<any>('/api/settings');
  const [name, setName] = useState('mcp'); const [scopes, setScopes] = useState<string[]>(DEFAULTS); const [fresh, setFresh] = useState(''); const [err, setErr] = useState('');
  if (loading || settings.loading) return <Spinner />;
  async function setChat(v: boolean) { try { await api('/api/settings', { method: 'PUT', body: { chatApproval: v } }); settings.reload(); } catch (e) { setErr((e as Error).message); } }
  async function create() { setErr(''); try { const r = await api('/api/tokens', { body: { name, scopes } }); setFresh(r.token); reload(); } catch (e) { setErr((e as Error).message); } }
  async function revoke(id: string) { if (confirm('إبطال هذا الرمز؟ سيتوقف فوراً.')) { await api(`/api/tokens/${id}`, { method: 'DELETE' }); reload(); } }
  return (
    <div className="space-y-4">
      <PageTitle sub="رموز لأدوات Claude Code (MCP). كل رمز بصلاحيات محددة ويمكن إبطاله">الأمان</PageTitle>
      <Card className="space-y-3 border-warn/40">
        <h2 className="font-semibold">الموافقة من داخل Claude</h2>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#fe2c55]" checked={!!settings.data?.chatApproval} onChange={(e) => setChat(e.target.checked)} />
          <span>اسمح لـClaude بالموافقة على النشر من المحادثة (تقول «انشر» فيُنشر). يعمل فقط مع رمز يملك <b dir="ltr">post:approve</b>.</span></label>
        <Notice tone="warn">إن فعّلتَه فأنت تثق بأن Claude لن يوافق دون طلبك. نموذج مخدوع بنص داخل ملف أو وصف قد يوافق دون سؤالك؛ الخادم يضمن فقط أن الموافقة على المحتوى الذي جُهّز. أغلقه متى شئت.</Notice>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">رمز جديد</h2>
        <Field label="الاسم"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <div className="space-y-2">{Object.entries<string>(data.scopes).map(([k, d]) => (
          <label key={k} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#fe2c55]" checked={scopes.includes(k)} onChange={(e) => setScopes(e.target.checked ? [...scopes, k] : scopes.filter((s) => s !== k))} />
            <span><b dir="ltr">{k}</b> — {d}</span></label>))}</div>
        {scopes.includes('post:approve') && <Notice tone="warn">منح <b>post:approve</b> يسمح لـClaude بإتمام الموافقة من المحادثة نفسها. الأسلم تركها معطّلة لتبقى الموافقة على هاتفك.</Notice>}
        {err && <Notice tone="bad">{err}</Notice>}
        <Button kind="primary" className="w-full" disabled={!scopes.length || !name.trim()} onClick={create}>إنشاء الرمز</Button>
        {fresh && <Notice tone="ok"><div className="mb-1">انسخه الآن — لن يظهر مرة أخرى:</div><code dir="ltr" className="block break-all rounded bg-black/40 p-2 text-xs">{fresh}</code></Notice>}
      </Card>
      <Card className="space-y-2"><h2 className="font-semibold">الرموز الحالية</h2>
        {data.tokens.length ? data.tokens.map((t: any) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{t.name} {t.revokedAt && <Badge tone="bad">مُبطل</Badge>}</div><div className="truncate text-xs text-muted" dir="ltr">{t.scopes.join(', ')}</div><div className="text-xs text-muted">آخر استخدام: {fmtDate(t.lastUsedAt)}</div></div>
            {!t.revokedAt && <Button kind="danger" className="!min-h-9" onClick={() => revoke(t.id)}>إبطال</Button>}
          </div>)) : <p className="text-sm text-muted">لا رموز.</p>}
      </Card>
      <Button kind="danger" className="w-full" onClick={async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.href = '/login'; }}>تسجيل الخروج</Button>
    </div>
  );
}
