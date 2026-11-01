# TikTok AI Publisher

نظام لإدارة ونشر محتوى TikTok بأوامر عربية: ترفع صورة/فيديو (من الجوال أو من Claude Code)، يقترح الذكاء الاصطناعي الوصف والهاشتاقات من **المحتوى الفعلي**، تراجع معاينة، **توافق صراحةً**، فيُنشر عبر **Content Posting API الرسمية** ويُتابَع حتى **تأكيد TikTok**.

> ⚠️ **حالة الصدق:** كل التكامل مع TikTok مُختبَر **مقابل خادم TikTok وهمي** (لم تصل جلسة البناء إلى خوادم TikTok). لن يُعرض أي منشور كـ«منشور» إلا بعد `PUBLISH_COMPLETE` من TikTok، لكن لم يُجرَّب ذلك مع TikTok الحقيقية بعد. اقرأ `docs/PLAN.md` ثم `docs/TIKTOK_SETUP.md`.

> 📱 **تستخدم الجوال فقط؟** اقرأ `docs/PHONE.md`: بعد إعداد لمرة واحدة تصمّم داخل Claude (صور HTML وفيديو من شرائح) وتقول «انشر» فيُنشر عبر الواجهة الرسمية.

## المعمارية
```
 جوال/متصفح ──► Fastify (يخدم الواجهة الثابتة + API + العامل في عملية واحدة) ──► Postgres (Prisma)
 Claude (موصّل مخصص) ──► /mcp (HTTP) ──►        │  ├──► Storage (S3/محلي)
 Claude Code ──► MCP (stdio) ──────────►         │  └──► Redis/BullMQ ──► TikTok Content Posting API
```
- `src/tiktok/` عميل OAuth + Content Posting (رسمي فقط، بلا أتمتة متصفح).
- `src/posts/` آلة الحالات، بوابة الموافقة، المنفّذ، المتابع، الجدولة.
- `src/media/` فحص الملفات، روابط السحب الموقّعة، الاحتفاظ.
- `src/ai/` توليد الأوصاف/الهاشتاقات (Claude) وفهم المواعيد العربية (Asia/Riyadh).
- `src/mcp/` 13 أداة + `upload_media` + `approve_tiktok_post` (اختيارية).
- `web/` لوحة جوال أولاً RTL Dark (12 صفحة) تُصدَّر ملفات ثابتة وتُخدَّم من الـAPI نفسه.

## تشغيل محلي للتجربة (بلا TikTok حقيقي)
```bash
docker compose up -d postgres redis      # أو Postgres/Redis لديك
npm ci && (cd web && npm ci)
cp .env.example .env                     # npm run cli -- gen-keys ؛ npm run cli -- hash-password
npm run db:migrate
npm run dev:fake-tiktok &                # TikTok وهمي على :4010 (للتجربة فقط)
# اضبط في .env: TIKTOK_API_BASE=http://127.0.0.1:4010 TIKTOK_AUTH_URL=http://127.0.0.1:4010/v2/auth/authorize/ TIKTOK_CLIENT_KEY=ck_test TIKTOK_CLIENT_SECRET=cs_test
npm run start:api & npm run start:worker &
(cd web && npm run build && npm start)   # http://localhost:3000
```
للإنتاج الفعلي: `docs/TIKTOK_SETUP.md` ثم `docs/DEPLOY.md`.

## الاختبارات
```bash
npm test          # 82 اختباراً: يتطلب Postgres وRedis (TEST_DATABASE_URL / TEST_REDIS_URL) وffmpeg
npm run typecheck && (cd web && npm run typecheck)
```
## الأوامر
`npm run cli -- gen-keys | hash-password | create-token <اسم> [صلاحيات]`

## الضمانات الأساسية
1. لا نشر بلا **موافقة صريحة مرتبطة ببصمة المحتوى**؛ أي تعديل يُبطلها.
2. لا ادّعاء نجاح قبل **تأكيد TikTok**؛ الغموض ⇒ `UNKNOWN` بلا إعادة تلقائية (تفادياً للتكرار).
3. تطبيق غير معتمد ⇒ `SELF_ONLY` فقط، ويظهر ذلك في المعاينة.
4. بلا صلاحية النشر المباشر ⇒ مسودة إلى صندوق TikTok تُكمَل من التطبيق.
