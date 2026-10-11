import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { getSteamRanking, steamCapsule, type SteamGame } from "@/lib/steam";
import { formatViewers } from "@/lib/twitch";

export const metadata: Metadata = {
  title: "Steam 同接ランキング（Twitch の視聴者数つき）",
  description:
    "Steamでいま遊ばれているゲームのランキング。Twitchの視聴者数と並べて、遊ばれているゲームか見られているゲームかがわかります。日本で配信している配信者へも移れます。",
  alternates: { canonical: "/games/steam" },
};

// Steam の人数は10分、上位の顔ぶれは30分作り置きする（lib/steam.ts）。ページも10分ごとに作り直す
export const revalidate = 600;

/** 先週の順位からの変化。矢印は方向そのものを表すので使う（サイトの決まりで「リンクの印」には使わない） */
function RankChange({ g }: { g: SteamGame }) {
  if (g.lastWeekRank === null)
    return <span className="text-[10px] text-gray-400">NEW</span>;
  const diff = g.lastWeekRank - g.rank;
  if (diff === 0) return <span className="text-[10px] text-gray-600">―</span>;
  return (
    <span className="text-[10px] text-gray-400">
      {diff > 0 ? `↑${diff}` : `↓${-diff}`}
    </span>
  );
}

/** 「見られ度」= Twitch の視聴者 ÷ Steam で遊んでいる人。
 *  大きいほど「遊ぶ人に比べて見る人が多い」ゲーム。Steam 版だけの人数なので目安 */
function watchRatio(g: SteamGame) {
  if (!g.twitchGame || !g.players) return null;
  return g.twitchViewers / g.players;
}

/** 0.0034 → 0.0034、0.86 → 0.86。小さいゲームでも 0.00 と潰れないよう、有効数字2桁で出す */
function formatRatio(r: number) {
  return r >= 1 ? r.toFixed(1) : r.toPrecision(2);
}

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
            <span className="mt-0.5 block text-gray-500">
              見られ度＝Twitchの視聴者÷Steamで遊んでいる人。大きいほど「見るゲーム」
              ・ 更新：10分ごと
            </span>
          </>
        }
        filters={<GameTabs current="steam" />}
      />

      <ol className="mt-8">
        {games.map((g) => {
          const ratio = watchRatio(g);
          const name = (
            <span className="line-clamp-2 text-sm font-bold text-gray-100 group-hover:text-purple-300 sm:text-base">
              {g.name}
            </span>
          );
          return (
            <li
              key={g.appid}
              className="group flex items-center gap-3 border-t border-white/5 py-3 first:border-t-0 sm:gap-4"
            >
              <div className="flex w-8 shrink-0 flex-col items-center">
                <span className="text-sm tabular-nums text-gray-400">
                  {g.rank}
                </span>
                <RankChange g={g} />
              </div>

              <div className="relative h-[46px] w-[123px] shrink-0 overflow-hidden rounded bg-white/5 sm:h-[69px] sm:w-[184px]">
                <Image
                  src={steamCapsule(g.appid)}
                  alt={g.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>

              <div className="min-w-0 flex-1">
                {/* Twitch のゲームと結べたものは、そのゲームの配信者の一覧へ */}
                {g.twitchGame ? (
                  <Link href={`/games/${g.twitchGame.id}`}>{name}</Link>
                ) : (
                  name
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {g.players !== null ? (
                    <>
                      <span className="text-gray-200">
                        {formatViewers(g.players)}人
                      </span>
                      がプレイ中
                    </>
                  ) : (
                    "人数は非公開"
                  )}
                  {" ・ "}今日の最高 {formatViewers(g.peakToday)}人
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {g.twitchGame ? (
                    <>
                      Twitch {formatViewers(g.twitchViewers)}人が視聴
                      {ratio !== null && ` ・ 見られ度 ${formatRatio(ratio)}`}
                      {g.jpStreams > 0 && (
                        <>
                          {" ・ "}
                          <Link
                            href={`/games/${g.twitchGame.id}`}
                            className="text-gray-300 transition hover:text-purple-300"
                          >
                            日本で{g.jpStreams}人が配信中
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    "Twitch の対応するゲームなし"
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
