# النشر على VPS

## المتطلبات
Node 22+، Postgres 16، Redis 7، ffmpeg (لفحص الفيديو واللقطات)، نطاق بـHTTPS، وخدمة تخزين S3-متوافقة (أو القرص المحلي لخادم واحد).

## الخطوات
```bash
git clone … && cd live-ai-moderator
npm ci && (cd web && npm ci && npm run build)
cp .env.example .env   # املأه: npm run cli -- gen-keys  /  npm run cli -- hash-password
npm run db:migrate
npm run cli -- create-token mcp          # رمز MCP (بلا post:approve افتراضياً)
```
شغّل ثلاث عمليات (systemd أو pm2): `npm run start:api` و`npm run start:worker` و`cd web && npm start`.

## وكيل عكسي (Caddy) — موصى به
يُبقي كل شيء من أصل واحد (كوكي first-party)، ويمرّر الملفات الكبيرة مباشرة إلى الـAPI دون المرور بـNext:
```
app.example.com {
  @api path /api/* /auth/* /media/pull/*
  handle @api { reverse_proxy 127.0.0.1:4000 }
  handle { reverse_proxy 127.0.0.1:3000 }
  request_body { max_size 4GB }
}
```
اضبط: `PUBLIC_API_URL=https://app.example.com` و`PUBLIC_WEB_URL=https://app.example.com` و`TIKTOK_REDIRECT_URI=https://app.example.com/auth/tiktok/callback` و`NODE_ENV=production`.

## تشغيل MCP مع Claude Code (مكتبي)
```bash
claude mcp add tiktok-publisher \
  -e MCP_API_URL=https://app.example.com -e MCP_API_TOKEN=tpk_… -e MCP_ALLOWED_DIR=/path/to/content \
  -- npx tsx /path/to/live-ai-moderator/src/mcp/main.ts
```
> الأمر مبني على صيغة `claude mcp add` المعروفة لي؛ لم أجرّبه داخل Claude Code فعلياً.

## النسخ الاحتياطي والصيانة
`pg_dump` يومي لقاعدة البيانات (فيها الرموز المشفّرة وسجل التدقيق). **احتفظ بـ`TOKEN_ENC_KEY` منفصلاً**: فقدانه يعني إعادة ربط الحساب. يُحذف المحتوى المنتهي (`MEDIA_RETENTION_DAYS`) تلقائياً كل 6 ساعات.
