import { describe, expect, it } from 'vitest';
import { useRig } from './rig.js';
import { resolvePull, makePullUrl } from '../src/media/pull.js';
import { planChunks, chunkRanges } from '../src/posts/chunks.js';

const r = useRig();
const MiB = 1024 * 1024;
const statusOf = async (id: string) => (await r.db.post.findUniqueOrThrow({ where: { id } })).status;
const hits = (p: string) => r.fake.hits(p).length;

describe('القطع', () => {
  it('خطة القطع تغطي الملف بلا فجوات ولا تتجاوز القواعد', () => {
    for (const size of [1, 5 * MiB - 1, 5 * MiB, 10 * MiB, 26 * MiB, 99 * MiB + 17]) {
      const plan = planChunks(size); const rg = chunkRanges(size, plan);
      expect(rg[0]!.start).toBe(0); expect(rg.at(-1)!.end).toBe(size - 1);
      rg.forEach((x, i) => { if (i) expect(x.start).toBe(rg[i - 1]!.end + 1); });
      if (size >= 5 * MiB) rg.slice(0, -1).forEach((x) => expect(x.end - x.start + 1).toBe(10 * MiB));
    }
  });
});

describe('نشر فيديو مباشر', () => {
  it('رفع متعدد القطع ثم PUBLISHED فقط بعد تأكيد TikTok', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('VIDEO', 26 * MiB);
    const id = await r.newApproved([m], { privacyLevel: 'PUBLIC_TO_EVERYONE', aiGenerated: true });
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('sent');
    expect(await statusOf(id)).toBe('PROCESSING'); // لم يُعلَن نجاح بعد
    const init = r.fake.hits('/v2/post/publish/video/init/')[0]!.body;
    expect(init.source_info).toMatchObject({ source: 'FILE_UPLOAD', video_size: 26 * MiB, chunk_size: 10 * MiB, total_chunk_count: 2 });
    expect(init.post_info).toMatchObject({ privacy_level: 'PUBLIC_TO_EVERYONE', is_aigc: true, disable_stitch: true });
    expect(init.post_info.title).toBe('وصف تجريبي\n\n#تقنية #ذكاء');
    const puts = r.fake.requests.filter((x) => x.path === '/upload').map((x) => x.body);
    expect(puts).toHaveLength(2); expect(puts[1]).toContain(`${10 * MiB}-${26 * MiB - 1}/${26 * MiB}`);

    expect(await r.pub.checkStatus(id)).toBe('PROCESSING'); // أول استعلام: ما زال يعالج
    expect(await r.pub.checkStatus(id)).toBe('PUBLISHED');
    const p = await r.db.post.findUniqueOrThrow({ where: { id } });
    expect(p.tiktokPostId).toBe('7300000000000000001'); expect(p.publishId).toMatch(/^v_pub_/);
    expect(r.notifier.sent.at(-1)?.kind).toBe('publish_complete');
    const evs = (await r.db.postEvent.findMany({ where: { postId: id }, orderBy: { at: 'asc' } })).map((e) => e.event);
    expect(evs).toEqual(expect.arrayContaining(['created', 'approved', 'queued', 'sending', 'init_ok', 'upload_done', 'published']));
  });

  it('تطبيق غير معتمد: «عام» يُخفَّض إلى SELF_ONLY مع تحذير، ولا يُرسل أبداً كعام', async () => {
    await r.connect({ audited: false });
    const m = await r.seedMedia('VIDEO');
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], privacyLevel: 'PUBLIC_TO_EVERYONE' }, 'owner');
    const pv = await r.posts.requestApproval(p.id, 'owner');
    expect(pv.privacy).toBe('SELF_ONLY'); expect(pv.requestedPrivacy).toBe('PUBLIC_TO_EVERYONE');
    expect(pv.warnings.join(' ')).toContain('غير معتمد');
    await r.posts.approve(p.id, pv.contentHash, 'owner'); await r.posts.publishNow(p.id, 'owner');
    await r.pub.run(p.id);
    expect(r.fake.hits('/v2/post/publish/video/init/')[0]!.body.post_info.privacy_level).toBe('SELF_ONLY');
  });

  it('بدون video.publish يتحوّل تلقائياً إلى مسودة الصندوق، ونهايتها «سُلّم» لا «نُشر»', async () => {
    await r.connect({ scope: 'user.info.basic,video.upload' });
    const m = await r.seedMedia('VIDEO');
    const id = await r.newApproved([m]);
    await r.posts.publishNow(id, 'owner'); await r.pub.run(id);
    expect(hits('/v2/post/publish/inbox/video/init/')).toBe(1); expect(hits('/v2/post/publish/video/init/')).toBe(0);
    expect(r.fake.hits('/v2/post/publish/inbox/video/init/')[0]!.body.post_info).toBeUndefined();
    await r.pub.checkStatus(id); await r.pub.checkStatus(id);
    expect(await statusOf(id)).toBe('INBOX_DELIVERED');
  });
});

