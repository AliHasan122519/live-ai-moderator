import type { MediaKind } from '@prisma/client';

export interface Sniffed { kind: MediaKind; mime: string }

/** تحديد النوع من البايتات الأولى (لا نثق بالامتداد ولا بـContent-Type المرسل). */
export function sniffMime(head: Buffer): Sniffed | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'IMAGE', mime: 'image/jpeg' };
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return { kind: 'IMAGE', mime: 'image/webp' };
  if (head.length >= 8 && head.toString('hex', 0, 8) === '89504e470d0a1a0a') return { kind: 'IMAGE', mime: 'image/png' }; // يُعرَف ثم يُرفض لاحقاً
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12);
    return { kind: 'VIDEO', mime: brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4' };
  }
  if (head.length >= 4 && head.toString('hex', 0, 4) === '1a45dfa3') return { kind: 'VIDEO', mime: 'video/webm' };
  return null;
}
