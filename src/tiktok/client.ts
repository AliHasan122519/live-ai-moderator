import { TikTokApiError } from './errors.js';

export interface TikTokClientOpts {
  baseUrl: string; authUrl: string; clientKey: string; clientSecret: string; redirectUri: string;
  fetchImpl?: typeof fetch; timeoutMs?: number;
}

export interface TokenResponse {
  access_token: string; expires_in: number; open_id: string; refresh_expires_in: number;
  refresh_token: string; scope: string; token_type: string;
}
export interface CreatorInfo {
  creator_avatar_url?: string; creator_username?: string; creator_nickname?: string;
  privacy_level_options: string[]; comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}
export type PublishStatus = 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
export interface StatusData { status: PublishStatus; fail_reason?: string; postIds: string[]; uploaded_bytes?: number }
export interface InitResult { publish_id: string; upload_url?: string }

export interface PostInfo {
  title?: string; description?: string; privacy_level?: string;
  disable_duet?: boolean; disable_comment?: boolean; disable_stitch?: boolean;
  video_cover_timestamp_ms?: number; brand_content_toggle?: boolean; brand_organic_toggle?: boolean;
  is_aigc?: boolean; auto_add_music?: boolean;
}

/**
 * عميل Content Posting API الرسمي + OAuth. لا منطق أعمال هنا: كل دالة = استدعاء واحد.
 * جميع الأشكال مبنية على معرفتي بالوثائق الرسمية ولم تُختبر مقابل خوادم TikTok الحقيقية (غير متاحة لهذه الجلسة).
 */
export class TikTokClient {
  private f: typeof fetch;
  constructor(private o: TikTokClientOpts) { this.f = o.fetchImpl ?? fetch; }

  buildAuthUrl(args: { state: string; scopes: string[]; codeChallenge?: string }): string {
    const u = new URL(this.o.authUrl);
    u.searchParams.set('client_key', this.o.clientKey);
    u.searchParams.set('scope', args.scopes.join(','));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.o.redirectUri);
    u.searchParams.set('state', args.state);
    if (args.codeChallenge) { u.searchParams.set('code_challenge', args.codeChallenge); u.searchParams.set('code_challenge_method', 'S256'); }
    return u.toString();
  }

  private async req(path: string, init: RequestInit & { token?: string; json?: unknown; form?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let body: string | undefined;
    if (init.json !== undefined) { headers['content-type'] = 'application/json; charset=UTF-8'; body = JSON.stringify(init.json); }
    if (init.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(init.form).toString(); }
    let res: Response;
    try {
      res = await this.f(this.o.baseUrl + path, { method: init.method ?? 'POST', headers, body, signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000) });
    } catch (e) {
      throw new TikTokApiError('network_error', `تعذّر الاتصال بـTikTok: ${(e as Error).message}`, 0);
    }
    const text = await res.text();
    let j: Record<string, any> = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* غير JSON */ }
    // نمطان للأخطاء: غلاف {error:{code,message,log_id}} أو OAuth {error,error_description}
    const env = j.error;
    if (env && typeof env === 'object' && env.code && env.code !== 'ok') throw new TikTokApiError(env.code, env.message ?? env.code, res.status, env.log_id);
    if (typeof env === 'string') throw new TikTokApiError(env, j.error_description ?? env, res.status, j.log_id);
    if (!res.ok) throw new TikTokApiError(`http_${res.status}`, `HTTP ${res.status}`, res.status);
    return j;
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const form: Record<string, string> = {
      client_key: this.o.clientKey, client_secret: this.o.clientSecret, code, grant_type: 'authorization_code', redirect_uri: this.o.redirectUri,
    };
    if (codeVerifier) form.code_verifier = codeVerifier;
    return (await this.req('/v2/oauth/token/', { form })) as unknown as TokenResponse;
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    return (await this.req('/v2/oauth/token/', {
      form: { client_key: this.o.clientKey, client_secret: this.o.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken },
    })) as unknown as TokenResponse;
  }

  async revoke(token: string): Promise<void> {
    await this.req('/v2/oauth/revoke/', { form: { client_key: this.o.clientKey, client_secret: this.o.clientSecret, token } });
  }

  async userInfo(token: string): Promise<{ open_id: string; display_name: string; avatar_url?: string; username?: string }> {
    const j = await this.req('/v2/user/info/?fields=open_id,avatar_url,display_name', { method: 'GET', token });
    return j.data.user;
  }

  async creatorInfo(token: string): Promise<CreatorInfo> {
    return (await this.req('/v2/post/publish/creator_info/query/', { token, json: {} })).data;
  }

  async initVideo(token: string, args: { mode: 'DIRECT' | 'DRAFT_INBOX'; postInfo?: PostInfo; videoSize: number; chunkSize: number; totalChunks: number }): Promise<InitResult> {
    const source_info = { source: 'FILE_UPLOAD', video_size: args.videoSize, chunk_size: args.chunkSize, total_chunk_count: args.totalChunks };
    const path = args.mode === 'DIRECT' ? '/v2/post/publish/video/init/' : '/v2/post/publish/inbox/video/init/';
    const json = args.mode === 'DIRECT' ? { post_info: args.postInfo, source_info } : { source_info };
    return (await this.req(path, { token, json })).data;
  }

  async initPhoto(token: string, args: { mode: 'DIRECT' | 'DRAFT_INBOX'; postInfo: PostInfo; imageUrls: string[]; coverIndex: number }): Promise<InitResult> {
    return (await this.req('/v2/post/publish/content/init/', {
      token,
      json: {
        post_info: args.postInfo,
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: args.coverIndex, photo_images: args.imageUrls },
        post_mode: args.mode === 'DIRECT' ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
      },
    })).data;
  }

  /** رفع قطعة واحدة. لا يُرسَل Bearer إلى upload_url (رابط موقّع مسبقاً). */
  async uploadChunk(uploadUrl: string, chunk: Buffer, range: { start: number; end: number; total: number }, mime: string): Promise<void> {
    let res: Response;
    try {
      res = await this.f(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': mime, 'content-length': String(chunk.length), 'content-range': `bytes ${range.start}-${range.end}/${range.total}` },
        body: new Uint8Array(chunk), signal: AbortSignal.timeout(this.o.timeoutMs ? this.o.timeoutMs * 4 : 120_000),
      });
    } catch (e) { throw new TikTokApiError('network_error', `فشل رفع القطعة: ${(e as Error).message}`, 0); }
    if (res.status !== 201 && res.status !== 206 && res.status !== 200) {
      throw new TikTokApiError('upload_failed', `رفض TikTok القطعة (HTTP ${res.status})`, res.status);
    }
  }

  async status(token: string, publishId: string): Promise<StatusData> {
    const d = (await this.req('/v2/post/publish/status/fetch/', { token, json: { publish_id: publishId } })).data;
    // الاسم في الوثائق يحوي خطأ إملائياً (publicaly_…)؛ ندعم الصيغتين.
    const ids = d.publicaly_available_post_id ?? d.publicly_available_post_id ?? [];
    return { status: d.status, fail_reason: d.fail_reason, postIds: ids.map(String), uploaded_bytes: d.uploaded_bytes };
  }
}
