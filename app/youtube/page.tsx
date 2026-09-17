import Image from "next/image";
import Link from "next/link";
import { getTopYouTubeLive, youtubeThumbnail } from "@/lib/youtube";
import { formatViewers } from "@/lib/twitch";

export const revalidate = 300;

type Props = {
  searchParams: Promise<{ lang?: string }>;
};

export default async function YouTubePage({ searchParams }: Props) {
  const { lang } = await searchParams;
  const isJapanese = lang !== "all";

  const videos = await getTopYouTubeLive(isJapanese ? "jp" : undefined, 40);

  const totalViewers = videos.reduce((sum, v) => sum + v.viewers, 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-purple-400">
            YouTube Liveランキング
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            いま配信中 ・ 上位{videos.length}配信で
            <span className="font-bold text-purple-300">
              {formatViewers(totalViewers)}人
            </span>
            が視聴中
          </p>
        </div>

        <div className="flex gap-4">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-purple-400"
          >
            配信ランキング →
          </Link>
          <Link
            href="/games"
            className="text-sm text-gray-500 hover:text-purple-400"
          >
            ゲームランキング →
          </Link>
        </div>
      </div>

      {/* 日本語/全世界切替タブ */}
      <div className="mt-6 flex gap-2">
        <Link
          href="/youtube"
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            isJapanese
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
        >
          日本語
        </Link>
        <Link
          href="/youtube?lang=all"
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            !isJapanese
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
        >
          全世界
        </Link>
      </div>

      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video, index) => (
          <li key={video.video_id} className="group">
            <a
              href={`https://www.youtube.com/watch?v=${video.video_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="relative overflow-hidden rounded-lg border border-white/10">
                <Image
                  src={youtubeThumbnail(video.video_id)}
                  alt={video.title}
                  width={480}
                  height={360}
                  className="w-full transition duration-300 group-hover:scale-105"
                  unoptimized
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/90 px-2 py-0.5 text-xs font-bold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  {formatViewers(video.viewers)}
                </span>
              </div>
            </a>

            <p
              className="mt-3 truncate font-bold text-gray-100"
              title={video.title}
            >
              {video.title}
            </p>

            <p className="mt-2 truncate text-sm text-gray-300">
              {video.channel_title}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
