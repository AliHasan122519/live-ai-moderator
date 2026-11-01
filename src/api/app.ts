import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import type { MediaAsset, PostStatus } from '@prisma/client';
import { authenticateToken, createApiToken, type Principal } from '../auth/tokens.js';
import { ALL_SCOPES, SCOPES, type Scope } from '../auth/scopes.js';
import { hashPassword, signPayload, verifyPassword, verifyPayload } from '../crypto/index.js';
import type { Container } from '../container.js';
import { audit } from '../db/index.js';
import { parseArabicTime } from '../ai/time.js';
import { AiUnavailable } from '../ai/service.js';
import { Readable } from 'node:stream';
import { extractFrames } from '../media/frames.js';
import { fetchPublicMedia, UrlError } from '../media/fetchUrl.js';
import { renderHtmlToJpeg, RenderError } from '../media/render.js';
import { makeSlideshow, SlideshowError, thumbnail } from '../media/slideshow.js';
import { ingestUpload, MediaError } from '../media/ingest.js';
import { resolvePull } from '../media/pull.js';
import { PostError } from '../posts/errors.js';
import { AccountError, AccountService } from '../tiktok/accounts.js';
import { ERROR_AR, TikTokApiError } from '../tiktok/errors.js';
import { ApiClient } from '../mcp/api.js';
import { buildMcpServer } from '../mcp/server.js';

declare module 'fastify' { interface FastifyRequest { principal?: Principal } }

const SESSION_TTL = 7 * 86400;
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'tiktok-publisher';
const ownerPrincipal: Principal = { kind: 'owner', id: 'owner', name: 'owner', scopes: new Set(ALL_SCOPES) };

const mediaView = (m: MediaAsset) => ({ ...m, sizeBytes: Number(m.sizeBytes), storageKey: undefined });

const draftSchema = z.object({
  accountId: z.string().optional(), mediaIds: z.array(z.string()).min(1).max(35), caption: z.string().max(4000).optional(), hashtags: z.array(z.string().max(60)).max(30).optional(),
  privacyLevel: z.enum(['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR']).optional(), mode: z.enum(['DIRECT', 'DRAFT_INBOX']).optional(),
  disableComment: z.boolean().optional(), disableDuet: z.boolean().optional(), disableStitch: z.boolean().optional(), aiGenerated: z.boolean().optional(),
  coverIndex: z.number().int().min(0).optional(), brandContent: z.boolean().optional(), brandOrganic: z.boolean().optional(), allowDuplicate: z.boolean().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(), scheduleText: z.string().max(200).optional(),
});
const patchSchema = draftSchema.omit({ accountId: true, mediaIds: true, allowDuplicate: true }).extend({ mediaIds: z.array(z.string()).min(1).max(35).optional() });

