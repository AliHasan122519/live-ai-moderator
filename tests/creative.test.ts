import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { closeRenderer, renderHtmlToJpeg, RenderError } from '../src/media/render.js';
import { makeSlideshow, thumbnail } from '../src/media/slideshow.js';
import { assertPublicUrl, fetchPublicMedia, isPrivateIp, UrlError } from '../src/media/fetchUrl.js';
import { probeMedia } from '../src/media/probe.js';

process.env.CHROMIUM_PATH ??= '/opt/pw-browsers/chromium';
afterAll(async () => { await closeRenderer(); });

const tmpFile = (name: string, b: Buffer) => { const p = join(mkdtempSync(join(tmpdir(), 'c-')), name); writeFileSync(p, b); return p; };
const centerRgb = (jpeg: Buffer): [number, number, number] => {
  const f = tmpFile('p.jpg', jpeg);
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'crop=4:4:iw/2:ih/2,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  return [out[0]!, out[1]!, out[2]!];
};
const RTL = (body: string, bg = '#102030') => `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:${bg};width:1080px;height:1920px;display:grid;place-items:center;font-family:'Noto Sans Arabic',Tahoma,'DejaVu Sans',sans-serif;color:#fff">${body}</body></html>`;

describe('الرسم من HTML', () => {
  it('يرسم صفحة عربية 1080×1920 بألوانها الفعلية', async () => {
    const jpeg = await renderHtmlToJpeg(RTL('<h1 style="font-size:96px">مرحباً بالعالم</h1>', '#ff0000'));
    const p = await probeMedia(tmpFile('r.jpg', jpeg));
    expect(p).toMatchObject({ probed: true, width: 1080, height: 1920 });
    const [r, g, b] = centerRgb(await renderHtmlToJpeg('<body style="margin:0;background:#00ff00">', { width: 640, height: 640 }));
    expect(g).toBeGreaterThan(200); expect(r).toBeLessThan(60); expect(b).toBeLessThan(60);
  }, 60_000);

  it('معزول: لا شبكة ولا ملفات محلية ولا JavaScript', async () => {
    let hits = 0; const canary = createServer((_q, s) => { hits++; s.writeHead(200, { 'content-type': 'image/png' }); s.end(); });
    await new Promise<void>((r) => canary.listen(0, '127.0.0.1', r)); const port = (canary.address() as AddressInfo).port;
    const red = tmpFile('red.jpg', execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-'], { maxBuffer: 1 << 20 }));
    const blocked: string[] = [];
    const jpeg = await renderHtmlToJpeg(`<body style="margin:0;background:#0000ff">
      <img src="http://127.0.0.1:${port}/steal.png"><img src="file://${red}" style="position:fixed;inset:0;width:100%;height:100%">
      <link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"><div style="background:url(http://127.0.0.1:${port}/bg.png)">x</div>
      <script>document.body.style.background='#ff0000'</script></body>`,
      { width: 400, height: 400, onBlocked: (u) => blocked.push(u) });
    // إعادة توجيه عبر meta: الطلب يُجهَض أيضاً (قد تظهر صفحة خطأ، لكن لا شيء يخرج)
    await renderHtmlToJpeg(`<meta http-equiv="refresh" content="0;url=http://127.0.0.1:${port}/redir"><body>x`, { width: 400, height: 400, onBlocked: (u) => blocked.push(u) });
    canary.close();
    expect(hits).toBe(0);                                  // لا طلب خرج إلى الشبكة
    expect(blocked.some((u) => u.includes('/steal.png'))).toBe(true);
    const [r, , b] = centerRgb(jpeg);
    expect(b).toBeGreaterThan(200); expect(r).toBeLessThan(60); // لا سكربت نُفِّذ ولا ملف محلي ظهر
  }, 60_000);

  it('يرفض المدخلات الضخمة والأبعاد الخاطئة والفارغة', async () => {
    await expect(renderHtmlToJpeg('')).rejects.toBeInstanceOf(RenderError);
    await expect(renderHtmlToJpeg('x'.repeat(300_001))).rejects.toMatchObject({ code: 'too_large' });
    await expect(renderHtmlToJpeg('<p>x', { width: 100000, height: 10 })).rejects.toMatchObject({ code: 'bad_size' });
  });
});

describe('تركيب الفيديو من الشرائح', () => {
  it('3 شرائح ⇒ MP4 حقيقي 1080×1920 بمدة 3·2 − 2·0.5 = 5 ثوانٍ وH.264 وصوت', async () => {
    const slides = await Promise.all(['#c00', '#0a0', '#00c'].map((c, i) => renderHtmlToJpeg(RTL(`<h1 style="font-size:120px">الشريحة ${i + 1}</h1>`, c))));
    const mp4 = await makeSlideshow(slides, { secondsPerSlide: 2, fade: 0.5 });
    const p = await probeMedia(tmpFile('s.mp4', mp4));
    expect(p).toMatchObject({ probed: true, width: 1080, height: 1920, videoCodec: 'h264' });
    expect(p.durationSec).toBeGreaterThan(4.7); expect(p.durationSec).toBeLessThan(5.4);
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', tmpFile('s2.mp4', mp4)]).toString();
    expect(out).toContain('audio');
    expect((await probeMedia(tmpFile('t.jpg', await thumbnail(slides[0]!, 300)))).width).toBe(300);
  }, 120_000);
  it('شريحة واحدة تعمل، والحدود تُفرض', async () => {
    const one = await makeSlideshow([await renderHtmlToJpeg('<body style="background:#fff">', { width: 400, height: 700 })], { secondsPerSlide: 1.5 });
    expect((await probeMedia(tmpFile('o.mp4', one))).durationSec).toBeGreaterThan(1.3);
    await expect(makeSlideshow([])).rejects.toThrow(); await expect(makeSlideshow([Buffer.from('x')], { secondsPerSlide: 99 })).rejects.toThrow();
  }, 60_000);
});

describe('استيراد من رابط (حماية SSRF)', () => {
  it('isPrivateIp يغطي النطاقات الخطرة', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '999.1.1.1']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('يرفض الروابط الداخلية والمخطّطات الغريبة', async () => {
    for (const u of ['http://127.0.0.1/x', 'http://localhost:8080/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://10.0.0.5/x', 'http://svc.internal/x', 'file:///etc/passwd', 'ftp://example.com/x', 'gopher://x', 'http://user:pw@example.com/x', 'not a url'])
      expect(() => assertPublicUrl(u), u).toThrow(UrlError);
    await expect(fetchPublicMedia('http://localhost:1/x')).rejects.toMatchObject({ code: 'private_host' });
    await expect(fetchPublicMedia('http://127.0.0.1:1/x')).rejects.toMatchObject({ code: 'private_host' });
  });
  it('يجلب بنجاح، ويتتبع تحويلات محدودة، ويرفض الكبير والخطأ (باستثناء خاص للاختبار فقط)', async () => {
    const srv = createServer((q, s) => {
      if (q.url === '/ok.jpg') { s.writeHead(200, { 'content-type': 'image/jpeg' }); return void s.end(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])); }
      if (q.url === '/r1') { s.writeHead(302, { location: '/ok.jpg' }); return void s.end(); }
      if (q.url === '/loop') { s.writeHead(302, { location: '/loop' }); return void s.end(); }
      if (q.url === '/big') { s.writeHead(200, { 'content-length': '5000' }); return void s.end(Buffer.alloc(5000)); }
      s.writeHead(404); s.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const get = async (p: string, o = {}) => { const m = await fetchPublicMedia(b + p, { allowPrivate: true, ...o }); const c: Buffer[] = []; for await (const x of m.stream) c.push(x as Buffer); return { ...m, body: Buffer.concat(c) }; };
    expect((await get('/ok.jpg')).body).toHaveLength(6); expect((await get('/r1')).filename).toBe('ok.jpg');
    await expect(get('/loop')).rejects.toMatchObject({ code: 'too_many_redirects' });
    await expect(get('/big', { maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(get('/missing')).rejects.toMatchObject({ code: 'http_error' });
    srv.closeAllConnections?.(); srv.close();
  });
});
