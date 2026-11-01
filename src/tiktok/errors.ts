export class TikTokApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
    public logId?: string,
  ) { super(message); this.name = 'TikTokApiError'; }

  /** أخطاء مؤقتة يجوز إعادة المحاولة عليها (بشرط ألا تكون العملية غير آمنة للتكرار — انظر publisher). */
  get transient() {
    return this.httpStatus >= 500 || this.httpStatus === 429 || ['internal_error', 'rate_limit_exceeded', 'service_unavailable'].includes(this.code);
  }
  get authExpired() { return this.code === 'access_token_invalid' || this.httpStatus === 401; }
}

/** رسائل عربية لأشهر رموز أخطاء Content Posting API (الرموز من معرفتي بالوثائق — غير مُتحقَّقة من الحية). */
export const ERROR_AR: Record<string, string> = {
  access_token_invalid: 'انتهت صلاحية الربط، أعد ربط الحساب',
  scope_not_authorized: 'الصلاحية المطلوبة غير ممنوحة لهذا الحساب',
  rate_limit_exceeded: 'تجاوزت حد الطلبات، حاول لاحقاً',
  spam_risk_too_many_posts: 'تجاوزت الحد اليومي للنشر عبر الواجهة',
  spam_risk_user_banned_from_posting: 'الحساب مقيّد من النشر لدى TikTok',
  reached_active_user_cap: 'بلغ التطبيق الحد اليومي للمستخدمين النشطين',
  unaudited_client_can_only_post_to_private_accounts: 'التطبيق غير معتمد بعد: لا يمكنه النشر إلا بخصوصية «أنا فقط»',
  url_ownership_unverified: 'نطاق رابط الملف غير موثَّق في TikTok for Developers',
  privacy_level_option_mismatch: 'خيار الخصوصية غير متاح لهذا الحساب',
  invalid_file_upload: 'ملف غير صالح أو تعذّر رفعه',
  invalid_param: 'معامل غير صالح في الطلب',
  duration_check_failed: 'مدة الفيديو غير مسموحة لهذا الحساب',
  picture_size_check_failed: 'حجم أو أبعاد الصورة غير مسموحة',
  file_format_check_failed: 'صيغة الملف غير مدعومة',
  internal_error: 'خطأ داخلي لدى TikTok',
};
