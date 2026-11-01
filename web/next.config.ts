import type { NextConfig } from 'next';

// الإنتاج: تصدير ملفات ثابتة تخدمها عملية الـAPI نفسها (خدمة واحدة، لا وكيل في مسار الرفع).
// التطوير: next dev مع تمرير /api إلى خادم الـAPI.
const isProd = process.env.NODE_ENV === 'production';
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';
const config: NextConfig = {
  poweredByHeader: false,
  ...(isProd
    ? { output: 'export', images: { unoptimized: true } }
    : { async rewrites() { return [{ source: '/api/:path*', destination: `${API}/api/:path*` }, { source: '/auth/:path*', destination: `${API}/auth/:path*` }]; } }),
};
export default config;
