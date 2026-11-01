import { loadConfig } from '../config/index.js';
import { buildContainer } from '../container.js';
import { BullPublishQueue } from '../worker/queue.js';
import { buildApi } from './app.js';

const cfg = loadConfig();
const bq = BullPublishQueue.create(cfg.REDIS_URL);
const c = buildContainer(bq, { cfg });
const app = await buildApi(c);
await app.listen({ port: cfg.PORT, host: process.env.HOST ?? '127.0.0.1' });
console.log(`API: http://127.0.0.1:${cfg.PORT}  (الذكاء الاصطناعي: ${c.ai.available ? 'مفعّل' : 'غير مفعّل'})`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); await bq.close(); await c.db.$disconnect(); process.exit(0); });
