import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { PlayRankingList } from "@/components/PlayRankingList";
import { RelativeTime } from "@/components/RelativeTime";
import { getPlayRanking } from "@/lib/play";
import { ROBLOX_TWITCH_GAME_ID } from "@/lib/roblox";
import { formatViewers, getJapaneseStreamCountsForGames } from "@/lib/twitch";

export const metadata: Metadata = {
  title: "Roblox 人気ゲームランキング",
  description:
    "Robloxでいま遊ばれているゲーム（体験）のランキング。24時間前からの増減も表示します。",
  alternates: { canonical: "/games/roblox" },
};

export const revalidate = 600;

export default async function RobloxGamesPage() {
  const [games, jp] = await Promise.all([
    getPlayRanking("roblox", 50),
    // Twitch では Roblox の体験はすべて「ROBLOX」のカテゴリなので、体験ごとではなく全体の数を出す
    getJapaneseStreamCountsForGames([ROBLOX_TWITCH_GAME_ID]).catch(
      () => new Map<string, number>(),
    ),
  ]);
  const total = games.reduce((s, g) => s + (g.players ?? 0), 0);
  const jpStreams = jp.get(ROBLOX_TWITCH_GAME_ID) ?? 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            Robloxでいま遊ばれている順 ・ 上位{games.length}本で
            <span className="font-bold text-white">
              {formatViewers(total)}人
            </span>
            がプレイ中（全世界）
            {jpStreams > 0 && (
              <>
                {" ・ "}
                <Link
                  href={`/games/${ROBLOX_TWITCH_GAME_ID}`}
                  className="text-gray-300 transition hover:text-purple-300"
                >
                  日本で{jpStreams}人が Roblox を配信中
                </Link>
              </>
            )}
            {games[0] && (
              <span className="mt-0.5 block text-gray-500">
                更新：毎時（
                <RelativeTime iso={games[0].capturedAt} />）
              </span>
            )}
          </>
        }
        filters={<GameTabs current="roblox" />}
      />

      {games.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">まだ記録がありません。</p>
      ) : (
        <PlayRankingList
          imageShape="square"
          items={games.map((g) => ({
            key: g.externalId,
            rank: g.rank,
            name: g.name,
            imageUrl: g.imageUrl,
            players: g.players,
            players24hAgo: g.players24hAgo,
          }))}
        />
      )}
    </main>
  );
}
