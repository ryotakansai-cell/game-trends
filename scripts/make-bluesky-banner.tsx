// Bluesky のプロフィールの背景画像（1500×500）を作る。
// 使い方: JITI_JSX=1 npx jiti scripts/make-bluesky-banner.tsx  → design/bluesky-banner.png
//
// 黒地に、紫のロゴと白い名前を大きく置き、下に一言（2026-10-16 にオーナーが選んだ）。
// 紫に光るグラデーション＋線でつなぐ図、名前を外して言葉だけにした案なども30枚ほど試したうえで、これに決めた。
// サイトの画面と同じ配色（暗い背景に紫を差す）。各社のロゴや実在の配信者の名前・顔は使わない。
// Bluesky では左下にプロフィールのアイコンが重なるので、中身は真ん中に寄せている。
// サイトの OGP 画像と同じ仕組み（next/og）で作る
import { writeFileSync } from "node:fs";
// jiti は JSX を React.createElement に変換するので、React をこのファイルに読み込んでおく
import React from "react";
import { ImageResponse } from "next/og";

const W = 1500;
const H = 500;
const PURPLE = "#7c3aed";
const NAME = "配信トレンド";
const TAGLINE = "いま見られている配信が、ひと目でわかる";

/** lib/og.tsx の loadJapaneseFont と同じ（そちらは @/ の別名を使うので、単独のスクリプトからは読めない）。
 *  Google Fonts から、画像に使う文字だけを切り出したフォントを取る */
async function loadFont(text: string, weight: number): Promise<ArrayBuffer> {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(text)}`,
    )
  ).text();
  const url = css.match(
    /src: url\((.+?)\) format\('(opentype|truetype)'\)/,
  )?.[1];
  if (!url) throw new Error("日本語フォントの URL が取れませんでした");
  return (await fetch(url)).arrayBuffer();
}

/** サイトのアイコン（design/icon.svg と同じ絵） */
function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72">
      <rect width="72" height="72" rx="16" fill={PURPLE} />
      <circle
        cx="36"
        cy="36"
        r="21"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
      />
      <path
        d="M31 26.5 L47 36 L31 45.5 Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Banner() {
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        position: "relative",
        fontFamily: "NotoSansJP",
        color: "#fff",
        background: "#0a0a0a",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 120,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Logo size={120} />
          <div style={{ fontSize: 110, fontWeight: 700 }}>{NAME}</div>
        </div>
        <div style={{ fontSize: 30, color: "#a1a1aa", marginTop: 28 }}>
          {TAGLINE}
        </div>
      </div>
    </div>
  );
}

async function main() {
  const text = NAME + TAGLINE;
  const [regular, bold] = await Promise.all([
    loadFont(text, 400),
    loadFont(text, 700),
  ]);
  const image = new ImageResponse(<Banner />, {
    width: W,
    height: H,
    fonts: [
      { name: "NotoSansJP", data: regular, weight: 400 },
      { name: "NotoSansJP", data: bold, weight: 700 },
    ],
  });
  writeFileSync(
    "design/bluesky-banner.png",
    Buffer.from(await image.arrayBuffer()),
  );
  console.log("design/bluesky-banner.png を作りました");
}

main();
