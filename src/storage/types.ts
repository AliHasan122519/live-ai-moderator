import type { Readable } from 'node:stream';

export interface StoredObject { size: number }

export interface Storage {
  put(key: string, body: Readable | Buffer, mime: string): Promise<void>;
  /** قراءة كاملة أو نطاق بايتات [start,end] شاملة */
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  stat(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,200}$/;
export function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error('مفتاح تخزين غير صالح');
}
