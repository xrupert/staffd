import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // W91.5 — the canonical STAFFD_SELF.md lives at the repo root; trace it into
  // the serverless bundle so the Vault loader can read it at runtime. Root is
  // pinned to the monorepo so the relative include resolves on Vercel.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/**": ["../../STAFFD_SELF.md"],
  },
  async redirects() {
    return [
      // Cockpit → Front Desk rename. 301 permanent so old links/bookmarks land.
      { source: "/dashboard/cockpit", destination: "/dashboard/front-desk", statusCode: 301 },
      { source: "/dashboard/cockpit/:path*", destination: "/dashboard/front-desk/:path*", statusCode: 301 },
    ];
  },
};

export default nextConfig;
