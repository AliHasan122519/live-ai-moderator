'use client';
import { useState } from 'react';
import { api, fmtDate, useApi } from '@/lib/api';
import { Button, Card, Notice, PageTitle, Spinner } from '@/components/ui';
import { PostRow } from '@/components/PostRow';

export default function Schedule() {
  const { data, loading, reload } = useApi<any[]>('/api/posts?status=SCHEDULED&limit=100', { poll: 10000 });
  const [msg, setMsg] = useState('');
  async function cancel(id: string) { try { await api(`/api/posts/${id}/cancel`, { method: 'POST', body: {} }); setMsg('أُلغي النشر المجدول'); reload(); } catch (e) { setMsg((e as Error).message); } }
  return (
    <div className="space-y-4">
      <PageTitle sub="بتوقيت الرياض. يُلتقط أي موعد فات بسبب انقطاع، ولا يُنشر متأخراً أكثر من ساعتين دون علمك">المجدول</PageTitle>
      {msg && <Notice tone="info">{msg}</Notice>}
      {loading ? <Spinner /> : data?.length ? data.map((p) => (
        <Card key={p.id} className="space-y-2"><PostRow p={p} /><div className="flex items-center justify-between text-sm"><span className="text-muted">الموعد: {fmtDate(p.scheduledAt)}</span><Button kind="danger" onClick={() => cancel(p.id)}>إلغاء الجدولة</Button></div></Card>
      )) : <p className="py-10 text-center text-muted">لا منشورات مجدولة. أنشئ منشوراً واكتب موعده بالعربية (مثل «بكرة الساعة 8 مساء»).</p>}
    </div>
  );
}
