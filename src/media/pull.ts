import type { MediaAsset } from '@prisma/client';
import type { Config } from '../config/index.js';
import type { Db } from '../db/index.js';
import { signPayload, verifyPayload } from '../crypto/index.js';

/**
 * رابط سحب موقّع قصير العمر لـPULL_FROM_URL (الصور). الحاوية تبقى خاصة؛ TikTok تسحب من خادمنا فقط.
 * شرط TikTok: نطاق/بادئة الرابط يجب أن تكون موثَّقة الملكية في لوحة المطور (انظر docs/TIKTOK_SETUP.md).
 */
export function makePullUrl(cfg: Pick<Config, 'PUBLIC_API_URL' | 'SESSION_SECRET'>, asset: Pick<MediaAsset, 'id' | 'mime'>, ttlSec = 3600, now = Date.now()): string {
  const ext = asset.mime === 'image/webp' ? 'webp' : asset.mime === 'image/jpeg' ? 'jpg' : 'bin';
  return `${cfg.PUBLIC_API_URL.replace(/\/$/, '')}/media/pull/${signPayload({ m: asset.id, k: 'pull' }, cfg.SESSION_SECRET, ttlSec, now)}.${ext}`;
}

export async function resolvePull(db: Db, cfg: Pick<Config, 'SESSION_SECRET'>, tokenWithExt: string, now = Date.now()): Promise<MediaAsset | null> {
  const token = tokenWithExt.replace(/\.(jpg|webp|bin)$/, '');
  const p = verifyPayload<{ m: string; k: string }>(token, cfg.SESSION_SECRET, now);
  if (!p || p.k !== 'pull') return null;
  const a = await db.mediaAsset.findUnique({ where: { id: p.m } });
  // لا تُسلَّم إلا الصور وغير المحذوفة، وفقط إن كانت مرتبطة بمنشور موافَق عليه/قيد الإرسال
  if (!a || a.deletedAt || a.kind !== 'IMAGE') return null;
  const linked = await db.postMedia.count({ where: { mediaId: a.id, post: { status: { in: ['APPROVED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PROCESSING'] } } } });
  return linked > 0 ? a : null;
}
