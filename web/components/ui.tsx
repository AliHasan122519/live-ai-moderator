'use client';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { STATUS_AR } from '@/lib/api';

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;

const tones = { ok: 'text-ok border-ok/40 bg-ok/10', warn: 'text-warn border-warn/40 bg-warn/10', bad: 'text-bad border-bad/40 bg-bad/10', info: 'text-accent border-accent/40 bg-accent/10', mute: 'text-muted border-line bg-surface-2' };
export const Badge = ({ tone = 'mute', children }: { tone?: keyof typeof tones; children: ReactNode }) =>
  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
export const StatusBadge = ({ status }: { status: string }) => { const s = STATUS_AR[status] ?? { label: status, tone: 'mute' as const }; return <Badge tone={s.tone}>{s.label}</Badge>; };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'danger' | 'ghost' | 'soft' };
export function Button({ kind = 'soft', className = '', ...p }: BtnProps) {
  const k = { primary: 'bg-brand text-white border-brand', danger: 'bg-bad/15 text-bad border-bad/40', ghost: 'bg-transparent text-muted border-line', soft: 'bg-surface-2 text-text border-line' }[kind];
  return <button {...p} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45 ${k} ${className}`} />;
}
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) =>
  <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}{hint && <span className="block text-xs text-muted">{hint}</span>}</label>;
export const inputCls = 'w-full min-h-11 rounded-xl border border-line bg-surface-2 px-3 py-2 text-base placeholder:text-muted/70';
export const Notice = ({ tone = 'warn', children }: { tone?: 'warn' | 'bad' | 'ok' | 'info'; children: ReactNode }) =>
  <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2.5 text-sm ${tones[tone]}`}>{children}</div>;
export const Spinner = () => <div className="p-8 text-center text-muted" aria-busy="true">جارٍ التحميل…</div>;
export const PageTitle = ({ children, sub }: { children: ReactNode; sub?: string }) =>
  <div className="mb-4"><h1 className="text-xl font-bold">{children}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>;
export const LinkBtn = ({ href, children, kind = 'soft' }: { href: string; children: ReactNode; kind?: 'primary' | 'soft' }) =>
  <Link href={href} className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold ${kind === 'primary' ? 'border-brand bg-brand text-white' : 'border-line bg-surface-2'}`}>{children}</Link>;
