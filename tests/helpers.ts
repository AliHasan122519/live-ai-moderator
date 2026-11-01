import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createDb, type Db } from '../src/db/index.js';
import { LocalStorage } from '../src/storage/local.js';
import { loadConfig, type Config } from '../src/config/index.js';

export const testConfig = (over: Record<string, string> = {}): Config =>
  loadConfig({
    NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL!, TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(48).toString('base64'), TIKTOK_CLIENT_KEY: 'ck_test', TIKTOK_CLIENT_SECRET: 'cs_test',
    TIKTOK_SCOPES: 'user.info.basic,video.upload,video.publish', PUBLIC_API_URL: 'http://localhost:4000', ...over,
  });

export async function freshDb(): Promise<Db> {
  const db = createDb();
  // ترتيب الحذف يراعي المفاتيح الأجنبية
  await db.$transaction([
    db.postEvent.deleteMany(), db.postMedia.deleteMany(), db.post.deleteMany(), db.mediaAsset.deleteMany(),
    db.tikTokAccount.deleteMany(), db.oAuthState.deleteMany(), db.apiToken.deleteMany(), db.auditLog.deleteMany(), db.setting.deleteMany(),
  ]);
  return db;
}
export const tmpStorage = () => new LocalStorage(mkdtempSync(join(tmpdir(), 'st-')));
export const streamOf = (b: Buffer) => Readable.from([b]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
export const jpegUnique = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);

/** فيديو mp4 حقيقي قصير عبر ffmpeg (للاختبارات) */
export function makeMp4(seconds = 2, tag = String(Math.random())): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), 'mp4-')), 'v.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=320x568:d=${seconds}:r=24`, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', `comment=${tag}`, '-shortest', '-y', out]);
  return readFileSync(out);
}
