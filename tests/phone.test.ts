import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApi } from '../src/api/app.js';
import { buildContainer } from '../src/container.js';
import { createApiToken } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config/index.js';
import { decryptSecret, encryptSecret } from '../src/crypto/index.js';
import { TikTokClient } from '../src/tiktok/client.js';
import { useRig } from './rig.js';
import { testConfig } from './helpers.js';

const r = useRig();

async function connect(url: string, headers?: Record<string, string>) {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: headers ? { headers } : undefined }));
  return client;
}

function webDir() {
  const d = mkdtempSync(join(tmpdir(), 'web-')); mkdirSync(join(d, 'account'));
  writeFileSync(join(d, 'index.html'), '<html>home</html>'); writeFileSync(join(d, 'account.html'), '<html>account</html>'); writeFileSync(join(d, '404.html'), '<html>nf</html>');
  writeFileSync(join(d, 'account', '__next.txt'), 'rsc');
  return d;
}
async function boot(over: Record<string, string> = {}) {
  const cfg = testConfig({ TOKEN_ENC_KEY: r.cfg.TOKEN_ENC_KEY, SESSION_SECRET: r.cfg.SESSION_SECRET, PUBLIC_API_URL: r.cfg.PUBLIC_API_URL, WEB_DIR: webDir(), ...over });
  const tt = new TikTokClient({ baseUrl: r.fake.base, authUrl: cfg.TIKTOK_AUTH_URL, clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: cfg.TIKTOK_REDIRECT_URI });
  const c = buildContainer(r.queue, { cfg, db: r.db, storage: r.storage, api: tt, notifier: r.notifier }, () => r.clock.t);
  const app = await buildApi(c, () => r.clock.t);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, c, base: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
}

describe('إعدادات صديقة للجوال', () => {
  const base = { DATABASE_URL: 'postgresql://x', SESSION_SECRET: 's'.repeat(40) };
  it('TOKEN_ENC_KEY: أي نص طويل يُشتق منه مفتاح ثابت 32 بايت، وbase64 الصالح يبقى كما هو', () => {
    const a = loadConfig({ ...base, TOKEN_ENC_KEY: 'x'.repeat(40) }); const b = loadConfig({ ...base, TOKEN_ENC_KEY: 'x'.repeat(40) });
    expect(Buffer.from(a.TOKEN_ENC_KEY, 'base64')).toHaveLength(32); expect(a.TOKEN_ENC_KEY).toBe(b.TOKEN_ENC_KEY);
    expect(decryptSecret(encryptSecret('سر', a.TOKEN_ENC_KEY), b.TOKEN_ENC_KEY)).toBe('سر');
    const real = Buffer.alloc(32, 7).toString('base64'); expect(loadConfig({ ...base, TOKEN_ENC_KEY: real }).TOKEN_ENC_KEY).toBe(real);
    expect(() => loadConfig({ ...base, TOKEN_ENC_KEY: 'قصير' })).toThrow('TOKEN_ENC_KEY');
  });
  it('الإنتاج يتطلب كلمة مرور (نصية أو مجزّأة) وHTTPS، وكلمة المرور القصيرة مرفوضة', () => {
    const prod = { ...base, TOKEN_ENC_KEY: 'x'.repeat(40), NODE_ENV: 'production', PUBLIC_API_URL: 'https://a.example.com' };
    expect(() => loadConfig(prod)).toThrow('OWNER_PASSWORD');
    expect(() => loadConfig({ ...prod, OWNER_PASSWORD: 'قصيرة' })).toThrow('12');
    expect(loadConfig({ ...prod, OWNER_PASSWORD: 'كلمة-مرور-طويلة-1' }).OWNER_PASSWORD).toBeTruthy();
    expect(() => loadConfig({ ...prod, OWNER_PASSWORD: 'كلمة-مرور-طويلة-1', PUBLIC_API_URL: 'http://a.example.com' })).toThrow('HTTPS');
  });
});

describe('خدمة واحدة: الواجهة + API + دخول بكلمة مرور نصية', () => {
  it('يخدم الصفحات الثابتة بترويسات أمان، ويرفض الخروج من المجلد، و404 مناسب للـAPI', async () => {
    const { app, base } = await boot();
    const home = await fetch(base + '/'); expect(await home.text()).toContain('home');
    expect(home.headers.get('content-security-policy')).toContain("frame-ancestors 'none'"); expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await (await fetch(base + '/account')).text()).toContain('account'); // account.html بلا امتداد
    const miss = await fetch(base + '/nope'); expect(miss.status).toBe(404); expect(await miss.text()).toContain('nf');
    const api404 = await fetch(base + '/api/zzz'); expect(api404.status).toBe(404); expect(api404.headers.get('content-type')).toContain('json'); // لا صفحة HTML لمسار API
    expect((await fetch(base + '/api/me')).status).toBe(401);
    expect((await fetch(base + '/api/me')).headers.get('cache-control')).toBe('no-store');
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd']) expect((await fetch(base + p)).status).not.toBe(200);
    await app.close();
  });

  it('الدخول بـOWNER_PASSWORD النصية (تُجزَّأ عند البدء)', async () => {
    const { app, base } = await boot({ OWNER_PASSWORD: 'كلمة-مرور-طويلة-123' });
    const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'خطأ-خطأ-خطأ-خطأ' }) });
    expect(bad.status).toBe(401);
    const ok = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'كلمة-مرور-طويلة-123' }) });
    expect(ok.status).toBe(200); expect(ok.headers.get('set-cookie')).toContain('HttpOnly');
    await app.close();
  });
});