describe('الصور والمنشور متعدد الصور', () => {
  it('Carousel: TikTok تسحب من روابط موقّعة فعلية ثم PUBLISHED', async () => {
    await r.connect({ audited: true });
    const ms = [await r.seedMedia('IMAGE'), await r.seedMedia('IMAGE'), await r.seedMedia('IMAGE')];
    const id = await r.newApproved(ms, { coverIndex: 1, privacyLevel: 'PUBLIC_TO_EVERYONE' });
    expect((await r.db.post.findUniqueOrThrow({ where: { id } })).type).toBe('CAROUSEL');
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('sent'); // الخادم الوهمي سحب الصور الثلاث فعلاً وإلا لرفض
    const b = r.fake.hits('/v2/post/publish/content/init/')[0]!.body;
    expect(b).toMatchObject({ post_mode: 'DIRECT_POST', media_type: 'PHOTO', source_info: { source: 'PULL_FROM_URL', photo_cover_index: 1 } });
    expect(b.source_info.photo_images).toHaveLength(3);
    await r.pub.checkStatus(id); await r.pub.checkStatus(id);
    expect(await statusOf(id)).toBe('PUBLISHED');
  });

  it('رابط السحب: لا يعمل لغير مرتبط بمنشور نشط، ولا بعد انتهائه، ولا مزوَّراً', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('IMAGE'); const asset = await r.db.mediaAsset.findUniqueOrThrow({ where: { id: m } });
    const url = makePullUrl(r.cfg, asset, 60, r.clock.t.getTime()); const tok = url.split('/media/pull/')[1]!;
    expect(await resolvePull(r.db, r.cfg, tok, r.clock.t.getTime())).toBeNull(); // غير مرتبطة بمنشور
    const id = await r.newApproved([m]);
    expect((await resolvePull(r.db, r.cfg, tok, r.clock.t.getTime()))?.id).toBe(m);
    expect(await resolvePull(r.db, r.cfg, tok, r.clock.t.getTime() + 61_000)).toBeNull();
    expect(await resolvePull(r.db, r.cfg, tok.slice(0, -3) + 'abc', r.clock.t.getTime())).toBeNull();
    await r.posts.cancel(id, 'owner');
    expect(await resolvePull(r.db, r.cfg, tok, r.clock.t.getTime())).toBeNull(); // أُلغي ⇒ لا تسليم
  });

  it('عنوان الصور يقتطع عند 90 حرفاً مع تحذير، والوصف الكامل يُرسل', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('IMAGE'); const long = 'ك'.repeat(150);
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], caption: long }, 'owner');
    const pv = await r.posts.requestApproval(p.id, 'owner');
    expect(pv.title).toHaveLength(90); expect(pv.description).toBe(long); expect(pv.warnings.join(' ')).toContain('اقتُطع');
  });
});

