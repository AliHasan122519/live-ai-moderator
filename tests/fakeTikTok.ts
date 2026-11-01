// خادم TikTok وهمي لاختبار عميلنا ومنطقنا. يطبّق العقد كما أعرفه من الوثائق (غير مُتحقَّق من الحية):
// قواعد القطع، رفض الخصوصية العامة لتطبيق غير معتمد، سحب الصور فعلياً من روابطنا، وتدرّج حالات النشر.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

type Json = Record<string, any>;
interface Pub { id: string; kind: 'video' | 'inbox' | 'photo'; size?: number; chunk?: number; total?: number; got: number; polls: number; body: Json }

export class FakeTikTok {
  server!: http.Server; base = '';
  requests: Array<{ method: string; path: string; body: any; auth?: string }> = [];
  pubs = new Map<string, Pub>();
  validAccess = new Set<string>(); validRefresh = new Set<string>();
  audited = false; privacyOptions = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS'];
  grantedScope = 'user.info.basic,video.upload,video.publish';
  pollsUntilDone = 2; finalStatus: 'PUBLISH_COMPLETE' | 'FAILED' | 'SEND_TO_USER_INBOX' = 'PUBLISH_COMPLETE';
  injected: Array<{ path: string; status: number; body: Json; once: boolean }> = [];
  issued = 0; refreshCalls = 0; revoked: string[] = [];

  injectError(path: string, status: number, body: Json, once = true) { this.injected.push({ path, status, body, once }); }
  hits(path: string) { return this.requests.filter((r) => r.path === path); }

  async start() {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  stop() { return new Promise<void>((r) => { this.server.closeAllConnections?.(); this.server.close(() => r()); }); }

  private issue(): Json {
    this.issued++;
    const a = `act.${randomUUID()}`, r = `rft.${randomUUID()}`;
    this.validAccess.add(a); this.validRefresh.add(r);
    return { access_token: a, expires_in: 86400, open_id: 'open-abc', refresh_expires_in: 31536000, refresh_token: r, scope: this.grantedScope, token_type: 'Bearer' };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, this.base); const path = url.pathname;
    const ct = req.headers['content-type'] ?? '';
    let body: any = raw;
    if (ct.includes('json')) body = JSON.parse(raw.toString() || '{}');
    else if (ct.includes('urlencoded')) body = Object.fromEntries(new URLSearchParams(raw.toString()));
    const auth = req.headers.authorization?.replace('Bearer ', '');
    this.requests.push({ method: req.method!, path, body: Buffer.isBuffer(body) ? `<${body.length} bytes>` : body, auth });
    const send = (status: number, j: Json, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(j)); };
    const err = (status: number, code: string, message = code) => send(status, { data: {}, error: { code, message, log_id: 'log-' + randomUUID().slice(0, 6) } });

    const inj = this.injected.findIndex((i) => i.path === path);
    if (inj >= 0) { const i = this.injected[inj]!; if (i.once) this.injected.splice(inj, 1); return send(i.status, i.body); }

    if (path === '/v2/oauth/token/') {
      if (body.client_key !== 'ck_test' || body.client_secret !== 'cs_test') return send(401, { error: 'invalid_client', error_description: 'bad client' });
      if (body.grant_type === 'authorization_code') {
        if (body.code !== 'good-code') return send(400, { error: 'invalid_grant', error_description: 'bad code' });
        return send(200, this.issue());
      }
      if (body.grant_type === 'refresh_token') {
        this.refreshCalls++;
        if (!this.validRefresh.has(body.refresh_token)) return send(400, { error: 'invalid_grant', error_description: 'refresh invalid' });
        this.validRefresh.delete(body.refresh_token); // تدوير: القديم يبطل
        return send(200, this.issue());
      }
    }
    if (path === '/v2/oauth/revoke/') { this.revoked.push(body.token); this.validAccess.delete(body.token); return send(200, {}); }

    // كل ما يلي يتطلب رمز وصول صالحاً
    if (!auth || !this.validAccess.has(auth)) return err(401, 'access_token_invalid', 'token invalid');

    if (path === '/v2/user/info/') return send(200, { data: { user: { open_id: 'open-abc', display_name: 'حساب تجريبي', avatar_url: 'https://example.invalid/a.jpg' } }, error: { code: 'ok', message: '', log_id: 'x' } });
    if (path === '/v2/post/publish/creator_info/query/') {
      return send(200, { data: { creator_username: 'demo_user', creator_nickname: 'حساب تجريبي', creator_avatar_url: 'https://example.invalid/a.jpg', privacy_level_options: this.privacyOptions, comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600 }, error: { code: 'ok', message: '', log_id: 'x' } });
    }
    const ok = (data: Json) => send(200, { data, error: { code: 'ok', message: '', log_id: 'x' } });

