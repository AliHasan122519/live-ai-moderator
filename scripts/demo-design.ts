// تجربة محلية: يرسم تصميماً عربياً كما سيفعل Claude، ويركّب فيديو من شرائح، ويحفظ النتائج للمعاينة.
import { writeFile } from 'node:fs/promises';
import { closeRenderer, renderHtmlToJpeg } from '../src/media/render.js';
import { makeSlideshow } from '../src/media/slideshow.js';

const out = process.argv[2] ?? '.';
process.env.CHROMIUM_PATH ??= '/opt/pw-browsers/chromium';
const slide = (kicker: string, title: string, sub: string, a: string, b: string) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1080px;height:1920px;background:linear-gradient(160deg,${a},${b});color:#fff;font-family:'Noto Sans Arabic',Tahoma,'DejaVu Sans',sans-serif;display:flex;flex-direction:column;justify-content:center;padding:160px 90px;gap:48px;position:relative;overflow:hidden}
  .blob{position:absolute;width:760px;height:760px;border-radius:50%;background:rgba(255,255,255,.08);inset-inline-start:-240px;top:-160px}
  .k{font-size:44px;letter-spacing:.04em;opacity:.85;border-inline-start:8px solid #25f4ee;padding-inline-start:24px}
  h1{font-size:128px;line-height:1.35;font-weight:800}
  p{font-size:56px;line-height:1.6;opacity:.92}
  .tag{margin-top:40px;display:inline-block;background:#fe2c55;padding:22px 44px;border-radius:999px;font-size:46px;font-weight:700;align-self:flex-start}
</style></head><body><div class="blob"></div><div class="k">${kicker}</div><h1>${title}</h1><p>${sub}</p><span class="tag">تابعنا للمزيد</span></body></html>`;

const slides = [
  slide('تقنية في دقيقة', 'الذكاء الاصطناعي يوفّر وقتك', 'ثلاث طرق عملية تبدأ بها اليوم', '#0f2027', '#2c5364'),
  slide('الطريقة الأولى', 'لخّص بدل أن تقرأ كل شيء', 'اطلب ملخصاً بنقاط قصيرة ثم تعمّق فيما يهمك', '#41295a', '#2f0743'),
  slide('الطريقة الثانية', 'اترك المهام المتكررة له', 'القوالب والردود والجداول تُنجَز في ثوانٍ', '#134e5e', '#71b280'),
];
const jpegs: Buffer[] = [];
for (const [i, h] of slides.entries()) { const j = await renderHtmlToJpeg(h); jpegs.push(j); await writeFile(`${out}/slide${i + 1}.jpg`, j); }
await writeFile(`${out}/demo.mp4`, await makeSlideshow(jpegs, { secondsPerSlide: 2.5 }));
await closeRenderer();
console.log('ok');
