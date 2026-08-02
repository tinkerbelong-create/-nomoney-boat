/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nmb/core'],
  experimental: { typedRoutes: false },
};
export default nextConfig;
