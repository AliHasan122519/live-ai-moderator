import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const b64u = (b: Buffer) => b.toString('base64url');

/** تشفير AES-256-GCM لرموز TikTok. الصيغة: v1.iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('مفتاح التشفير يجب أن يكون 32 بايت');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join('.');
}

export function decryptSecret(enc: string, keyB64: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('صيغة سرّ مشفّر غير صالحة');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => b64u(randomBytes(bytes));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 16384;
  const h = await scrypt(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${b64u(salt)}$${b64u(h)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !N || !salt || !hash) return false;
  const h = await scrypt(pw, Buffer.from(salt, 'base64url'), 32, { N: Number(N), r: 8, p: 1 });
  const exp = Buffer.from(hash, 'base64url');
  return h.length === exp.length && timingSafeEqual(h, exp);
}

/** توقيع حمولة JSON بـHMAC مع انتهاء صلاحية (للجلسات وروابط الوسائط). */
export function signPayload(payload: Record<string, unknown>, secret: string, ttlSec: number, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec })));
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
}

export function verifyPayload<T = Record<string, unknown>>(token: string, secret: string, now = Date.now()): (T & { exp: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null; // لا نقبل مقاطع زائدة
  const [body, sig] = parts as [string, string];
  if (!body || !sig) return null;
  const exp = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== exp.length || !timingSafeEqual(given, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return p.exp * 1000 > now ? p : null;
  } catch { return null; }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE: code_verifier + code_challenge (S256). TikTok تستخدم hex بدل base64url للتحدي؛ نُرجع الاثنين. */
export function pkcePair() {
  const verifier = randomToken(48);
  return { verifier, challengeHex: sha256Hex(verifier), challengeB64u: createHash('sha256').update(verifier).digest('base64url') };
}
