import type { Prisma, TikTokAccount } from '@prisma/client';
import type { Config } from '../config/index.js';
import { audit, type Db } from '../db/index.js';
import { decryptSecret, encryptSecret, pkcePair, randomToken } from '../crypto/index.js';
import { TikTokClient, type CreatorInfo, type TokenResponse } from './client.js';
import { TikTokApiError } from './errors.js';

const STATE_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 5 * 60_000;

export class AccountError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** يحتاج على الأقل قراءة الملف الأساسي + أحد صلاحيتي الرفع/النشر. */
export function hasMinimumScopes(granted: string[]): boolean {
  return granted.includes('user.info.basic') && (granted.includes('video.upload') || granted.includes('video.publish'));
}

export class AccountService {
  constructor(private db: Db, private cfg: Config, private api: TikTokClient, private now: () => Date = () => new Date()) {}

  async startConnect(): Promise<{ url: string }> {
    const state = randomToken(24);
    const pk = pkcePair();
    await this.db.oAuthState.create({ data: { state, codeVerifier: pk.verifier, expiresAt: new Date(this.now().getTime() + STATE_TTL_MS) } });
    await this.db.oAuthState.deleteMany({ where: { expiresAt: { lt: this.now() } } });
    return { url: this.api.buildAuthUrl({ state, scopes: this.cfg.scopes }) };
  }

  async handleCallback(q: { code?: string; state?: string; error?: string; error_description?: string }): Promise<TikTokAccount> {
    if (q.error) throw new AccountError('denied', `رفض المستخدم أو TikTok الربط: ${q.error_description ?? q.error}`);
    if (!q.code || !q.state) throw new AccountError('bad_callback', 'استجابة ربط ناقصة');
    // الحالة تُستهلك مرة واحدة (حذف ذرّي) — تمنع CSRF وإعادة الاستخدام
    const del = await this.db.oAuthState.deleteMany({ where: { state: q.state, expiresAt: { gt: this.now() } } });
    if (del.count !== 1) throw new AccountError('bad_state', 'طلب الربط غير صالح أو منتهي. ابدأ الربط من جديد');

    let tok: TokenResponse;
    try { tok = await this.api.exchangeCode(q.code); }
    catch (e) { throw new AccountError('exchange_failed', e instanceof TikTokApiError ? `فشل تبادل الرمز: ${e.message}` : 'فشل تبادل الرمز'); }
    const granted = tok.scope.split(',').map((s) => s.trim()).filter(Boolean);
    if (!hasMinimumScopes(granted)) {
      await this.api.revoke(tok.access_token).catch(() => {});
      throw new AccountError('insufficient_scopes', `الصلاحيات الممنوحة غير كافية (${granted.join(', ') || 'لا شيء'}). المطلوب user.info.basic وvideo.upload أو video.publish`);
    }
    const user = await this.api.userInfo(tok.access_token);
    let creator: CreatorInfo | null = null;
    try { creator = await this.api.creatorInfo(tok.access_token); } catch { /* يُحدَّث لاحقاً */ }

    const nowD = this.now();
    const data = {
      displayName: user.display_name, username: creator?.creator_username ?? user.username ?? null, avatarUrl: user.avatar_url ?? creator?.creator_avatar_url ?? null,
      scopes: granted,
      accessTokenEnc: encryptSecret(tok.access_token, this.cfg.TOKEN_ENC_KEY), refreshTokenEnc: encryptSecret(tok.refresh_token, this.cfg.TOKEN_ENC_KEY),
      accessExpiresAt: new Date(nowD.getTime() + tok.expires_in * 1000), refreshExpiresAt: new Date(nowD.getTime() + tok.refresh_expires_in * 1000),
      creatorInfo: (creator ?? undefined) as Prisma.InputJsonValue | undefined, creatorInfoAt: creator ? nowD : null, status: 'ACTIVE' as const,
    };
    const acc = await this.db.tikTokAccount.upsert({ where: { openId: tok.open_id }, create: { openId: tok.open_id, ...data }, update: data });
    await audit(this.db, 'owner', 'account.connected', acc.id, { scopes: granted });
    return acc;
  }