describe('MCP البعيد (HTTP)', () => {
  it('يعمل بالترويسة وبالرمز في المسار، بلا upload_media، ويرفض الرموز الخاطئة/المُبطلة', async () => {
    const { app, base } = await boot(); await r.connect({ audited: true });
    const { token, id } = await createApiToken(r.db, 'phone', ['read', 'post:write', 'post:publish', 'media:write', 'ai:use']);

    const viaHeader = await connect(`${base}/mcp`, { authorization: `Bearer ${token}` });
    const names = (await viaHeader.listTools()).tools.map((t) => t.name);
    expect(names).toContain('publish_tiktok_video'); expect(names).not.toContain('upload_media'); expect(names).toContain('approve_tiktok_post'); // موجودة دائماً؛ الخادم يفرض الصلاحية + إعداد المالك
    const acc = await viaHeader.callTool({ name: 'get_tiktok_account_info', arguments: {} }) as { content: Array<{ text: string }> };
    expect(JSON.parse(acc.content[0]!.text)).toMatchObject({ connected: true, display_name: 'حساب تجريبي' });

    // سيناريو الهاتف: «انشر آخر فيديو» ⇒ يجد الملف المرفوع من اللوحة ويجهّز معاينة بلا نشر
    const m = await r.seedMedia('VIDEO');
    const viaPath = await connect(`${base}/mcp/${token}`);
    const list = JSON.parse(((await viaPath.callTool({ name: 'list_media_files', arguments: { kind: 'VIDEO' } })) as any).content[0].text);
    expect(list[0].id).toBe(m);
    const prep = JSON.parse(((await viaPath.callTool({ name: 'publish_tiktok_video', arguments: { media_id: m, caption: 'من الجوال' } })) as any).content[0].text);
    expect(prep).toMatchObject({ published: false, status: 'AWAITING_APPROVAL' }); expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(0);

    await expect(connect(`${base}/mcp/tpk_wrong`)).rejects.toThrow();
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })).status).toBe(401);
    await r.db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await expect(connect(`${base}/mcp/${token}`)).rejects.toThrow();
    await viaHeader.close(); await viaPath.close(); await app.close();
  });
});

