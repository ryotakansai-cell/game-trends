import Image from "next/image";
import Link from "next/link";
import {
  getTopStreams,
  getUsersByLogin,
  streamThumb,
  elapsedSince,
  formatViewers,
} from "@/lib/twitch";

export const revalidate = 180;

type Props = {
  searchParams: Promise<{ lang?: string }>;
};

export default async function Home({ searchParams }: Props) {
  const { lang } = await searchParams;
  const isJapanese = lang !== "all";

  const streams = await getTopStreams({
    language: isJapanese ? "ja" : undefined,
    limit: 40,
  });

  const totalViewers = streams.reduce((sum, s) => sum + s.viewer_count, 0);
  const users = await getUsersByLogin(streams.map((s) => s.user_login));

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-purple-400">配信ランキング</h1>
          <p className="mt-2 text-sm text-gray-400">
            いま配信中 ・ 上位{streams.length}配信で
            <span className="font-bold text-purple-300">
              {formatViewers(totalViewers)}人
            </span>
            が視聴中
          </p>
        </div>

        <Link
          href="/games"
          className="text-sm text-gray-500 hover:text-purple-400"
        >
          ゲームランキング →
        </Link>
      </div>

      {/* 言語切替タブ */}
      <div className="mt-6 flex gap-2">
        <Link
          href="/"
        className={`rounded-full px-4 py-1.5 text-sm transition ${
            isJapanese
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
        >
          日本語
        </Link>
        <Link
          href="/?lang=all"
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            !isJapanese
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
        >
          全世界
        </Link>
      </div>

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

            <p
              className="mt-3 truncate font-bold text-gray-100"
              title={stream.title}
            >
              {stream.title}
            </p>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Link
                href={`/streamers/${stream.user_login}`}
                className="flex shrink-0 items-center gap-2 text-gray-300 hover:text-purple-300"
              >
                {users.get(stream.user_login) && (
                  <Image
                    src={users.get(stream.user_login)!.profile_image_url}
                    alt={stream.user_name}
                    width={28}
                    height={28}
                    className="rounded-full ring-1 ring-white/10"
                  />
                )}
                <span className="truncate">{stream.user_name}</span>
              </Link>
              {stream.game_id && (
                <>
                  <span className="text-gray-700">·</span>
                  <Link
                    href={`/games/${stream.game_id}`}
                    className="truncate text-xs text-gray-500 transition hover:text-purple-400 hover:underline"
                  >
                    {stream.game_name} →
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
