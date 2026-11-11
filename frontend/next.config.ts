import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // Lean production image (Docker sets NEXT_OUTPUT_STANDALONE=1); `next start` stays unchanged locally.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://localhost:4000'}/:path*`,
      },
    ];
  },
};
export default config;
