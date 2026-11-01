import { createDb, type Db } from './db/index.js';
import { loadConfig, type Config } from './config/index.js';
import { createStorage, type Storage } from './storage/index.js';
import { TikTokClient } from './tiktok/client.js';
import { AccountService } from './tiktok/accounts.js';
import { PostService } from './posts/service.js';
import { Publisher } from './posts/publisher.js';
import { DbNotifier, type Notifier } from './posts/notify.js';
import type { PublishQueue } from './posts/queue.js';
import { AiService } from './ai/service.js';

export interface Container {
  cfg: Config; db: Db; storage: Storage; api: TikTokClient; accounts: AccountService; posts: PostService;
  publisher: Publisher; notifier: Notifier; queue: PublishQueue; ai: AiService;
}

export function buildContainer(queue: PublishQueue, over: Partial<Pick<Container, 'cfg' | 'db' | 'storage' | 'api' | 'notifier'>> = {}, now: () => Date = () => new Date()): Container {
  const cfg = over.cfg ?? loadConfig();
  const db = over.db ?? createDb();
  const storage = over.storage ?? createStorage(cfg);
  const api = over.api ?? new TikTokClient({ baseUrl: cfg.TIKTOK_API_BASE, authUrl: cfg.TIKTOK_AUTH_URL, clientKey: cfg.TIKTOK_CLIENT_KEY, clientSecret: cfg.TIKTOK_CLIENT_SECRET, redirectUri: cfg.TIKTOK_REDIRECT_URI });
  const notifier = over.notifier ?? new DbNotifier(db, process.env.NOTIFY_WEBHOOK_URL ?? '');
  const accounts = new AccountService(db, cfg, api, now);
  const posts = new PostService(db, accounts, queue, now);
  const publisher = new Publisher(db, cfg, posts, accounts, api, storage, queue, notifier, now);
  const ai = new AiService(cfg, storage);
  return { cfg, db, storage, api, accounts, posts, publisher, notifier, queue, ai };
}
