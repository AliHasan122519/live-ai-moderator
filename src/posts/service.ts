import type { MediaAsset, Post, PostStatus, Prisma, TikTokAccount } from '@prisma/client';
import { audit, type Db } from '../db/index.js';
import type { AccountService } from '../tiktok/accounts.js';
import { LIMITS } from '../media/limits.js';
import { resolveEffective, type Effective } from './effective.js';
import { PostError } from './errors.js';
import { computeContentHash, mediaSignature } from './hash.js';
import type { PublishQueue } from './queue.js';

export const HOLDS_MEDIA: PostStatus[] = ['PUBLISHED', 'PROCESSING', 'SENDING', 'QUEUED', 'SCHEDULED', 'APPROVED', 'INBOX_DELIVERED', 'UNKNOWN'];
const EDITABLE: PostStatus[] = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED'];
const MIN_SCHEDULE_LEAD_MS = 60_000;

export interface DraftInput {
  accountId: string; mediaIds: string[]; caption?: string; hashtags?: string[]; privacyLevel?: string; mode?: 'DIRECT' | 'DRAFT_INBOX';
  disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean; aiGenerated?: boolean; coverIndex?: number;
  brandContent?: boolean; brandOrganic?: boolean; allowDuplicate?: boolean; scheduledAt?: Date | null;
}
export type PostPatch = Partial<Omit<DraftInput, 'accountId' | 'mediaIds'>> & { mediaIds?: string[] };

export interface Loaded { post: Post; media: MediaAsset[]; account: TikTokAccount }

const normTags = (t: string[] = []) => [...new Set(t.map((x) => x.trim().replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean))].slice(0, 30);

export class PostService {
  constructor(private db: Db, private accounts: AccountService, private queue: PublishQueue, private now: () => Date = () => new Date()) {}

  async event(postId: string, actor: string, event: string, detail?: Prisma.InputJsonValue) {
    await this.db.postEvent.create({ data: { postId, actor, event, detail } });
  }

  /** CAS ذرّي على الحالة: ينجح فقط إن كانت الحالة الحالية ضمن from. */
  async transition(id: string, from: PostStatus[], to: PostStatus, data: Prisma.PostUpdateManyMutationInput = {}): Promise<boolean> {
    return (await this.db.post.updateMany({ where: { id, status: { in: from } }, data: { ...data, status: to } })).count === 1;
  }

  async load(id: string): Promise<Loaded> {
    const post = await this.db.post.findUnique({ where: { id }, include: { media: { orderBy: { position: 'asc' }, include: { media: true } }, account: true } });
    if (!post) throw new PostError('not_found', 'المنشور غير موجود');
    const { media, account, ...rest } = post;
    return { post: rest as Post, media: media.map((m) => m.media), account };
  }

  analyze(l: Loaded): { eff: Effective; hash: string; mediaSha: string[] } {
    const mediaSha = l.media.map((m) => m.sha256);
    const eff = resolveEffective(l.post, l.account, l.media);
    return { eff, hash: computeContentHash(l.post, mediaSha, eff), mediaSha };
  }

  private deriveType(media: MediaAsset[]): Post['type'] {
    if (media.length === 0) throw new PostError('no_media', 'اختر ملفاً واحداً على الأقل');
    const videos = media.filter((m) => m.kind === 'VIDEO').length;
    if (videos > 0) { if (media.length > 1) throw new PostError('mixed_media', 'الفيديو لا يُدمج مع ملفات أخرى في منشور واحد'); return 'VIDEO'; }
    if (media.length === 1) return 'PHOTO';
    if (media.length < LIMITS.carousel.minImages || media.length > LIMITS.carousel.maxImages) throw new PostError('bad_count', `عدد الصور يجب أن يكون بين ${LIMITS.carousel.minImages} و${LIMITS.carousel.maxImages}`);
    return 'CAROUSEL';
  }