describe('تفاصيل الواجهة الثابتة', () => {
  it('طلبات HEAD لمسارات الصفحات (جلب Next المسبق) تنجح', async () => {
    const { app, base } = await boot();
    expect((await fetch(base + '/account', { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(base + '/nope', { method: 'HEAD' })).status).toBe(404);
    await app.close();
  });
});

describe('السلسلة كاملة داخل Claude فقط (MCP بعيد): تصميم ← فيديو ← موافقة ← نشر ← تأكيد', () => {
  it('Claude يصمّم صورة وفيديو ويرى المعاينة، يجهّز المنشور، وبعد تفعيل المالك يوافق وينشر حتى تأكيد TikTok', async () => {
    const { app, base } = await boot(); await r.connect({ audited: true });
    const { token } = await createApiToken(r.db, 'claude', ['read', 'media:write', 'post:write', 'post:approve', 'post:publish', 'ai:use']);
    const cl = await connect(`${base}/mcp/${token}`);
    const call = async (name: string, args: Record<string, unknown>) => (await cl.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
    const json = (x: { content: Array<{ text?: string }> }) => JSON.parse(x.content[0]!.text!);
    const slide = (t: string, c: string) => `<html lang="ar" dir="rtl"><body style="margin:0;width:1080px;height:1920px;background:${c};display:grid;place-items:center;font:700 110px Tahoma,sans-serif;color:#fff">${t}</body></html>`;

    // 1) صورة مصمَّمة: تعود معها صورة معاينة فعلية ليراها Claude
    const img = await call('create_image_from_html', { html: slide('نصيحة اليوم', '#0a4') });
    expect(img.isError).toBeFalsy(); expect(img.content.some((c) => c.type === 'image' && c.mimeType === 'image/jpeg' && (c.data?.length ?? 0) > 1000)).toBe(true);
    expect(json(img)).toMatchObject({ kind: 'IMAGE', width: 1080, height: 1920, ai_generated: true });

    // 2) فيديو من 3 شرائح + لقطات معاينة
    const vid = await call('create_video_from_slides', { slides: [slide('١', '#c00'), slide('٢', '#06c'), slide('٣', '#a0a')], seconds_per_slide: 2 });
    expect(vid.isError).toBeFalsy(); expect(vid.content.filter((c) => c.type === 'image')).toHaveLength(3);
    const v = json(vid); expect(v.kind).toBe('VIDEO'); expect(v.duration_sec).toBeGreaterThan(4.7);

    // 3) تجهيز → معاينة بلا نشر
    const prep = json(await call('publish_tiktok_video', { media_id: v.media_id, caption: 'فيديو من تصميم Claude', hashtags: ['تقنية'], privacy_level: 'SELF_ONLY' }));
    expect(prep).toMatchObject({ published: false, status: 'AWAITING_APPROVAL' }); expect(prep.preview.aiGenerated).toBe(true);

    // 4) إعداد المالك مغلق ⇒ لا موافقة من المحادثة
    const denied = await call('approve_tiktok_post', { post_id: prep.post_id, content_hash: prep.content_hash });
    expect(denied.isError).toBe(true); expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(0);
    // 5) المالك يفعّله ⇒ «انشر» تعمل
    await r.db.setting.upsert({ where: { key: 'chatApproval' }, create: { key: 'chatApproval', value: true }, update: { value: true } });
    const ap = json(await call('approve_tiktok_post', { post_id: prep.post_id, content_hash: prep.content_hash, publish_now: true }));
    expect(ap).toMatchObject({ published: false, status: 'QUEUED' });
    expect(await r.pub.run(prep.post_id)).toBe('sent');
    // 6) لا «منشور» قبل تأكيد TikTok
    expect(json(await call('get_tiktok_publish_status', { post_id: prep.post_id }))).toMatchObject({ status: 'PROCESSING', confirmed_by_tiktok: false });
    expect(json(await call('get_tiktok_publish_status', { post_id: prep.post_id }))).toMatchObject({ status: 'PUBLISHED', confirmed_by_tiktok: true });
    expect(r.fake.hits('/v2/post/publish/video/init/')[0]!.body.post_info.is_aigc).toBe(true);

    // 7) استيراد من رابط: الداخلي محظور، ومعاينة ملف مرفوع تعيد لقطات
    const ssrf = await call('import_media_from_url', { url: 'http://169.254.169.254/latest/meta-data' });
    expect(ssrf.isError).toBe(true); expect(ssrf.content[0]!.text).toContain('محظور');
    expect((await call('preview_media', { media_id: v.media_id })).content.filter((c) => c.type === 'image').length).toBe(3);
    await cl.close(); await app.close();
  }, 120_000);
});

describe('الوضع التجريبي المدمج', () => {
  it('صفحة تفويض وهمية آمنة، وعلم demo ظاهر في الـAPI وفي أدوات MCP، وتغيب خارج الوضع التجريبي', async () => {
    const ru = 'https://app.example.com/auth/tiktok/callback';
    const off = await boot({ TIKTOK_REDIRECT_URI: ru });
    expect((await fetch(`${off.base}/demo/tiktok/authorize/?redirect_uri=${encodeURIComponent(ru)}&state=s`, { redirect: 'manual' })).status).toBe(404);
    await off.app.close();

    const { app, base } = await boot({ DEMO_TIKTOK: 'true', TIKTOK_REDIRECT_URI: ru });
    const ok = await fetch(`${base}/demo/tiktok/authorize/?redirect_uri=${encodeURIComponent(ru)}&state=abc`, { redirect: 'manual' });
    expect(ok.status).toBe(302); expect(ok.headers.get('location')).toBe(`${ru}?code=good-code&state=abc`);
    const evil = await fetch(`${base}/demo/tiktok/authorize/?redirect_uri=${encodeURIComponent('https://evil.example/cb')}&state=abc`, { redirect: 'manual' });
    expect(evil.status).toBe(400); // لا open redirect

    const { token } = await createApiToken(r.db, 'd', ['read', 'media:write', 'post:write', 'post:publish']);
    const acc = await (await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${token}` } })).json() as { demo: boolean };
    expect(acc.demo).toBe(true);
    await r.connect({ audited: true });
    const cl = await connect(`${base}/mcp/${token}`);
    const info = JSON.parse(((await cl.callTool({ name: 'get_tiktok_account_info', arguments: {} })) as any).content[0].text);
    expect(info).toMatchObject({ connected: true, demo_mode: true }); expect(info.demo_note).toContain('لا تقل');
    const prep = JSON.parse(((await cl.callTool({ name: 'publish_tiktok_video', arguments: { media_id: await r.seedMedia('VIDEO') } })) as any).content[0].text);
    expect(prep.demo_mode).toBe(true);
    await cl.close(); await app.close();
  });
});
