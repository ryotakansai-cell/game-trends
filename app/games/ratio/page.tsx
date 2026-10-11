import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { getSteamRanking } from "@/lib/steam";
import { formatViewers } from "@/lib/twitch";

export const metadata: Metadata = {
  title: "見られ度ランキング（Twitch の視聴者 ÷ Steam で遊んでいる人）",
  description:
    "遊ばれている人数に比べて、配信でよく見られているゲームのランキング。Twitchの視聴者数をSteamで遊んでいる人数で割った「見られ度」で並べます。",
  alternates: { canonical: "/games/ratio" },
};

export const revalidate = 600;

/** 0.0034 → 0.0034、0.86 → 0.86、1.7 → 1.7。小さい値が 0.00 と潰れないよう有効数字2桁で出す */
function formatRatio(r: number) {
  return r >= 1 ? r.toFixed(1) : r.toPrecision(2);
}

/** 見られ度 = Twitch の視聴者 ÷ Steam で遊んでいる人。
 *  Steam の一覧に混ぜると数字の意味の説明が一覧を埋めてしまうので、別のタブにした */
export default async function WatchRatioPage() {
  const games = (await getSteamRanking(100))
    .filter((g) => g.twitchGameId && g.players)
    .map((g) => ({ ...g, ratio: g.twitchViewers / g.players! }))
    .sort((a, b) => b.ratio - a.ratio);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="見られ度"
        summary={
          <>
            Twitchの視聴者 ÷
            Steamで遊んでいる人。大きいほど、遊ぶ人に比べて配信でよく見られているゲーム
            <span className="mt-0.5 block text-gray-500">
              Steam で遊ばれている上位100本のうち、Twitch と結び付けられた
              {games.length}本 ・ 更新：毎時
            </span>
          </>
        }
        filters={<GameTabs current="ratio" />}
      />

      <ol className="mt-8">
        {games.map((g, i) => (
          <li
            key={g.externalId}
            className="flex items-center gap-3 border-t border-white/5 py-3 first:border-t-0"
          >
            <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-400">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/games/${g.twitchGameId}`}
                className="text-sm font-bold text-gray-100 transition hover:text-purple-300"
              >
                {g.name}
              </Link>
              <p className="mt-0.5 text-xs text-gray-500">
                Twitch {formatViewers(g.twitchViewers)}人が視聴 ・ Steam{" "}
                {formatViewers(g.players!)}人がプレイ中
              </p>
            </div>
            <span className="shrink-0 text-right text-sm tabular-nums text-gray-200">
              {formatRatio(g.ratio)}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
