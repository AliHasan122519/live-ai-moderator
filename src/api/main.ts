import { loadConfig } from '../config/index.js';
import { startFake } from '../demo/fakeTikTok.js';
import { buildContainer } from '../container.js';
import { BullPublishQueue, startWorker } from '../worker/queue.js';
import { buildApi } from './app.js';

if (process.env.DEMO_TIKTOK === 'true') {
  // خادم TikTok وهمي داخلي (127.0.0.1 فقط). صفحة التفويض يخدمها الـAPI نفسه ليصل إليها متصفحك.
  const fake = await startFake(4010); fake.pollsUntilDone = 2;
  const origin = (process.env.PUBLIC_API_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  Object.assign(process.env, { TIKTOK_API_BASE: fake.base, TIKTOK_CLIENT_KEY: 'ck_test', TIKTOK_CLIENT_SECRET: 'cs_test', TIKTOK_AUTH_URL: `${origin}/demo/tiktok/authorize/` });
  console.log('⚠ الوضع التجريبي: TikTok وهمي — لا يُنشر شيء على TikTok الحقيقية');
}
const cfg = loadConfig();
const bq = BullPublishQueue.create(cfg.REDIS_URL);
const c = buildContainer(bq, { cfg });
const app = await buildApi(c);
// RUN_WORKER=true (الافتراضي): العامل داخل العملية نفسها ⇒ خدمة واحدة تكفي. ضعه false إن شغّلت src/worker/main.ts منفصلاً
const worker = cfg.RUN_WORKER ? await startWorker(c, bq, cfg.REDIS_URL) : null;
await app.listen({ port: cfg.PORT, host: process.env.HOST ?? '127.0.0.1' });
console.log(`جاهز على المنفذ ${cfg.PORT} — الواجهة: ${process.env.WEB_DIR ?? 'web/out'} — العامل: ${worker ? 'داخل العملية' : 'خارجي'} — الذكاء الاصطناعي: ${c.ai.available ? 'مفعّل' : 'غير مفعّل'}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await worker?.close(); await app.close(); await bq.close(); await c.db.$disconnect(); process.exit(0); });
