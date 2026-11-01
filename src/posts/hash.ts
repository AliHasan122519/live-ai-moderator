import type { Post } from '@prisma/client';
import { sha256Hex } from '../crypto/index.js';
import type { Effective } from './effective.js';

/** بصمة كل ما سيراه الجمهور أو يؤثر على النشر. الموافقة تُمنح على هذه البصمة تحديداً. */
export function computeContentHash(post: Pick<Post, 'accountId' | 'type' | 'coverIndex' | 'brandContent' | 'brandOrganic'>, mediaSha: string[], eff: Effective): string {
  return sha256Hex(JSON.stringify({
    a: post.accountId, t: post.type, m: mediaSha, cover: post.coverIndex, bc: post.brandContent, bo: post.brandOrganic,
    mode: eff.mode, privacy: eff.privacy, title: eff.title, desc: eff.description,
    dc: eff.disableComment, dd: eff.disableDuet, ds: eff.disableStitch, aigc: eff.isAigc,
  }));
}
export const mediaSignature = (mediaSha: string[]) => sha256Hex(mediaSha.join(','));
