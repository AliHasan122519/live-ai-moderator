import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import type { Config } from '../config/index.js';
import { assertKey, type Storage } from './types.js';

/** تخزين متوافق مع S3 (AWS/R2/MinIO). الحاوية يجب أن تبقى خاصة؛ التسليم لـTikTok عبر خادمنا بروابط موقّعة قصيرة العمر. */
export class S3Storage implements Storage {
  private s3: S3Client;
  private bucket: string;
  constructor(c: Config) {
    if (!c.S3_BUCKET || !c.S3_ACCESS_KEY_ID) throw new Error('إعدادات S3 ناقصة');
    this.bucket = c.S3_BUCKET;
    this.s3 = new S3Client({
      region: c.S3_REGION, endpoint: c.S3_ENDPOINT || undefined, forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY },
    });
  }
  async put(key: string, body: Readable | Buffer, mime: string) {
    assertKey(key);
    await new Upload({ client: this.s3, params: { Bucket: this.bucket, Key: key, Body: body, ContentType: mime, ServerSideEncryption: undefined } }).done();
  }
  async get(key: string, range?: { start: number; end: number }) {
    assertKey(key);
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
    return r.Body as Readable;
  }
  async stat(key: string) {
    assertKey(key);
    try { const h = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return { size: Number(h.ContentLength ?? 0) }; } catch { return null; }
  }
  async delete(key: string) { assertKey(key); await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}
