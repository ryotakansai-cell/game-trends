import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUserByLogin,
  getStreamByLogin,
  getClipsByBroadcaster,
  getVideosByUser,
  streamThumb,
  videoThumb,
  elapsedSince,
  formatViewers,
  formatDate,
} from "@/lib/twitch";

export const revalidate = 300;

type Props = {
  params: Promise<{ login: string }>;
};

export default async function StreamerPage({ params }: Props) {
  const { login } = await params;

  const user = await getUserByLogin(login);
  if (!user) notFound();

  const [stream, clips, videos] = await Promise.all([
    getStreamByLogin(login).catch(() => null),
    getClipsByBroadcaster(user.id, 7, 12).catch(() => []),
    getVideosByUser(user.id, 6).catch(() => []),
  ]);

  const q = encodeURIComponent(user.display_name);

  const links = [
    { label: "Twitchで開く", url: `https://twitch.tv/${user.login}` },
    {
      label: "YouTubeで検索",
      url: `https://www.youtube.com/results?search_query=${q}`,
    },
    {
      label: "切り抜きを検索",
      url: `https://www.youtube.com/results?search_query=${q}+切り抜き`,
    },
    { label: "Xで検索", url: `https://x.com/search?q=${q}` },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-purple-400">
        ← 配信ランキング
      </Link>

      {/* プロフィール */}
      <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/5 p-6">
        <Image
          src={user.profile_image_url}
          alt={user.display_name}
          width={96}
          height={96}
          className="rounded-full ring-2 ring-purple-500/40"
        />

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-100">
              {user.display_name}
            </h1>
            {stream && (
              <span className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                LIVE
              </span>
            )}
          </div>

          {user.description && (
            <p className="mt-2 line-clamp-2 text-sm text-gray-400">
              {user.description}
            </p>
          )}

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

      {/* 配信中なら表示 */}
      {stream && (
        <section className="mt-10">
          <h2 className="text-lg font-bold text-gray-200">配信中</h2>
          <a
            href={`https://twitch.tv/${user.login}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-4 flex flex-wrap gap-5 rounded-xl border border-white/10 p-4 transition hover:border-purple-400/50"
          >
            <Image
              src={streamThumb(stream.thumbnail_url)}
              alt={stream.title}
              width={320}
              height={180}
              className="rounded-lg"
              unoptimized
            />
            <div className="flex-1">
              <p className="font-bold text-gray-100 group-hover:text-purple-300">
                {stream.title}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                {formatViewers(stream.viewer_count)}人が視聴中 ・{" "}
                {elapsedSince(stream.started_at)}経過
              </p>
              {stream.game_id && (
                <Link
                  href={`/games/${stream.game_id}`}
                  className="mt-2 inline-block text-sm text-gray-500 hover:text-purple-400 hover:underline"
                >
                  {stream.game_name} →
                </Link>
              )}
            </div>
          </a>
        </section>
      )}

      {/* クリップ */}
      <section className="mt-10">
        <h2 className="text-lg font-bold text-gray-200">今週の人気クリップ</h2>
        {clips.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            直近1週間のクリップはありません。
          </p>
        ) : (
          <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {clips.map((clip) => (
              <li key={clip.id} className="group">
                <a href={clip.url} target="_blank" rel="noopener noreferrer">
                  <div className="relative overflow-hidden rounded-lg border border-white/10">
                    <Image
                      src={clip.thumbnail_url}
                      alt={clip.title}
                      width={320}
                      height={180}
                      className="w-full transition duration-300 group-hover:scale-105"
                      unoptimized
                    />
                    <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                      {Math.round(clip.duration)}秒
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300">
                    {clip.title}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {clip.view_count.toLocaleString("ja-JP")}回再生 ・{" "}
                    {formatDate(clip.created_at)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* アーカイブ */}
      <section className="mt-10">
        <h2 className="text-lg font-bold text-gray-200">過去の配信</h2>
        {videos.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            公開されているアーカイブはありません。
          </p>
        ) : (
          <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <li key={video.id} className="group">
                <a href={video.url} target="_blank" rel="noopener noreferrer">
                  <Image
                    src={videoThumb(video.thumbnail_url)}
                    alt={video.title}
                    width={320}
                    height={180}
                    className="w-full rounded-lg border border-white/10 transition duration-300 group-hover:scale-105"
                    unoptimized
                  />
                  <p className="mt-2 line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300">
                    {video.title}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {video.view_count.toLocaleString("ja-JP")}回視聴 ・{" "}
                    {video.duration} ・ {formatDate(video.created_at)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
