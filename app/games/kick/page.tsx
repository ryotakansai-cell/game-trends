import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { getKickGameRanking } from "@/lib/kick";
import { boxArt, formatViewers } from "@/lib/twitch";

export const metadata: Metadata = {
  title: "Kick ゲーム別ランキング",
  description:
    "Kickでいま視聴者が多いゲームのランキング。日本語の配信と全世界の配信を切り替えて見られます。",
  alternates: { canonical: "/games/kick" },
};

type Props = { searchParams: Promise<{ lang?: string }> };

/** Kick でいま見られているゲーム（lib/kick.ts の getKickGameRanking）。
 *  見た目は Twitch のゲームランキングとそろえ、押すと Twitch と Kick の配信を混ぜたゲームのページへ */
export default async function KickGamesPage({ searchParams }: Props) {
  const { lang } = await searchParams;
  const isJapanese = lang !== "all";
  const games = (await getKickGameRanking(isJapanese).catch(() => [])).slice(
    0,
    24,
  );
  const total = games.reduce((sum, g) => sum + g.viewers, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            Kickでいま視聴者が多い順（
            {isJapanese ? "日本語の配信" : "全世界の上位100配信"}）
            {games.length > 0 && (
              <>
                {" ・ "}
                <span className="font-bold text-white">
                  {formatViewers(total)}人
                </span>
                が視聴中
              </>
            )}
            {/* 雑談（Just Chatting）や外配信（IRL）はゲームではないので入らないことを書いておく */}
            <span className="mt-0.5 block text-gray-500">
              更新：5分ごと ・ 雑談・外配信は含まない
            </span>
          </>
        }
        region={
          <SegmentedTabs
            options={[
              { label: "日本", href: "/games/kick", active: isJapanese },
              {
                label: "Global",
                href: "/games/kick?lang=all",
                active: !isJapanese,
              },
            ]}
          />
        }
        filters={<GameTabs current="kick" />}
      />

      {games.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">
          いまゲームを配信している人がいません。
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          {games.map((game, index) => (
            <li key={game.twitchGameId} className="group">
              <Link href={`/games/${game.twitchGameId}`}>
                <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5 transition group-hover:border-purple-400/50">
                  <Image
                    src={boxArt(game.boxArtUrl)}
                    alt={game.name}
                    width={285}
                    height={380}
                    className="w-full transition duration-300 group-hover:scale-105"
                    unoptimized
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                </div>
                <p
                  className="mt-2 truncate text-sm text-gray-300 group-hover:text-purple-300"
                  title={game.name}
                >
                  {game.name}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  {formatViewers(game.viewers)}人 ・ {game.streams}配信
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
