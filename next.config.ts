import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "static-cdn.jtvnw.net" },
      { protocol: "https", hostname: "**.jtvnw.net" },
      { protocol: "https", hostname: "**.twitch.tv" },
    ],
  },
};

export default nextConfig;
