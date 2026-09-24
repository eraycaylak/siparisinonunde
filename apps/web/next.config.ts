import type { NextConfig } from 'next';

// API adresi: web sunucusu /api/* isteklerini buraya aktarır (aynı köken, çerez).
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@siparis/core'],
  // Görseller API'nin /uploads altından ya da CDN'den gelir; optimizasyonu API'deki images kuyruğu yapar.
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: '/komisyon-hesaplayici', destination: '/hesaplayici', permanent: true },
      { source: '/kayit', destination: '/panel/kayit', permanent: false },
      { source: '/giris', destination: '/panel/giris', permanent: false },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
