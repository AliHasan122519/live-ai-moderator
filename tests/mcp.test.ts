import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildApi } from '../src/api/app.js';
import { buildContainer } from '../src/container.js';
import { createApiToken } from '../src/auth/tokens.js';
import { DEFAULT_MCP_SCOPES, ALL_SCOPES } from '../src/auth/scopes.js';
import { TikTokClient } from '../src/tiktok/client.js';
import { ApiClient } from '../src/mcp/api.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { useRig } from './rig.js';
import { makeMp4, testConfig } from './helpers.js';

const r = useRig();
const REQUIRED = ['publish_to_tiktok', 'upload_tiktok_draft', 'publish_tiktok_photo', 'publish_tiktok_video', 'publish_tiktok_carousel', 'schedule_tiktok_post', 'cancel_scheduled_post',
  'get_tiktok_publish_status', 'get_tiktok_account_info', 'list_tiktok_posts', 'list_media_files', 'generate_tiktok_caption', 'generate_tiktok_hashtags'];

async function rigMcp(o: { scopes?: string[]; enableApproval?: boolean; allowedDir?: string } = {}) {
  const cfg = testConfig({ TOKEN_ENC_KEY: r.cfg.TOKEN_ENC_KEY, SESSION_SECRET: r.cfg.SESSION_SECRET, PUBLIC_API_URL: r.cfg.PUBLIC_API_URL, PUBLIC_WEB_URL: 'https://app.example.com' });
  const tt = new TikTokClient({ baseUrl: r.fake.base, authUrl: cfg.TIKTOK_AUTH_URL, clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: cfg.TIKTOK_REDIRECT_URI });
  const c = buildContainer(r.queue, { cfg, db: r.db, storage: r.storage, api: tt, notifier: r.notifier }, () => r.clock.t);
  const app = await buildApi(c, () => r.clock.t);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const { token } = await createApiToken(r.db, 'mcp', o.scopes ?? DEFAULT_MCP_SCOPES);
  const server = buildMcpServer(new ApiClient(base, token), { allowedDir: o.allowedDir ?? '', enableApproval: o.enableApproval ?? false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '1' }); await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content[0]!.text; let data: any = text; try { data = JSON.parse(text); } catch { /* نص خطأ */ }
    return { isError: !!res.isError, data, text };
  };
  return { call, client, close: async () => { await client.close(); await app.close(); } };
}

