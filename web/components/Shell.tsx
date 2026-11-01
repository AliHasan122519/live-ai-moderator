'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

const TABS = [
  { href: '/', label: 'الرئيسية', icon: '⌂' }, { href: '/posts', label: 'المنشورات', icon: '≣' }, { href: '/new', label: 'جديد', icon: '＋', primary: true },
  { href: '/media', label: 'الملفات', icon: '▣' }, { href: '/more', label: 'المزيد', icon: '⋯' },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [ok, setOk] = useState(false);
  useEffect(() => { api('/api/me').then(() => setOk(true)).catch(() => {}); }, []);
  if (path === '/login') return <>{children}</>;
  if (!ok) return <div className="p-10 text-center text-muted">…</div>;
  return (
    <div className="glow min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="font-bold tracking-tight"><span className="text-brand">●</span> TikTok AI Publisher</Link>
          <Link href="/account" className="text-xs text-muted">الحساب</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
      <nav aria-label="التنقل" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((t) => {
            const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
            return (
              <li key={t.href}><Link href={t.href} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'text-accent' : 'text-muted'}`}>
                <span className={t.primary ? 'grid h-9 w-9 place-items-center rounded-full bg-brand text-lg text-white' : 'text-lg leading-none'}>{t.icon}</span>{t.label}
              </Link></li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
