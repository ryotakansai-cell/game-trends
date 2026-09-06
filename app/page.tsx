import Image from "next/image";
import { getTopGames, boxArt, isRealGame } from "@/lib/twitch";

export const revalidate = 300;

export default async function Home() {
  const all = await getTopGames(40);
  const games = all.filter(isRealGame).slice(0, 24);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-4xl font-bold text-purple-400">ゲームトレンド</h1>
      <p className="mt-2 text-sm text-gray-400">
        Twitchでいま視聴者が多い順。5分ごとに更新されます。
      </p>

      <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {games.map((game, index) => (
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
          </li>
        ))}
      </ul>
    </main>
  );
}
