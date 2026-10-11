import type { Metadata } from "next";
import Image from "next/image";
import { ShareOnX } from "@/components/ShareOnX";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  getDailySummary,
  getDayRange,
  isAvailableDay,
  dayTitle,
  shiftDay,
  type DailyEntry,
} from "@/lib/daily";
import {
  getGamesByIds,
  boxArt,
  formatViewers,
  type TwitchGame,
} from "@/lib/twitch";
import { accountHref, accountKey, PLATFORM_NAMES } from "@/lib/platforms";
import { getAccountIcons } from "@/lib/platform-loaders";
import { PageHeader } from "@/components/PageHeader";
import { PlatformIcon } from "@/components/PlatformIcons";

// 過去の日の内容は変わらないので、初めて開かれたときに作って1日作り置きする。
// generateStaticParams が空の配列を返すと「ビルド時には作らず、開かれたら作って保存する」になる
// （日付は毎日増えるので、ビルド時に全部作ることはしない）
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ date: string }> };

const loadSummary = cache(async (date: string) =>
  (await isAvailableDay(date)) ? getDailySummary(date) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const summary = await loadSummary(date);
  if (!summary) return { title: "見つかりません" };

  const top = summary.topPeak[0];
  const title = `${dayTitle(date)}の配信ランキング`;
  const description = top
    ? `${dayTitle(date)}に最も見られた配信者は${top.displayName}（最高同接${top.peakViewers.toLocaleString("ja-JP")}人）。${PLATFORM_NAMES}の最高同接ランキング、前日から伸びた配信者、長時間配信、見られたゲーム。`
    : `${dayTitle(date)}の${PLATFORM_NAMES}の配信ランキング。`;
  return {
    title,
    description,
    alternates: { canonical: `/daily/${date}` },
    openGraph: { title, description, url: `/daily/${date}` },
  };
}

