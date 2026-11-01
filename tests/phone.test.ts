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
  async function connect(url: string, headers?: Record<string, string>) {
    const client = new Client({ name: 't', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: headers ? { headers } : undefined }));
    return client;
  }
  it('يعمل بالترويسة وبالرمز في المسار، بلا upload_media، ويرفض الرموز الخاطئة/المُبطلة', async () => {
    const { app, base } = await boot(); await r.connect({ audited: true });
    const { token, id } = await createApiToken(r.db, 'phone', ['read', 'post:write', 'post:publish', 'media:write', 'ai:use']);

    const viaHeader = await connect(`${base}/mcp`, { authorization: `Bearer ${token}` });
    const names = (await viaHeader.listTools()).tools.map((t) => t.name);
    expect(names).toContain('publish_tiktok_video'); expect(names).not.toContain('upload_media'); expect(names).not.toContain('approve_tiktok_post');
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
