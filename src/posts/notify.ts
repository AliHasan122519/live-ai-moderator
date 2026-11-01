import type { Db } from '../db/index.js';
import { audit } from '../db/index.js';

export interface Notifier { notify(kind: 'publish_failed' | 'publish_unknown' | 'publish_complete' | 'schedule_missed' | 'reauth_needed', postId: string, message: string): Promise<void> }

/** تنبيه = سجل تدقيق دائم + (اختياري) POST نصي إلى NOTIFY_WEBHOOK_URL (متوافق مع ntfy.sh ونحوه). فشل الإرسال لا يكسر النشر. */
export class DbNotifier implements Notifier {
  constructor(private db: Db, private webhookUrl = '', private f: typeof fetch = fetch) {}
  async notify(kind: string, postId: string, message: string) {
    await audit(this.db, 'system', `notify.${kind}`, postId, { message });
    if (!this.webhookUrl) return;
    try { await this.f(this.webhookUrl, { method: 'POST', body: `[${kind}] ${message}`, signal: AbortSignal.timeout(5000) }); } catch { /* تنبيه ثانوي */ }
  }
}
