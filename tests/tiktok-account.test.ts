import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountService, hasMinimumScopes } from '../src/tiktok/accounts.js';
import { TikTokClient } from '../src/tiktok/client.js';
import { decryptSecret } from '../src/crypto/index.js';
import { startFake, type FakeTikTok } from './fakeTikTok.js';
import { freshDb, testConfig } from './helpers.js';
import type { Db } from '../src/db/index.js';

let fake: FakeTikTok; let db: Db; let clock = new Date('2026-11-01T10:00:00Z');
const cfg = testConfig();
const mk = () => new AccountService(db, cfg, new TikTokClient({ baseUrl: fake.base, authUrl: 'https://www.tiktok.com/v2/auth/authorize/', clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: cfg.TIKTOK_REDIRECT_URI }), () => clock);

beforeAll(async () => { fake = await startFake(); db = await freshDb(); });
afterAll(async () => { await fake.stop(); await db.$disconnect(); });
beforeEach(async () => { clock = new Date('2026-11-01T10:00:00Z'); fake.requests.length = 0; fake.revoked.length = 0; fake.refreshCalls = 0; fake.grantedScope = 'user.info.basic,video.upload,video.publish'; await db.tikTokAccount.deleteMany(); await db.oAuthState.deleteMany(); });

const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

describe('OAuth', () => {
  it('رابط التفويض يحوي المعاملات الرسمية', async () => {
    const { url } = await mk().startConnect(); const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(u.searchParams.get('client_key')).toBe('ck_test');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('user.info.basic,video.upload,video.publish');
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.TIKTOK_REDIRECT_URI);
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(20);
  });

  it('ربط ناجح: الرموز مشفّرة ولا تظهر في العرض العام', async () => {
    const svc = mk(); const { url } = await svc.startConnect();
    const acc = await svc.handleCallback({ code: 'good-code', state: stateOf(url) });
    expect(acc.displayName).toBe('حساب تجريبي'); expect(acc.username).toBe('demo_user');
    expect(acc.accessTokenEnc).not.toContain('act.');
    expect(decryptSecret(acc.accessTokenEnc, cfg.TOKEN_ENC_KEY)).toMatch(/^act\./);
    expect(JSON.stringify(AccountService.publicView(acc))).not.toMatch(/act\.|rft\.|Enc/);
    expect((acc.creatorInfo as any).privacy_level_options).toContain('SELF_ONLY');
  });

  it('state يُستهلك مرة واحدة، والمزيّف والمنتهي مرفوضان', async () => {
    const svc = mk(); const { url } = await svc.startConnect(); const st = stateOf(url);
    await svc.handleCallback({ code: 'good-code', state: st });
    await expect(svc.handleCallback({ code: 'good-code', state: st })).rejects.toMatchObject({ code: 'bad_state' });
    await expect(svc.handleCallback({ code: 'good-code', state: 'forged' })).rejects.toMatchObject({ code: 'bad_state' });
    const { url: u2 } = await svc.startConnect(); clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(svc.handleCallback({ code: 'good-code', state: stateOf(u2) })).rejects.toMatchObject({ code: 'bad_state' });
  });

  it('رفض المستخدم، وكود خاطئ، وصلاحيات غير كافية (مع إبطال الرمز)', async () => {
    const svc = mk();
    await expect(svc.handleCallback({ error: 'access_denied', state: 'x' })).rejects.toMatchObject({ code: 'denied' });
    const { url } = await svc.startConnect();
    await expect(svc.handleCallback({ code: 'wrong', state: stateOf(url) })).rejects.toMatchObject({ code: 'exchange_failed' });
    fake.grantedScope = 'user.info.basic';
    const { url: u2 } = await svc.startConnect();
    await expect(svc.handleCallback({ code: 'good-code', state: stateOf(u2) })).rejects.toMatchObject({ code: 'insufficient_scopes' });
    expect(fake.revoked.length).toBeGreaterThan(0);
    expect(await db.tikTokAccount.count()).toBe(0);
    expect(hasMinimumScopes(['user.info.basic', 'video.publish'])).toBe(true);
  });
});

describe('الرموز', () => {
  async function connected() { const svc = mk(); const { url } = await svc.startConnect(); const acc = await svc.handleCallback({ code: 'good-code', state: stateOf(url) }); return { svc, acc }; }

  it('لا تجديد قبل الانتهاء، ويجدّد قبل 5 دقائق من الانتهاء ويدوّر رمز التحديث', async () => {
    const { svc, acc } = await connected();
    const t1 = await svc.accessToken(acc.id); expect(fake.refreshCalls).toBe(0);
    clock = new Date(clock.getTime() + 86400_000 - 4 * 60_000); // قبل الانتهاء بـ4 دقائق
    const t2 = await svc.accessToken(acc.id);
    expect(fake.refreshCalls).toBe(1); expect(t2).not.toBe(t1);
    const row = await db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(decryptSecret(row.accessTokenEnc, cfg.TOKEN_ENC_KEY)).toBe(t2);
  });

  it('طلبان متزامنان لا يسبّبان فقدان الربط', async () => {
    const { svc, acc } = await connected();
    clock = new Date(clock.getTime() + 86400_000 - 60_000);
    const [a, b] = await Promise.all([svc.accessToken(acc.id), svc.accessToken(acc.id)]);
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect((await db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe('ACTIVE');
  });

  it('فشل التجديد النهائي يحوّل الحساب إلى NEEDS_REAUTH', async () => {
    const { svc, acc } = await connected();
    fake.validRefresh.clear(); clock = new Date(clock.getTime() + 86400_000);
    await expect(svc.accessToken(acc.id)).rejects.toMatchObject({ code: 'reauth' });
    expect((await db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe('NEEDS_REAUTH');
    await expect(svc.accessToken(acc.id)).rejects.toMatchObject({ code: 'not_active' });
  });

  it('إلغاء الربط: يُبطل لدى TikTok ويمسح الرموز محلياً', async () => {
    const { svc, acc } = await connected();
    await svc.disconnect(acc.id);
    const row = await db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(row.status).toBe('REVOKED'); expect(row.accessTokenEnc).toBe('revoked'); expect(fake.revoked.length).toBe(1);
  });
});
