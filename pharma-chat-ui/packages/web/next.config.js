/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_CF_EXPORT === 'true' ? 'export' : 'standalone',
};
module.exports = nextConfig;
