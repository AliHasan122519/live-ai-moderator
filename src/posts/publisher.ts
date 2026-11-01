import type { Post } from '@prisma/client';
import type { Config } from '../config/index.js';
import type { Db } from '../db/index.js';
import { makePullUrl } from '../media/pull.js';
import type { Storage } from '../storage/types.js';
import { AccountError, type AccountService } from '../tiktok/accounts.js';
import type { TikTokClient } from '../tiktok/client.js';
import { ERROR_AR, TikTokApiError } from '../tiktok/errors.js';
import { chunkRanges, planChunks } from './chunks.js';
import { toPostInfo } from './effective.js';
import type { Notifier } from './notify.js';
import type { PublishQueue } from './queue.js';
import { HOLDS_MEDIA, type PostService } from './service.js';

export interface PublisherOpts {
  processingTimeoutMs?: number; maxRateLimitRetries?: number; sleep?: (ms: number) => Promise<void>; chunkSize?: number;
}
const reasonAr = (e: unknown) => e instanceof TikTokApiError ? (ERROR_AR[e.code] ?? e.message) + ` [${e.code}${e.logId ? ' log:' + e.logId : ''}]` : (e as Error).message;

/**
 * تنفيذ النشر. ضمانات:
 *  - تنفيذ واحد لكل منشور (CAS على الحالة) حتى لو وصلت المهمة مرتين.
 *  - لا إرسال إلا إن طابقت بصمة المحتوى الحالية بصمة الموافقة.
 *  - غموض ما بعد init (انقطاع/5xx) ⇒ UNKNOWN بلا إعادة تلقائية، لأن TikTok قد تكون أنشأت المنشور.
 *  - PUBLISHED فقط بعد PUBLISH_COMPLETE من TikTok.
 */
