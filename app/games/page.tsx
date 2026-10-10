import Image from "next/image";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  getTopGames,
  getViewerCountByGame,
  boxArt,
  isRealGame,
  formatViewers,
} from "@/lib/twitch";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ゲーム別ランキング",
  description:
    "Twitchでいま視聴者数が多いゲームのランキング。ゲームを選ぶと、そのゲームを配信している配信者が一覧で見られます。",
  alternates: { canonical: "/games" },
};

export const revalidate = 300;

export default async function Home() {
  const [all, viewerCounts] = await Promise.all([
    getTopGames(40),
    getViewerCountByGame(5),
  ]);

  const games = all.filter(isRealGame).slice(0, 24);
  const total = games.reduce(
    (sum, g) => sum + (viewerCounts.get(g.id) ?? 0),
    0,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            Twitchでいま視聴者が多い順 ・ 上位{games.length}タイトルで
            <span className="font-bold text-white">
              {formatViewers(total)}人
            </span>
            が視聴中
            {/* Twitch API の返事とページの作り置きが、どちらも5分ごとに作り直される */}
            <span className="mt-0.5 block text-gray-500">更新：5分ごと</span>
          </>
        }
      />

      <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {games.map((game, index) => {
          const viewers = viewerCounts.get(game.id) ?? 0;

          return (
            <li key={game.id} className="group">
              {/* カード全体をリンクにする。/games/[id] は前から存在していたが
                  ここが <Link> になっておらず、たどり着けなかった */}
              <Link href={`/games/${game.id}`}>
                <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5 transition group-hover:border-purple-400/50">
                  <Image
                    src={boxArt(game.box_art_url)}
                    alt={game.name}
                    width={285}
                    height={380}
                    className="w-full transition duration-300 group-hover:scale-105"
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

                {viewers > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {formatViewers(viewers)}人
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
