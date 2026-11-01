import { loadConfig } from '../config/index.js';
import { buildContainer } from '../container.js';
import { BullPublishQueue, startWorker } from '../worker/queue.js';
import { buildApi } from './app.js';

const cfg = loadConfig();
const bq = BullPublishQueue.create(cfg.REDIS_URL);
const c = buildContainer(bq, { cfg });
const app = await buildApi(c);
// RUN_WORKER=true (الافتراضي): العامل داخل العملية نفسها ⇒ خدمة واحدة تكفي. ضعه false إن شغّلت src/worker/main.ts منفصلاً
const worker = cfg.RUN_WORKER ? await startWorker(c, bq, cfg.REDIS_URL) : null;
await app.listen({ port: cfg.PORT, host: process.env.HOST ?? '127.0.0.1' });
console.log(`جاهز على المنفذ ${cfg.PORT} — الواجهة: ${process.env.WEB_DIR ?? 'web/out'} — العامل: ${worker ? 'داخل العملية' : 'خارجي'} — الذكاء الاصطناعي: ${c.ai.available ? 'مفعّل' : 'غير مفعّل'}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await worker?.close(); await app.close(); await bq.close(); await c.db.$disconnect(); process.exit(0); });
