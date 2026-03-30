/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.susercontent.com' },
    ],
  },
  // 정적 내보내기 (Vercel에서 최적)
  output: 'export',
  trailingSlash: true,
};

module.exports = nextConfig;
