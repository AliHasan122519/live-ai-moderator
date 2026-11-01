import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export interface Probe { width?: number; height?: number; durationSec?: number; videoCodec?: string }

/** ffprobe (إن وُجد). فشله لا يمنع الرفع لكنه يعطّل التحقق من المدة/الأبعاد، ويُسجَّل ذلك في النتيجة. */
export async function probeMedia(path: string): Promise<(Probe & { probed: boolean })> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { timeout: 30_000 });
    const j = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    const dur = Number(j.format?.duration ?? v?.duration);
    return {
      probed: true,
      width: v?.width ? Number(v.width) : undefined, height: v?.height ? Number(v.height) : undefined,
      durationSec: Number.isFinite(dur) ? dur : undefined, videoCodec: v?.codec_name ? String(v.codec_name) : undefined,
    };
  } catch { return { probed: false }; }
}
