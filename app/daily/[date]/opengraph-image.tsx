import { ImageResponse } from "next/og";
import { OG_SIZE, OgFrame, OgLogo, loadJapaneseFont } from "@/lib/og";
import { dayTitle, getDailyHeadline, isAvailableDay } from "@/lib/daily";
import { formatViewers } from "@/lib/twitch";

// 日付ページの OGP 画像。SNS に流れてきたときに中身が一目で分かるよう、
// その日の最高同接の上位3人を載せる。過去の日は変わらないので1日作り置きする
export const alt = "その日の配信ランキング（最高同接の上位3人）";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const summary = (await isAvailableDay(date))
    ? await getDailyHeadline(date)
    : null;
  const top3 = summary?.top ?? [];

  const title = `${dayTitle(date)}の配信ランキング`;
  const lines = top3.map((e, i) => ({
    rank: `${i + 1}`,
    name: e.displayName,
    value: `${formatViewers(e.peakViewers)}人`,
  }));
  const note = summary
    ? `最高同接 ・ 日本の配信者${summary.streamers.toLocaleString("ja-JP")}人の記録から`
    : "";

  const font = await loadJapaneseFont(
    [
      title,
      note,
      "配信トレンド",
      ...lines.flatMap((l) => [l.rank, l.name, l.value]),
    ].join(""),
  );

  return new ImageResponse(
    <OgFrame>
      <OgLogo />
      <div style={{ fontSize: 56, marginTop: 44 }}>{title}</div>
      <div style={{ fontSize: 26, color: "#9ca3af", marginTop: 8 }}>{note}</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
        {lines.map((l) => (
          <div
            key={l.rank}
            style={{
              display: "flex",
              alignItems: "center",
              borderTop: "2px solid #262626",
              padding: "14px 0",
            }}
          >
            <div style={{ width: 70, fontSize: 40, color: "#a78bfa" }}>
              {l.rank}
            </div>
            {/* 長い名前は1行に収め、はみ出す分は … で省略する */}
            <div
              style={{
                flex: 1,
                fontSize: 40,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {l.name}
            </div>
            <div style={{ fontSize: 40, color: "#d1d5db", marginLeft: 24 }}>
              {l.value}
            </div>
          </div>
        ))}
      </div>
    </OgFrame>,
    { ...size, fonts: [{ name: "NotoSansJP", data: font, weight: 700 }] },
  );
}
