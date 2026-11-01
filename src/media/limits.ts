// قيود الوسائط. مصدرها معرفتي بوثائق Content Posting API وليست مُتحقَّقاً منها من الوثائق الحية
// (النطاق غير متاح لهذه الجلسة). راجعها في developers.tiktok.com قبل الإطلاق — كلها هنا في مكان واحد.
export const LIMITS = {
  video: { mimes: ['video/mp4', 'video/quicktime', 'video/webm'], maxBytes: 4 * 1024 ** 3, minDurationSec: 1 },
  image: { mimes: ['image/jpeg', 'image/webp'], maxBytes: 20 * 1024 ** 2 },
  carousel: { minImages: 2, maxImages: 35 },
  caption: { maxVideoTitle: 2200, maxPhotoTitle: 90, maxPhotoDescription: 4000 },
} as const;
