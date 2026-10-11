import { ImageResponse } from "next/og";
import { OG_SIZE, OgFrame, OgLogo, loadJapaneseFont } from "@/lib/og";

// サイト全体の OGP 画像。個別の画像を持たないページ（トップ・急上昇など）で使われる。
// 中身が変わらないので、ビルド時に1回だけ作られる
export const alt =
  "配信トレンド：Twitch・YouTubeを横断したライブ配信ランキング";
export const size = OG_SIZE;
export const contentType = "image/png";

const TITLE = "いま見られている配信が、ひと目でわかる";
const SUB = "Twitch・YouTubeを横断したライブ配信ランキング";
const TAGS = ["ライブランキング", "急上昇", "配信者の同接・配信時間"];

export default async function Image() {
  const font = await loadJapaneseFont(
    [TITLE, SUB, ...TAGS, "配信トレンド"].join(""),
  );

  return new ImageResponse(
    <OgFrame>
      <OgLogo />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 90 }}>
        {/* 自動の折り返しだと「ひと目で／わかる」と切れるので、読点の後で改行する */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 64,
            lineHeight: 1.3,
          }}
        >
          {TITLE.split("、").map((part, i, arr) => (
            <span key={part}>{i < arr.length - 1 ? `${part}、` : part}</span>
          ))}
        </div>
        <div style={{ fontSize: 34, color: "#9ca3af", marginTop: 24 }}>
          {SUB}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
        {TAGS.map((t) => (
          <div
            key={t}
            style={{
              fontSize: 26,
              color: "#d8b4fe",
              border: "2px solid #6d28d9",
              borderRadius: 999,
              padding: "8px 24px",
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </OgFrame>,
    { ...size, fonts: [{ name: "NotoSansJP", data: font, weight: 700 }] },
  );
}
