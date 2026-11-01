import { createHash } from 'node:crypto';
import { z } from 'zod';

const bool = (d: 'true' | 'false') => z.enum(['true', 'false']).default(d).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // أي نص عشوائي طويل (32+ حرفاً) يصلح؛ يُشتق منه مفتاح 32 بايت. يسهّل الإعداد من الجوال (مثل «Generate value» في منصات الاستضافة)
  TOKEN_ENC_KEY: z.string().min(32, 'TOKEN_ENC_KEY قصير: استخدم نصاً عشوائياً من 32 حرفاً فأكثر'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET قصير (استخدم openssl rand -base64 48)'),
  OWNER_PASSWORD_HASH: z.string().default(''),
  // بديل مريح للجوال: كلمة مرور نصية في متغيرات البيئة (تُجزَّأ عند التشغيل). متغيرات المنصة خاصة، لكن التجزئة أفضل إن أمكنك
  OWNER_PASSWORD: z.string().default(''),
  WEB_DIR: z.string().default('web/out'),
  RUN_WORKER: bool('true'),
  MCP_ENABLE_APPROVAL: bool('false'),
  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  TIKTOK_REDIRECT_URI: z.string().default('http://localhost:4000/auth/tiktok/callback'),
  TIKTOK_SCOPES: z.string().default('user.info.basic,video.upload'),
  TIKTOK_API_BASE: z.string().url().default('https://open.tiktokapis.com'),
  TIKTOK_AUTH_URL: z.string().url().default('https://www.tiktok.com/v2/auth/authorize/'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage-data'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool('true'),
  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  MEDIA_RETENTION_DAYS: z.coerce.number().default(30),
});

export type Config = z.infer<typeof schema> & { scopes: string[]; isProd: boolean };

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
  // الرابط العام: صراحةً، أو PUBLIC_URL، أو ما تحقنه المنصة (Render: RENDER_EXTERNAL_URL). الواجهة والـAPI من أصل واحد الآن.
  const origin = raw.PUBLIC_API_URL || raw.PUBLIC_URL || raw.RENDER_EXTERNAL_URL || '';
  const env: NodeJS.ProcessEnv = { ...raw };
  if (origin) {
    env.PUBLIC_API_URL = origin.replace(/\/$/, '');
    env.PUBLIC_WEB_URL = raw.PUBLIC_WEB_URL || env.PUBLIC_API_URL;
    env.TIKTOK_REDIRECT_URI = raw.TIKTOK_REDIRECT_URI || `${env.PUBLIC_API_URL}/auth/tiktok/callback`;
  }
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error('إعدادات غير صالحة:\n' + r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const c = r.data;
  if (c.NODE_ENV === 'production') {
    if (!c.PUBLIC_API_URL.startsWith('https://')) throw new Error('PUBLIC_API_URL يجب أن يكون HTTPS في الإنتاج');
    if (!c.OWNER_PASSWORD_HASH && !c.OWNER_PASSWORD) throw new Error('OWNER_PASSWORD أو OWNER_PASSWORD_HASH مطلوب في الإنتاج');
  }
  const rawKey = Buffer.from(c.TOKEN_ENC_KEY, 'base64');
  const key = rawKey.length === 32 && rawKey.toString('base64') === c.TOKEN_ENC_KEY ? c.TOKEN_ENC_KEY : createHash('sha256').update(c.TOKEN_ENC_KEY).digest('base64');
  if (c.OWNER_PASSWORD && c.OWNER_PASSWORD.length < 12) throw new Error('OWNER_PASSWORD قصيرة: 12 حرفاً على الأقل');
  return { ...c, TOKEN_ENC_KEY: key, scopes: c.TIKTOK_SCOPES.split(',').map((s) => s.trim()).filter(Boolean), isProd: c.NODE_ENV === 'production' };
}
