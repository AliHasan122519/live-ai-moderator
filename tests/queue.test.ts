import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { buildContainer, type Container } from '../src/container.js';
import { BullPublishQueue, startWorker } from '../src/worker/queue.js';
import { TikTokClient } from '../src/tiktok/client.js';
import type { Worker } from 'bullmq';
import { useRig } from './rig.js';

const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';
const r = useRig();
let bq: BullPublishQueue; let c: Container; let worker: Worker;

async function waitFor<T>(fn: () => Promise<T | false>, ms = 15_000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('انتهت مهلة الانتظار'); await new Promise((x) => setTimeout(x, 150)); }
}

describe('BullMQ على Redis حقيقي', () => {
  beforeAll(async () => {
    const probe = new Redis(REDIS, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try { await probe.connect(); await probe.flushdb(); } catch { throw new Error(`Redis غير متاح على ${REDIS} (شغّله أو اضبط TEST_REDIS_URL)`); } finally { probe.disconnect(); }
    bq = BullPublishQueue.create(REDIS);
    const api = new TikTokClient({ baseUrl: r.fake.base, authUrl: r.cfg.TIKTOK_AUTH_URL, clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: r.cfg.TIKTOK_REDIRECT_URI });
    c = buildContainer(bq, { cfg: r.cfg, db: r.db, storage: r.storage, api, notifier: r.notifier });
    worker = await startWorker(c, bq, REDIS, () => {});
  });
  afterAll(async () => { await worker.close(); await bq.close(); });

  it('ping يعكس حالة Redis الحقيقية', async () => { expect(await bq.ping()).toBe(true); });

  it('نشر فوري عبر الطابور ثم متابعة الحالة تلقائياً حتى PUBLISHED', async () => {
    await r.connect({ audited: true }); r.fake.pollsUntilDone = 0;
    const m = await r.seedMedia('VIDEO');
    const p = await c.posts.createDraft({ accountId: r.accountId, mediaIds: [m], caption: 'عبر الطابور' }, 'owner');
    const pv = await c.posts.requestApproval(p.id, 'owner'); await c.posts.approve(p.id, pv.contentHash, 'owner');
    await c.posts.publishNow(p.id, 'owner');
    const done = await waitFor(async () => { const x = await r.db.post.findUniqueOrThrow({ where: { id: p.id } }); return x.status === 'PUBLISHED' ? x : false; }, 20_000);
    expect(done.tiktokPostId).toBe('7300000000000000001');
    expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(1);
  }, 30_000);

  it('مهمة مؤجلة لا تعمل قبل موعدها، وتعمل بعده، والإلغاء يزيلها', async () => {
    await r.connect({ audited: true }); r.fake.pollsUntilDone = 0;
    const m1 = await r.seedMedia('VIDEO'); const m2 = await r.seedMedia('VIDEO');
    const mk = async (m: string) => { const p = await c.posts.createDraft({ accountId: r.accountId, mediaIds: [m] }, 'owner'); const pv = await c.posts.requestApproval(p.id, 'owner'); await c.posts.approve(p.id, pv.contentHash, 'owner'); return p.id; };
    const a = await mk(m1); const b = await mk(m2);
    await bq.enqueuePublish(a, new Date(Date.now() + 1800)); await bq.enqueuePublish(b, new Date(Date.now() + 1800)); await bq.cancelPublish(b);
    await new Promise((x) => setTimeout(x, 600));
    expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(0); // لم يحِن
    await waitFor(async () => (await r.db.post.findUniqueOrThrow({ where: { id: a } })).publishId ? true : false, 8000);
    await new Promise((x) => setTimeout(x, 800));
    expect(r.fake.hits('/v2/post/publish/video/init/')).toHaveLength(1); // a فقط
    expect((await r.db.post.findUniqueOrThrow({ where: { id: b } })).publishId).toBeNull();
  }, 30_000);
});
