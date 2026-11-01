'use client';
import { useApi } from '@/lib/api';
import { PageTitle, Spinner, LinkBtn } from '@/components/ui';
import { PostRow } from '@/components/PostRow';

export default function Drafts() {
  const { data, loading } = useApi<any[]>('/api/posts?status=DRAFT,AWAITING_APPROVAL&limit=100', { poll: 10000 });
  return (
    <div className="space-y-4">
      <PageTitle sub="مسودات لم تُوافَق بعد. لا يُنشر منها شيء قبل موافقتك">المسودات</PageTitle>
      {loading ? <Spinner /> : data?.length ? <div className="space-y-2">{data.map((p) => <PostRow key={p.id} p={p} />)}</div> : <p className="py-8 text-center text-muted">لا مسودات.</p>}
      <LinkBtn kind="primary" href="/new">إنشاء منشور</LinkBtn>
    </div>
  );
}
