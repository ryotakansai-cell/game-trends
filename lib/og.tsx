// OGP 画像（URL を SNS に貼ったときに出るカードの画像）の共通部品。
//
// 画像を作る仕組み（next/og）には日本語のフォントが入っていないので、
// Google Fonts から「画像に使う文字だけ」を切り出したフォントを取ってくる。
// 丸ごとだと数MBあるが、使う文字だけなら10KB前後で済む（2026-10 に確認）。

import { ImageResponse } from "next/og";
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

// ---------------------------------------------------------------
// ランキングの画像（Bluesky の投稿のカードと、日付ページの OGP 画像で共用）
// ---------------------------------------------------------------

export type OgRankRow = {
  rank: number;
  name: string;
  title?: string | null; // 配信タイトル（shortTitle で縮めたもの）
  value: string; // 「2.7万人」
  platform?: string; // 「YouTube」。名前の横に小さく出す
  iconUrl?: string;
};

/** Kick のアイコンは WebP（…/profile_image/conversion/<id>-medium.webp）しか返ってこないが、
 *  変換前の元画像（…/profile_image/<id>）は PNG で置いてある（2026-10-16 に確認。1〜2MB と大きめ） */
function kickOriginal(url: string) {
  return url.replace(
    /(files\.kick\.com\/images\/user\/\d+\/profile_image\/)conversion\/([0-9a-f-]+)-\w+\.webp$/,
    "$1$2",
  );
}

/** アイコンを画像に埋め込める形（data URL）にする。
 *  画像を作る仕組み（satori）は PNG / JPEG / GIF しか読めず、WebP などが混ざると画像全体が失敗する。
 *  そのため先に自分で取りに行き、読める形式のときだけ使う（読めなければアイコンの枠だけ出す） */
async function iconForOg(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(kickOriginal(url));
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/image\/(png|jpe?g|gif)/.test(type)) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // 大きすぎる画像は、画像を作る処理（Worker の CPU・メモリ）に響くので使わない
    if (bytes.length > 3_000_000) return undefined;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${type.split(";")[0]};base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

/** 上位の配信者を「順位・アイコン・名前・タイトル・人数」の表にした画像（1200×630）。
 *  SNS のカードは小さく表示されるので、文字が読める大きさで5人までにする */
export async function rankingImage(
  heading: string,
  note: string,
  rows: OgRankRow[],
) {
  const top = rows.slice(0, 5);
  const icons = await Promise.all(top.map((r) => iconForOg(r.iconUrl)));
  const font = await loadJapaneseFont(
    [
      SITE_NAME,
      heading,
      note,
      "0123456789",
      ...top.flatMap((r) => [r.name, r.title ?? "", r.value, r.platform ?? ""]),
    ].join(""),
  );

  return new ImageResponse(
    <OgFrame>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <OgLogo />
        <div style={{ fontSize: 22, color: "#9ca3af" }}>{note}</div>
      </div>
      {/* 枠の上下の余白（56px ずつ）の中に、見出しと5行（72px ずつ）が収まる高さにしてある */}
      <div style={{ fontSize: 38, marginTop: 12 }}>{heading}</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
        {top.map((r, i) => (
          <div
            key={r.rank}
            style={{
              display: "flex",
              alignItems: "center",
              borderTop: "2px solid #262626",
              height: 72,
            }}
          >
            <div style={{ width: 52, fontSize: 32, color: "#a78bfa" }}>
              {/* 数値のまま渡すと、画像を作る仕組みが「子が2つある div」とみなして失敗する。文字にして渡す */}
              {String(r.rank)}
            </div>
            {/* アイコン。取れなかったときも同じ大きさの枠を出して、行の形をそろえる */}
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background: "#1f1f1f",
                display: "flex",
                overflow: "hidden",
                marginRight: 20,
              }}
            >
              {icons[i] && (
                // eslint-disable-next-line @next/next/no-img-element -- OGP 画像の中なので next/image は使えない
                <img src={icons[i]} width={56} height={56} alt="" />
              )}
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <div
                  style={{
                    fontSize: 30,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    maxWidth: 640,
                  }}
                >
                  {r.name}
                </div>
                {r.platform && (
                  <div
                    style={{ fontSize: 18, color: "#6b7280", marginLeft: 12 }}
                  >
                    {r.platform}
                  </div>
                )}
              </div>
              {r.title && (
                <div
                  style={{
                    fontSize: 21,
                    color: "#9ca3af",
                    // 幅を決めないと … にならず、右の人数の手前で文字が途中で切れた
                    maxWidth: 760,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.title}
                </div>
              )}
            </div>
            <div style={{ fontSize: 32, color: "#d1d5db", marginLeft: 24 }}>
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts: [{ name: "NotoSansJP", data: font, weight: 700 }] },
  );
}
