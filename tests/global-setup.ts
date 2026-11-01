import { execSync } from 'node:child_process';

// يجهّز قاعدة اختبار منفصلة ويطبّق الهجرات عليها. يتطلب Postgres يعمل (انظر README).
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/tiktok_publisher_test';
  const u = new URL(url);
  const name = u.pathname.slice(1);
  const admin = new URL(url); admin.pathname = '/postgres';
  try { execSync(`psql "${admin.toString()}" -tc "SELECT 1 FROM pg_database WHERE datname='${name}'" | grep -q 1 || psql "${admin.toString()}" -c "CREATE DATABASE ${name}"`, { stdio: 'pipe', shell: '/bin/bash' }); }
  catch (e) { throw new Error('تعذّر الوصول إلى Postgres للاختبارات: ' + (e as Error).message); }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
