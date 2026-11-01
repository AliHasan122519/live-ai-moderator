import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MediaAsset, MediaSource } from '@prisma/client';
import type { Config } from '../config/index.js';
import type { Db } from '../db/index.js';
import type { Storage } from '../storage/types.js';
import { LIMITS } from './limits.js';
import { probeMedia } from './probe.js';
import { sniffMime } from './sniff.js';

export class MediaError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

export interface IngestInput {
  db: Db; storage: Storage; config: Pick<Config, 'MEDIA_RETENTION_DAYS'>;
  stream: Readable; filename: string; source?: MediaSource; aiGenerated?: boolean;
  /** سقف أمان للبث الوارد قبل معرفة النوع */
  hardMaxBytes?: number;
}

export async function ingestUpload(i: IngestInput): Promise<{ asset: MediaAsset; duplicate: boolean }> {
  const tmp = join(tmpdir(), `upl-${randomUUID()}`);
  const hash = createHash('sha256');
  let size = 0;
  const max = i.hardMaxBytes ?? LIMITS.video.maxBytes;
  try {
    await pipeline(
      i.stream,
      new Transform({
        transform(chunk: Buffer, _e, cb) {
          size += chunk.length;
          if (size > max) return cb(new MediaError('too_large', 'الملف أكبر من الحد المسموح'));
          hash.update(chunk); cb(null, chunk);
        },
      }),
      createWriteStream(tmp, { mode: 0o600 }),
    );
    if (size === 0) throw new MediaError('empty', 'الملف فارغ');

    const fh = await open(tmp, 'r');
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    await fh.close();

    const sn = sniffMime(head);
    if (!sn) throw new MediaError('unsupported', 'صيغة غير معروفة. المدعوم: فيديو MP4/MOV/WebM وصور JPEG/WebP');
    if (sn.mime === 'image/png') throw new MediaError('unsupported_png', 'صور PNG غير مدعومة للنشر. حوّلها إلى JPEG أو WebP');
    const allowed = sn.kind === 'VIDEO' ? LIMITS.video : LIMITS.image;
    if (!(allowed.mimes as readonly string[]).includes(sn.mime)) throw new MediaError('unsupported', `الصيغة ${sn.mime} غير مدعومة`);
    if (size > allowed.maxBytes) throw new MediaError('too_large', `الحجم يتجاوز الحد (${Math.round(allowed.maxBytes / 1024 ** 2)}MB)`);

    const sha256 = hash.digest('hex');
    const dup = await i.db.mediaAsset.findFirst({ where: { sha256, deletedAt: null } });
    if (dup) return { asset: dup, duplicate: true };

    const probe = await probeMedia(tmp);
    if (sn.kind === 'VIDEO' && probe.probed && (probe.durationSec ?? 0) < LIMITS.video.minDurationSec) throw new MediaError('bad_video', 'الفيديو قصير جداً أو تالف');
    if (sn.kind === 'VIDEO' && !probe.probed) throw new MediaError('probe_failed', 'تعذّر فحص الفيديو (ffprobe غير متاح أو الملف تالف)');

    const id = randomUUID();
    const key = `media/${new Date().getUTCFullYear()}/${id}.${EXT[sn.mime]}`;
    await i.storage.put(key, createReadStream(tmp), sn.mime);
    const written = await i.storage.stat(key);
    if (!written || written.size !== (await stat(tmp)).size) throw new MediaError('store_failed', 'فشل التحقق من الملف بعد التخزين');

    const asset = await i.db.mediaAsset.create({
      data: {
        id, kind: sn.kind, filename: i.filename.slice(0, 200), mime: sn.mime, sizeBytes: BigInt(size), sha256, storageKey: key,
        width: probe.width, height: probe.height, durationSec: probe.durationSec,
        source: i.source ?? 'UPLOAD', aiGenerated: i.aiGenerated ?? i.source === 'AI_GENERATED',
        expiresAt: new Date(Date.now() + i.config.MEDIA_RETENTION_DAYS * 86_400_000),
      },
    });
    return { asset, duplicate: false };
  } finally {
    await rm(tmp, { force: true });
  }
}
