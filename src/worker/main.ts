import { loadConfig } from '../config/index.js';
import { buildContainer } from '../container.js';
import { BullPublishQueue, startWorker } from './queue.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const cfg = loadConfig();
const bq = BullPublishQueue.create(redisUrl);
const c = buildContainer(bq, { cfg });
const worker = await startWorker(c, bq, redisUrl);
console.log('العامل يعمل: النشر + المتابعة + المسح الدوري للمجدولات');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await worker.close(); await bq.close(); await c.db.$disconnect(); process.exit(0); });
