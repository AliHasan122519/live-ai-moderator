'use client';
export function MediaThumb({ id, kind, className = '' }: { id: string; kind: string; className?: string }) {
  const src = `/api/media/${id}/file`;
  return kind === 'VIDEO'
    ? <video src={src} preload="metadata" muted playsInline className={`h-full w-full object-cover ${className}`} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt="" loading="lazy" className={`h-full w-full object-cover ${className}`} />;
}