  private async fetchMedia(ids: string[]): Promise<MediaAsset[]> {
    if (new Set(ids).size !== ids.length) throw new PostError('dup_media', 'ملف مكرر داخل المنشور نفسه');
    const rows = await this.db.mediaAsset.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const m = byId.get(id);
      if (!m || m.deletedAt) throw new PostError('media_missing', `الملف ${id} غير موجود أو حُذف`);
      return m;
    });
  }

  async assertNotDuplicate(accountId: string, mediaSig: string, selfId?: string) {
    const other = await this.db.post.findFirst({ where: { accountId, mediaSig, status: { in: HOLDS_MEDIA }, id: selfId ? { not: selfId } : undefined } });
    if (other) throw new PostError('duplicate', `هذا الملف نفسه مرتبط بمنشور آخر (${other.status}). أضف allowDuplicate إن كنت تقصد النشر مرة ثانية`, [other.id]);
  }

  async createDraft(i: DraftInput, actor: string): Promise<Post> {
    const account = await this.db.tikTokAccount.findUnique({ where: { id: i.accountId } });
    if (!account || account.status !== 'ACTIVE') throw new PostError('account', 'حساب TikTok غير مربوط');
    const media = await this.fetchMedia(i.mediaIds);
    const type = this.deriveType(media);
    const mediaSig = mediaSignature(media.map((m) => m.sha256));
    if (!i.allowDuplicate) await this.assertNotDuplicate(i.accountId, mediaSig);
    if (i.scheduledAt) this.checkSchedule(i.scheduledAt);
    const coverIndex = i.coverIndex ?? 0;
    if (coverIndex < 0 || coverIndex >= media.length) throw new PostError('bad_cover', 'فهرس الغلاف خارج النطاق');

    const post = await this.db.post.create({
      data: {
        accountId: i.accountId, type, mode: i.mode ?? 'DIRECT', caption: i.caption ?? '', hashtags: normTags(i.hashtags), privacyLevel: i.privacyLevel ?? 'SELF_ONLY',
        disableComment: i.disableComment ?? false, disableDuet: i.disableDuet ?? false, disableStitch: i.disableStitch ?? false, aiGenerated: i.aiGenerated ?? false,
        coverIndex, brandContent: i.brandContent ?? false, brandOrganic: i.brandOrganic ?? false, allowDuplicate: i.allowDuplicate ?? false,
        scheduledAt: i.scheduledAt ?? null, contentHash: '', mediaSig,
        media: { create: media.map((m, position) => ({ mediaId: m.id, position })) },
      },
    });
    await this.refreshHash(post.id);
    await this.event(post.id, actor, 'created', { type, media: media.length });
    return (await this.load(post.id)).post;
  }

  private async refreshHash(id: string) {
    const l = await this.load(id);
    const { hash } = this.analyze(l);
    await this.db.post.update({ where: { id }, data: { contentHash: hash } });
  }

  private checkSchedule(d: Date) {
    if (d.getTime() < this.now().getTime() + MIN_SCHEDULE_LEAD_MS) throw new PostError('bad_schedule', 'موعد الجدولة يجب أن يكون بعد دقيقة على الأقل من الآن');
  }

  async update(id: string, patch: PostPatch, actor: string): Promise<Post> {
    const l = await this.load(id);
    if (!EDITABLE.includes(l.post.status)) throw new PostError('not_editable', `لا يمكن تعديل منشور بحالة ${l.post.status}`);
    const data: Prisma.PostUpdateInput = {};
    if (patch.caption !== undefined) data.caption = patch.caption;
    if (patch.hashtags !== undefined) data.hashtags = normTags(patch.hashtags);
    if (patch.privacyLevel !== undefined) data.privacyLevel = patch.privacyLevel;
    if (patch.mode !== undefined) data.mode = patch.mode;
    for (const k of ['disableComment', 'disableDuet', 'disableStitch', 'aiGenerated', 'brandContent', 'brandOrganic'] as const) if (patch[k] !== undefined) data[k] = patch[k];
    if (patch.coverIndex !== undefined) data.coverIndex = patch.coverIndex;
    if (patch.scheduledAt !== undefined) { if (patch.scheduledAt) this.checkSchedule(patch.scheduledAt); data.scheduledAt = patch.scheduledAt; }
    if (patch.mediaIds) {
      const media = await this.fetchMedia(patch.mediaIds);
      const type = this.deriveType(media);
      data.type = type; data.mediaSig = mediaSignature(media.map((m) => m.sha256));
      await this.db.postMedia.deleteMany({ where: { postId: id } });
      await this.db.postMedia.createMany({ data: media.map((m, position) => ({ postId: id, mediaId: m.id, position })) });
    }
    await this.db.post.update({ where: { id }, data });
    const before = l.post.contentHash;
    await this.refreshHash(id);
    const after = await this.load(id);
    // أي تغيير في المحتوى يُبطل الموافقة ويعيد المنشور إلى مسودة
    if (after.post.contentHash !== before && (after.post.approvedHash || after.post.status !== 'DRAFT')) {
      await this.db.post.update({ where: { id }, data: { status: 'DRAFT', approvedHash: null, approvedAt: null, approvedBy: null } });
      await this.queue.cancelPublish(id);
      await this.event(id, actor, 'approval_invalidated', { reason: 'content_changed' });
    }
    await this.event(id, actor, 'updated', { fields: Object.keys(patch) });
    return (await this.load(id)).post;
  }

  /** يجلب إعدادات الحساب الحالية، يتحقق، ثم ينقل المنشور إلى انتظار الموافقة ويُرجع المعاينة. */
  async requestApproval(id: string, actor: string) {
    const l0 = await this.load(id);
    if (!['DRAFT', 'AWAITING_APPROVAL'].includes(l0.post.status)) throw new PostError('bad_state', `لا يمكن طلب الموافقة من حالة ${l0.post.status}`);
    let creatorWarning: string | undefined;
    try { await this.accounts.refreshCreatorInfo(l0.post.accountId); } catch (e) { creatorWarning = `تعذّر تحديث إعدادات الحساب من TikTok (${(e as Error).message}) — استُخدمت آخر نسخة محفوظة`; }
    const l = await this.load(id);
    const { eff, hash } = this.analyze(l);
    if (eff.errors.length) throw new PostError('invalid', 'المنشور غير صالح للنشر', eff.errors);
    if (!l.post.allowDuplicate) await this.assertNotDuplicate(l.post.accountId, l.post.mediaSig, id);
    await this.db.post.update({ where: { id }, data: { contentHash: hash, status: 'AWAITING_APPROVAL', approvedHash: null, approvedAt: null, approvedBy: null } });
    await this.event(id, actor, 'approval_requested', { hash });
    return this.preview(id, creatorWarning ? [creatorWarning] : []);
  }

  async preview(id: string, extraWarnings: string[] = []) {
    const l = await this.load(id);
    const { eff, hash } = this.analyze(l);
    return {
      id: l.post.id, status: l.post.status, type: l.post.type, contentHash: hash,
      account: { id: l.account.id, displayName: l.account.displayName, username: l.account.username, audited: l.account.audited },
      mode: eff.mode, requestedMode: l.post.mode, privacy: eff.privacy, requestedPrivacy: l.post.privacyLevel,
      title: eff.title, description: eff.description, caption: l.post.caption, hashtags: l.post.hashtags,
      disableComment: eff.disableComment, disableDuet: eff.disableDuet, disableStitch: eff.disableStitch, aiGenerated: eff.isAigc,
      scheduledAt: l.post.scheduledAt, media: l.media.map((m) => ({ id: m.id, kind: m.kind, filename: m.filename, durationSec: m.durationSec })),
      warnings: [...eff.warnings, ...extraWarnings], errors: eff.errors,
      privacyOptions: ((l.account.creatorInfo as { privacy_level_options?: string[] } | null)?.privacy_level_options) ?? [],
    };
  }

  /** الموافقة الصريحة. تتطلب البصمة التي رآها المستخدم؛ إن تغيّر أي شيء منذ المعاينة تفشل. */
  async approve(id: string, contentHash: string, actor: string): Promise<Post> {
    const l = await this.load(id);
    if (l.post.status !== 'AWAITING_APPROVAL') throw new PostError('bad_state', `المنشور ليس بانتظار الموافقة (${l.post.status})`);
    const { eff, hash } = this.analyze(l);
    if (eff.errors.length) throw new PostError('invalid', 'المنشور غير صالح للنشر', eff.errors);
    if (hash !== contentHash || hash !== l.post.contentHash) throw new PostError('stale_hash', 'تغيّر المحتوى منذ المعاينة. أعد المعاينة ثم وافق');
    if (!l.post.allowDuplicate) await this.assertNotDuplicate(l.post.accountId, l.post.mediaSig, id);
    if (l.post.scheduledAt) this.checkSchedule(l.post.scheduledAt);
    const to: PostStatus = l.post.scheduledAt ? 'SCHEDULED' : 'APPROVED';
    const ok = await this.transition(id, ['AWAITING_APPROVAL'], to, { approvedHash: hash, approvedAt: this.now(), approvedBy: actor });
    if (!ok) throw new PostError('bad_state', 'تغيّرت حالة المنشور أثناء الموافقة');
    await this.event(id, actor, 'approved', { hash, scheduledAt: l.post.scheduledAt?.toISOString() ?? null });
    await audit(this.db, actor, 'post.approved', id, { hash });
    if (to === 'SCHEDULED') await this.queue.enqueuePublish(id, l.post.scheduledAt!);
    return (await this.load(id)).post;
  }

  async schedule(id: string, at: Date, actor: string): Promise<Post> {
    this.checkSchedule(at);
    const l = await this.load(id);
    if (!EDITABLE.includes(l.post.status)) throw new PostError('bad_state', `لا يمكن جدولة منشور بحالة ${l.post.status}`);
    await this.db.post.update({ where: { id }, data: { scheduledAt: at } });
    if (l.post.status === 'APPROVED') await this.transition(id, ['APPROVED'], 'SCHEDULED');
    if (['APPROVED', 'SCHEDULED'].includes(l.post.status)) { await this.queue.cancelPublish(id); await this.queue.enqueuePublish(id, at); }
    await this.event(id, actor, 'scheduled', { at: at.toISOString() });
    return (await this.load(id)).post;
  }

  async publishNow(id: string, actor: string): Promise<Post> {
    const l = await this.load(id);
    if (!l.post.approvedHash) throw new PostError('not_approved', 'لا يوجد نشر بدون موافقة صريحة');
    if (!(await this.transition(id, ['APPROVED', 'SCHEDULED'], 'QUEUED'))) throw new PostError('bad_state', `لا يمكن النشر من حالة ${l.post.status}`);
    await this.queue.cancelPublish(id);
    await this.queue.enqueuePublish(id);
    await this.event(id, actor, 'queued');
    return (await this.load(id)).post;
  }

  async cancel(id: string, actor: string): Promise<Post> {
    const ok = await this.transition(id, ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'QUEUED'], 'CANCELED');
    if (!ok) {
      const p = (await this.load(id)).post;
      throw new PostError('cannot_cancel', p.status === 'CANCELED' ? 'المنشور ملغى مسبقاً' : `لا يمكن الإلغاء من حالة ${p.status} (بدأ الإرسال أو اكتمل)`);
    }
    await this.queue.cancelPublish(id);
    await this.event(id, actor, 'canceled');
    return (await this.load(id)).post;
  }

  /**
   * إعادة محاولة يدوية. من FAILED فقط، أو من UNKNOWN بشرط force (أي تأكيدك أنك راجعت TikTok ولم تجد المنشور).
   * تتطلب أن تبقى الموافقة سارية على المحتوى نفسه.
   */
  async retry(id: string, actor: string, opts: { force?: boolean } = {}): Promise<Post> {
    const l = await this.load(id);
    if (l.post.status === 'UNKNOWN' && !opts.force) throw new PostError('needs_force', 'حالة غير مؤكدة: قد يكون TikTok نشره فعلاً. تحقق من حسابك أولاً ثم أعد بـ force');
    if (!['FAILED', 'UNKNOWN'].includes(l.post.status)) throw new PostError('bad_state', `لا إعادة محاولة من حالة ${l.post.status}`);
    const { hash } = this.analyze(l);
    if (!l.post.approvedHash || l.post.approvedHash !== hash) throw new PostError('not_approved', 'تغيّر المحتوى أو الإعدادات منذ الموافقة. اطلب موافقة جديدة');
    const ok = await this.transition(id, ['FAILED', 'UNKNOWN'], 'QUEUED', { failReason: null, publishId: null, initSentAt: null });
    if (!ok) throw new PostError('bad_state', 'تغيّرت الحالة');
    await this.event(id, actor, 'retry', { force: !!opts.force, previousPublishId: l.post.publishId });
    await this.queue.enqueuePublish(id);
    return (await this.load(id)).post;
  }

  list(accountId: string | undefined, take = 50, status?: PostStatus[]) {
    return this.db.post.findMany({ where: { accountId, status: status ? { in: status } : undefined }, orderBy: { createdAt: 'desc' }, take, include: { media: { orderBy: { position: 'asc' } } } });
  }
}