export async function buildApi(c: Container, now: () => Date = () => new Date()) {
  const { cfg, db } = c;
  // maxParamLength: روابط السحب الموقّعة (~150 حرفاً) أطول من الافتراضي 100 فتُرفض بـ414
  // disableRequestLogging: روابط /mcp/<token> تحمل سراً ولا يجوز أن تُسجَّل
  const app = Fastify({ logger: cfg.isProd, disableRequestLogging: true, bodyLimit: 1024 * 1024, trustProxy: true, routerOptions: { maxParamLength: 500 } });
  // صفحات Next المُصدَّرة تحتوي سكربتات مضمَّنة، لذا 'unsafe-inline' للسكربت (بلا nonce). باقي القيود صارمة.
  await app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"],
  } } });
  const ownerHash = cfg.OWNER_PASSWORD_HASH || (cfg.OWNER_PASSWORD ? await hashPassword(cfg.OWNER_PASSWORD) : '');
  app.addHook('onSend', async (req, reply) => { if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) reply.header('cache-control', 'no-store'); });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 4 * 1024 ** 3, files: 1, fields: 5 } });

  // ---------- المصادقة ----------
  async function authenticate(req: FastifyRequest): Promise<Principal | null> {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (bearer) return authenticateToken(db, bearer);
    const sid = req.cookies.sid;
    if (sid && verifyPayload<{ o: number }>(sid, cfg.SESSION_SECRET, now().getTime())?.o === 1) {
      // الجلسة بالكوكي ⇒ حماية CSRF للطلبات المغيِّرة
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) return null;
      return ownerPrincipal;
    }
    return null;
  }
  async function need(req: FastifyRequest, reply: FastifyReply, scope: Scope): Promise<Principal | null> {
    const p = (req.principal ??= (await authenticate(req)) ?? undefined);
    if (!p) { reply.code(401).send({ error: 'unauthorized', message: 'غير مصرّح' }); return null; }
    if (!p.scopes.has(scope)) { reply.code(403).send({ error: 'forbidden', message: `الصلاحية المطلوبة غير ممنوحة لهذا الرمز: ${scope}` }); return null; }
    return p;
  }
  const actorOf = (p: Principal) => (p.kind === 'owner' ? 'owner' : `token:${p.name}`);
  const ownerOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    const p = await need(req, reply, 'read'); if (!p) return null;
    if (p.kind !== 'owner') { reply.code(403).send({ error: 'owner_only', message: 'هذا الإجراء لجلسة المالك فقط' }); return null; }
    return p;
  };

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as Error & { statusCode?: number; validation?: unknown };
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', message: 'بيانات غير صالحة', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err instanceof PostError) { const code = err.code === 'not_found' ? 404 : ['bad_state', 'duplicate', 'stale_hash', 'cannot_cancel', 'needs_force', 'not_approved'].includes(err.code) ? 409 : 400; return reply.code(code).send({ error: err.code, message: err.message, details: err.details }); }
    if (err instanceof RenderError) return reply.code(err.code === 'unavailable' ? 503 : 400).send({ error: err.code, message: err.message });
    if (err instanceof SlideshowError || err instanceof UrlError) return reply.code(400).send({ error: (err as UrlError).code ?? 'slideshow', message: err.message });
    if (err instanceof AccountError) return reply.code(409).send({ error: err.code, message: err.message });
    if (err instanceof MediaError) return reply.code(err.code === 'too_large' ? 413 : 400).send({ error: err.code, message: err.message });
    if (err instanceof TikTokApiError) return reply.code(502).send({ error: err.code, message: ERROR_AR[err.code] ?? err.message });
    if (err instanceof AiUnavailable) return reply.code(503).send({ error: 'ai_unavailable', message: err.message });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'bad_request', message: e.message });
    app.log.error(err); return reply.code(500).send({ error: 'internal', message: 'خطأ داخلي' });
  });

  app.get('/health', async () => ({ ok: true }));

  // ---------- MCP البعيد (Streamable HTTP، بلا حالة) ----------
  // الرمز في الترويسة Authorization، أو في المسار /mcp/<token> للتطبيقات التي لا تتيح ترويسات (مثل موصّلات مخصصة).
  // الرمز في الرابط أضعف (قد يظهر في سجلات وسطاء)؛ استخدم رمزاً بلا post:approve وأبطله عند الشك.
  const mcpHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.params as { token?: string }).token ?? /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const p = raw ? await authenticateToken(db, raw) : null;
    if (!p) return reply.code(401).send({ error: 'unauthorized', message: 'غير مصرّح' });
    const server = buildMcpServer(new ApiClient(`http://127.0.0.1:${req.socket.localPort}`, raw), { allowedDir: '', enableApproval: true, remote: true });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };
  const mcpRate = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.all('/mcp', mcpRate, mcpHandler);
  app.all('/mcp/:token', mcpRate, mcpHandler);

  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    if (!ownerHash) return reply.code(503).send({ error: 'no_password', message: 'لم تُضبط كلمة مرور المالك (OWNER_PASSWORD_HASH)' });
    if (!(await verifyPassword(password, ownerHash))) { await audit(db, 'anonymous', 'login.failed', undefined, { ip: req.ip }); return reply.code(401).send({ error: 'bad_credentials', message: 'كلمة المرور غير صحيحة' }); }
    reply.setCookie('sid', signPayload({ o: 1 }, cfg.SESSION_SECRET, SESSION_TTL, now().getTime()), { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, path: '/', maxAge: SESSION_TTL });
    await audit(db, 'owner', 'login.ok');
    return { ok: true };
  });
  app.post('/api/auth/logout', async (_req, reply) => { reply.clearCookie('sid', { path: '/' }); return { ok: true }; });
  app.get('/api/me', async (req, reply) => {
    const p = await need(req, reply, 'read'); if (!p) return;
    return { kind: p.kind, name: p.name, scopes: [...p.scopes] };
  });

  // ---------- ربط TikTok ----------
  app.get('/api/tiktok/connect', async (req, reply) => { if (!(await ownerOnly(req, reply))) return; return c.accounts.startConnect(); });
  app.get('/auth/tiktok/callback', async (req, reply) => {
    const sid = req.cookies.sid;
    if (!sid || !verifyPayload(sid, cfg.SESSION_SECRET, now().getTime())) return reply.redirect(`${cfg.PUBLIC_WEB_URL}/login`);
    try {
      await c.accounts.handleCallback(req.query as Record<string, string>);
      return reply.redirect(`${cfg.PUBLIC_WEB_URL}/account?connected=1`);
    } catch (e) {
      const msg = e instanceof AccountError ? e.message : 'فشل الربط';
      return reply.redirect(`${cfg.PUBLIC_WEB_URL}/account?error=${encodeURIComponent(msg)}`);
    }
  });
  if (cfg.DEMO_TIKTOK) {
    // صفحة موافقة وهمية تحل محل صفحة TikTok في الوضع التجريبي: تعيد التوجيه إلى redirect_uri المضبوط فقط (لا open redirect)
    app.get('/demo/tiktok/authorize/', async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (q.redirect_uri !== cfg.TIKTOK_REDIRECT_URI) return reply.code(400).send({ error: 'bad_redirect', message: 'redirect_uri غير مطابق' });
      const u = new URL(cfg.TIKTOK_REDIRECT_URI); u.searchParams.set('code', 'good-code'); u.searchParams.set('state', q.state ?? '');
      return reply.redirect(u.toString());
    });
  }
  app.get('/api/account', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const acc = await db.tikTokAccount.findFirst({ orderBy: { connectedAt: 'desc' } });
    if (!acc) return { connected: false, demo: cfg.DEMO_TIKTOK, config: { clientKeySet: !!cfg.TIKTOK_CLIENT_KEY, scopes: cfg.scopes, redirectUri: cfg.TIKTOK_REDIRECT_URI } };
    return { connected: acc.status === 'ACTIVE', demo: cfg.DEMO_TIKTOK, account: AccountService.publicView(acc), config: { scopes: cfg.scopes, redirectUri: cfg.TIKTOK_REDIRECT_URI } };
  });
  app.post('/api/account/refresh', async (req, reply) => {
    if (!(await need(req, reply, 'post:write'))) return;
    const acc = await db.tikTokAccount.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    return { creatorInfo: await c.accounts.refreshCreatorInfo(acc.id) };
  });
  app.put('/api/account/audited', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    const { audited } = z.object({ audited: z.boolean() }).parse(req.body);
    const acc = await db.tikTokAccount.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    await db.tikTokAccount.update({ where: { id: acc.id }, data: { audited } });
    await audit(db, 'owner', 'account.audited_flag', acc.id, { audited });
    return { ok: true, audited };
  });
  app.delete('/api/account', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    const acc = await db.tikTokAccount.findFirstOrThrow({ where: { status: { not: 'REVOKED' } } });
    await c.accounts.disconnect(acc.id);
    return { ok: true };
  });

  // ---------- الوسائط ----------
  app.post('/api/media', async (req, reply) => {
    const p = await need(req, reply, 'media:write'); if (!p) return;
    const q = z.object({ source: z.enum(['UPLOAD', 'AI_GENERATED', 'CLAUDE_CODE']).default('UPLOAD'), aiGenerated: z.enum(['true', 'false']).optional() }).parse(req.query);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'لم يُرفع ملف' });
    const { asset, duplicate } = await ingestUpload({ db, storage: c.storage, config: cfg, stream: file.file, filename: file.filename, source: q.source, aiGenerated: q.aiGenerated ? q.aiGenerated === 'true' : undefined });
    if (file.file.truncated) throw new MediaError('too_large', 'الملف أكبر من الحد المسموح');
    await audit(db, actorOf(p), 'media.uploaded', asset.id, { duplicate, kind: asset.kind });
    return reply.code(duplicate ? 200 : 201).send({ asset: mediaView(asset), duplicate });
  });
  app.get('/api/media', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const { kind, limit } = z.object({ kind: z.enum(['VIDEO', 'IMAGE']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return (await db.mediaAsset.findMany({ where: { deletedAt: null, kind }, orderBy: { createdAt: 'desc' }, take: limit })).map(mediaView);
  });
  app.get('/api/media/:id/file', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const a = await db.mediaAsset.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!a || a.deletedAt) return reply.code(404).send({ error: 'not_found', message: 'غير موجود' });
    const size = Number(a.sizeBytes); const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0, end = size - 1;
    if (m) { start = m[1] ? Number(m[1]) : size - Number(m[2]); end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; if (start > end || start < 0) return reply.code(416).send(); reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`); }
    return reply.header('content-type', a.mime).header('accept-ranges', 'bytes').header('content-length', end - start + 1).header('cache-control', 'private, max-age=300').send(await c.storage.get(a.storageKey, { start, end }));
  });
  app.delete('/api/media/:id', async (req, reply) => {
    const p = await need(req, reply, 'media:write'); if (!p) return;
    const id = (req.params as { id: string }).id;
    const used = await db.postMedia.count({ where: { mediaId: id, post: { status: { in: ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PROCESSING', 'UNKNOWN'] } } } });
    if (used) return reply.code(409).send({ error: 'in_use', message: 'الملف مرتبط بمنشور نشط. ألغِ المنشور أولاً' });
    const a = await db.mediaAsset.findUnique({ where: { id } });
    if (!a || a.deletedAt) return reply.code(404).send({ error: 'not_found', message: 'غير موجود' });
    await c.storage.delete(a.storageKey); await db.mediaAsset.update({ where: { id }, data: { deletedAt: now() } });
    await audit(db, actorOf(p), 'media.deleted', id);
    return { ok: true };
  });
  // رابط سحب موقّع لـTikTok (PULL_FROM_URL): عام لكن بتوقيع وعمر قصير ومربوط بمنشور نشط
  app.get('/media/pull/:token', async (req, reply) => {
    const a = await resolvePull(db, cfg, (req.params as { token: string }).token, now().getTime());
    if (!a) return reply.code(404).send();
    return reply.header('content-type', a.mime).header('content-length', Number(a.sizeBytes)).header('cache-control', 'no-store').send(await c.storage.get(a.storageKey));
  });

  // ---------- إعدادات المالك ----------
  async function getSetting<T>(key: string, d: T): Promise<T> { const r = await db.setting.findUnique({ where: { key } }); return (r?.value as T | undefined) ?? d; }
  app.get('/api/settings', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    return { chatApproval: await getSetting('chatApproval', false) };
  });
  app.put('/api/settings', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    const { chatApproval } = z.object({ chatApproval: z.boolean() }).parse(req.body);
    await db.setting.upsert({ where: { key: 'chatApproval' }, create: { key: 'chatApproval', value: chatApproval }, update: { value: chatApproval } });
    await audit(db, 'owner', 'settings.chat_approval', undefined, { chatApproval });
    return { chatApproval };
  });

  // ---------- التصميم داخل Claude: رسم HTML، فيديو من شرائح، استيراد من رابط ----------
  const heavy = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  async function ingestBuffer(buf: Buffer, filename: string, aiGenerated: boolean) {
    return ingestUpload({ db, storage: c.storage, config: cfg, stream: Readable.from([buf]), filename, source: aiGenerated ? 'AI_GENERATED' : 'UPLOAD', aiGenerated });
  }
  const b64 = (b: Buffer) => b.toString('base64');
  app.post('/api/media/render', heavy, async (req, reply) => {
    const p = await need(req, reply, 'media:write'); if (!p) return;
    const b = z.object({ html: z.string().min(1).max(300_000), width: z.number().int().min(320).max(2160).default(1080), height: z.number().int().min(320).max(3840).default(1920), aiGenerated: z.boolean().default(true) }).parse(req.body);
    const jpeg = await renderHtmlToJpeg(b.html, { width: b.width, height: b.height });
    const { asset, duplicate } = await ingestBuffer(jpeg, `design-${Date.now()}.jpg`, b.aiGenerated);
    await audit(db, actorOf(p), 'media.rendered', asset.id, { duplicate });
    return reply.code(201).send({ asset: mediaView(asset), duplicate, previewJpegBase64: b64(await thumbnail(jpeg, 540)) });
  });
  app.post('/api/media/slideshow', heavy, async (req, reply) => {
    const p = await need(req, reply, 'media:write'); if (!p) return;
    const b = z.object({ slides: z.array(z.string().min(1).max(300_000)).min(1).max(12).optional(), imageIds: z.array(z.string()).min(1).max(12).optional(),
      secondsPerSlide: z.number().min(1).max(10).default(3), width: z.number().int().min(320).max(1080).default(1080), height: z.number().int().min(320).max(1920).default(1920), aiGenerated: z.boolean().default(true) })
      .refine((v) => !!v.slides !== !!v.imageIds, 'أرسل slides (HTML) أو imageIds (صور مرفوعة) — واحداً فقط').parse(req.body);
    const images: Buffer[] = [];
    if (b.slides) for (const h of b.slides) images.push(await renderHtmlToJpeg(h, { width: b.width, height: b.height }));
    else {
      const assets = await db.mediaAsset.findMany({ where: { id: { in: b.imageIds }, deletedAt: null, kind: 'IMAGE' } });
      if (assets.length !== new Set(b.imageIds).size) throw new SlideshowError('بعض الصور غير موجودة أو ليست صوراً');
      for (const id of b.imageIds!) { const a = assets.find((x) => x.id === id)!; const chunks: Buffer[] = []; for await (const ch of await c.storage.get(a.storageKey)) chunks.push(ch as Buffer); images.push(Buffer.concat(chunks)); }
    }
    const mp4 = await makeSlideshow(images, { secondsPerSlide: b.secondsPerSlide, width: b.width, height: b.height });
    const { asset, duplicate } = await ingestBuffer(mp4, `slideshow-${Date.now()}.mp4`, b.aiGenerated);
    await audit(db, actorOf(p), 'media.slideshow', asset.id, { slides: images.length });
    const frames = await extractFrames(c.storage, asset, 3, 360);
    return reply.code(201).send({ asset: mediaView(asset), duplicate, previewFramesBase64: frames.map(b64) });
  });
  app.post('/api/media/import-url', heavy, async (req, reply) => {
    const p = await need(req, reply, 'media:write'); if (!p) return;
    const b = z.object({ url: z.string().url().max(2000), aiGenerated: z.boolean().default(false) }).parse(req.body);
    const f = await fetchPublicMedia(b.url, { maxBytes: 4 * 1024 ** 3 });
    const { asset, duplicate } = await ingestUpload({ db, storage: c.storage, config: cfg, stream: f.stream, filename: f.filename, source: b.aiGenerated ? 'AI_GENERATED' : 'UPLOAD', aiGenerated: b.aiGenerated });
    await audit(db, actorOf(p), 'media.imported', asset.id, { host: new URL(b.url).host, duplicate });
    return reply.code(201).send({ asset: mediaView(asset), duplicate });
  });
  /** لقطات مصغّرة لمحتوى مرفوع، ليراه Claude ويقيّمه قبل النشر */
  app.get('/api/media/:id/preview', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const a = await db.mediaAsset.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!a || a.deletedAt) return reply.code(404).send({ error: 'not_found', message: 'غير موجود' });
    return { asset: mediaView(a), framesBase64: (await extractFrames(c.storage, a, a.kind === 'VIDEO' ? 3 : 1, 480)).map(b64) };
  });

  // ---------- المنشورات ----------
  async function accountIdOf(explicit?: string) {
    if (explicit) return explicit;
    const acc = await db.tikTokAccount.findFirst({ where: { status: 'ACTIVE' }, orderBy: { connectedAt: 'desc' } });
    if (!acc) throw new PostError('account', 'لا يوجد حساب TikTok مربوط');
    return acc.id;
  }
  function resolveSchedule(a: { scheduledAt?: string | null; scheduleText?: string }) {
    if (a.scheduleText) { const r = parseArabicTime(a.scheduleText, now()); if (!r.ok) throw new PostError('bad_schedule', r.hint); return r.at; }
    return a.scheduledAt ? new Date(a.scheduledAt) : a.scheduledAt === null ? null : undefined;
  }
  const approvalUrl = (id: string) => `${cfg.PUBLIC_WEB_URL}/post?id=${id}`;

  app.post('/api/posts', async (req, reply) => {
    const p = await need(req, reply, 'post:write'); if (!p) return;
    const b = draftSchema.parse(req.body);
    const post = await c.posts.createDraft({ ...b, accountId: await accountIdOf(b.accountId), scheduledAt: resolveSchedule(b) ?? null }, actorOf(p));
    return reply.code(201).send(post);
  });
  /** مسار الاختصار للمساعد: مسودة + طلب موافقة + معاينة + رابط الموافقة، ولا يُنشر شيء. */
  app.post('/api/posts/prepare', async (req, reply) => {
    const p = await need(req, reply, 'post:write'); if (!p) return;
    const b = draftSchema.parse(req.body);
    const post = await c.posts.createDraft({ ...b, accountId: await accountIdOf(b.accountId), scheduledAt: resolveSchedule(b) ?? null }, actorOf(p));
    const preview = await c.posts.requestApproval(post.id, actorOf(p));
    return reply.code(201).send({ demo: cfg.DEMO_TIKTOK, preview, approvalUrl: approvalUrl(post.id), nextStep: 'اعرض المعاينة على المستخدم واطلب موافقته الصريحة. الموافقة من اللوحة، أو من المحادثة إن كان الرمز يملك post:approve.' });
  });
  app.get('/api/posts', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const q = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return c.posts.list(undefined, q.limit, q.status?.split(',') as PostStatus[] | undefined);
  });
  app.get('/api/posts/:id', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const id = (req.params as { id: string }).id;
    const l = await c.posts.load(id);
    const events = await db.postEvent.findMany({ where: { postId: id }, orderBy: { at: 'asc' } });
    return { post: { ...l.post, media: l.media.map(mediaView) }, preview: await c.posts.preview(id), events, approvalUrl: approvalUrl(id) };
  });
  app.patch('/api/posts/:id', async (req, reply) => {
    const p = await need(req, reply, 'post:write'); if (!p) return;
    const b = patchSchema.parse(req.body);
    const { scheduleText: _s, scheduledAt: _a, ...rest } = b;
    const sch = resolveSchedule(b);
    return c.posts.update((req.params as { id: string }).id, { ...rest, ...(sch !== undefined ? { scheduledAt: sch } : {}) }, actorOf(p));
  });
  app.post('/api/posts/:id/request-approval', async (req, reply) => {
    const p = await need(req, reply, 'post:write'); if (!p) return;
    return c.posts.requestApproval((req.params as { id: string }).id, actorOf(p));
  });
  app.post('/api/posts/:id/approve', async (req, reply) => {
    const p = await need(req, reply, 'post:approve'); if (!p) return;
    // الموافقة من المحادثة (رمز API) لا تعمل إلا إن فعّلها المالك صراحةً من اللوحة؛ الصلاحية وحدها لا تكفي
    if (p.kind === 'token' && !(await getSetting('chatApproval', false))) return reply.code(403).send({ error: 'chat_approval_off', message: 'الموافقة من المحادثة معطّلة. فعّلها من اللوحة (الأمان)، أو وافق من رابط المنشور.' });
    const id = (req.params as { id: string }).id;
    const b = z.object({ contentHash: z.string().length(64), publishNow: z.boolean().default(false) }).parse(req.body);
    let post = await c.posts.approve(id, b.contentHash, actorOf(p));
    if (b.publishNow && post.status === 'APPROVED') {
      if (!p.scopes.has('post:publish')) return reply.code(403).send({ error: 'forbidden', message: 'وُوفق على المنشور لكن الرمز لا يملك post:publish للنشر الفوري' });
      post = await c.posts.publishNow(id, actorOf(p));
    }
    return post;
  });
  app.post('/api/posts/:id/schedule', async (req, reply) => {
    const p = await need(req, reply, 'post:publish'); if (!p) return;
    const b = z.object({ at: z.string().datetime({ offset: true }).optional(), text: z.string().max(200).optional() }).refine((v) => v.at || v.text, 'at أو text مطلوب').parse(req.body);
    const when = b.text ? (() => { const r = parseArabicTime(b.text!, now()); if (!r.ok) throw new PostError('bad_schedule', r.hint); return r.at; })() : new Date(b.at!);
    return c.posts.schedule((req.params as { id: string }).id, when, actorOf(p));
  });
  app.post('/api/posts/:id/publish', async (req, reply) => {
    const p = await need(req, reply, 'post:publish'); if (!p) return;
    return c.posts.publishNow((req.params as { id: string }).id, actorOf(p));
  });
  app.post('/api/posts/:id/cancel', async (req, reply) => {
    const p = await need(req, reply, 'post:write'); if (!p) return;
    return c.posts.cancel((req.params as { id: string }).id, actorOf(p));
  });
  app.post('/api/posts/:id/retry', async (req, reply) => {
    const p = await need(req, reply, 'post:publish'); if (!p) return;
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    return c.posts.retry((req.params as { id: string }).id, actorOf(p), { force });
  });
  /** تحقق فوري من حالة TikTok (يغني عن انتظار المتابع الدوري). */
  app.post('/api/posts/:id/check', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const id = (req.params as { id: string }).id;
    const status = await c.publisher.checkStatus(id);
    const post = await db.post.findUniqueOrThrow({ where: { id } });
    return { demo: cfg.DEMO_TIKTOK, status, publishId: post.publishId, tiktokPostId: post.tiktokPostId, failReason: post.failReason, confirmedByTikTok: status === 'PUBLISHED' || status === 'INBOX_DELIVERED' };
  });

  // ---------- الذكاء الاصطناعي والوقت ----------
  async function framesFor(ids: string[]) {
    const assets = await db.mediaAsset.findMany({ where: { id: { in: ids.slice(0, 4) }, deletedAt: null } });
    const out: Buffer[] = [];
    for (const a of assets) out.push(...(await extractFrames(c.storage, a, a.kind === 'VIDEO' ? 3 : 1)));
    return out.slice(0, 6);
  }
  app.post('/api/ai/caption', async (req, reply) => {
    if (!(await need(req, reply, 'ai:use'))) return;
    const b = z.object({ mediaIds: z.array(z.string()).max(4).default([]), topic: z.string().max(500).optional(), tone: z.string().max(60).optional(), maxChars: z.number().int().min(20).max(2000).optional() }).parse(req.body);
    return c.ai.caption({ ...b, images: await framesFor(b.mediaIds) });
  });
  app.post('/api/ai/hashtags', async (req, reply) => {
    if (!(await need(req, reply, 'ai:use'))) return;
    const b = z.object({ mediaIds: z.array(z.string()).max(4).default([]), topic: z.string().max(300).optional(), caption: z.string().max(1000).optional(), count: z.number().int().min(1).max(15).optional() }).parse(req.body);
    return { hashtags: await c.ai.hashtags({ ...b, images: await framesFor(b.mediaIds) }) };
  });
  app.post('/api/time/parse', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const { text } = z.object({ text: z.string().max(200) }).parse(req.body);
    const r = parseArabicTime(text, now());
    return r.ok ? { ok: true, at: r.at.toISOString(), display: r.display } : r;
  });

  // ---------- الإدارة ----------
  app.get('/api/dashboard', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    const by = await db.post.groupBy({ by: ['status'], _count: true });
    const upcoming = await db.post.findMany({ where: { status: 'SCHEDULED' }, orderBy: { scheduledAt: 'asc' }, take: 5 });
    const recent = await db.post.findMany({ orderBy: { updatedAt: 'desc' }, take: 6 });
    return { counts: Object.fromEntries(by.map((x) => [x.status, x._count])), upcoming, recent, ai: c.ai.available };
  });
  app.get('/api/tokens', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    return { scopes: SCOPES, tokens: (await db.apiToken.findMany({ orderBy: { createdAt: 'desc' } })).map(({ tokenHash: _h, ...t }) => t) };
  });
  app.post('/api/tokens', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    const b = z.object({ name: z.string().min(1).max(60), scopes: z.array(z.string()).min(1) }).parse(req.body);
    return reply.code(201).send(await createApiToken(db, b.name, b.scopes));
  });
  app.delete('/api/tokens/:id', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    const id = (req.params as { id: string }).id;
    await db.apiToken.update({ where: { id }, data: { revokedAt: now() } });
    await audit(db, 'owner', 'token.revoked', id);
    return { ok: true };
  });
  app.get('/api/audit', async (req, reply) => {
    if (!(await ownerOnly(req, reply))) return;
    return db.auditLog.findMany({ orderBy: { at: 'desc' }, take: 200 });
  });
  app.get('/api/errors', async (req, reply) => {
    if (!(await need(req, reply, 'read'))) return;
    return db.post.findMany({ where: { status: { in: ['FAILED', 'UNKNOWN'] } }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, status: true, failReason: true, updatedAt: true, type: true, caption: true } });
  });

  // ---------- الواجهة المُصدَّرة (ملفات ثابتة) ----------
  const webRoot = resolve(cfg.WEB_DIR);
  const hasWeb = existsSync(resolve(webRoot, 'index.html'));
  if (hasWeb) {
    // /account ⇒ account.html (التصدير ينشئ مجلداً بالاسم نفسه فيحجب @fastify/static الملف). مسار آمن: داخل الجذر فقط.
    app.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return;
      const path = req.url.split('?')[0] ?? '/';
      if (path === '/' || /\.[a-z0-9]+$/i.test(path) || ['/api/', '/auth/', '/media/pull/', '/mcp'].some((x) => path.startsWith(x))) return;
      let decoded: string; try { decoded = decodeURIComponent(path); } catch { return; }
      if (decoded.includes('\0') || decoded.includes('..')) return;
      const file = resolve(webRoot, '.' + decoded.replace(/\/$/, '') + '.html');
      if (!file.startsWith(webRoot + sep) || !existsSync(file)) return;
      return reply.type('text/html; charset=utf-8').send(createReadStream(file));
    });
  }
  if (hasWeb) await app.register(fastifyStatic, { root: webRoot, extensions: ['html'], index: ['index.html'], wildcard: true, decorateReply: false });
  app.setNotFoundHandler(async (req, reply) => {
    const apiLike = ['/api/', '/auth/', '/media/pull/', '/mcp'].some((p) => req.url.startsWith(p));
    if (hasWeb && req.method === 'GET' && !apiLike) return reply.code(404).type('text/html').send(await readFile(resolve(webRoot, '404.html')).catch(() => 'غير موجود'));
    return reply.code(404).send({ error: 'not_found', message: 'غير موجود' });
  });

  return app;
}
