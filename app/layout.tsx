import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // metadataBase を決めておくと、各ページで相対パスを書いても
  // 絶対URLに展開される（OGP画像やcanonicalで必要）
  metadataBase: new URL(SITE_URL),

  // title.template は「各ページのタイトル | サイト名」を自動で組み立てる指定。
  // 各ページが title だけ返せばよくなる
  title: {
    default: `${SITE_NAME} | Twitch・YouTubeのライブ配信ランキング`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "TwitchとYouTube Liveの配信を横断して、いま盛り上がっている配信・ゲーム・急上昇中の配信者がわかるサイト。",
  openGraph: {
    siteName: SITE_NAME,
    locale: "ja_JP",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        {/* アクセス解析（Cloudflare Web Analytics）。Vercel Analytics は Vercel の外では
            動かないので置き換えた。token は HTML に出る公開用の値で、秘密ではない。
            Cookie を使わない方式なので、同意バナーは要らない */}
        <Script
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "99f139530e1d47b08b85aa7ef678a96a"}'
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
