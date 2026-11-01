import { openAsBlob, realpathSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

export class ApiError extends Error { constructor(public status: number, message: string, public details?: string[]) { super(message); } }

/** عميل HTTP رفيع لـAPI المشروع. الرمز يبقى في بيئة عملية MCP ولا يمرّ عبر المحادثة. */
export class ApiClient {
  constructor(private base: string, private token: string, private f: typeof fetch = fetch) {
    if (!token) throw new Error('MCP_API_TOKEN مطلوب (أنشئه بـ npm run cli -- create-token mcp)');
  }
  async call<T = any>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const res = await this.f(this.base.replace(/\/$/, '') + path, {
      method, headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(10 * 60_000),
    });
    const text = await res.text(); let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
    if (!res.ok) throw new ApiError(res.status, j.message ?? `HTTP ${res.status}`, j.details);
    return j as T;
  }
  get = <T = any>(p: string) => this.call<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.call<T>('POST', p, b);
  patch = <T = any>(p: string, b: unknown) => this.call<T>('PATCH', p, b);

  /** رفع ملف محلي. مقيّد بمجلد مسموح (حماية من حقن أوامر يطلب رفع ملفات حساسة). */
  async uploadFile(filePath: string, allowedDir: string, source: 'CLAUDE_CODE' | 'AI_GENERATED' | 'UPLOAD', aiGenerated?: boolean) {
    if (!allowedDir) throw new ApiError(400, 'رفع الملفات المحلية معطّل: اضبط MCP_ALLOWED_DIR على مجلد المحتوى');
    let real: string, root: string;
    try { real = realpathSync(resolve(filePath)); root = realpathSync(resolve(allowedDir)); } catch { throw new ApiError(404, 'الملف أو المجلد غير موجود'); }
    if (real !== root && !real.startsWith(root + sep)) throw new ApiError(403, `المسار خارج المجلد المسموح (${allowedDir})`);
    const st = statSync(real);
    if (!st.isFile()) throw new ApiError(400, 'المسار ليس ملفاً');
    const fd = new FormData(); fd.append('file', await openAsBlob(real), basename(real));
    const q = new URLSearchParams({ source, ...(aiGenerated !== undefined ? { aiGenerated: String(aiGenerated) } : {}) });
    return this.call('POST', `/api/media?${q}`, undefined, fd);
  }
}
