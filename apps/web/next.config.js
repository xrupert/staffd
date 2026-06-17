/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Cockpit → Front Desk rename. 301 permanent so old links/bookmarks land.
      { source: "/dashboard/cockpit", destination: "/dashboard/front-desk", statusCode: 301 },
      { source: "/dashboard/cockpit/:path*", destination: "/dashboard/front-desk/:path*", statusCode: 301 },
    ];
  },
};

export default nextConfig;

// W91.5 redeploy — force clean function trace after the tracing-root revert (cache bust).
