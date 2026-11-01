'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiErr extends Error {
  constructor(public status: number, message: string, public details?: string[]) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers: { 'x-requested-with': 'tiktok-publisher', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), credentials: 'same-origin',
  });
  const text = await res.text(); let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) { location.href = '/login'; throw new ApiErr(401, 'انتهت الجلسة'); }
  if (!res.ok) throw new ApiErr(res.status, j.message ?? `خطأ ${res.status}`, j.details);
  return j as T;
}

export function useApi<T = any>(path: string | null, o: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiErr | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e as ApiErr); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => { alive.current = true; setLoading(!!path); void load(); const t = o.poll ? setInterval(load, o.poll) : null; return () => { alive.current = false; if (t) clearInterval(t); }; }, [load, o.poll, path]);
  return { data, error, loading, reload: load, setData };
}

export const STATUS_AR: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute' }> = {
  DRAFT: { label: 'مسودة', tone: 'mute' }, AWAITING_APPROVAL: { label: 'بانتظار موافقتك', tone: 'warn' }, APPROVED: { label: 'موافَق عليه', tone: 'info' },
  SCHEDULED: { label: 'مجدول', tone: 'info' }, QUEUED: { label: 'في الطابور', tone: 'info' }, SENDING: { label: 'يُرسل الآن', tone: 'info' },
  PROCESSING: { label: 'TikTok يعالجه', tone: 'info' }, INBOX_DELIVERED: { label: 'سُلّم لصندوق TikTok', tone: 'ok' }, PUBLISHED: { label: 'منشور ✓', tone: 'ok' },
  FAILED: { label: 'فشل', tone: 'bad' }, UNKNOWN: { label: 'غير مؤكد — تحقق', tone: 'bad' }, CANCELED: { label: 'ملغى', tone: 'mute' },
};
export const PRIVACY_AR: Record<string, string> = { PUBLIC_TO_EVERYONE: 'عام للجميع', MUTUAL_FOLLOW_FRIENDS: 'الأصدقاء (متابعة متبادلة)', FOLLOWER_OF_CREATOR: 'المتابعون', SELF_ONLY: 'أنا فقط' };
export const TYPE_AR: Record<string, string> = { VIDEO: 'فيديو', PHOTO: 'صورة', CAROUSEL: 'صور متعددة' };
export const fmtDate = (s?: string | null) => (s ? new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)) : '—');
