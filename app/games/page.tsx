import Image from "next/image";
import {
  getTopGames,
  getViewerCountByGame,
  boxArt,
  isRealGame,
  formatViewers,
} from "@/lib/twitch";

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
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-4xl font-bold text-purple-400">ゲームトレンド</h1>
      <p className="mt-2 text-sm text-gray-400">
        Twitchでいま視聴者が多い順 ・ 上位{games.length}タイトルで
        <span className="font-bold text-purple-300">
          {formatViewers(total)}人
        </span>
        が視聴中
      </p>

      <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {games.map((game, index) => {
          const viewers = viewerCounts.get(game.id) ?? 0;

          return (
            <li key={game.id} className="group">
              <div className="relative overflow-hidden rounded-lg border border-white/10">
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
                className="mt-2 truncate text-sm text-gray-300"
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
            </li>
          );
        })}
      </ul>
    </main>
  );
}
