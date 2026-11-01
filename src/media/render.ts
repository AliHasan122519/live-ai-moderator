import { chromium, type Browser } from 'playwright-core';

export class RenderError extends Error { constructor(public code: string, message: string) { super(message); } }

const MAX_HTML = 300_000;
let browserP: Promise<Browser> | null = null;
let active = 0;
const waiters: Array<() => void> = [];
const MAX_PARALLEL = 2;

async function getBrowser(): Promise<Browser> {
  browserP ??= chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  }).catch((e) => { browserP = null; throw new RenderError('unavailable', `الرسم غير متاح على هذا الخادم (Chromium): ${(e as Error).message.split('\n')[0]}`); });
  const b = await browserP;
  b.on('disconnected', () => { browserP = null; });
  return b;
}
export async function closeRenderer() { if (browserP) { const b = await browserP.catch(() => null); await b?.close(); browserP = null; } }

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

export interface RenderOpts { width?: number; height?: number; onBlocked?: (url: string) => void }

/**
 * يرسم HTML/CSS إلى JPEG. أمان: JavaScript معطّل، وكل طلب شبكة/ملف مُجهَض عدا data: (صور/خطوط مضمَّنة)،
 * فلا يستطيع المحتوى قراءة الخادم أو الشبكة الداخلية أو تسريب شيء. المخرجات بصريّة فقط.
 */
export async function renderHtmlToJpeg(html: string, o: RenderOpts = {}): Promise<Buffer> {
  if (!html.trim()) throw new RenderError('empty', 'HTML فارغ');
  if (html.length > MAX_HTML) throw new RenderError('too_large', `HTML أكبر من ${MAX_HTML} حرفاً`);
  const width = o.width ?? 1080; const height = o.height ?? 1920;
  if (width < 320 || width > 2160 || height < 320 || height > 3840) throw new RenderError('bad_size', 'أبعاد خارج المسموح');
  return slot(async () => {
    const browser = await getBrowser();
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: 'block' });
    try {
      await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith('data:') || u === 'about:blank') return route.continue();
        o.onBlocked?.(u); return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page.waitForTimeout(150); // استقرار التخطيط والخطوط المضمَّنة
      return await page.screenshot({ type: 'jpeg', quality: 90, timeout: 15_000 });
    } catch (e) {
      if (e instanceof RenderError) throw e;
      throw new RenderError('render_failed', `فشل الرسم: ${(e as Error).message.split('\n')[0]}`);
    } finally { await ctx.close().catch(() => {}); }
  });
}
