import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets a second, isolated server run without overwriting the build another server is serving.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  allowedDevOrigins: (process.env.ROADMAP_DEV_HOSTS ?? '').split(',').map(host => host.trim()).filter(host => /^[a-z\d.-]+$/i.test(host)),
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/\/auth\/confirm(?:[?\s]|$)/, /\/auth\/callback(?:[?\s]|$)/] } },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          ...(process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SITE_URL?.startsWith('https://')
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          }
        ]
      }
    ];
  }
};

export default nextConfig;
