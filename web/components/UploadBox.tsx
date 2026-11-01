'use client';
import { useRef, useState } from 'react';
import { Button, Notice } from './ui';

/** رفع بمؤشر تقدم حقيقي (XHR). الملفات تُفحص في الخادم (النوع من البايتات لا الامتداد). */
export function UploadBox({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [ai, setAi] = useState(false); const [pct, setPct] = useState<number | null>(null); const [msg, setMsg] = useState<{ t: 'ok' | 'bad'; s: string } | null>(null);

  function send(file: File) {
    return new Promise<void>((resolve) => {
      const fd = new FormData(); fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/media?source=${ai ? 'AI_GENERATED' : 'UPLOAD'}${ai ? '&aiGenerated=true' : ''}`);
      xhr.setRequestHeader('x-requested-with', 'tiktok-publisher');
      xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        let j: any = {}; try { j = JSON.parse(xhr.responseText); } catch { /* */ }
        if (xhr.status === 401) location.href = '/login';
        else if (xhr.status < 300) setMsg({ t: 'ok', s: j.duplicate ? `«${file.name}» مرفوع مسبقاً (نفس الملف)` : `رُفع «${file.name}»` });
        else setMsg({ t: 'bad', s: `«${file.name}»: ${j.message ?? 'فشل الرفع'}` });
        resolve();
      };
      xhr.onerror = () => { setMsg({ t: 'bad', s: `«${file.name}»: انقطع الاتصال` }); resolve(); };
      xhr.send(fd);
    });
  }
  async function pick(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) { setPct(0); await send(f); }
    setPct(null); onDone(); if (input.current) input.current.value = '';
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="h-5 w-5 accent-[#fe2c55]" /> هذا الملف مُولَّد بالذكاء الاصطناعي (يُفصَح عنه عند النشر)</label>
      <input ref={input} type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files)} />
      <Button kind="primary" className="w-full" disabled={pct !== null} onClick={() => input.current?.click()}>{pct === null ? 'اختر فيديو أو صور من الجوال' : `جارٍ الرفع… ${pct}%`}</Button>
      {pct !== null && <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
      {msg && <Notice tone={msg.t}>{msg.s}</Notice>}
      <p className="text-xs text-muted">المدعوم: فيديو MP4/MOV/WebM، صور JPEG/WebP (PNG غير مدعوم للنشر).</p>
    </div>
  );
}
