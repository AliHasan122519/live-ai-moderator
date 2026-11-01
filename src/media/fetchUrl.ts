import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';

export class UrlError extends Error { constructor(public code: string, message: string) { super(message); } }

/** عناوين غير عامة: loopback، خاصة، link-local (بما فيها بيانات السحابة 169.254.169.254)، CGNAT، multicast، محجوزة. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  if (isIP(v) === 6) return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8');
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 88);
}

export function assertPublicUrl(raw: string, allowPrivate = false): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new UrlError('bad_url', 'رابط غير صالح'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UrlError('bad_scheme', 'يُسمح بروابط http/https فقط');
  if (u.username || u.password) throw new UrlError('bad_url', 'روابط بها بيانات دخول غير مسموحة');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && (isIP(host) ? isPrivateIp(host) : /^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host))) throw new UrlError('private_host', 'العنوان داخلي/خاص ومحظور');
  return u;
}

const MAX_REDIRECTS = 3;
export interface FetchedMedia { stream: Readable; contentType: string; filename: string }

/**
 * جلب ملف من رابط عام (مثل رابط تصدير من Canva/ElevenLabs). حماية SSRF: التحقق من العنوان الفعلي وقت الاتصال
 * (يمنع DNS rebinding) ولكل تحويل، حد حجم، مهلة، وبلا ترويسات أو كوكيز. النوع يُتحقَّق منه لاحقاً من البايتات.
 * يستخدم node:http/https مباشرة (لا undici: استيراده يستبدل مُرسِل fetch العام ويكسر بقية النظام).
 */
export async function fetchPublicMedia(raw: string, o: { maxBytes?: number; timeoutMs?: number; allowPrivate?: boolean } = {}): Promise<FetchedMedia> {
  const maxBytes = o.maxBytes ?? 1024 ** 3; const allowPrivate = o.allowPrivate ?? false; const timeoutMs = o.timeoutMs ?? 120_000;
  const lookup = (hostname: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    dnsLookup(hostname, { all: true }).then((addrs) => {
      if (!addrs.length || (!allowPrivate && addrs.some((a) => isPrivateIp(a.address)))) return cb(new UrlError('private_host', 'العنوان الفعلي داخلي/خاص ومحظور'));
      if (opts.all) cb(null, addrs); else cb(null, addrs[0]!.address, addrs[0]!.family);
    }).catch((e) => cb(e));
  };
  const once = (u: URL) => new Promise<IncomingMessage>((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers: { 'user-agent': 'TikTokAIPublisher/0.1', accept: '*/*' }, lookup: lookup as never, timeout: 15_000, signal: AbortSignal.timeout(timeoutMs) }, resolve);
    req.on('timeout', () => req.destroy(new Error('انتهت مهلة الاتصال')));
    req.on('error', (e) => reject(e instanceof UrlError ? e : (e as { cause?: unknown }).cause instanceof UrlError ? (e as { cause: UrlError }).cause : new UrlError('fetch_failed', `تعذّر الجلب: ${e.message}`)));
    req.end();
  });
  let url = assertPublicUrl(raw, allowPrivate);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await once(url);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy(); if (hop === MAX_REDIRECTS) throw new UrlError('too_many_redirects', 'تحويلات كثيرة');
      url = assertPublicUrl(new URL(res.headers.location, url).toString(), allowPrivate); continue;
    }
    if (status < 200 || status >= 300) { res.destroy(); throw new UrlError('http_error', `الرابط أعاد HTTP ${status}`); }
    if (Number(res.headers['content-length'] ?? 0) > maxBytes) { res.destroy(); throw new UrlError('too_large', 'الملف أكبر من الحد المسموح'); }
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? 'download').slice(0, 120) || 'download';
    return { stream: res, contentType: String(res.headers['content-type'] ?? ''), filename: name };
  }
  throw new UrlError('too_many_redirects', 'تحويلات كثيرة');
}
