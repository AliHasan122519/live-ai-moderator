'use client';
import Link from 'next/link';
import { fmtDate, TYPE_AR } from '@/lib/api';
import { StatusBadge } from './ui';

export function PostRow({ p }: { p: any }) {
  return (
    <Link href={`/post?id=${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{p.caption || <span className="text-muted">(بلا وصف)</span>}</div>
        <div className="mt-0.5 text-xs text-muted">{TYPE_AR[p.type]} · {p.scheduledAt ? `مجدول ${fmtDate(p.scheduledAt)}` : fmtDate(p.createdAt)}</div>
      </div>
      <StatusBadge status={p.status} />
    </Link>
  );
}
