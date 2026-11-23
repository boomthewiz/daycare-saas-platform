import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/marketing/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      {
        source: "/clients",
        destination: "/team-management",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;