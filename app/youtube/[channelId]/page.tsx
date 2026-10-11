import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { ShareOnX } from "@/components/ShareOnX";
import { notFound, redirect } from "next/navigation";
import {
  getAccountInfo,
  getAccountStats,
  getRecentStreams,
} from "@/lib/account-stats";
import { getChannelIcons, youtubeThumbnail } from "@/lib/youtube";
import { formatViewers, formatDate } from "@/lib/twitch";
import { StreamStats } from "@/components/StreamStats";
import { DayStreams } from "@/components/DayStreams";
import { loadStatsExtras, pickSelectedDay } from "@/lib/stats-extras";
import { dayTitle } from "@/lib/daily";

export const revalidate = 300;

type Props = {
  params: Promise<{ channelId: string }>;
  // ?day=2026-10-08：グラフで選んだ日。その日の配信をグラフの下に出す
  searchParams: Promise<{ day?: string }>;
};

// YouTube のチャンネルIDは「UC + 22文字」。形が違うURLは DB を引かずに404にする
const CHANNEL_ID = /^UC[\w-]{22}$/;

const loadAccount = cache((channelId: string) =>
  CHANNEL_ID.test(channelId) ? getAccountInfo("youtube", channelId) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channelId } = await params;
  const account = await loadAccount(channelId);
  if (!account) return { title: "見つかりません" };

  const name = account.displayName;
  const title = `${name}の同接・配信時間`;
  const description = `${name}（YouTube）の直近30日の平均同接・最高同接・配信時間と、最近のライブ配信。`;
  return {
    title,
    description,
    alternates: { canonical: `/youtube/${channelId}` },
    openGraph: { title, description, url: `/youtube/${channelId}` },
  };
}

/** YouTube だけで配信している人のページ。
 *  記録（DB）だけで作り、YouTube API はアイコンの1回（1日作り置き）しか使わない。
 *  検索エンジンに何千ページも巡回されても、1日の枠を使い切らないようにするため */
export default async function YouTubeChannelPage({
  params,
  searchParams,
}: Props) {
  const { channelId } = await params;
  const { day } = await searchParams;
  const account = await loadAccount(channelId);
  // 記録に無いチャンネルはページを作らない（どんなIDでも表示すると、その分 API を呼ばれる）
  if (!account) notFound();

  // 名寄せ済みなら、Twitch などもまとめた人物のページへ。同じ内容のページを2つ作らない
  if (account.creatorId !== null) redirect(`/creators/${account.creatorId}`);

  const [stats, streams, icons] = await Promise.all([
    getAccountStats(account.id).catch(() => null),
    getRecentStreams(account.id).catch(() => []),
    getChannelIcons([channelId]).catch(() => new Map<string, string>()),
  ]);
  const iconUrl = icons.get(channelId);
  const name = account.displayName;

  // 時間帯・選んだ日の配信（YouTube にはゲームの情報が無いので、同じゲームの人は出ない）
  const selectedDay = pickSelectedDay(stats, day);
  const extras = await loadStatsExtras({
    accountIds: [account.id],
    stats,
    games: new Map(),
    selectedDay,
  });
  const q = encodeURIComponent(name);

  // 最後の記録が90分以内なら、まだ配信中とみなす（毎時の記録なので、1時間＋余裕）
  const latest = streams[0];
  const isLive =
    latest !== undefined &&
    Date.now() - new Date(latest.lastSeenAt).getTime() < 90 * 60 * 1000;

  const links = [
    {
      label: "YouTubeで開く",
      url: `https://www.youtube.com/channel/${channelId}`,
    },
    {
      label: "切り抜きを検索",
      url: `https://www.youtube.com/results?search_query=${q}+切り抜き`,
    },
    { label: "Xで検索", url: `https://x.com/search?q=${q}` },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      {/* プロフィール（Twitch の配信者ページと同じ形） */}
      <div className="flex flex-wrap items-start gap-5 rounded-xl border border-white/10 bg-white/5 p-6">
        {iconUrl && (
          <Image
            src={iconUrl}
            alt={name}
            width={96}
            height={96}
            className="rounded-full ring-2 ring-purple-500/40"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-bold text-gray-100">
              {name}
            </h1>
            {isLive && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                LIVE
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-400">YouTube</p>
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
            <ShareOnX
              text={`${name}の同接・配信時間`}
              path={`/youtube/${channelId}`}
            />
          </div>
        </div>
      </div>

      {/* YouTube にはゲームの情報が無いので、「よく遊んだゲーム」は出ない */}
      <StreamStats
        stats={stats}
        games={new Map()}
        heatmap={extras.heatmap}
        dayHref={(d) => `/youtube/${channelId}?day=${d}`}
        selectedDay={selectedDay}
        dayPanel={
          selectedDay ? (
            <DayStreams
              dayLabel={dayTitle(selectedDay)}
              closeHref={`/youtube/${channelId}`}
              streams={extras.dayStreams}
              games={extras.games}
            />
          ) : undefined
        }
      />

      <section className="mt-10">
        <h2 className="text-lg font-bold text-gray-200">最近のライブ配信</h2>
        {streams.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            記録に残っている配信はありません。
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {streams.map((s, i) => (
              <li key={s.contentId} className="group">
                {/* スマホでは「サムネ左・文字右」の横並び、sm以上では縦積み */}
                <a
                  href={`https://www.youtube.com/watch?v=${s.contentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 sm:block"
                >
                  <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:w-auto">
                    <Image
                      src={youtubeThumbnail(s.contentId)}
                      alt={s.title}
                      fill
                      className="object-cover transition duration-300 group-hover:scale-105"
                      unoptimized
                    />
                    {i === 0 && isLive && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white sm:left-2 sm:top-2 sm:text-xs">
                        配信中
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300 sm:mt-2">
                      {s.title}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      最高 {formatViewers(s.peakViewers)}人 ・{" "}
                      {formatDate(s.lastSeenAt)}
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