describe('خادم MCP', () => {
  it('يعرّف كل الأدوات المطلوبة، ولا يعرّض أداة الموافقة افتراضياً', async () => {
    const m = await rigMcp(); const names = (await m.client.listTools()).tools.map((t) => t.name);
    for (const n of REQUIRED) expect(names).toContain(n);
    expect(names).not.toContain('approve_tiktok_post'); await m.close();
  });

  it('رفع من المجلد المسموح فقط: يرفض الخارج، وروابط الهروب، وعند غياب الإعداد', async () => {
    const root = mkdtempSync(join(tmpdir(), 'allowed-')); const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(root, 'v.mp4'), makeMp4(2)); writeFileSync(join(outside, 'secret.mp4'), makeMp4(2)); mkdirSync(join(root, 'sub'));
    symlinkSync(join(outside, 'secret.mp4'), join(root, 'sub', 'link.mp4'));
    const m = await rigMcp({ allowedDir: root });
    const ok = await m.call('upload_media', { file_path: join(root, 'v.mp4'), ai_generated: true });
    expect(ok.isError).toBe(false); expect(ok.data.kind).toBe('VIDEO');
    expect((await m.call('upload_media', { file_path: join(outside, 'secret.mp4') })).isError).toBe(true);
    const sym = await m.call('upload_media', { file_path: join(root, 'sub', 'link.mp4') });
    expect(sym.isError).toBe(true); expect(sym.text).toContain('خارج المجلد');
    expect((await m.call('upload_media', { file_path: '/etc/passwd' })).isError).toBe(true);
    await m.close();
    const none = await rigMcp(); expect((await none.call('upload_media', { file_path: join(root, 'v.mp4') })).text).toContain('معطّل'); await none.close();
  });

  it('تجهيز فيديو يُرجع معاينة بلا نشر؛ المنشور لا يُعدّ منشوراً قبل تأكيد TikTok', async () => {
    await r.connect({ audited: true });
    const root = mkdtempSync(join(tmpdir(), 'allowed-')); writeFileSync(join(root, 'v.mp4'), makeMp4(2));
    const m = await rigMcp({ allowedDir: root });
    const up = await m.call('upload_media', { file_path: join(root, 'v.mp4') });
    const prep = await m.call('publish_tiktok_video', { media_id: up.data.media_id, caption: 'فيديو عن التقنية', hashtags: ['تقنية'], ai_generated: true });
    expect(prep.isError).toBe(false);
    expect(prep.data).toMatchObject({ published: false, status: 'AWAITING_APPROVAL' });
    expect(prep.data.approval_url).toContain('https://app.example.com/post?id='); expect(prep.data.preview.aiGenerated).toBe(true);
    expect(prep.data.next).toContain('approval_url');
    expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(0);
    const st = await m.call('get_tiktok_publish_status', { post_id: prep.data.post_id, refresh: false });
    expect(st.data).toMatchObject({ status: 'AWAITING_APPROVAL', confirmed_by_tiktok: false });
    expect((await m.call('list_tiktok_posts', {})).data[0].id).toBe(prep.data.post_id);
    expect((await m.call('list_media_files', {})).data[0].ai_generated).toBe(false);
    await m.close();
  });

  it('عدم تطابق النوع يلغي المنشور؛ والصور المتعددة تشترط 2 على الأقل', async () => {
    await r.connect({ audited: true });
    const m = await rigMcp(); const v = await r.seedMedia('VIDEO');
    const bad = await m.call('publish_tiktok_photo', { media_id: v });
    expect(bad.isError).toBe(true); expect(bad.text).toContain('لا يطابق');
    expect((await r.db.post.findMany()).every((p) => p.status === 'CANCELED')).toBe(true);
    await expect(m.client.callTool({ name: 'publish_tiktok_carousel', arguments: { media_ids: [await r.seedMedia('IMAGE')] } })).resolves.toMatchObject({ isError: true });
    await m.close();
  });

  it('الجدولة بالعربية: موعد صحيح يُحفظ بانتظار الموافقة، والغامض يُرفض', async () => {
    await r.connect({ audited: true });
    const m = await rigMcp(); const v = await r.seedMedia('VIDEO');
    const prep = await m.call('publish_to_tiktok', { media_ids: [v], caption: 'x' });
    const sch = await m.call('schedule_tiktok_post', { post_id: prep.data.post_id, when_text: 'بكرة الساعة 8 مساء' });
    expect(sch.isError).toBe(false); expect(sch.data.note).toContain('قبل موافقة');
    expect((await r.db.post.findUniqueOrThrow({ where: { id: prep.data.post_id } })).scheduledAt?.toISOString()).toBe('2026-11-02T17:00:00.000Z');
    expect((await r.db.post.findUniqueOrThrow({ where: { id: prep.data.post_id } })).status).toBe('AWAITING_APPROVAL');
    const amb = await m.call('schedule_tiktok_post', { post_id: prep.data.post_id, when_text: 'بكرة الساعة 8' });
    expect(amb.isError).toBe(true); expect(amb.text).toContain('صباحاً أم مساءً');
    expect((await m.call('cancel_scheduled_post', { post_id: prep.data.post_id })).data.status).toBe('CANCELED');
    await m.close();
  });

  it('الموافقة من المحادثة: تحتاج تفعيلاً + رمزاً بـpost:approve + بصمة المعاينة؛ ثم لا نجاح قبل TikTok', async () => {
    await r.connect({ audited: true });
    const v = await r.seedMedia('VIDEO');
    // 1) أداة مفعّلة لكن الرمز بلا post:approve ⇒ 403 من الخادم
    const weak = await rigMcp({ enableApproval: true });
    const prep = await weak.call('publish_tiktok_video', { media_id: v, caption: 'ب' });
    const denied = await weak.call('approve_tiktok_post', { post_id: prep.data.post_id, content_hash: prep.data.content_hash });
    expect(denied.isError).toBe(true); expect(denied.text).toContain('post:approve'); await weak.close();
    // 2) رمز كامل: بصمة خاطئة ترفض، الصحيحة تقبل وتبدأ الإرسال دون ادعاء النشر
    const strong = await rigMcp({ enableApproval: true, scopes: ALL_SCOPES });
    expect((await strong.call('approve_tiktok_post', { post_id: prep.data.post_id, content_hash: 'c'.repeat(64) })).isError).toBe(true);
    const ap = await strong.call('approve_tiktok_post', { post_id: prep.data.post_id, content_hash: prep.data.content_hash });
    expect(ap.data).toMatchObject({ published: false, status: 'QUEUED' });
    expect(await r.pub.run(prep.data.post_id)).toBe('sent');
    expect((await strong.call('get_tiktok_publish_status', { post_id: prep.data.post_id })).data).toMatchObject({ status: 'PROCESSING', confirmed_by_tiktok: false });
    const fin = (await strong.call('get_tiktok_publish_status', { post_id: prep.data.post_id })).data;
    expect(fin).toMatchObject({ status: 'PUBLISHED', confirmed_by_tiktok: true, tiktok_post_id: '7300000000000000001' });
    await strong.close();
  });

  it('معلومات الحساب تحذّر من التطبيق غير المعتمد ولا تسرّب رموزاً', async () => {
    await r.connect({ audited: false }); const m = await rigMcp();
    const a = await m.call('get_tiktok_account_info');
    expect(a.data.warning).toContain('SELF_ONLY'); expect(a.text).not.toMatch(/act\.|rft\./); expect(a.data.privacy_options).toContain('SELF_ONLY');
    await m.close();
  });
});
