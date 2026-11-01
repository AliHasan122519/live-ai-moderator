'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, Field, inputCls, Notice } from '@/components/ui';

export default function Login() {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/auth/login', { body: { password: pw } }); location.href = '/'; }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <div className="glow grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-bold"><span className="text-brand">●</span> TikTok AI Publisher</h1>
        <Card className="space-y-4">
          <Field label="كلمة مرور المالك"><input className={inputCls} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
          {err && <Notice tone="bad">{err}</Notice>}
          <Button kind="primary" className="w-full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</Button>
        </Card>
      </form>
    </div>
  );
}
