import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { createDb } from './db/index.js';
import { hashPassword } from './crypto/index.js';
import { createApiToken } from './auth/tokens.js';
import { ALL_SCOPES, DEFAULT_MCP_SCOPES } from './auth/scopes.js';

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'gen-keys':
    console.log(`TOKEN_ENC_KEY=${randomBytes(32).toString('base64')}\nSESSION_SECRET=${randomBytes(48).toString('base64')}`);
    break;
  case 'hash-password': {
    let pw = args[0];
    if (!pw) { const rl = createInterface({ input: process.stdin, output: process.stdout }); pw = await rl.question('كلمة المرور الجديدة: '); rl.close(); }
    if (pw.length < 10) { console.error('كلمة المرور قصيرة (10 أحرف على الأقل)'); process.exit(1); }
    console.log(`OWNER_PASSWORD_HASH='${await hashPassword(pw)}'`);
    break;
  }
  case 'create-token': {
    const [name, scopeArg] = args;
    if (!name) { console.error(`الاستخدام: create-token <اسم> [صلاحيات مفصولة بفواصل]\nالمتاحة: ${ALL_SCOPES.join(', ')}\nالافتراضي لـMCP: ${DEFAULT_MCP_SCOPES.join(',')} (بلا post:approve عمداً)`); process.exit(1); }
    const db = createDb();
    const { token } = await createApiToken(db, name, scopeArg ? scopeArg.split(',') : DEFAULT_MCP_SCOPES);
    console.log(`MCP_API_TOKEN=${token}\n(يظهر مرة واحدة فقط — احفظه الآن)`);
    await db.$disconnect();
    break;
  }
  default:
    console.log('الأوامر: gen-keys | hash-password [كلمة] | create-token <اسم> [صلاحيات]');
}
