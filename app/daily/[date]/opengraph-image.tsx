import { OG_SIZE, rankingImage } from "@/lib/og";
import { dayTitle, getDailyHeadline, isAvailableDay } from "@/lib/daily";
import { formatViewers } from "@/lib/twitch";
import { getAccountIcons } from "@/lib/platform-loaders";
import { PLATFORMS, accountKey } from "@/lib/platforms";
import { shortTitle } from "@/lib/text";

// 日付ページの OGP 画像。SNS に流れてきたときに中身が一目で分かるよう、
// その日の最高同接の上位5人を、アイコン・最高同接だった瞬間の配信タイトルと一緒に載せる。
// 毎朝の Bluesky の投稿のカードにも、この画像を使う（lib/bluesky.ts）
export const alt = "その日の配信ランキング（最高同接の上位5人）";
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
    ? await getDailyHeadline(date, 5)
    : null;
  const top = summary?.top ?? [];
  // アイコンは表示のたびに取る方針（DB に保存しない）。Twitch は API、YouTube は1日作り置き
  const icons = await getAccountIcons(top).catch(
    () => new Map<string, string>(),
  );

  return rankingImage(
    `${dayTitle(date)}の配信ランキング`,
    summary
      ? `最高同接 ・ 日本の配信者${summary.streamers.toLocaleString("ja-JP")}人から`
      : "",
    top.map((e, i) => ({
      rank: i + 1,
      name: e.displayName,
      title: e.peakTitle ? shortTitle(e.peakTitle, 40) : null,
      value: `${formatViewers(e.peakViewers)}人`,
      platform: PLATFORMS[e.platform].label,
      iconUrl: icons.get(accountKey(e)),
    })),
  );
}
