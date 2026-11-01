import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { MediaAsset } from '@prisma/client';
import type { Storage } from '../storage/types.js';

const run = promisify(execFile);

/** يستخرج حتى n إطاراً JPEG مصغّراً (≤1024px) لتحليل المحتوى: صورة واحدة للصور، ولقطات موزعة للفيديو. */
export async function extractFrames(storage: Storage, a: Pick<MediaAsset, 'storageKey' | 'kind' | 'durationSec'>, n = 3, width = 1024): Promise<Buffer[]> {
  const src = join(tmpdir(), `fr-${randomUUID()}`);
  const outs: string[] = [];
  try {
    await pipeline(await storage.get(a.storageKey), createWriteStream(src, { mode: 0o600 }));
    const stamps = a.kind === 'IMAGE' ? [0] : Array.from({ length: n }, (_, i) => ((a.durationSec ?? 3) * (i + 1)) / (n + 1));
    const frames: Buffer[] = [];
    for (const [i, ts] of stamps.entries()) {
      const out = `${src}-${i}.jpg`; outs.push(out);
      await run('ffmpeg', ['-v', 'error', '-y', ...(a.kind === 'VIDEO' ? ['-ss', ts.toFixed(2)] : []), '-i', src, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '4', out], { timeout: 30_000 });
      frames.push(await readFile(out));
    }
    return frames;
  } finally {
    await Promise.all([src, ...outs].map((f) => rm(f, { force: true })));
  }
}
