import type { NextConfig } from 'next';

// في التطوير: نمرّر /api و/auth و/media إلى خادم الـAPI ليبقى كل شيء من أصل واحد (الكوكي first-party).
// في الإنتاج: الأفضل وكيل عكسي (Caddy/nginx) يوجّه هذه المسارات مباشرة إلى الـAPI (انظر docs/DEPLOY.md).
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/auth/:path*', destination: `${API}/auth/:path*` },
      { source: '/media/pull/:path*', destination: `${API}/media/pull/:path*` },
    ];
  },
};
export default config;
