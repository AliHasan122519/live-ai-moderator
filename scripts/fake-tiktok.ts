// خادم TikTok وهمي للعرض/التطوير المحلي فقط. ليس TikTok الحقيقي ولا يثبت أي شيء عن سلوكه.
import { startFake } from '../tests/fakeTikTok.js';

const port = Number(process.env.FAKE_TIKTOK_PORT ?? 4010);
const f = await startFake();
await new Promise<void>((r) => f.server.close(() => r()));
f.server.listen(port, '127.0.0.1');
f.base = `http://127.0.0.1:${port}`;
f.audited = process.env.FAKE_AUDITED === 'true';
f.pollsUntilDone = Number(process.env.FAKE_POLLS ?? 2);
console.log(`⚠ TikTok وهمي على ${f.base} — للتجربة المحلية فقط (audited=${f.audited})`);
