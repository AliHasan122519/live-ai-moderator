import type { Config } from '../config/index.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { Storage } from './types.js';

export function createStorage(c: Config): Storage {
  return c.STORAGE_DRIVER === 's3' ? new S3Storage(c) : new LocalStorage(c.STORAGE_LOCAL_DIR);
}
export type { Storage } from './types.js';
