import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Vercel の画像最適化を使わない。Hobby は月5,000回までで、配信者のアイコンは
    // 入れ替わりが激しく上限を超えた（超えると新しい画像が402で表示されなくなる）。
    // Twitch / YouTube の画像は配信元がサイズ違いを用意しているので、
    // 小さい版のURLを指定すれば最適化しなくても軽い（lib/twitch.ts の getUsersByLogin）
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "static-cdn.jtvnw.net" },
      { protocol: "https", hostname: "**.jtvnw.net" },
      { protocol: "https", hostname: "**.twitch.tv" },
      { protocol: "https", hostname: "**.ggpht.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
