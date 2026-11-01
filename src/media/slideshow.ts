import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export class SlideshowError extends Error {}

export interface SlideshowOpts { secondsPerSlide?: number; fade?: number; width?: number; height?: number }

/** يركّب فيديو MP4 (H.264 + صوت صامت AAC) من صور بتلاشٍ بين الشرائح. المدة الكلية = N·d − (N−1)·fade. */
export async function makeSlideshow(images: Buffer[], o: SlideshowOpts = {}): Promise<Buffer> {
  if (!images.length || images.length > 12) throw new SlideshowError('عدد الشرائح بين 1 و12');
  const d = o.secondsPerSlide ?? 3; const fade = images.length > 1 ? Math.min(o.fade ?? 0.5, d / 2) : 0;
  const W = o.width ?? 1080, H = o.height ?? 1920;
  if (d < 1 || d > 10) throw new SlideshowError('مدة الشريحة بين 1 و10 ثوانٍ');
  const dir = join(tmpdir(), `ss-${randomUUID()}`); await mkdir(dir, { recursive: true });
  try {
    const args = ['-v', 'error', '-y'];
    for (const [i, b] of images.entries()) { const f = join(dir, `${i}.jpg`); await writeFile(f, b); args.push('-loop', '1', '-framerate', '30', '-t', String(d), '-i', f); }
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
    const norm = images.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p[v${i}]`);
    let chain = ''; let last = 'v0';
    for (let i = 1; i < images.length; i++) { const out = i === images.length - 1 ? 'vout' : `x${i}`; chain += `;[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(i * (d - fade)).toFixed(3)}[${out}]`; last = out; }
    const filter = norm.join(';') + chain;
    const total = images.length * d - (images.length - 1) * fade;
    const out = join(dir, 'out.mp4');
    args.push('-filter_complex', filter, '-map', images.length > 1 ? '[vout]' : '[v0]', '-map', `${images.length}:a`, '-t', total.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', out);
    try { await run('ffmpeg', args, { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }); }
    catch (e) { throw new SlideshowError(`فشل تركيب الفيديو: ${((e as { stderr?: string }).stderr ?? (e as Error).message).toString().split('\n')[0]}`); }
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** مصغّرة JPEG بعرض محدد (لمعاينة Claude). */
export async function thumbnail(jpeg: Buffer, width = 540): Promise<Buffer> {
  const dir = join(tmpdir(), `th-${randomUUID()}`); await mkdir(dir, { recursive: true });
  try {
    const i = join(dir, 'i.jpg'), o = join(dir, 'o.jpg'); await writeFile(i, jpeg);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', i, '-vf', `scale='min(${width},iw)':-2`, '-q:v', '5', '-frames:v', '1', o], { timeout: 30_000 });
    return await readFile(o);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