describe('بوابة الموافقة', () => {
  it('لا نشر بلا موافقة، وأي تعديل بعدها يبطلها', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('VIDEO');
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], caption: 'أ' }, 'mcp');
    await expect(r.posts.publishNow(p.id, 'mcp')).rejects.toMatchObject({ code: 'not_approved' });
    const pv = await r.posts.requestApproval(p.id, 'mcp');
    await expect(r.posts.approve(p.id, 'f'.repeat(64), 'mcp')).rejects.toMatchObject({ code: 'stale_hash' });
    await r.posts.approve(p.id, pv.contentHash, 'owner');
    await r.posts.update(p.id, { caption: 'ب — تعديل بعد الموافقة' }, 'mcp');
    const after = await r.db.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe('DRAFT'); expect(after.approvedHash).toBeNull();
    await expect(r.posts.publishNow(p.id, 'mcp')).rejects.toMatchObject({ code: 'not_approved' });
    expect(hits('/v2/post/publish/video/init/')).toBe(0);
  });

  it('تلاعب مباشر بقاعدة البيانات بعد الموافقة ⇒ الإرسال يُرفض قبل أي طلب إلى TikTok', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id, 'owner');
    await r.db.post.update({ where: { id }, data: { caption: 'محتوى مختلف لم يوافَق عليه' } });
    // البصمة تُحسب من الوصف المُصيَّر؛ تعديل الحقل مباشرة يغيّر البصمة
    expect(await r.pub.run(id)).toBe('failed');
    expect((await r.db.post.findUniqueOrThrow({ where: { id } })).failReason).toContain('approval_stale');
    expect(hits('/v2/post/publish/video/init/')).toBe(0);
  });

  it('خطأ في الإعدادات (خصوصية غير متاحة) يمنع طلب الموافقة أصلاً', async () => {
    await r.connect({ audited: true }); r.fake.privacyOptions = ['SELF_ONLY'];
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds: [await r.seedMedia('VIDEO')], privacyLevel: 'PUBLIC_TO_EVERYONE' }, 'owner');
    await expect(r.posts.requestApproval(p.id, 'owner')).rejects.toMatchObject({ code: 'invalid' });
    r.fake.privacyOptions = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS'];
  });
});

describe('منع التكرار والتزامن', () => {
  it('الملف نفسه لا يُنشر مرتين إلا بـallowDuplicate، ويُسمح بعد الإلغاء', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('VIDEO');
    const id1 = await r.newApproved([m]);
    await expect(r.posts.createDraft({ accountId: r.accountId, mediaIds: [m] }, 'owner')).rejects.toMatchObject({ code: 'duplicate' });
    await expect(r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], allowDuplicate: true }, 'owner')).resolves.toBeTruthy();
    await r.posts.cancel(id1, 'owner');
    await expect(r.posts.createDraft({ accountId: r.accountId, mediaIds: [m] }, 'owner')).resolves.toBeTruthy();
  });

  it('استلام المهمة مرتين بالتوازي يرسل مرة واحدة فقط', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id, 'owner');
    const res = await Promise.all([r.pub.run(id), r.pub.run(id), r.pub.run(id)]);
    expect(res.filter((x) => x === 'sent')).toHaveLength(1);
    expect(hits('/v2/post/publish/video/init/')).toBe(1);
  });
});

