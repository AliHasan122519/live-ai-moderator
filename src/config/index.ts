import { z } from 'zod';

const bool = (d: 'true' | 'false') => z.enum(['true', 'false']).default(d).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENC_KEY يجب أن يكون 32 بايت بترميز base64 (openssl rand -base64 32)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET قصير (استخدم openssl rand -base64 48)'),
  OWNER_PASSWORD_HASH: z.string().default(''),
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error('إعدادات غير صالحة:\n' + r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const c = r.data;
  if (c.NODE_ENV === 'production') {
    if (!c.PUBLIC_API_URL.startsWith('https://')) throw new Error('PUBLIC_API_URL يجب أن يكون HTTPS في الإنتاج');
    if (!c.OWNER_PASSWORD_HASH) throw new Error('OWNER_PASSWORD_HASH مطلوب في الإنتاج');
  }
  return { ...c, scopes: c.TIKTOK_SCOPES.split(',').map((s) => s.trim()).filter(Boolean), isProd: c.NODE_ENV === 'production' };
}
