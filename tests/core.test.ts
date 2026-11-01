import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, hashPassword, signPayload, verifyPassword, verifyPayload, pkcePair, sha256Hex } from '../src/crypto/index.js';
import { ingestUpload, MediaError } from '../src/media/ingest.js';
import { purgeExpiredMedia } from '../src/media/retention.js';
import { sniffMime } from '../src/media/sniff.js';
import { freshDb, JPEG, jpegUnique, makeMp4, streamOf, testConfig, tmpStorage } from './helpers.js';
import type { Db } from '../src/db/index.js';

describe('crypto', () => {
  const key = randomBytes(32).toString('base64');
  it('تشفير/فك تشفير الرموز ويرفض العبث', () => {
    const enc = encryptSecret('act.secret-token', key);
    expect(enc).not.toContain('secret');
    expect(decryptSecret(enc, key)).toBe('act.secret-token');
    const [v, iv, tag, ct] = enc.split('.');
    expect(() => decryptSecret([v, iv, tag, ct!.slice(0, -2) + 'AA'].join('.'), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32).toString('base64'))).toThrow();
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key)); // IV عشوائي
  });
  it('كلمات المرور', async () => {
    const h = await hashPassword('كلمة-سر');
    expect(await verifyPassword('كلمة-سر', h)).toBe(true);
    expect(await verifyPassword('خطأ', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('التوقيع وانتهاء الصلاحية', () => {
    const t = signPayload({ k: 'v' }, 'secret-secret-secret', 60, 1_000_000);
    expect(verifyPayload(t, 'secret-secret-secret', 1_000_000 + 59_000)?.k).toBe('v');
    expect(verifyPayload(t, 'secret-secret-secret', 1_000_000 + 61_000)).toBeNull();
    expect(verifyPayload(t, 'other', 1_000_000)).toBeNull();
    expect(verifyPayload(t.replace(/.$/, 'x'), 'secret-secret-secret', 1_000_000)).toBeNull();
  });
  it('PKCE', () => { const p = pkcePair(); expect(p.challengeHex).toBe(sha256Hex(p.verifier)); });
});

describe('storage', () => {
  it('يمنع الخروج من المجلد', async () => {
    const s = tmpStorage();
    for (const k of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '']) await expect(s.put(k, Buffer.from('x'), 'a/b')).rejects.toThrow();
    await s.put('media/a.bin', Buffer.from('hello world'), 'application/octet-stream');
    expect((await s.stat('media/a.bin'))?.size).toBe(11);
    const chunks: Buffer[] = []; for await (const c of await s.get('media/a.bin', { start: 6, end: 10 })) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('world');
    await s.delete('media/a.bin'); expect(await s.stat('media/a.bin')).toBeNull();
  });
});

describe('media ingest', () => {
  let db: Db; const config = testConfig(); const storage = tmpStorage();
  beforeAll(async () => { db = await freshDb(); });
  afterAll(async () => { await db.$disconnect(); });

  it('sniff لا يعتمد على الامتداد', () => {
    expect(sniffMime(JPEG)?.mime).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('MZ.....exe......'))).toBeNull();
  });
  it('يقبل JPEG ويكتشف التكرار بالبصمة', async () => {
    const buf = jpegUnique();
    const a = await ingestUpload({ db, storage, config, stream: streamOf(buf), filename: 'a.jpg' });
    expect(a.duplicate).toBe(false); expect(a.asset.kind).toBe('IMAGE');
    const b = await ingestUpload({ db, storage, config, stream: streamOf(buf), filename: 'again.jpg' });
    expect(b.duplicate).toBe(true); expect(b.asset.id).toBe(a.asset.id);
  });
  it('يرفض exe متنكراً بامتداد صورة، وPNG، والفارغ، والكبير', async () => {
    const bad = (b: Buffer, name: string, max?: number) => ingestUpload({ db, storage, config, stream: streamOf(b), filename: name, hardMaxBytes: max });
    await expect(bad(Buffer.concat([Buffer.from('MZ'), randomBytes(200)]), 'virus.jpg')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(bad(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(100)]), 'a.png')).rejects.toMatchObject({ code: 'unsupported_png' });
    await expect(bad(Buffer.alloc(0), 'e.jpg')).rejects.toBeInstanceOf(MediaError);
    await expect(bad(jpegUnique(), 'big.jpg', 500)).rejects.toMatchObject({ code: 'too_large' });
    expect(await db.mediaAsset.count()).toBe(1); // لا بقايا
  });
  it('فيديو MP4 حقيقي: مدة وأبعاد من ffprobe، ثم سياسة الاحتفاظ', async () => {
    const { asset } = await ingestUpload({ db, storage, config, stream: streamOf(makeMp4(2)), filename: 'v.mp4' });
    expect(asset.kind).toBe('VIDEO'); expect(asset.width).toBe(320); expect(asset.height).toBe(568);
    expect(asset.durationSec).toBeGreaterThan(1.5);
    await db.mediaAsset.update({ where: { id: asset.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await purgeExpiredMedia(db, storage)).toBe(1);
    expect(await storage.stat(asset.storageKey)).toBeNull();
  });
});
