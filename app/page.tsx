import Image from "next/image";
import Link from "next/link";
import {
  getTopStreams,
  getUsersByLogin,
  streamThumb,
  elapsedSince,
  formatViewers,
} from "@/lib/twitch";
import {
  getTopYouTubeLive,
  youtubeThumbnail,
  getChannelIcons,
} from "@/lib/youtube";

export const revalidate = 180;

type Props = {
  searchParams: Promise<{ lang?: string; platform?: string }>;
};

type Platform = "all" | "twitch" | "youtube";

/** 表示用に、TwitchとYouTubeの形を1つに揃えたもの */
type UnifiedEntry = {
  key: string;
  platform: "twitch" | "youtube";
  title: string;
  viewers: number;
  thumbnailUrl: string;
  watchHref: string;
  channelName: string;
  channelHref?: string;
  channelIconUrl?: string;
  gameName?: string;
  gameHref?: string;
  elapsed?: string;
};

/** 選んだタブを維持したまま、リンク先のURLを組み立てる */
function buildHref(platform: Platform, isJapanese: boolean) {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (!isJapanese) params.set("lang", "all");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({ searchParams }: Props) {
  const { lang, platform } = await searchParams;
  const isJapanese = lang !== "all";
  const selectedPlatform: Platform =
    platform === "twitch" || platform === "youtube" ? platform : "all";

  const showTwitch = selectedPlatform !== "youtube";
  const showYouTube = selectedPlatform !== "twitch";

  const [twitchStreams, youtubeVideos] = await Promise.all([
    showTwitch
      ? getTopStreams({ language: isJapanese ? "ja" : undefined, limit: 40 })
      : Promise.resolve([]),
    showYouTube
      ? getTopYouTubeLive(isJapanese ? "jp" : undefined, 40)
      : Promise.resolve([]),
  ]);

  const [users, youtubeIcons] = await Promise.all([
    getUsersByLogin(twitchStreams.map((s) => s.user_login)),
    getChannelIcons(youtubeVideos.map((v) => v.channel_id)),
  ]);

  const twitchEntries: UnifiedEntry[] = twitchStreams.map((s) => ({
    key: `twitch-${s.id}`,
    platform: "twitch",
    title: s.title,
    viewers: s.viewer_count,
    thumbnailUrl: streamThumb(s.thumbnail_url),
    watchHref: `https://twitch.tv/${s.user_login}`,
    channelName: s.user_name,
    channelHref: `/streamers/${s.user_login}`,
    channelIconUrl: users.get(s.user_login)?.profile_image_url,
    gameName: s.game_name || undefined,
    gameHref: s.game_id ? `/games/${s.game_id}` : undefined,
    elapsed: elapsedSince(s.started_at),
  }));

  const youtubeEntries: UnifiedEntry[] = youtubeVideos.map((v) => ({
    key: `youtube-${v.video_id}`,
    platform: "youtube",
    title: v.title,
    viewers: v.viewers,
    thumbnailUrl: youtubeThumbnail(v.video_id),
    watchHref: `https://www.youtube.com/watch?v=${v.video_id}`,
    channelName: v.channel_title,
    channelHref: `https://www.youtube.com/channel/${v.channel_id}`,
    channelIconUrl: youtubeIcons.get(v.channel_id),
  }));

  const entries = [...twitchEntries, ...youtubeEntries]
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 40);

  const totalViewers = entries.reduce((sum, e) => sum + e.viewers, 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-purple-400">Live Ranking</h1>
          <p className="mt-2 text-sm text-gray-400">
            配信中 ・ 上位{entries.length}配信で
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

      {/* プラットフォーム/言語切替（セグメント型、必ず縦に2段） */}
      <div className="mt-6 flex flex-col gap-2">
        <div className="inline-flex w-fit gap-1 rounded-lg bg-white/5 p-1">
          {(
            [
              ["all", "All"],
              ["twitch", "Twitch"],
              ["youtube", "YouTube"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={buildHref(value, isJapanese)}
              className={`rounded-md px-3.5 py-1.5 text-sm transition ${
                selectedPlatform === value
                  ? "bg-purple-500 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="inline-flex w-fit gap-1 rounded-lg bg-white/5 p-1">
          <Link
            href={buildHref(selectedPlatform, true)}
            className={`rounded-md px-3.5 py-1.5 text-sm transition ${
              isJapanese
                ? "bg-purple-500 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            JP
          </Link>
          <Link
            href={buildHref(selectedPlatform, false)}
            className={`rounded-md px-3.5 py-1.5 text-sm transition ${
              !isJapanese
                ? "bg-purple-500 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Global
          </Link>
        </div>
      </div>

      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry, index) => (
          <li key={entry.key} className="group">
            <a href={entry.watchHref} target="_blank" rel="noopener noreferrer">
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
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/90 px-2 py-0.5 text-xs font-bold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  {formatViewers(entry.viewers)}
                </span>
                {selectedPlatform === "all" && (
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                    {entry.platform === "twitch" ? "Twitch" : "YouTube"}
                  </span>
                )}
                {entry.elapsed && (
                  <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                    {entry.elapsed}
                  </span>
                )}
              </div>
            </a>

            <p
              className="mt-3 truncate font-bold text-gray-100"
              title={entry.title}
            >
              {entry.title}
            </p>

            <div className="mt-2 flex items-center gap-2 text-sm">
              {entry.channelHref ? (
                entry.channelHref.startsWith("http") ? (
                  <a
                    href={entry.channelHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-2 text-gray-300 hover:text-purple-300"
                  >
                    {entry.channelIconUrl && (
                      <Image
                        src={entry.channelIconUrl}
                        alt={entry.channelName}
                        width={28}
                        height={28}
                        className="rounded-full ring-1 ring-white/10"
                      />
                    )}
                    <span className="truncate">{entry.channelName}</span>
                  </a>
                ) : (
                  <Link
                    href={entry.channelHref}
                    className="flex shrink-0 items-center gap-2 text-gray-300 hover:text-purple-300"
                  >
                    {entry.channelIconUrl && (
                      <Image
                        src={entry.channelIconUrl}
                        alt={entry.channelName}
                        width={28}
                        height={28}
                        className="rounded-full ring-1 ring-white/10"
                      />
                    )}
                    <span className="truncate">{entry.channelName}</span>
                  </Link>
                )
              ) : (
                <span className="truncate text-gray-300">
                  {entry.channelName}
                </span>
              )}
              {entry.gameName && (
                <>
                  <span className="text-gray-700">·</span>
                  <Link
                    href={entry.gameHref!}
                    className="truncate text-xs text-gray-500 transition hover:text-purple-400 hover:underline"
                  >
                    {entry.gameName} →
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