describe('الأخطاء والغموض', () => {
  it('خطأ نهائي من TikTok ⇒ FAILED مع سبب عربي وتنبيه، بلا إعادة تلقائية', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.fake.injectError('/v2/post/publish/video/init/', 403, { data: {}, error: { code: 'spam_risk_too_many_posts', message: 'x', log_id: 'L1' } });
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('failed');
    const p = await r.db.post.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe('FAILED'); expect(p.failReason).toContain('الحد اليومي'); expect(p.failReason).toContain('L1');
    expect(r.notifier.sent.at(-1)?.kind).toBe('publish_failed'); expect(hits('/v2/post/publish/video/init/')).toBe(1);
  });

  it('5xx أثناء init ⇒ UNKNOWN (لا إعادة تلقائية)، وإعادة المحاولة تتطلب force صريحاً', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.fake.injectError('/v2/post/publish/video/init/', 502, { error: { code: 'internal_error', message: 'bad gateway' } });
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('unknown');
    expect(await statusOf(id)).toBe('UNKNOWN'); expect(r.notifier.sent.at(-1)?.kind).toBe('publish_unknown');
    expect(await r.pub.run(id)).toBe('skipped'); // لا يُلتقط من جديد
    await expect(r.posts.retry(id, 'owner')).rejects.toMatchObject({ code: 'needs_force' });
    await r.posts.retry(id, 'owner', { force: true });
    expect(await r.pub.run(id)).toBe('sent');
  });

  it('429 على init ⇒ إعادة جدولة آمنة بتأخير متزايد ثم نجاح', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.fake.injectError('/v2/post/publish/video/init/', 429, { error: { code: 'rate_limit_exceeded', message: 'slow' } });
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('requeued');
    expect(await statusOf(id)).toBe('QUEUED'); expect(r.queue.publishes.at(-1)?.at).toBeInstanceOf(Date);
    expect(await r.pub.run(id)).toBe('sent');
  });

  it('انقطاع قطعة عابر يُعاد، وفشل دائم ⇒ FAILED مع بقاء publish_id', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.fake.uploadFailures = 2; await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('sent'); expect(r.sleeps.length).toBe(2);

    const id2 = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.fake.uploadFailures = 99; await r.posts.publishNow(id2, 'owner');
    expect(await r.pub.run(id2)).toBe('failed');
    expect((await r.db.post.findUniqueOrThrow({ where: { id: id2 } })).publishId).toMatch(/^v_pub_/);
    r.fake.uploadFailures = 0;
  });

  it('فشل لدى TikTok بعد المعالجة ⇒ FAILED بسبب مفهوم، وتجاوز المهلة ⇒ UNKNOWN', async () => {
    await r.connect({ audited: true }); r.fake.finalStatus = 'FAILED'; r.fake.pollsUntilDone = 0;
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id, 'owner'); await r.pub.run(id);
    expect(await r.pub.checkStatus(id)).toBe('FAILED');
    expect((await r.db.post.findUniqueOrThrow({ where: { id } })).failReason).toContain('صيغة الملف');

    r.fake.pollsUntilDone = 99;
    const id2 = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id2, 'owner'); await r.pub.run(id2);
    r.clock.t = new Date(r.clock.t.getTime() + 31 * 60_000);
    expect(await r.pub.checkStatus(id2)).toBe('UNKNOWN');
  });

  it('انتهاء الرمز أثناء الطريق يُجدَّد تلقائياً وينجح النشر', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    r.clock.t = new Date(r.clock.t.getTime() + 86400_000 - 60_000);
    await r.posts.publishNow(id, 'owner');
    expect(await r.pub.run(id)).toBe('sent'); expect(r.fake.refreshCalls).toBeGreaterThan(0);
  });

  it('حساب مفصول ⇒ FAILED مع طلب إعادة الربط، ولا طلب لـTikTok', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id, 'owner');
    await r.db.tikTokAccount.update({ where: { id: r.accountId }, data: { status: 'NEEDS_REAUTH' } });
    expect(await r.pub.run(id)).toBe('failed'); expect(r.notifier.sent.at(-1)?.kind).toBe('reauth_needed');
    expect(hits('/v2/post/publish/video/init/')).toBe(0);
  });
});