  /** رمز وصول صالح؛ يجدّد تلقائياً قبل الانتهاء. لا يُرجَع الرمز إلا داخل الخادم. */
  async accessToken(accountId: string): Promise<string> {
    const acc = await this.db.tikTokAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (acc.status !== 'ACTIVE') throw new AccountError('not_active', 'الحساب غير مربوط حالياً. أعد الربط');
    if (acc.accessExpiresAt.getTime() - this.now().getTime() > REFRESH_SKEW_MS) return decryptSecret(acc.accessTokenEnc, this.cfg.TOKEN_ENC_KEY);
    if (acc.refreshExpiresAt <= this.now()) { await this.markReauth(acc.id); throw new AccountError('reauth', 'انتهى الربط. أعد ربط الحساب'); }

    const oldRefresh = decryptSecret(acc.refreshTokenEnc, this.cfg.TOKEN_ENC_KEY);
    let tok: TokenResponse;
    try { tok = await this.api.refresh(oldRefresh); }
    catch (e) {
      // قد يكون سباقاً: عملية أخرى جدّدت للتو وأبطلت القديم. نعيد قراءة الحساب قبل الحكم.
      const again = await this.db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } });
      if (again.refreshTokenEnc !== acc.refreshTokenEnc && again.accessExpiresAt.getTime() - this.now().getTime() > REFRESH_SKEW_MS) return decryptSecret(again.accessTokenEnc, this.cfg.TOKEN_ENC_KEY);
      if (e instanceof TikTokApiError && (e.code === 'invalid_grant' || e.httpStatus === 400 || e.httpStatus === 401)) { await this.markReauth(acc.id); throw new AccountError('reauth', 'تعذّر تجديد الربط. أعد ربط الحساب'); }
      throw e;
    }
    const nowD = this.now();
    // تحديث مشروط برمز التحديث القديم: يمنع تجديدين متزامنين من الكتابة فوق بعضهما
    const upd = await this.db.tikTokAccount.updateMany({
      where: { id: acc.id, refreshTokenEnc: acc.refreshTokenEnc },
      data: {
        accessTokenEnc: encryptSecret(tok.access_token, this.cfg.TOKEN_ENC_KEY), refreshTokenEnc: encryptSecret(tok.refresh_token, this.cfg.TOKEN_ENC_KEY),
        accessExpiresAt: new Date(nowD.getTime() + tok.expires_in * 1000), refreshExpiresAt: new Date(nowD.getTime() + tok.refresh_expires_in * 1000),
      },
    });
    if (upd.count !== 1) { const again = await this.db.tikTokAccount.findUniqueOrThrow({ where: { id: acc.id } }); return decryptSecret(again.accessTokenEnc, this.cfg.TOKEN_ENC_KEY); }
    return tok.access_token;
  }

  private async markReauth(id: string) {
    await this.db.tikTokAccount.update({ where: { id }, data: { status: 'NEEDS_REAUTH' } });
    await audit(this.db, 'system', 'account.needs_reauth', id);
  }

  /** تحديث إعدادات النشر المسموحة (الخصوصية، التعليقات...) — مطلوب عرضها قبل كل نشر. */
  async refreshCreatorInfo(accountId: string): Promise<CreatorInfo> {
    const token = await this.accessToken(accountId);
    const info = await this.api.creatorInfo(token);
    await this.db.tikTokAccount.update({ where: { id: accountId }, data: { creatorInfo: info as unknown as Prisma.InputJsonValue, creatorInfoAt: this.now() } });
    return info;
  }

  async disconnect(accountId: string): Promise<void> {
    const acc = await this.db.tikTokAccount.findUniqueOrThrow({ where: { id: accountId } });
    let revoked = true;
    try { await this.api.revoke(decryptSecret(acc.accessTokenEnc, this.cfg.TOKEN_ENC_KEY)); } catch { revoked = false; }
    // نمسح الرموز محلياً في كل الأحوال حتى لو فشل الإبطال لدى TikTok
    await this.db.tikTokAccount.update({ where: { id: accountId }, data: { status: 'REVOKED', accessTokenEnc: 'revoked', refreshTokenEnc: 'revoked' } });
    await audit(this.db, 'owner', 'account.disconnected', accountId, { revokedAtTikTok: revoked });
  }

  /** عرض آمن للواجهة: بلا أي رموز. */
  static publicView(a: TikTokAccount) {
    const { accessTokenEnc: _a, refreshTokenEnc: _r, ...rest } = a;
    return rest;
  }
}