/** 配信者1人分の行。アイコン・名前・配信元のアイコン・右側の数字 */
function EntryRow({
  rank,
  entry,
  iconUrl,
  detail,
  value,
}: {
  rank?: number;
  entry: DailyEntry;
  iconUrl?: string;
  detail?: string;
  value: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-white/5 py-2.5 first:border-t-0">
      {rank !== undefined && (
        <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500">
          {rank}
        </span>
      )}
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/5">
        {iconUrl && (
          <Image
            src={iconUrl}
            alt={entry.displayName}
            fill
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={accountHref(entry)}
          className="flex min-w-0 items-center gap-1.5 text-sm text-gray-100 transition hover:text-purple-300"
        >
          <span className="truncate">{entry.displayName}</span>
          <span className="shrink-0 text-gray-500">
            <PlatformIcon platform={entry.platform} />
          </span>
        </Link>
        {detail && (
          <p className="mt-0.5 truncate text-xs text-gray-500">{detail}</p>
        )}
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums text-gray-200">
        {value}
      </div>
    </li>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-gray-200">
        {title}
        {note && (
          <span className="ml-2 text-sm font-normal text-gray-500">{note}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

export default async function DailyPage({ params }: Props) {
  const { date } = await params;
  const summary = await loadSummary(date);
  if (!summary) notFound();

  const all = [
    ...summary.topPeak,
    ...summary.longest,
    ...summary.rising,
    ...summary.personalBests,
  ];
  const [range, icons, games] = await Promise.all([
    getDayRange(),
    // 同じ人が複数の一覧に出るので、配信元ごとに重複を除いてから取る
    getAccountIcons([...new Map(all.map((e) => [accountKey(e), e])).values()]),
    getGamesByIds([
      ...summary.games.map((g) => g.gameId),
      ...all.map((e) => e.topGameId).filter((id): id is string => id !== null),
    ]).catch(() => new Map<string, TwitchGame>()),
  ]);

  const iconOf = (e: DailyEntry) => icons.get(accountKey(e));
  const gameName = (e: DailyEntry) =>
    e.topGameId ? games.get(e.topGameId)?.name : undefined;

  const prevDay = shiftDay(date, -1);
  const nextDay = shiftDay(date, 1);
  const hasPrev = range !== null && prevDay >= range.first;
  const hasNext = range !== null && nextDay <= range.last;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="DAILY"
        title={`${dayTitle(date)}の配信`}
        summary={
          <>
            日本の配信者{summary.streamers.toLocaleString("ja-JP")}
            人の記録から（{PLATFORM_NAMES}）
            <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
              {hasPrev && (
                <Link
                  href={`/daily/${prevDay}`}
                  className="transition hover:text-purple-300"
                >
                  ← {dayTitle(prevDay)}
                </Link>
              )}
              {hasNext && (
                <Link
                  href={`/daily/${nextDay}`}
                  className="transition hover:text-purple-300"
                >
                  {dayTitle(nextDay)} →
                </Link>
              )}
              <Link href="/daily" className="transition hover:text-purple-300">
                日付の一覧
              </Link>
            </span>
            <span className="mt-3 block">
              <ShareOnX
                text={`${dayTitle(date)}の配信ランキング`}
                path={`/daily/${date}`}
              />
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
        <Section title="最高同接ランキング" note="その日一番見られた瞬間">
          <ol className="mt-3">
            {summary.topPeak.map((e, i) => (
              <EntryRow
                key={`${e.platform}-${e.platformId}`}
                rank={i + 1}
                entry={e}
                iconUrl={iconOf(e)}
                detail={[gameName(e), `${e.hoursLive}時間`]
                  .filter(Boolean)
                  .join(" ・ ")}
                value={`${formatViewers(e.peakViewers)}人`}
              />
            ))}
          </ol>
        </Section>

        <div>
          {summary.rising.length > 0 && (
            <Section title="前日から伸びた配信者" note="最高同接の比較">
              <ul className="mt-3">
                {summary.rising.map((e) => (
                  <EntryRow
                    key={`${e.platform}-${e.platformId}`}
                    entry={e}
                    iconUrl={iconOf(e)}
                    detail={`${formatViewers(e.prevPeak!)}人 → ${formatViewers(e.peakViewers)}人`}
                    value={
                      <span className="text-purple-300">
                        +{Math.round((e.peakViewers / e.prevPeak! - 1) * 100)}%
                      </span>
                    }
                  />
                ))}
              </ul>
            </Section>
          )}

          {summary.personalBests.length > 0 && (
            <Section title="自己ベスト更新" note="直近30日の自分の最高を更新">
              <ul className="mt-3">
                {summary.personalBests.map((e) => (
                  <EntryRow
                    key={`${e.platform}-${e.platformId}`}
                    entry={e}
                    iconUrl={iconOf(e)}
                    detail={`これまでの最高 ${formatViewers(e.prevPeak!)}人`}
                    value={`${formatViewers(e.peakViewers)}人`}
                  />
                ))}
              </ul>
            </Section>
          )}
          <Section title="長時間配信">
            <ul className="mt-3">
              {summary.longest.map((e) => (
                <EntryRow
                  key={`${e.platform}-${e.platformId}`}
                  entry={e}
                  iconUrl={iconOf(e)}
                  detail={`最高 ${formatViewers(e.peakViewers)}人`}
                  value={`${e.hoursLive}時間`}
                />
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {summary.games.length > 0 && (
        <Section title="見られたゲーム" note="日本語の Twitch 配信・1日平均">
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {summary.games.map((g, i) => {
              const game = games.get(g.gameId);
              if (!game) return null;
              return (
                <li key={g.gameId}>
                  <Link
                    href={`/games/${g.gameId}`}
                    className="group flex items-center gap-3 rounded-lg border border-white/10 p-2 transition hover:border-purple-400/50"
                  >
                    <div className="relative h-14 w-[42px] shrink-0 overflow-hidden rounded bg-white/5">
                      <Image
                        src={boxArt(game.box_art_url, 84, 112)}
                        alt={game.name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{i + 1}位</p>
                      <p className="truncate text-sm text-gray-200 group-hover:text-purple-300">
                        {game.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatViewers(g.avgViewers)}人
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </main>
  );
}
