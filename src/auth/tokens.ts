import { randomToken, sha256Hex } from '../crypto/index.js';
import { audit, type Db } from '../db/index.js';
import { isScope, type Scope } from './scopes.js';

export interface Principal { kind: 'owner' | 'token'; id: string; name: string; scopes: Set<Scope> }

export async function createApiToken(db: Db, name: string, scopes: string[]): Promise<{ id: string; token: string }> {
  const bad = scopes.filter((s) => !isScope(s));
  if (bad.length || !scopes.length) throw new Error(`صلاحيات غير صالحة: ${bad.join(', ') || '(فارغة)'}`);
  const token = `tpk_${randomToken(32)}`;
  const row = await db.apiToken.create({ data: { name, tokenHash: sha256Hex(token), scopes } });
  await audit(db, 'owner', 'token.created', row.id, { name, scopes });
  return { id: row.id, token }; // الرمز الصريح يُعرض هنا مرة واحدة فقط ولا يُخزَّن
}

export async function authenticateToken(db: Db, bearer: string): Promise<Principal | null> {
  if (!bearer.startsWith('tpk_')) return null;
  const row = await db.apiToken.findUnique({ where: { tokenHash: sha256Hex(bearer) } });
  if (!row || row.revokedAt) return null;
  void db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { kind: 'token', id: row.id, name: row.name, scopes: new Set(row.scopes.filter(isScope)) };
}
