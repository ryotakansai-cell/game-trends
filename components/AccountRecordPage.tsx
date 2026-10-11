import Image from "next/image";
import { ShareOnX } from "@/components/ShareOnX";
import { StreamStats } from "@/components/StreamStats";
import { DayStreams } from "@/components/DayStreams";
import {
  getAccountStats,
  getRecentStreams,
  type AccountInfo,
} from "@/lib/account-stats";
import { loadStatsExtras, pickSelectedDay } from "@/lib/stats-extras";
import { getAccountIcons } from "@/lib/platform-loaders";
import { PLATFORMS, accountKey, toPlatformId } from "@/lib/platforms";
import { formatViewers, formatDate } from "@/lib/twitch";
import { dayTitle } from "@/lib/daily";

/** 名寄せしていない人の、配信元ごとのページの中身（YouTube・ツイキャスで共通）。
 *  記録（DB）だけで作り、配信元の API はアイコンの分しか使わない。
 *  sitemap に載せて検索エンジンに何千ページも巡回されるので、表示のたびに API を呼ぶと
 *  YouTube は1日の枠を、ツイキャスは1分60回の上限を使い切ってしまうため。
 *  Twitch は API に余裕があり、クリップやアーカイブも出すので別のページ（/streamers/[login]）にしている */
export async function AccountRecordPage({
  account,
  day,
}: {
  account: AccountInfo;
  /** ?day=2026-10-08：グラフで選んだ日。その日の配信をグラフの下に出す */
  day?: string;
}) {
  const ref = {
    platform: toPlatformId(account.platform),
    platformId: account.platformId,
    login: account.login,
  };
  const info = PLATFORMS[ref.platform];
  const selfPath = info.accountPath(ref);

  const [stats, streams, icons] = await Promise.all([
    getAccountStats(account.id).catch(() => null),
    getRecentStreams(account.id).catch(() => []),
    getAccountIcons([ref]),
  ]);
  const iconUrl = icons.get(accountKey(ref));
  const name = account.displayName;

  // 時間帯・選んだ日の配信（ゲームの情報は Twitch にしか無いので、同じゲームの人は出ない）
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
    { label: `${info.label}で開く`, url: info.profileUrl(ref) },
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
          <p className="mt-2 text-sm text-gray-400">{info.label}</p>
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
            <ShareOnX text={`${name}の同接・配信時間`} path={selfPath} />
          </div>
        </div>
      </div>

      {/* ゲームの情報は Twitch にしか無いので、「よく遊んだゲーム」は出ない */}
      <StreamStats
        stats={stats}
        games={new Map()}
        heatmap={extras.heatmap}
        dayHref={(d) => `${selfPath}?day=${d}`}
        selectedDay={selectedDay}
        dayPanel={
          selectedDay ? (
            <DayStreams
              dayLabel={dayTitle(selectedDay)}
              closeHref={selfPath}
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
            {streams.map((s, i) => {
              const live = i === 0 && isLive;
              // 配信中ならいまのサムネイル、終わった配信は配信元が用意している分だけ
              const thumbnail = live
                ? info.liveThumbnail(ref, s.contentId)
                : info.pastThumbnail(ref, s.contentId);
              return (
                <li key={s.contentId} className="group">
                  {/* スマホでは「サムネ左・文字右」の横並び、sm以上では縦積み */}
                  <a
                    href={
                      (live ? info.liveUrl(ref, s.contentId) : null) ??
                      info.pastStreamUrl(ref, s.contentId) ??
                      info.profileUrl(ref)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 sm:block"
                  >
                    <div className="relative flex aspect-video w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5 text-xs text-gray-600 sm:w-auto">
                      {thumbnail ? (
                        <Image
                          src={thumbnail}
                          alt={s.title}
                          fill
                          className="object-cover transition duration-300 group-hover:scale-105"
                          unoptimized
                        />
                      ) : (
                        // サムネイルが無い配信元は、空の枠に配信元の名前だけ出す（並びをそろえるため）
                        info.label
                      )}
                      {live && (
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
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
