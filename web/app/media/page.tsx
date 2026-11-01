'use client';
import { useState } from 'react';
import { api, fmtDate, useApi } from '@/lib/api';
import { Badge, Button, Card, Notice, PageTitle, Spinner } from '@/components/ui';
import { MediaThumb } from '@/components/MediaThumb';
import { UploadBox } from '@/components/UploadBox';

export default function Media() {
  const { data, loading, reload } = useApi<any[]>('/api/media?limit=100');
  const [err, setErr] = useState('');
  async function del(id: string) {
    if (!confirm('حذف هذا الملف نهائياً؟')) return;
    try { await api(`/api/media/${id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="space-y-4">
      <PageTitle sub="كل ملف يُفحص ويُخزَّن بشكل خاص، ولا يُتاح لأحد قبل نشر موافَق عليه">الملفات</PageTitle>
      <Card><UploadBox onDone={reload} /></Card>
      {err && <Notice tone="bad">{err}</Notice>}
      {loading ? <Spinner /> : data?.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="aspect-[9/12] bg-black"><MediaThumb id={m.id} kind={m.kind} /></div>
              <div className="space-y-1.5 p-2.5 text-xs">
                <div className="truncate font-medium" title={m.filename}>{m.filename}</div>
                <div className="flex flex-wrap gap-1"><Badge tone="info">{m.kind === 'VIDEO' ? `فيديو ${m.durationSec ? Math.round(m.durationSec) + 'ث' : ''}` : 'صورة'}</Badge>{m.aiGenerated && <Badge tone="warn">AI</Badge>}</div>
                <div className="text-muted">{(m.sizeBytes / 1048576).toFixed(1)}MB · {fmtDate(m.createdAt)}</div>
                <Button kind="danger" className="!min-h-9 w-full !text-xs" onClick={() => del(m.id)}>حذف</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="py-10 text-center text-muted">لا ملفات بعد.</p>}
    </div>
  );
}
