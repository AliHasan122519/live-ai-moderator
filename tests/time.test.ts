import { describe, expect, it } from 'vitest';
import { parseArabicTime } from '../src/ai/time.js';

// الآن = الأحد 2026-11-01 الساعة 13:00 بتوقيت الرياض
const NOW = new Date('2026-11-01T10:00:00Z');
const at = (s: string) => { const r = parseArabicTime(s, NOW); if (!r.ok) throw new Error(`${s}: ${r.reason}`); return r.at.toISOString(); };

describe('تحليل التوقيت العربي (Asia/Riyadh)', () => {
  it('المثال المطلوب: غداً الساعة 8 مساءً', () => {
    expect(at('انشر هذا الفيديو غداً الساعة 8 مساءً')).toBe('2026-11-02T17:00:00.000Z'); // 20:00 الرياض
    expect(at('بكرة الساعة ٨ مساء')).toBe('2026-11-02T17:00:00.000Z');
  });
  it('صباحاً، ظهراً، ليلاً، نصف وربع', () => {
    expect(at('بكرا الساعة 9 صباحا')).toBe('2026-11-02T06:00:00.000Z');
    expect(at('بكرة 12 ظهرا')).toBe('2026-11-02T09:00:00.000Z');
    expect(at('بكرة الساعة 12 ليلا')).toBe('2026-11-01T21:00:00.000Z'); // منتصف ليل الرياض
    expect(at('بكرة الساعة 8 ونص مساء')).toBe('2026-11-02T17:30:00.000Z');
    expect(at('بكرة الساعة 8 الا ربع مساء')).toBe('2026-11-02T16:45:00.000Z');
    expect(at('بكرة الساعة ثمانية وربع مساء')).toBe('2026-11-02T17:15:00.000Z');
    expect(at('بعد بكرة الساعة 6 عصرا')).toBe('2026-11-03T15:00:00.000Z');
  });
  it('اليوم والليلة وأسماء الأيام', () => {
    expect(at('اليوم الساعة 9 مساء')).toBe('2026-11-01T18:00:00.000Z');
    expect(at('الليلة الساعة 11')).toBe('2026-11-01T20:00:00.000Z');
    expect(at('يوم الجمعة الساعة 7 مساء')).toBe('2026-11-06T16:00:00.000Z');
    expect(at('الأحد الساعة 8 مساء')).toBe('2026-11-01T17:00:00.000Z'); // اليوم نفسه ما زال مستقبلاً
    expect(at('الأحد الساعة 8 صباحا')).toBe('2026-11-08T05:00:00.000Z'); // فات اليوم ⇒ الأسبوع القادم
  });
  it('نسبي وISO وصيغة 24 ساعة', () => {
    expect(at('بعد ساعتين')).toBe('2026-11-01T12:00:00.000Z');
    expect(at('بعد 30 دقيقة')).toBe('2026-11-01T10:30:00.000Z');
    expect(at('بعد نص ساعة')).toBe('2026-11-01T10:30:00.000Z');
    expect(at('بعد ثلاث ساعات')).toBe('2026-11-01T13:00:00.000Z');
    expect(at('2026-11-05T20:00:00')).toBe('2026-11-05T17:00:00.000Z');
    expect(at('بكرة الساعة 20:30')).toBe('2026-11-02T17:30:00.000Z');
  });
  it('الغموض والماضي يُرفضان بدل التخمين', () => {
    expect(parseArabicTime('بكرة الساعة 8', NOW)).toMatchObject({ ok: false, reason: 'period_needed' });
    expect(parseArabicTime('الساعة 8 مساء', NOW)).toMatchObject({ ok: false, reason: 'day_needed' });
    expect(parseArabicTime('بكرة', NOW)).toMatchObject({ ok: false, reason: 'time_needed' });
    expect(parseArabicTime('اليوم الساعة 8 صباحا', NOW)).toMatchObject({ ok: false, reason: 'past' });
    expect(parseArabicTime('2020-01-01T10:00:00', NOW)).toMatchObject({ ok: false, reason: 'past' });
  });
});
