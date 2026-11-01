import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { assertKey, type Storage } from './types.js';

export class LocalStorage implements Storage {
  private root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  private path(key: string) {
    assertKey(key);
    const p = join(this.root, key);
    if (!p.startsWith(this.root + '/')) throw new Error('مسار خارج مجلد التخزين');
    return p;
  }
  async put(key: string, body: Readable | Buffer, _mime?: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(body instanceof Buffer ? Readable.from([body]) : body, createWriteStream(p, { mode: 0o600 }));
  }
  async get(key: string, range?: { start: number; end: number }) { return createReadStream(this.path(key), range); }
  async stat(key: string) {
    try { return { size: (await stat(this.path(key))).size }; } catch { return null; }
  }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}
