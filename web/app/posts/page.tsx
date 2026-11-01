'use client';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { PageTitle, Spinner } from '@/components/ui';
import { PostRow } from '@/components/PostRow';

const FILTERS: Array<[string, string]> = [['', 'الكل'], ['PUBLISHED,INBOX_DELIVERED', 'منشور'], ['SCHEDULED', 'مجدول'], ['QUEUED,SENDING,PROCESSING', 'قيد المعالجة'], ['FAILED,UNKNOWN', 'فشل/غير مؤكد'], ['CANCELED', 'ملغى']];
export default function Posts() {
  const [f, setF] = useState('');
  const { data, loading } = useApi<any[]>(`/api/posts?limit=100${f ? `&status=${f}` : ''}`, { poll: 8000 });
  return (
    <div className="space-y-4">
      <PageTitle sub="سجل كل المنشورات وحالاتها الحقيقية">المنشورات</PageTitle>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {FILTERS.map(([v, l]) => <button key={l} role="tab" aria-selected={f === v} onClick={() => setF(v)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${f === v ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted'}`}>{l}</button>)}
      </div>
      {loading ? <Spinner /> : data?.length ? <div className="space-y-2">{data.map((p) => <PostRow key={p.id} p={p} />)}</div> : <p className="py-10 text-center text-muted">لا شيء هنا.</p>}
    </div>
  );
}
