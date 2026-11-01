// تحليل التوقيت العربي (اللهجة السعودية) إلى لحظة مطلقة بتوقيت Asia/Riyadh (UTC+3 ثابت بلا توقيت صيفي).
import { norm } from './arabic.js';

const OFFSET_MS = 3 * 3600_000;
const NUM: Record<string, number> = { واحد: 1, واحده: 1, اثنين: 2, اثنتين: 2, ثنتين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7,
  ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, احداشر: 11, اثناشر: 12, عشرين: 20, ثلاثين: 30 };
const NUMN = Object.fromEntries(Object.entries(NUM).map(([k, v]) => [norm(k), v]));
const DAYS: Record<string, number> = { الاحد: 0, الاثنين: 1, الثلاثاء: 2, الاربعاء: 3, الخميس: 4, الجمعه: 5, السبت: 6 };

export type TimeResult = { ok: true; at: Date; display: string } | { ok: false; reason: string; hint: string };
const bad = (reason: string, hint: string): TimeResult => ({ ok: false, reason, hint });

const fmt = (d: Date) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d) + ' (توقيت الرياض)';
const num = (w?: string) => (w === undefined ? undefined : /^\d+$/.test(w) ? Number(w) : NUMN[w]);

export function parseArabicTime(input: string, now: Date = new Date()): TimeResult {
  const raw = input.trim();
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (iso) {
    const d = new Date(iso[3] ? raw : `${raw}+03:00`);
    return Number.isNaN(d.getTime()) ? bad('invalid', 'صيغة التاريخ غير صالحة') : d.getTime() > now.getTime() ? { ok: true, at: d, display: fmt(d) } : bad('past', 'الموعد في الماضي');
  }
  const t = norm(raw);

  // نسبي: بعد ساعتين / بعد 30 دقيقة / بعد نص ساعة
  const rel = /بعد (?:(نص|نصف|ربع) )?(?:(\d+|[ا-ي]+) )?(دقيقه|دقيقتين|دقايق|دقائق|ساعه|ساعتين|ساعات|يوم|يومين|ايام|اسبوع|اسبوعين)(?! ?بعد)/.exec(t);
  if (rel && !/بعد (بكره|بكرا|غد|غدا)/.test(t)) {
    const [, frac, n, unit] = rel as unknown as [string, string | undefined, string | undefined, string];
    const unitMs = unit.startsWith('دقيق') || unit === 'دقايق' ? 60_000 : unit.startsWith('ساع') ? 3600_000 : unit.startsWith('يوم') || unit === 'ايام' ? 86_400_000 : 7 * 86_400_000;
    let count = unit.endsWith('تين') ? 2 : 1;
    if (frac) count = frac === 'ربع' ? 0.25 : 0.5; else if (n) { const v = num(n); if (v === undefined) return bad('bad_number', `ما فهمت الرقم «${n}»`); count = v; }
    const at = new Date(now.getTime() + count * unitMs);
    return { ok: true, at, display: fmt(at) };
  }

  // اليوم المستهدف
  const local = new Date(now.getTime() + OFFSET_MS); // نقرأ مكوّناتها بـgetUTC*
  let dayOffset: number | null = null; let weekday: number | null = null;
  if (/بعد (بكره|بكرا|غد|غدا)/.test(t)) dayOffset = 2;
  else if (/(^| )(بكره|بكرا|غدا|غد)( |$)/.test(t)) dayOffset = 1;
  else if (/(^| )(اليوم|الليله|الليلة)( |$)/.test(t)) dayOffset = 0;
  for (const [name, idx] of Object.entries(DAYS)) if (t.includes(norm(name)) || t.includes(norm(name).replace(/^ال/, ''))) weekday = idx;
  if (dayOffset === null && weekday === null) return bad('day_needed', 'حدد اليوم: اليوم، بكرة، بعد بكرة، أو اسم اليوم (مثلاً يوم الجمعة)');

  // الوقت
  const tm = /(?:الساعه )?(\d{1,2}|[ا-ي]+)(?::(\d{2}))?(?: (ونص|ونصف|الا ربع|وربع|و ?(\d{1,2}) دقيقه?|الا (\d{1,2})))?(?: (?:ب)?(مساء|مساءا|عصرا|عصر|العصر|عشاء|العشاء|ليلا|الليل|المغرب|مغرب|صباحا|الصباح|صبح|الصبح|فجرا|الفجر|ظهرا|الظهر|ضحي|الضحي))?(?= |$)/g;
  const afterSaa = t.includes('الساعه') ? t.slice(t.indexOf('الساعه')) : t;
  // أول رمز يُفهم كرقم/كلمة رقم (نتجاوز «بكرة» و«اليوم» وغيرها)
  const m = [...afterSaa.matchAll(tm)].find((x) => num(x[1]) !== undefined) ?? null;
  let hour = m ? num(m[1]) : undefined; let minute = m?.[2] ? Number(m[2]) : 0;
  if (!m || hour === undefined || hour > 24 || hour < 0) return bad('time_needed', 'حدد الساعة، مثلاً: الساعة 8 مساءً');
  const mod = m[3]; if (mod) { if (/ونص/.test(mod)) minute = 30; else if (/وربع/.test(mod)) minute = 15; else if (/الا ربع/.test(mod)) { minute = 45; hour = hour - 1; } else if (m[5]) { minute = 60 - Number(m[5]); hour = hour - 1; } else if (m[4]) minute = Number(m[4]); }
  const period = m[6];
  const pm = period && /مساء|عصر|عشاء|ليل|مغرب/.test(period); const am = period && /صباح|صبح|فجر|ضحي/.test(period); const noon = period && /ظهر/.test(period);
  if (period) {
    if (pm) { if (hour < 12) hour += 12; if (/ليل/.test(period) && hour === 12) hour = 0; if (/ليل/.test(period) && hour === 24) hour = 0; }
    else if (am) { if (hour === 12) hour = 0; }
    else if (noon) { if (hour >= 1 && hour <= 5) hour += 12; }
  } else if (/الليله/.test(t) && hour < 12) hour += 12;
  else if (hour <= 12 && !(hour === 0)) {
    return bad('period_needed', `الساعة ${m[1]} صباحاً أم مساءً؟ أعد الأمر مع «صباحاً» أو «مساءً»`);
  }
  hour = ((hour % 24) + 24) % 24;
  if (minute > 59) return bad('invalid', 'الدقائق غير صالحة');

  const build = (days: number) => new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hour! , minute) - OFFSET_MS);
  let at: Date;
  if (dayOffset !== null) at = build(dayOffset);
  else { const diff = (weekday! - local.getUTCDay() + 7) % 7; at = build(diff); if (at.getTime() <= now.getTime() + 60_000) at = build(diff + 7); }
  if (at.getTime() <= now.getTime() + 60_000) return bad('past', 'الموعد في الماضي أو خلال دقيقة');
  return { ok: true, at, display: fmt(at) };
}
