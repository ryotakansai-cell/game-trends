import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { PlayRankingList } from "@/components/PlayRankingList";
import { RelativeTime } from "@/components/RelativeTime";
import { getSteamRanking } from "@/lib/steam";
import { formatViewers } from "@/lib/twitch";

export const metadata: Metadata = {
  title: "Steam 同接ランキング",
  description:
    "Steamでいま遊ばれているゲームのランキング。24時間前からの増減、Twitchの視聴者数、日本で配信している人数も並べて表示します。",
  alternates: { canonical: "/games/steam" },
};

// 人数は毎時の記録、Twitch の数字は5分作り置き。ページは10分ごとに作り直す
export const revalidate = 600;

export default async function SteamGamesPage() {
  const games = await getSteamRanking(50);
  const totalPlayers = games.reduce((s, g) => s + (g.players ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            Steamでいま遊ばれている順 ・ 上位{games.length}本で
            <span className="font-bold text-white">
              {formatViewers(totalPlayers)}人
            </span>
            がプレイ中（全世界）
            {games[0] && (
              <span className="mt-0.5 block text-gray-500">
                更新：毎時（
                <RelativeTime iso={games[0].capturedAt} />）
              </span>
            )}
          </>
        }
        filters={<GameTabs current="steam" />}
      />

      {games.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">まだ記録がありません。</p>
      ) : (
        <PlayRankingList
          imageShape="wide"
          items={games.map((g) => ({
            key: g.externalId,
            rank: g.rank,
            name: g.name,
            imageUrl: g.imageUrl,
            players: g.players,
            players24hAgo: g.players24hAgo,
            prevRank: g.prevRank,
            // Twitch のゲームと結べたものは、そのゲームの配信者の一覧（日本の配信が先に出る）へ
            href: g.twitchGameId ? `/games/${g.twitchGameId}` : undefined,
            extra: g.twitchGameId ? (
              <>
                Twitch {formatViewers(g.twitchViewers)}人が視聴
                {g.jpStreams > 0 && (
                  <>
                    {" ・ "}
                    <Link
                      href={`/games/${g.twitchGameId}`}
                      className="text-gray-300 transition hover:text-purple-300"
                    >
                      日本で{g.jpStreams >= 100 ? "100以上" : g.jpStreams}
                      人が配信中
                    </Link>
                  </>
                )}
              </>
            ) : undefined,
          }))}
        />
      )}
    </main>
  );
}
