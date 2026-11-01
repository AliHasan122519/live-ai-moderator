import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { AccountService } from '../src/tiktok/accounts.js';
import { TikTokClient } from '../src/tiktok/client.js';
import { PostService } from '../src/posts/service.js';
import { Publisher } from '../src/posts/publisher.js';
import { MemoryQueue } from '../src/posts/queue.js';
import { resolvePull } from '../src/media/pull.js';
import { sha256Hex } from '../src/crypto/index.js';
import type { Notifier } from '../src/posts/notify.js';
import type { Db } from '../src/db/index.js';
import { startFake, type FakeTikTok } from './fakeTikTok.js';
import { freshDb, testConfig, tmpStorage } from './helpers.js';

export class RecNotifier implements Notifier {
  sent: Array<{ kind: string; postId: string; message: string }> = [];
  async notify(kind: any, postId: string, message: string) { this.sent.push({ kind, postId, message }); }
}

/** منصة اختبار كاملة: TikTok وهمي + خادم سحب وسائط حقيقي (resolvePull) + Postgres + تخزين محلي. */
export function useRig() {
  const r = {} as {
    fake: FakeTikTok; db: Db; pull: http.Server; clock: { t: Date }; queue: MemoryQueue; notifier: RecNotifier;
    cfg: ReturnType<typeof testConfig>; storage: ReturnType<typeof tmpStorage>; accounts: AccountService; posts: PostService; pub: Publisher;
    accountId: string; sleeps: number[];
    seedMedia(kind: 'VIDEO' | 'IMAGE', bytes?: number, over?: { aiGenerated?: boolean; durationSec?: number }): Promise<string>;
    connect(opts?: { audited?: boolean; scope?: string }): Promise<string>;
    newApproved(mediaIds: string[], extra?: Record<string, unknown>): Promise<string>;
  };

  beforeAll(async () => {
    r.fake = await startFake(); r.db = await freshDb(); r.storage = tmpStorage(); r.clock = { t: new Date('2026-11-01T10:00:00Z') };
    r.pull = http.createServer(async (req, res) => {
      const a = await resolvePull(r.db, r.cfg, req.url!.replace('/media/pull/', ''), r.clock.t.getTime());
      if (!a) { res.writeHead(404); return void res.end(); }
      res.writeHead(200, { 'content-type': a.mime }); for await (const c of await r.storage.get(a.storageKey)) res.write(c); res.end();
    });
    await new Promise<void>((ok) => r.pull.listen(0, '127.0.0.1', ok));
    r.cfg = testConfig({ PUBLIC_API_URL: `http://127.0.0.1:${(r.pull.address() as AddressInfo).port}` });
  });
  afterAll(async () => { await r.fake.stop(); r.pull.closeAllConnections?.(); await new Promise((ok) => r.pull.close(ok)); await r.db.$disconnect(); });

  beforeEach(async () => {
    await freshDb(); // يمسح الجداول
    Object.assign(r.fake, { audited: false, grantedScope: 'user.info.basic,video.upload,video.publish', pollsUntilDone: 1, finalStatus: 'PUBLISH_COMPLETE', uploadFailures: 0 });
    r.fake.requests.length = 0; r.fake.injected.length = 0; r.fake.pubs.clear(); r.fake.refreshCalls = 0;
    r.clock.t = new Date('2026-11-01T10:00:00Z'); r.sleeps = [];
    r.queue = new MemoryQueue(); r.notifier = new RecNotifier();
    const api = new TikTokClient({ baseUrl: r.fake.base, authUrl: 'https://www.tiktok.com/v2/auth/authorize/', clientKey: 'ck_test', clientSecret: 'cs_test', redirectUri: r.cfg.TIKTOK_REDIRECT_URI });
    const now = () => r.clock.t;
    r.accounts = new AccountService(r.db, r.cfg, api, now);
    r.posts = new PostService(r.db, r.accounts, r.queue, now);
    r.pub = new Publisher(r.db, r.cfg, r.posts, r.accounts, api, r.storage, r.queue, r.notifier, now, { sleep: async (ms) => { r.sleeps.push(ms); }, chunkSize: 10 * 1024 * 1024 });
  });

  r.seedMedia = async (kind, bytes = 300_000, over = {}) => {
    const head = kind === 'VIDEO' ? Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]) : Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const buf = Buffer.concat([head, randomBytes(bytes - head.length)]);
    const id = randomUUID(); const key = `media/2026/${id}.${kind === 'VIDEO' ? 'mp4' : 'jpg'}`;
    await r.storage.put(key, buf, 'x');
    await r.db.mediaAsset.create({ data: { id, kind, filename: `${id}.${kind === 'VIDEO' ? 'mp4' : 'jpg'}`, mime: kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg', sizeBytes: BigInt(bytes), sha256: sha256Hex(buf), storageKey: key, durationSec: kind === 'VIDEO' ? over.durationSec ?? 12 : null, aiGenerated: over.aiGenerated ?? false } });
    return id;
  };
  r.connect = async (o = {}) => {
    if (o.scope) r.fake.grantedScope = o.scope;
    const { url } = await r.accounts.startConnect();
    const acc = await r.accounts.handleCallback({ code: 'good-code', state: new URL(url).searchParams.get('state')! });
    if (o.audited) await r.db.tikTokAccount.update({ where: { id: acc.id }, data: { audited: true } }), (r.fake.audited = true);
    r.accountId = acc.id; return acc.id;
  };
  r.newApproved = async (mediaIds, extra = {}) => {
    const p = await r.posts.createDraft({ accountId: r.accountId, mediaIds, caption: 'وصف تجريبي', hashtags: ['تقنية', '#ذكاء'], ...extra }, 'owner');
    const pv = await r.posts.requestApproval(p.id, 'owner');
    await r.posts.approve(p.id, pv.contentHash, 'owner');
    return p.id;
  };
  return r;
}