describe('الجدولة', () => {
  it('الجدولة لموعد مستقبلي، وعدم الإرسال مبكراً، والالتقاط بعد انقطاع، وإلغاء المجدول', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('VIDEO'); const at = new Date(r.clock.t.getTime() + 2 * 3600_000);
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], scheduledAt: at }, 'owner');
    const pv = await r.posts.requestApproval(p.id, 'owner'); await r.posts.approve(p.id, pv.contentHash, 'owner');
    expect(await statusOf(p.id)).toBe('SCHEDULED'); expect(r.queue.publishes.at(-1)).toMatchObject({ postId: p.id, at });
    expect(await r.pub.run(p.id)).toBe('skipped'); expect(hits('/v2/post/publish/video/init/')).toBe(0);
    expect(await r.pub.sweep()).toMatchObject({ dispatched: 0 });
    r.clock.t = new Date(at.getTime() + 60_000); // انقطاع: لم تصل المهمة المؤجلة
    expect(await r.pub.sweep()).toMatchObject({ dispatched: 1 });
    expect(await r.pub.run(p.id)).toBe('sent');
    expect(await r.pub.run(p.id)).toBe('skipped');

    const p2 = await r.newApproved([await r.seedMedia('VIDEO')], { scheduledAt: new Date(r.clock.t.getTime() + 3600_000) });
    await r.posts.cancel(p2, 'owner'); expect(await statusOf(p2)).toBe('CANCELED');
    expect(r.queue.canceled).toContain(p2); expect(await r.pub.run(p2)).toBe('skipped');
  });

  it('فوات الموعد بأكثر من ساعتين لا يُنشر بصمت: FAILED(missed) مع تنبيه', async () => {
    await r.connect({ audited: true });
    const at = new Date(r.clock.t.getTime() + 3600_000);
    const id = await r.newApproved([await r.seedMedia('VIDEO')], { scheduledAt: at });
    r.clock.t = new Date(at.getTime() + 3 * 3600_000);
    expect(await r.pub.sweep()).toMatchObject({ missed: 1, dispatched: 0 });
    expect(await statusOf(id)).toBe('FAILED'); expect(r.notifier.sent.at(-1)?.kind).toBe('schedule_missed');
  });

  it('جدولة في الماضي مرفوضة، وإرسال عالق في SENDING يتحول UNKNOWN', async () => {
    await r.connect({ audited: true });
    const m = await r.seedMedia('VIDEO');
    await expect(r.posts.createDraft({ accountId: r.accountId, mediaIds: [m], scheduledAt: new Date(r.clock.t.getTime() - 1000) }, 'owner')).rejects.toMatchObject({ code: 'bad_schedule' });
    const id = await r.newApproved([m]);
    await r.db.post.update({ where: { id }, data: { status: 'SENDING' } });
    r.clock.t = new Date(Date.now() + 3600_000); await r.db.post.update({ where: { id }, data: { updatedAt: new Date(0) } });
    await r.pub.sweep(); expect(await statusOf(id)).toBe('UNKNOWN');
  });
});

describe('شفافية أخطاء المتابعة', () => {
  it('خطأ في استعلام الحالة لا يُبتلع: يظهر في أحداث المنشور مرة واحدة لكل رسالة', async () => {
    await r.connect({ audited: true });
    const id = await r.newApproved([await r.seedMedia('VIDEO')]);
    await r.posts.publishNow(id, 'owner'); await r.pub.run(id);
    r.fake.injectError('/v2/post/publish/status/fetch/', 500, { error: { code: 'internal_error', message: 'oops' } }, false);
    expect(await r.pub.checkStatus(id)).toBe('PROCESSING'); expect(await r.pub.checkStatus(id)).toBe('PROCESSING');
    const evs = await r.db.postEvent.findMany({ where: { postId: id, event: 'status_check_error' } });
    expect(evs).toHaveLength(1); expect(JSON.stringify(evs[0]!.detail)).toContain('internal_error');
    r.fake.injected.length = 0;
    await r.pub.checkStatus(id); expect(await r.pub.checkStatus(id)).toBe('PUBLISHED');
  });
});
