import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGameById,
  getTopStreams,
  boxArt,
  streamThumb,
  elapsedSince,
  formatViewers,
} from "@/lib/twitch";

export const revalidate = 180;

type Props = {
  params: Promise<{ id: string }>;
};

export default async function GameDetailPage({ params }: Props) {
  const { id } = await params;

  const [game, streams] = await Promise.all([
    getGameById(id),
    getTopStreams({ gameId: id, limit: 30 }),
  ]);

  if (!game) notFound();

  const totalViewers = streams.reduce((sum, s) => sum + s.viewer_count, 0);
  const query = encodeURIComponent(game.name);

  const links = [
    {
      label: "YouTubeで検索",
      url: `https://www.youtube.com/results?search_query=${query}+実況`,
    },
    {
      label: "Steamで検索",
      url: `https://store.steampowered.com/search/?term=${query}`,
    },
    {
      label: "Twitchで開く",
      url: `https://www.twitch.tv/directory/game/${query}`,
    },
    {
      label: "Google検索",
      url: `https://www.google.com/search?q=${query}+攻略`,
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-purple-400">
        ← 配信ランキング
      </Link>

      {/* ゲーム情報の帯 */}
      <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/5 p-5">
        <Image
          src={boxArt(game.box_art_url, 144, 192)}
          alt={game.name}
          width={96}
          height={128}
          className="rounded-lg"
        />

        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-100">{game.name}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {streams.length}配信 ・
            <span className="font-bold text-purple-300">
              {formatViewers(totalViewers)}人
            </span>
            が視聴中
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400 transition hover:border-purple-400 hover:text-purple-300"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* 配信者一覧 */}
      <h2 className="mt-10 text-lg font-bold text-gray-200">配信中</h2>

      {streams.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          今このゲームを配信している人はいません。
        </p>
      ) : (
        <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((stream, index) => (
            <li key={stream.id} className="group">
              <a
                href={`https://twitch.tv/${stream.user_login}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="relative overflow-hidden rounded-lg border border-white/10">
                  <Image
                    src={streamThumb(stream.thumbnail_url)}
                    alt={stream.title}
                    width={440}
                    height={248}
                    className="w-full transition duration-300 group-hover:scale-105"
                    unoptimized
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/90 px-2 py-0.5 text-xs font-bold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    {formatViewers(stream.viewer_count)}
                  </span>
                  <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                    {elapsedSince(stream.started_at)}
                  </span>
                </div>
              </a>

              <p className="mt-3 line-clamp-2 text-sm font-bold text-gray-100">
                {stream.title}
              </p>
              <Link
                href={`/streamers/${stream.user_login}`}
                className="mt-1 inline-block text-sm text-gray-400 transition hover:text-purple-400 hover:underline"
              >
                {stream.user_name} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
