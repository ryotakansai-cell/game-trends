import { cache } from "react";
import type { Metadata } from "next";
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

// 同じユーザー情報を generateMetadata と本体の両方で使うので
// cache() で1リクエスト内の呼び出しをまとめる
const loadUser = cache((login: string) => getUserByLogin(login));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const user = await loadUser(login);
  if (!user) return { title: "見つかりません" };

  const title = `${user.display_name}のクリップ・アーカイブ`;
  const description = `${user.display_name}（Twitch: ${user.login}）の人気クリップと過去の配信を一覧。配信中かどうかもわかります。`;

  return {
    title,
    description,
    alternates: { canonical: `/streamers/${login}` },
    openGraph: { title, description, url: `/streamers/${login}` },
  };
}

export default async function StreamerPage({ params }: Props) {
  const { login } = await params;

  const user = await loadUser(login);
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
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      {/* プロフィール */}
      <div className="flex flex-wrap items-start gap-5 rounded-xl border border-white/10 bg-white/5 p-6">
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
          {/* 以前は全体を <a> で包み、その中にゲームの <Link> を入れていた。
              リンクの中にリンクを入れるのはHTMLとして不正なので、
              配信へのリンク（サムネとタイトル）とゲームへのリンクを分けた。
              スマホではサムネを画面幅いっぱいにせず、左に小さく置く */}
          <div className="group mt-4 flex gap-3 rounded-xl border border-white/10 p-3 transition hover:border-purple-400/50 sm:gap-5 sm:p-4">
            <a
              href={`https://twitch.tv/${user.login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg sm:w-80"
            >
              <Image
                src={streamThumb(stream.thumbnail_url)}
                alt={stream.title}
                fill
                className="object-cover"
                unoptimized
              />
            </a>
            <div className="min-w-0 flex-1">
              <a
                href={`https://twitch.tv/${user.login}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <p className="line-clamp-2 text-sm font-bold text-gray-100 group-hover:text-purple-300 sm:text-base">
                  {stream.title}
                </p>
              </a>
              <p className="mt-2 text-xs text-gray-400 sm:text-sm">
                {formatViewers(stream.viewer_count)}人が視聴中 ・{" "}
                {elapsedSince(stream.started_at)}経過
              </p>
              {stream.game_id && (
                <Link
                  href={`/games/${stream.game_id}`}
                  className="mt-2 inline-block text-xs text-gray-200 transition hover:text-purple-400 sm:text-sm"
                >
                  {stream.game_name}
                </Link>
              )}
            </div>
          </div>
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
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {clips.map((clip) => (
              <li key={clip.id} className="group">
                {/* スマホでは「サムネ左・文字右」の横並び、sm以上では縦積み */}
                <a
                  href={clip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 sm:block"
                >
                  <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:w-auto">
                    <Image
                      src={clip.thumbnail_url}
                      alt={clip.title}
                      fill
                      className="object-cover transition duration-300 group-hover:scale-105"
                      unoptimized
                    />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white sm:bottom-2 sm:right-2 sm:text-xs">
                      {Math.round(clip.duration)}秒
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300 sm:mt-2">
                      {clip.title}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {clip.view_count.toLocaleString("ja-JP")}回再生 ・{" "}
                      {formatDate(clip.created_at)}
                    </p>
                  </div>
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
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {videos.map((video) => (
              <li key={video.id} className="group">
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 sm:block"
                >
                  <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:w-auto">
                    <Image
                      src={videoThumb(video.thumbnail_url)}
                      alt={video.title}
                      fill
                      className="object-cover transition duration-300 group-hover:scale-105"
                      unoptimized
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300 sm:mt-2">
                      {video.title}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {video.view_count.toLocaleString("ja-JP")}回視聴 ・{" "}
                      {video.duration} ・ {formatDate(video.created_at)}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
