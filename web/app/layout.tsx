import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'TikTok AI Publisher', description: 'إدارة ونشر محتوى TikTok بأوامر عربية' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0a10' };

export default function Root({ children }: { children: ReactNode }) {
  return <html lang="ar" dir="rtl"><body><Shell>{children}</Shell></body></html>;
}
