import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/api/app.js';
import { buildContainer } from '../src/container.js';
import { hashPassword } from '../src/crypto/index.js';
import { createApiToken } from '../src/auth/tokens.js';
import { TikTokClient } from '../src/tiktok/client.js';
import { useRig } from './rig.js';
import { JPEG, makeMp4, testConfig } from './helpers.js';

const r = useRig();
const H = { 'x-requested-with': 'tiktok-publisher' };
const PASS = 'كلمة-مرور-طويلة-123';

async function boot() {
  const cfg = testConfig({ TOKEN_ENC_KEY: r.cfg.TOKEN_ENC_KEY, SESSION_SECRET: r.cfg.SESSION_SECRET, OWNER_PASSWORD_HASH: await hashPassword(PASS), PUBLIC_API_URL: r.cfg.PUBLIC_API_URL, PUBLIC_WEB_URL: 'https://app.example.com' });
  const api = new TikTokClient({ baseUrl: r.fake.base, authUrl: cfg.TIKTOK_AUTH_URL, clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: cfg.TIKTOK_REDIRECT_URI });
  const c = buildContainer(r.queue, { cfg, db: r.db, storage: r.storage, api, notifier: r.notifier }, () => r.clock.t);
  const app = await buildApi(c, () => r.clock.t);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASS } });
  const sid = login.cookies.find((x) => x.name === 'sid')!.value;
  const own = (o: object) => ({ ...o, cookies: { sid }, headers: { ...H, ...((o as { headers?: object }).headers ?? {}) } });
  return { app, c, sid, own, login };
}
const mp = (name: string, buf: Buffer) => {
  const b = '----t' + randomBytes(6).toString('hex');
  return { headers: { 'content-type': `multipart/form-data; boundary=${b}` }, payload: Buffer.concat([Buffer.from(`--${b}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]) };
};
const json = (res: { body: string }) => JSON.parse(res.body);

describe('المصادقة وCSRF', () => {
  it('بلا هوية 401، كلمة خطأ 401، الدخول ينشئ كوكي HttpOnly، وCSRF مطلوب للتعديل', async () => {
    const { app, own, login } = await boot();
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'خطأ' } })).statusCode).toBe(401);
    const ck = login.cookies.find((x) => x.name === 'sid')!;
    expect(ck.httpOnly).toBe(true); expect(ck.sameSite).toBe('Lax');
    expect((await app.inject(own({ url: '/api/me' }))).statusCode).toBe(200);
    // تعديل بالكوكي بدون ترويسة CSRF يُرفض
    expect((await app.inject({ method: 'POST', url: '/api/posts/prepare', cookies: { sid: ck.value }, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me', cookies: { sid: ck.value + 'x' } })).statusCode).toBe(401);
    await app.close();
  });
  it('تحديد المعدل على الدخول', async () => {
    const { app } = await boot();
    const codes: number[] = []; for (let i = 0; i < 8; i++) codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode);
    expect(codes).toContain(429); await app.close();
  });
});

describe('رموز API والصلاحيات', () => {
  it('رمز بلا post:approve لا يوافق، ولا يدير الرموز، والمُلغى مرفوض، والنص الصريح غير مخزَّن', async () => {
    const { app, c, own } = await boot();
    const { token, id } = await createApiToken(r.db, 'mcp', ['read', 'post:write', 'post:publish', 'media:write', 'ai:use']);
    const bearer = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url: '/api/me', headers: bearer })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/posts/xx/approve', headers: bearer, payload: { contentHash: 'a'.repeat(64) } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tokens', headers: bearer })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/audit', headers: bearer })).statusCode).toBe(403);
    expect(JSON.stringify(await r.db.apiToken.findMany())).not.toContain(token);
    const created = json(await app.inject(own({ method: 'POST', url: '/api/tokens', payload: { name: 'x', scopes: ['nope'] } })));
    expect(created.error).toBeDefined();
    await app.inject(own({ method: 'DELETE', url: `/api/tokens/${id}` }));
    expect((await app.inject({ url: '/api/me', headers: bearer })).statusCode).toBe(401);
    void c; await app.close();
  });
});

describe('تدفق كامل عبر الـAPI', () => {
  it('رفع → prepare → رمز MCP لا يوافق → المالك يوافق وينشر → TikTok يؤكد → PUBLISHED', async () => {
    const { app, own } = await boot();
    await r.connect({ audited: true });
    const { token } = await createApiToken(r.db, 'mcp', ['read', 'post:write', 'post:publish', 'media:write']);
    const B = { authorization: `Bearer ${token}` };

    const form = mp('clip.mp4', makeMp4(2));
    const up = await app.inject({ method: 'POST', url: '/api/media?source=AI_GENERATED', headers: { ...B, ...form.headers }, payload: form.payload });
    expect(up.statusCode).toBe(201); const media = json(up).asset;
    expect(media.kind).toBe('VIDEO'); expect(media.aiGenerated).toBe(true); expect(media.storageKey).toBeUndefined();

    const prep = await app.inject({ method: 'POST', url: '/api/posts/prepare', headers: B, payload: { mediaIds: [media.id], caption: 'فيديو عن التقنية', hashtags: ['تقنية'], privacyLevel: 'PUBLIC_TO_EVERYONE', scheduleText: 'بعد ثلاث ساعات' } });
    expect(prep.statusCode).toBe(201); const { preview, approvalUrl } = json(prep);
    expect(preview.status).toBe('AWAITING_APPROVAL'); expect(preview.aiGenerated).toBe(true); expect(approvalUrl).toBe(`https://app.example.com/posts/${preview.id}`);
    expect(preview.scheduledAt).toBeTruthy();

    // رمز MCP لا يستطيع الموافقة ⇒ لا نشر
    expect((await app.inject({ method: 'POST', url: `/api/posts/${preview.id}/approve`, headers: B, payload: { contentHash: preview.contentHash } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/posts/${preview.id}/publish`, headers: B })).statusCode).toBe(409);
    expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(0);

    // المالك يوافق بالبصمة (خاطئة ثم صحيحة)
    expect((await app.inject(own({ method: 'POST', url: `/api/posts/${preview.id}/approve`, payload: { contentHash: 'b'.repeat(64) } }))).statusCode).toBe(409);
    const ok = await app.inject(own({ method: 'POST', url: `/api/posts/${preview.id}/approve`, payload: { contentHash: preview.contentHash } }));
    expect(json(ok).status).toBe('SCHEDULED');
    // الآن نشر فوري بدل الانتظار
    expect(json(await app.inject({ method: 'POST', url: `/api/posts/${preview.id}/publish`, headers: B })).status).toBe('QUEUED');
    expect(await r.pub.run(preview.id)).toBe('sent');
    const c1 = json(await app.inject({ method: 'POST', url: `/api/posts/${preview.id}/check`, headers: B }));
    expect(c1.status).toBe('PROCESSING'); expect(c1.confirmedByTikTok).toBe(false);
    const c2 = json(await app.inject({ method: 'POST', url: `/api/posts/${preview.id}/check`, headers: B }));
    expect(c2).toMatchObject({ status: 'PUBLISHED', confirmedByTikTok: true, tiktokPostId: '7300000000000000001' });
    const detail = json(await app.inject({ url: `/api/posts/${preview.id}`, headers: B }));
    expect(detail.events.map((e: { event: string }) => e.event)).toContain('published');
    const dash = json(await app.inject({ url: '/api/dashboard', headers: B })); expect(dash.counts.PUBLISHED).toBe(1);
    await app.close();
  });

  it('الحساب والأخطاء لا يسرّبان الرموز؛ وعلم audited للمالك فقط', async () => {
    const { app, own } = await boot(); await r.connect();
    const { token } = await createApiToken(r.db, 'ro', ['read']);
    const acc = (await app.inject({ url: '/api/account', headers: { authorization: `Bearer ${token}` } })).body;
    expect(acc).not.toMatch(/act\.|rft\.|Enc|accessToken/); expect(json({ body: acc }).account.displayName).toBe('حساب تجريبي');
    expect((await app.inject({ method: 'PUT', url: '/api/account/audited', headers: { authorization: `Bearer ${token}` }, payload: { audited: true } })).statusCode).toBe(403);
    expect(json(await app.inject(own({ method: 'PUT', url: '/api/account/audited', payload: { audited: true } }))).audited).toBe(true);
    await app.close();
  });

  it('رفض الملفات الخبيثة، والبثّ بنطاق Range للمعاينة، والتحقق من التكرار', async () => {
    const { app, own } = await boot();
    const bad = mp('virus.jpg', Buffer.concat([Buffer.from('MZ'), randomBytes(400)]));
    expect((await app.inject(own({ method: 'POST', url: '/api/media', headers: bad.headers, payload: bad.payload }))).statusCode).toBe(400);
    const jpg = Buffer.concat([JPEG, randomBytes(50)]); const m = mp('a.jpg', jpg);
    const up = json(await app.inject(own({ method: 'POST', url: '/api/media', headers: m.headers, payload: m.payload }))).asset;
    const part = await app.inject(own({ url: `/api/media/${up.id}/file`, headers: { range: 'bytes=0-3' } }));
    expect(part.statusCode).toBe(206); expect(part.rawPayload.length).toBe(4); expect(part.headers['content-range']).toBe(`bytes 0-3/${jpg.length}`);
    const again = await app.inject(own({ method: 'POST', url: '/api/media', headers: m.headers, payload: m.payload }));
    expect(again.statusCode).toBe(200); expect(json(again).duplicate).toBe(true);
    await app.close();
  });

  it('الوقت العربي عبر API، وجدولة بنص غامض تُرفض بسبب مفهوم', async () => {
    const { app, own } = await boot(); await r.connect({ audited: true });
    const t = json(await app.inject(own({ method: 'POST', url: '/api/time/parse', payload: { text: 'بكرة الساعة 8 مساء' } })));
    expect(t.ok).toBe(true); expect(t.at).toBe('2026-11-02T17:00:00.000Z');
    const m = await r.seedMedia('IMAGE');
    const bad = await app.inject(own({ method: 'POST', url: '/api/posts', payload: { mediaIds: [m], scheduleText: 'بكرة الساعة 8' } }));
    expect(bad.statusCode).toBe(400); expect(json(bad).message).toContain('صباحاً أم مساءً');
    await app.close();
  });

  it('رابط السحب العام يعمل عبر مسار API الحقيقي ويرفض غير المرتبط', async () => {
    const { app, c } = await boot(); await r.connect({ audited: true });
    const m = await r.seedMedia('IMAGE'); const asset = await r.db.mediaAsset.findUniqueOrThrow({ where: { id: m } });
    const { makePullUrl } = await import('../src/media/pull.js');
    const path = new URL(makePullUrl(c.cfg, asset, 600, r.clock.t.getTime())).pathname;
    expect((await app.inject({ url: path })).statusCode).toBe(404);
    await r.newApproved([m]);
    const ok = await app.inject({ url: path }); expect(ok.statusCode).toBe(200); expect(ok.headers['content-type']).toBe('image/jpeg');
    await app.close();
  });
});
