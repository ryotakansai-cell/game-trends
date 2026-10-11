// OGP 画像（URL を SNS に貼ったときに出るカードの画像）の共通部品。
//
// 画像を作る仕組み（next/og）には日本語のフォントが入っていないので、
// Google Fonts から「画像に使う文字だけ」を切り出したフォントを取ってくる。
// 丸ごとだと数MBあるが、使う文字だけなら10KB前後で済む（2026-10 に確認）。

import { SITE_NAME } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 };

/** 画像に出す文字だけを含む日本語フォント（太字）を取ってくる。
 *  Google Fonts は、ブラウザらしい User-Agent を付けないと ttf を返す。
 *  画像を作る仕組みは ttf / otf / woff しか読めないので、その性質を使っている */
export async function loadJapaneseFont(text: string): Promise<ArrayBuffer> {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`,
    )
  ).text();
  const url = css.match(
    /src: url\((.+?)\) format\('(opentype|truetype)'\)/,
  )?.[1];
  if (!url) throw new Error("日本語フォントの URL が取れませんでした");
  return (await fetch(url)).arrayBuffer();
}

/** サイトのアイコン（design/icon.svg と同じ絵）。画像の左上に小さく出す */
export function OgLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="56" height="56" viewBox="0 0 72 72">
        <rect width="72" height="72" rx="16" fill="#7c3aed" />
        <rect x="10" y="18" width="52" height="36" rx="8" fill="#fff" />
        <path
          d="M19 45 L29 35 L36 41 L50 27"
          stroke="#7c3aed"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontSize: 34, color: "#ededed" }}>{SITE_NAME}</span>
    </div>
  );
}

/** 画像全体の枠。サイトと同じ暗い背景に、紫を差し色にする */
export function OgFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0a",
        color: "#ededed",
        padding: "56px 72px",
        fontFamily: "NotoSansJP",
        borderTop: "12px solid #7c3aed",
      }}
    >
      {children}
    </div>
  );
}
