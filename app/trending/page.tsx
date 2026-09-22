import Image from "next/image";
import Link from "next/link";
import {
  getRisingStreamers,
  twitchThumbnailFromLogin,
  formatViewers,
} from "@/lib/twitch";
import { getRisingYouTubeLive, youtubeThumbnail } from "@/lib/youtube";

// 5分間キャッシュする。cronが数時間おきなので、これ以上短くしても意味がない
export const revalidate = 300;

// トップページの UnifiedEntry と同じ考え方。
// TwitchとYouTubeの形が違うので、表示用の共通の形に揃える
type RisingEntry = {
  key: string;
  platform: "twitch" | "youtube";
  title: string; // 配信タイトル
  channelName: string; // 配信者名
  thumbnailUrl: string;
  watchHref: string; // 配信を見に行くリンク（外部）
  currentViewers: number;
  pastViewers: number;
  growthRate: number; // 0.35 なら 35%増
};

export default async function TrendingPage() {
  // 2つのDB問い合わせを同時に走らせる（順番に待つより速い）
  const [twitchRising, youtubeRising] = await Promise.all([
    getRisingStreamers(200, 20),
    getRisingYouTubeLive(50, 20),
  ]);

  // Twitchの結果を共通の形に変換
  const twitchEntries: RisingEntry[] = twitchRising.map((s) => ({
    key: `twitch-${s.streamer_id}`,
    platform: "twitch",
    // ?? は「左がnullなら右を使う」（C#と同じ）。
    // cronが次に回るまでは古い行のtitleがnullなので、当面は配信者名が出る
    title: s.title ?? s.display_name,
    channelName: s.display_name,
    thumbnailUrl: twitchThumbnailFromLogin(s.login),
    watchHref: `https://twitch.tv/${s.login}`,
    currentViewers: s.current_viewers,
    pastViewers: s.past_viewers,
    growthRate: s.growth_rate,
  }));

  // YouTubeの結果も同じ形に変換
  const youtubeEntries: RisingEntry[] = youtubeRising.map((v) => ({
    key: `youtube-${v.channel_id}`,
    platform: "youtube",
    title: v.video_title,
    channelName: v.channel_title,
    thumbnailUrl: youtubeThumbnail(v.video_id),
    watchHref: `https://www.youtube.com/watch?v=${v.video_id}`,
    currentViewers: v.current_viewers,
    pastViewers: v.past_viewers,
    growthRate: v.growth_rate,
  }));

  // 2つを混ぜて、増加率が高い順に並べ直す
  const entries = [...twitchEntries, ...youtubeEntries]
    .sort((a, b) => b.growthRate - a.growthRate)
    .slice(0, 30);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-purple-400">Trending</h1>
          <p className="mt-2 text-sm text-gray-400">
            24時間前と比べて伸びている配信 ・ {entries.length}件
          </p>
        </div>

        <div className="flex gap-4">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-purple-400"
          >
            Live Ranking →
          </Link>
          <Link
            href="/games"
            className="text-sm text-gray-500 hover:text-purple-400"
          >
            ゲームランキング →
          </Link>
        </div>
      </div>

      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry, index) => (
          <li key={entry.key} className="group">
            <a href={entry.watchHref} target="_blank" rel="noopener noreferrer">
              {/* aspect-video で縦横比を固定。TwitchとYouTubeでサムネの
                  元サイズが違っても、カードの高さが揃う */}
              <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10">
                <Image
                  src={entry.thumbnailUrl}
                  alt={entry.title}
                  fill
                  className="object-cover transition duration-300 group-hover:scale-105"
                  unoptimized
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                  {index + 1}
                </span>
                {/* 急上昇ページの主役なので、増加率を目立つ緑バッジで表示 */}
                <span className="absolute right-2 top-2 rounded bg-green-600/90 px-2 py-0.5 text-xs font-bold text-white">
                  +{Math.round(entry.growthRate * 100)}%
                </span>
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                  {entry.platform === "twitch" ? "Twitch" : "YouTube"}
                </span>
              </div>
            </a>

            <p
              className="mt-3 truncate font-bold text-gray-100"
              title={entry.title}
            >
              {entry.title}
            </p>

            <div className="mt-1 text-sm text-gray-400">
              {entry.channelName}
            </div>

            {/* 「1068人 → 3091人」という変化そのものを見せる */}
            <div className="mt-1 text-xs text-gray-500">
              {formatViewers(entry.pastViewers)}人 →{" "}
              <span className="font-bold text-purple-300">
                {formatViewers(entry.currentViewers)}人
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
