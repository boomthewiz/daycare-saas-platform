import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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