export class Publisher {
  private o: Required<PublisherOpts>;
  constructor(private db: Db, private cfg: Config, private posts: PostService, private accounts: AccountService, private api: TikTokClient,
    private storage: Storage, private queue: PublishQueue, private notifier: Notifier, private now: () => Date = () => new Date(), o: PublisherOpts = {}) {
    this.o = { processingTimeoutMs: 30 * 60_000, maxRateLimitRetries: 4, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), chunkSize: 10 * 1024 * 1024, ...o };
  }

  async run(postId: string): Promise<'sent' | 'skipped' | 'failed' | 'unknown' | 'requeued'> {
    const before = await this.db.post.findUnique({ where: { id: postId } });
    if (!before) return 'skipped';
    if (before.status === 'SCHEDULED' && before.scheduledAt && before.scheduledAt.getTime() > this.now().getTime() + 5000) return 'skipped'; // أُطلقت مبكراً
    const claimed = await this.db.post.updateMany({
      where: { id: postId, status: { in: ['QUEUED', 'APPROVED', 'SCHEDULED'] }, approvedHash: { not: null } },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return 'skipped'; // عملية أخرى استلمته أو أُلغي
    await this.posts.event(postId, 'worker', 'sending');

    let stage: 'prepare' | 'init' | 'upload' = 'prepare';
    let post: Post = before;
    try {
      let l = await this.posts.load(postId);
      post = l.post;
      const token = await this.accounts.accessToken(l.account.id);
      await this.accounts.refreshCreatorInfo(l.account.id).catch(() => {}); // الإعدادات الحالية؛ عند الفشل نكمل بالمحفوظة
      l = await this.posts.load(postId);
      const { eff, hash } = this.posts.analyze(l);

      if (hash !== l.post.approvedHash) return await this.fail(post, 'approval_stale', 'تغيّر المحتوى أو إعدادات الحساب بعد الموافقة — لم يُرسل شيء. اطلب موافقة جديدة');
      if (eff.errors.length) return await this.fail(post, 'invalid', eff.errors.join(' | '));
      if (!l.post.allowDuplicate) {
        const dup = await this.db.post.findFirst({ where: { accountId: l.post.accountId, mediaSig: l.post.mediaSig, id: { not: postId }, status: { in: HOLDS_MEDIA } } });
        if (dup) return await this.fail(post, 'duplicate', `الملف نفسه مرتبط بمنشور آخر (${dup.id})`);
      }
      const media = l.media;
      for (const m of media) if (m.deletedAt || !(await this.storage.stat(m.storageKey))) return await this.fail(post, 'media_missing', `الملف ${m.filename} غير متاح في التخزين`);

      stage = 'init';
      await this.db.post.update({ where: { id: postId }, data: { initSentAt: this.now() } }); // قبل الاستدعاء: لو انهار الخادم نعرف أن init ربما أُرسل
      let publishId: string; let uploadUrl: string | undefined;
      if (l.post.type === 'VIDEO') {
        const m = media[0]!; const size = Number(m.sizeBytes);
        const plan = planChunks(size, this.o.chunkSize);
        const r = await this.api.initVideo(token, { mode: eff.mode, postInfo: eff.mode === 'DIRECT' ? toPostInfo(eff, l.post) : undefined, videoSize: size, chunkSize: plan.chunkSize, totalChunks: plan.total });
        publishId = r.publish_id; uploadUrl = r.upload_url;
        if (!uploadUrl) throw new TikTokApiError('invalid_response', 'لم تُرجع TikTok رابط الرفع', 200);
        await this.db.post.update({ where: { id: postId }, data: { publishId, status: 'PROCESSING' } });
        await this.posts.event(postId, 'worker', 'init_ok', { publishId, mode: eff.mode });
        stage = 'upload';
        const ranges = chunkRanges(size, plan);
        for (const [i, rg] of ranges.entries()) {
          const buf = await this.readRange(m.storageKey, rg.start, rg.end);
          await this.uploadWithRetry(uploadUrl, buf, { ...rg, total: size }, m.mime, i);
        }
        await this.posts.event(postId, 'worker', 'upload_done', { chunks: ranges.length });
      } else {
        const urls = media.map((m) => makePullUrl(this.cfg, m, 3600, this.now().getTime()));
        const r = await this.api.initPhoto(token, { mode: eff.mode, postInfo: toPostInfo(eff, l.post), imageUrls: urls, coverIndex: l.post.coverIndex });
        publishId = r.publish_id;
        await this.db.post.update({ where: { id: postId }, data: { publishId, status: 'PROCESSING' } });
        await this.posts.event(postId, 'worker', 'init_ok', { publishId, mode: eff.mode });
      }
      await this.queue.enqueuePoll(postId, 5000);
      return 'sent';
    } catch (e) {
      return await this.handleError(post, e, stage);
    }
  }

  private async readRange(key: string, start: number, end: number): Promise<Buffer> {
    const parts: Buffer[] = []; for await (const c of await this.storage.get(key, { start, end })) parts.push(c as Buffer);
    const b = Buffer.concat(parts);
    if (b.length !== end - start + 1) throw new Error('قراءة ناقصة من التخزين');
    return b;
  }

  /** PUT لنفس النطاق آمن للتكرار (idempotent)، فنعيد المحاولة على أخطاء الشبكة/5xx فقط. */
  private async uploadWithRetry(url: string, buf: Buffer, r: { start: number; end: number; total: number }, mime: string, idx: number) {
    for (let attempt = 1; ; attempt++) {
      try { return await this.api.uploadChunk(url, buf, r, mime); }
      catch (e) {
        const retriable = e instanceof TikTokApiError && (e.transient || e.code === 'network_error');
        if (!retriable || attempt >= 3) throw e;
        await this.o.sleep(500 * 2 ** attempt);
        void idx;
      }
    }
  }

  private async handleError(post: Post, e: unknown, stage: 'prepare' | 'init' | 'upload'): Promise<'failed' | 'unknown' | 'requeued'> {
    if (e instanceof AccountError) return await this.fail(post, e.code, e.message, 'reauth_needed');
    if (e instanceof TikTokApiError) {
      if (stage === 'init') {
        // 429 صريح = لم يُنشأ شيء: آمن إعادة المحاولة لاحقاً
        if (e.httpStatus === 429 || e.code === 'rate_limit_exceeded') {
          const fresh = await this.db.post.findUniqueOrThrow({ where: { id: post.id } });
          if (fresh.attempts <= this.o.maxRateLimitRetries) {
            const delay = Math.min(15 * 60_000, 30_000 * 2 ** fresh.attempts);
            await this.posts.transition(post.id, ['SENDING'], 'QUEUED');
            await this.queue.enqueuePublish(post.id, new Date(this.now().getTime() + delay));
            await this.posts.event(post.id, 'worker', 'rate_limited_requeued', { delayMs: delay });
            return 'requeued';
          }
        }
        // انقطاع/5xx: غموض — قد تكون TikTok أنشأت المنشور
        if (e.code === 'network_error' || e.httpStatus >= 500) return await this.unknown(post, `رد غير مؤكد من TikTok أثناء بدء النشر (${reasonAr(e)})`);
      }
      return await this.fail(post, e.code, reasonAr(e), e.authExpired ? 'reauth_needed' : 'publish_failed');
    }
    return await this.fail(post, 'internal', `خطأ داخلي: ${(e as Error).message}`);
  }

  private async fail(post: Post, code: string, message: string, kind: 'publish_failed' | 'reauth_needed' = 'publish_failed') {
    await this.db.post.update({ where: { id: post.id }, data: { status: 'FAILED', failReason: `${code}: ${message}` } });
    await this.posts.event(post.id, 'worker', 'failed', { code, message });
    await this.notifier.notify(kind, post.id, `فشل نشر المنشور ${post.id}: ${message}`);
    return 'failed' as const;
  }
  private async unknown(post: Post, message: string) {
    await this.db.post.update({ where: { id: post.id }, data: { status: 'UNKNOWN', failReason: `unknown: ${message}` } });
    await this.posts.event(post.id, 'worker', 'unknown', { message });
    await this.notifier.notify('publish_unknown', post.id, `حالة غير مؤكدة للمنشور ${post.id}: ${message}. تحقق من حسابك على TikTok قبل أي إعادة محاولة`);
    return 'unknown' as const;
  }

  /** استعلام حالة النشر لدى TikTok وتحويلها. هذا هو المكان الوحيد الذي يصير فيه المنشور PUBLISHED. */
  async checkStatus(postId: string): Promise<Post['status']> {
    const post = await this.db.post.findUniqueOrThrow({ where: { id: postId } });
    if (post.status !== 'PROCESSING' || !post.publishId) return post.status;
    const age = this.now().getTime() - (post.initSentAt?.getTime() ?? post.updatedAt.getTime());
    try {
      const token = await this.accounts.accessToken(post.accountId);
      const s = await this.api.status(token, post.publishId);
      await this.db.post.update({ where: { id: postId }, data: { lastCheckedAt: this.now() } });
      switch (s.status) {
        case 'PUBLISH_COMPLETE':
          await this.posts.transition(postId, ['PROCESSING'], 'PUBLISHED', { tiktokPostId: s.postIds[0] ?? null });
          await this.posts.event(postId, 'worker', 'published', { postIds: s.postIds });
          await this.notifier.notify('publish_complete', postId, `تم نشر المنشور ${postId} (TikTok أكّد)`);
          return 'PUBLISHED';
        case 'SEND_TO_USER_INBOX':
          await this.posts.transition(postId, ['PROCESSING'], 'INBOX_DELIVERED');
          await this.posts.event(postId, 'worker', 'inbox_delivered');
          await this.notifier.notify('publish_complete', postId, `سُلّم المنشور ${postId} كمسودة إلى صندوق TikTok — أكمل نشره من التطبيق`);
          return 'INBOX_DELIVERED';
        case 'FAILED': {
          const r = s.fail_reason ?? 'unknown';
          await this.fail(post, r, ERROR_AR[r] ?? `فشل لدى TikTok: ${r}`);
          return 'FAILED';
        }
        default:
          if (age > this.o.processingTimeoutMs) { await this.unknown(post, 'تجاوزت المعالجة المهلة دون نتيجة نهائية'); return 'UNKNOWN'; }
          await this.queue.enqueuePoll(postId, Math.min(60_000, 5000 * 2 ** Math.min(4, Math.floor(age / 30_000))));
          return 'PROCESSING';
      }
    } catch (e) {
      if (age > this.o.processingTimeoutMs) { await this.unknown(post, `تعذّر التحقق من الحالة: ${reasonAr(e)}`); return 'UNKNOWN'; }
      // لا نبتلع الخطأ: يُسجَّل في أحداث المنشور (مرة لكل رسالة مختلفة) ليظهر للمالك سبب بقاء الحالة معلّقة
      const msg = reasonAr(e);
      const last = await this.db.postEvent.findFirst({ where: { postId, event: 'status_check_error' }, orderBy: { at: 'desc' } });
      if ((last?.detail as { message?: string } | null)?.message !== msg) await this.posts.event(postId, 'worker', 'status_check_error', { message: msg });
      await this.queue.enqueuePoll(postId, 30_000);
      return 'PROCESSING';
    }
  }

  /** مسح دوري: يلتقط المجدولات المستحقة (بعد انقطاع الخادم/Redis) ويتابع المعلّقة. آمن للتكرار. */
  async sweep(maxLateMs = 2 * 3600_000): Promise<{ dispatched: number; missed: number; polled: number }> {
    const now = this.now();
    const due = await this.db.post.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, take: 100 });
    let dispatched = 0, missed = 0;
    for (const p of due) {
      if (now.getTime() - p.scheduledAt!.getTime() > maxLateMs) {
        // فات الموعد بكثير (انقطاع طويل): لا ننشر في وقت غير مقصود؛ نترك القرار للمالك
        if (await this.posts.transition(p.id, ['SCHEDULED'], 'FAILED', { failReason: 'missed_schedule: فات موعد الجدولة بسبب انقطاع، لم يُنشر. أعد الجدولة أو انشر الآن' })) {
          missed++; await this.notifier.notify('schedule_missed', p.id, `فات موعد المنشور ${p.id} ولم يُنشر`);
        }
      } else { await this.queue.enqueuePublish(p.id); dispatched++; }
    }
    const stuck = await this.db.post.findMany({ where: { status: 'PROCESSING' }, take: 100 });
    for (const p of stuck) await this.queue.enqueuePoll(p.id, 0);
    // SENDING عالق (انهيار منتصف الإرسال): غموض ⇒ UNKNOWN
    const hung = await this.db.post.findMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, take: 50 });
    for (const p of hung) if (await this.posts.transition(p.id, ['SENDING'], 'UNKNOWN', { failReason: 'unknown: توقّف الإرسال فجأة (انهيار الخادم؟)' })) await this.notifier.notify('publish_unknown', p.id, `توقف إرسال المنشور ${p.id} فجأة؛ تحقق من حسابك على TikTok`);
    return { dispatched, missed, polled: stuck.length };
  }
}
