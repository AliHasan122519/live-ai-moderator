import type { Db } from '../db/index.js';
import type { Storage } from '../storage/types.js';

const ACTIVE = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PROCESSING', 'UNKNOWN'] as const;

/** حذف الوسائط المنتهية الاحتفاظ التي لا يرتبط بها أي منشور نشط. يُرجع عدد المحذوف. */
export async function purgeExpiredMedia(db: Db, storage: Storage, now = new Date()): Promise<number> {
  const expired = await db.mediaAsset.findMany({
    where: { deletedAt: null, expiresAt: { lt: now }, posts: { none: { post: { status: { in: [...ACTIVE] } } } } },
  });
  for (const m of expired) {
    await storage.delete(m.storageKey);
    await db.mediaAsset.update({ where: { id: m.id }, data: { deletedAt: now } });
  }
  return expired.length;
}