    if (path === '/v2/post/publish/video/init/' || path === '/v2/post/publish/inbox/video/init/') {
      const direct = path === '/v2/post/publish/video/init/';
      const s = body.source_info ?? {};
      if (s.source !== 'FILE_UPLOAD') return err(400, 'invalid_param', 'source');
      const { video_size: size, chunk_size: chunk, total_chunk_count: total } = s;
      if (!(size > 0) || !(chunk > 0) || !(total >= 1)) return err(400, 'invalid_param', 'sizes');
      if (size < 5 * 1024 ** 2) { if (total !== 1 || chunk !== size) return err(400, 'invalid_param', 'small videos must be one chunk'); }
      else {
        if (chunk < 5 * 1024 ** 2 || chunk > 64 * 1024 ** 2) return err(400, 'invalid_param', 'chunk_size range');
        if (total !== Math.floor(size / chunk)) return err(400, 'invalid_param', 'total_chunk_count mismatch');
      }
      if (direct) {
        const p = body.post_info ?? {};
        if (!this.privacyOptions.includes(p.privacy_level)) return err(400, 'privacy_level_option_mismatch');
        if (!this.audited && p.privacy_level !== 'SELF_ONLY') return err(403, 'unaudited_client_can_only_post_to_private_accounts');
        if (p.title && p.title.length > 2200) return err(400, 'invalid_param', 'title too long');
      }
      const id = `v_pub_${randomUUID()}`;
      this.pubs.set(id, { id, kind: direct ? 'video' : 'inbox', size, chunk, total, got: 0, polls: 0, body });
      return ok({ publish_id: id, upload_url: `${this.base}/upload/${id}` });
    }

    if (path === '/v2/post/publish/content/init/') {
      const s = body.source_info ?? {}; const p = body.post_info ?? {};
      if (s.source !== 'PULL_FROM_URL' || body.media_type !== 'PHOTO') return err(400, 'invalid_param', 'photo source');
      const imgs: string[] = s.photo_images ?? [];
      if (imgs.length < 1 || imgs.length > 35) return err(400, 'invalid_param', 'photo count');
      if (!(s.photo_cover_index >= 0 && s.photo_cover_index < imgs.length)) return err(400, 'invalid_param', 'cover index');
      if (body.post_mode === 'DIRECT_POST') {
        if (!this.privacyOptions.includes(p.privacy_level)) return err(400, 'privacy_level_option_mismatch');
        if (!this.audited && p.privacy_level !== 'SELF_ONLY') return err(403, 'unaudited_client_can_only_post_to_private_accounts');
      }
      if (p.title && p.title.length > 90) return err(400, 'invalid_param', 'photo title max 90');
      for (const u of imgs) { // TikTok تسحب الصور بنفسها: نحاكي ذلك لإثبات أن روابطنا قابلة للسحب
        let r: Response; try { r = await fetch(u); } catch { return err(400, 'url_ownership_unverified', 'cannot fetch ' + u); }
        if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return err(400, 'url_ownership_unverified', `fetch ${r.status}`);
        await r.arrayBuffer();
      }
      const id = `p_pub_${randomUUID()}`;
      this.pubs.set(id, { id, kind: 'photo', got: 0, polls: 0, body });
      return ok({ publish_id: id });
    }

    if (path === '/v2/post/publish/status/fetch/') {
      const pub = this.pubs.get(body.publish_id);
      if (!pub) return err(400, 'invalid_publish_id');
      pub.polls++;
      if (pub.kind !== 'photo' && pub.got < (pub.size ?? 0)) return ok({ status: 'PROCESSING_UPLOAD', uploaded_bytes: pub.got });
      if (pub.polls <= this.pollsUntilDone) return ok({ status: pub.kind === 'photo' ? 'PROCESSING_DOWNLOAD' : 'PROCESSING_UPLOAD' });
      const final = pub.kind === 'inbox' ? 'SEND_TO_USER_INBOX' : this.finalStatus;
      if (final === 'FAILED') return ok({ status: 'FAILED', fail_reason: 'file_format_check_failed' });
      return ok({ status: final, publicaly_available_post_id: final === 'PUBLISH_COMPLETE' ? ['7300000000000000001'] : [] });
    }
    return err(404, 'not_found', path);
  }

  /** نقطة رفع القطع — تُعالَج في نفس الخادم تحت /upload/:id */
  static attachUpload(f: FakeTikTok) {
    const orig = f.server.listeners('request')[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void;
    f.server.removeAllListeners('request');
    f.server.on('request', async (req, res) => {
      if (req.method === 'PUT' && req.url?.startsWith('/upload/')) {
        const id = req.url.slice('/upload/'.length); const pub = f.pubs.get(id);
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
        const len = Buffer.concat(chunks).length;
        f.requests.push({ method: 'PUT', path: '/upload', body: `<${len} bytes> ${req.headers['content-range']}` });
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(req.headers['content-range'] ?? ''));
        if (!pub || !m || Number(m[1]) !== pub.got || Number(m[2]) - Number(m[1]) + 1 !== len || Number(m[3]) !== pub.size) { res.writeHead(416); return void res.end(); }
        pub.got += len;
        res.writeHead(pub.got >= (pub.size ?? 0) ? 201 : 206, { 'content-range': `bytes ${m[1]}-${m[2]}/${m[3]}` }); return void res.end();
      }
      orig(req, res);
    });
    return f;
  }
}
export const startFake = async () => FakeTikTok.attachUpload(await new FakeTikTok().start());
