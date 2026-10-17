import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";
import { getTodayRanking } from "@/lib/today";
import { getAccountIcons } from "@/lib/platform-loaders";
import { accountHref, accountKey, PLATFORM_NAMES } from "@/lib/platforms";
import { shortTitle } from "@/lib/text";
import { jstDay } from "@/lib/snapshot-range";
import { PageHeader } from "@/components/PageHeader";
import { PlatformIcon } from "@/components/PlatformIcons";
import { RelativeTime } from "@/components/RelativeTime";
import { SummaryTabs } from "@/components/SummaryTabs";

export const metadata: Metadata = {
  title: "今日これまでの配信ランキング",
  description: `${PLATFORM_NAMES}の日本の配信で、今日の0時から今までに最も見られた瞬間（最高同接）のランキング。毎時更新。`,
  alternates: { canonical: "/today" },
};

// 中身は毎時の収集で変わる。データの作り置き（lib/today.ts）は15分なので、ページも10分で作り直す
export const revalidate = 600;

/** 日本時間の「21時」 */
function jstHour(iso: string) {
  return `${new Date(new Date(iso).getTime() + 9 * 3600 * 1000).getUTCHours()}時`;
}

/** 今日（日本時間）これまでの最高同接ランキング。日付のまとめ（/daily/[date]）の「途中経過」版。
 *  毎時の収集が today_peaks に反映した「アカウントごとの今日の最高」の上位を読むだけ（lib/today.ts） */
export default async function TodayPage() {
  const { day, updatedAt, entries } = await getTodayRanking(30);
  const icons = await getAccountIcons(entries).catch(
    () => new Map<string, string>(),
  );
  const [, m, d] = (day ?? jstDay()).split("-").map(Number);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <SummaryTabs current="today" />
      <PageHeader
        eyebrow="TODAY"
        title="今日これまで"
        summary={
          <>
            {m}/{d}の0時から今までの最高同接 ・ 日本の配信者
            <span className="mt-0.5 block text-gray-500">
              更新：毎時
              {updatedAt && (
                <>
                  （<RelativeTime iso={updatedAt} />）
                </>
              )}
            </span>
          </>
        }
      />

      {entries.length === 0 ? (
        <p className="mt-10 text-sm text-gray-400">
          今日の記録はまだありません。毎時の収集のあとに出ます。
        </p>
      ) : (
        <ol className="mt-8">
          {entries.map((e, i) => {
            const iconUrl = icons.get(accountKey(e));
            return (
              <li
                key={accountKey(e)}
                className="flex items-center gap-3 border-t border-white/5 py-3 first:border-t-0"
              >
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500">
                  {i + 1}
                </span>
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/5">
                  {iconUrl && (
                    <Image
                      src={iconUrl}
                      alt={e.displayName}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={accountHref(e)}
                    className="flex min-w-0 items-center gap-1.5 text-sm text-gray-100 transition hover:text-purple-300"
                  >
                    <span className="truncate">{e.displayName}</span>
                    <span className="shrink-0 text-gray-500">
                      <PlatformIcon platform={e.platform} />
                    </span>
                  </Link>
                  {/* 最高同接だった瞬間の配信タイトル（ハッシュタグや末尾の出演者名を外して1行で） */}
                  {e.peakTitle && (
                    <p className="mt-0.5 truncate text-xs text-gray-400">
                      {shortTitle(e.peakTitle, 60)}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm tabular-nums text-gray-200">
                    {formatViewers(e.peakViewers)}人
                  </div>
                  <div className="text-xs text-gray-500">
                    {jstHour(e.peakAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
