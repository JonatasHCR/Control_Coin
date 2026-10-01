import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // `new URL(...).pathname` yields "/C:/…" on Windows, which is not a path any
  // filesystem call accepts — tracing then fails and `.next/standalone` is
  // never emitted, so the image cannot be reproduced locally.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@cc/domain'],
};

export default config;
