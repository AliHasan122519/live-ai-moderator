import type { MediaAsset, Post, TikTokAccount } from '@prisma/client';
import type { CreatorInfo, PostInfo } from '../tiktok/client.js';
import { LIMITS } from '../media/limits.js';

export interface Effective {
  mode: 'DIRECT' | 'DRAFT_INBOX';
  privacy: string | null;           // null في وضع المسودة (يختارها المستخدم داخل TikTok)
  disableComment: boolean; disableDuet: boolean; disableStitch: boolean;
  isAigc: boolean;
  title: string; description: string;
  warnings: string[]; errors: string[];
}

export const renderCaption = (p: Pick<Post, 'caption' | 'hashtags'>) => {
  const tags = p.hashtags.map((h) => `#${h.replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h) => h.length > 1);
  return [p.caption.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
};

/** يحسب ما سيُرسَل فعلياً إلى TikTok (قد يختلف عن المطلوب بسبب حالة الحساب). كل فرق يظهر كتحذير. */
export function resolveEffective(post: Post, account: Pick<TikTokAccount, 'audited' | 'scopes' | 'creatorInfo'>, media: Pick<MediaAsset, 'aiGenerated' | 'durationSec' | 'kind'>[]): Effective {
  const warnings: string[] = []; const errors: string[] = [];
  const creator = (account.creatorInfo ?? null) as CreatorInfo | null;
  const caption = renderCaption(post);

  let mode: 'DIRECT' | 'DRAFT_INBOX' = post.mode;
  if (mode === 'DIRECT' && !account.scopes.includes('video.publish')) {
    mode = 'DRAFT_INBOX';
    warnings.push('لا تتوفر صلاحية النشر المباشر (video.publish) — سيُرسل كمسودة إلى صندوق TikTok لتُكمله من التطبيق');
  }

  let privacy: string | null = null;
  if (mode === 'DIRECT') {
    const options = creator?.privacy_level_options;
    if (!options?.length) errors.push('لم تُجلب إعدادات النشر المسموحة للحساب بعد (creator_info)');
    privacy = post.privacyLevel;
    if (!account.audited && privacy !== 'SELF_ONLY') {
      warnings.push('تطبيقك غير معتمد من TikTok بعد: سيُنشر بخصوصية «أنا فقط» (SELF_ONLY) مهما اخترت');
      privacy = 'SELF_ONLY';
    }
    if (options?.length && !options.includes(privacy)) errors.push(`خيار الخصوصية ${privacy} غير متاح لهذا الحساب (المتاح: ${options.join(', ')})`);
  }

  const forced = (want: boolean, disabledByCreator: boolean | undefined, label: string) => {
    if (disabledByCreator && !want) warnings.push(`${label} معطّل في إعدادات حسابك على TikTok`);
    return want || !!disabledByCreator;
  };
  const disableComment = forced(post.disableComment, creator?.comment_disabled, 'التعليقات');
  const disableDuet = forced(post.disableDuet, creator?.duet_disabled, 'الديو');
  const disableStitch = forced(post.disableStitch, creator?.stitch_disabled, 'الستيتش');

  const isAigc = post.aiGenerated || media.some((m) => m.aiGenerated);
  if (isAigc) warnings.push('سيُوسَم المحتوى كمحتوى مُنشأ بالذكاء الاصطناعي (AI-generated)');

  let title = caption; let description = '';
  if (post.type !== 'VIDEO') {
    const firstLine = (post.caption.split('\n')[0] ?? '').trim();
    title = firstLine.slice(0, LIMITS.caption.maxPhotoTitle);
    description = caption;
    if (firstLine.length > LIMITS.caption.maxPhotoTitle) warnings.push(`عنوان منشور الصور محدود بـ${LIMITS.caption.maxPhotoTitle} حرفاً — اقتُطع السطر الأول، والوصف الكامل أُرسل كوصف`);
    if (description.length > LIMITS.caption.maxPhotoDescription) errors.push(`الوصف يتجاوز ${LIMITS.caption.maxPhotoDescription} حرفاً`);
  } else if (title.length > LIMITS.caption.maxVideoTitle) errors.push(`الوصف يتجاوز ${LIMITS.caption.maxVideoTitle} حرفاً`);

  const dur = media.find((m) => m.kind === 'VIDEO')?.durationSec;
  if (dur && creator?.max_video_post_duration_sec && dur > creator.max_video_post_duration_sec) errors.push(`مدة الفيديو (${Math.round(dur)}ث) تتجاوز المسموح لحسابك (${creator.max_video_post_duration_sec}ث)`);

  return { mode, privacy, disableComment, disableDuet, disableStitch, isAigc, title, description, warnings, errors };
}

export function toPostInfo(e: Effective, post: Post): PostInfo {
  const base: PostInfo = { disable_comment: e.disableComment, title: e.title, brand_content_toggle: post.brandContent, brand_organic_toggle: post.brandOrganic };
  if (post.type === 'VIDEO') return { ...base, privacy_level: e.privacy ?? undefined, disable_duet: e.disableDuet, disable_stitch: e.disableStitch, is_aigc: e.isAigc };
  return { ...base, description: e.description, privacy_level: e.privacy ?? undefined, auto_add_music: true };
}
