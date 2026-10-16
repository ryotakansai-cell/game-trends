import { formatViewers } from "@/lib/twitch";
import { getCreatorIdMap } from "@/lib/creators";
import {
  PLATFORM_IDS,
  PLATFORMS,
  accountKey,
  isPlatformId,
  type PlatformId,
} from "@/lib/platforms";
import { LOADERS, getAccountIcons } from "@/lib/platform-loaders";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PageHeader } from "@/components/PageHeader";
import { PlatformFilter } from "@/components/PlatformFilter";
import { RelativeTime } from "@/components/RelativeTime";
import { LiveCards, LiveList, type LiveRow } from "@/components/LiveViews";
import { ViewToggle, type View } from "@/components/ViewToggle";
import Link from "next/link";
import { getDayRange, getDailyHeadline } from "@/lib/daily";
import { jstDay } from "@/lib/snapshot-range";

export const revalidate = 180;

// トップページは layout の default タイトルを使うので title は指定しない
export const metadata = {
  alternates: { canonical: "/" },
};

type Props = {
  searchParams: Promise<{ lang?: string; platform?: string; view?: string }>;
};

// カードは大きいので40件、リストは1行が小さいので100件まで出す
const LIMIT: Record<View, number> = { card: 40, list: 100 };

/** 選んだタブ（配信元・地域・表示の形）を維持したまま、リンク先のURLを組み立てる。
 *  表示の形も URL に残すので、リスト表示のままブックマークや共有ができる */
function buildHref(
  platform: PlatformId | "all",
  isJapanese: boolean,
  view: View,
) {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (!isJapanese) params.set("lang", "all");
  if (view === "list") params.set("view", "list");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** 「昨日のまとめ」の1行に出す、まとめがある一番新しい日の1位。
 *  日付のまとめへの入口が急上昇のページにしか無かったので、一番開かれるこのページにも置く。
 *  まとめは DB に保存したもの（終わった日）か作り置き（直近2日）から取るので、読むのは数行。
 *  取れなくてもライブのランキングは出したいので、失敗したら null（1行ごと出さない） */
async function latestDailyTop() {
  try {
    const range = await getDayRange();
    if (!range) return null;
    const { top } = await getDailyHeadline(range.last, 1);
    if (!top[0]) return null;
    const [, m, d] = range.last.split("-").map(Number);
    const yesterday = jstDay(new Date(Date.now() - 24 * 3600 * 1000));
    return {
      day: range.last,
      // 毎朝の集計（6時ごろ）までは昨日の分がまだ無いので、そのときは日付だけ出す
      label: range.last === yesterday ? `昨日（${m}/${d}）` : `${m}/${d}`,
      top: top[0],
    };
  } catch {
    return null;
  }
}

/** 「Twitch・ツイキャス 5分ごと / YouTube 毎時」。同じ間隔の配信元をまとめて、スマホでも1行に収める */
function updateLabel(platforms: PlatformId[]) {
  const byInterval = new Map<string, string[]>();
  for (const p of platforms) {
    const { liveUpdate, label } = PLATFORMS[p];
    byInterval.set(liveUpdate, [...(byInterval.get(liveUpdate) ?? []), label]);
  }
  return [...byInterval]
    .map(([interval, labels]) => `${labels.join("・")} ${interval}`)
    .join(" / ");
}

export default async function Home({ searchParams }: Props) {
  const { lang, platform, view: viewParam } = await searchParams;
  const isJapanese = lang !== "all";
  const view: View = viewParam === "list" ? "list" : "card";
  const limit = LIMIT[view];
  const selected = isPlatformId(platform) ? platform : "all";
  const targets = selected === "all" ? [...PLATFORM_IDS] : [selected];

  // 配信元ごとの上位を同時に取り、視聴者数で混ぜて並べる。
  // 取り方（API か DB か）は配信元ごとに違うが、LOADERS が同じ形（LiveEntry）にそろえて返す。
  // 1つの配信元が取れなくても、ほかの配信元は出す
  const [lists, daily] = await Promise.all([
    Promise.all(
      targets.map((p) => LOADERS[p].live(isJapanese, limit).catch(() => [])),
    ),
    latestDailyTop(),
  ]);
  const entries = lists
    .flat()
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, limit);

  // アイコンと名寄せは、並べた後の上位だけ調べる（表に出ない分まで API や DB を読まない）
  const [icons, creatorIds] = await Promise.all([
    getAccountIcons(entries.filter((e) => !e.iconUrl)),
    getCreatorIdMap(entries),
  ]);

  const rows: LiveRow[] = entries.map((entry) => ({
    entry,
    creatorId: creatorIds.get(accountKey(entry)) ?? null,
    iconUrl: entry.iconUrl ?? icons.get(accountKey(entry)),
  }));
  const totalViewers = entries.reduce((sum, e) => sum + e.viewers, 0);
  // DB の毎時の記録から作った配信元（YouTube）の、最終収集の時刻
  const collectedAt = lists
    .flat()
    .map((e) => e.capturedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="LIVE RANKING"
        title="ライブランキング"
        summary={
          <>
            上位{entries.length}配信で
            <span className="font-bold text-white">
              {formatViewers(totalViewers)}人
            </span>
            が視聴中
            {/* データの鮮度。表示のたびに API を読む配信元と、毎時の収集結果を DB から読む配信元があるので、
                それぞれの更新間隔を出す */}
            <span className="mt-0.5 block text-gray-500">
              更新：
              {updateLabel(targets)}
              {collectedAt && (
                <>
                  （<RelativeTime iso={collectedAt} />）
                </>
              )}
            </span>
            {/* 日付のまとめへの入口。リンクの印に矢印は使わず、色で示す（UI の約束ごと） */}
            {daily && (
              <span className="mt-1 block truncate text-gray-500">
                {daily.label}のまとめ：
                <Link
                  href={`/daily/${daily.day}`}
                  className="text-gray-100 transition hover:text-purple-300"
                >
                  1位 {daily.top.displayName}{" "}
                  {formatViewers(daily.top.peakViewers)}人
                </Link>
              </span>
            )}
          </>
        }
        region={
          <SegmentedTabs
            options={[
              {
                label: "日本",
                href: buildHref(selected, true, view),
                active: isJapanese,
              },
              {
                label: "Global",
                href: buildHref(selected, false, view),
                active: !isJapanese,
              },
            ]}
          />
        }
        filters={
          <PlatformFilter
            selected={selected}
            hrefFor={(p) => buildHref(p, isJapanese, view)}
          />
        }
        // 表示の形（カード／リスト）。地域より重要度が低いのでアイコンだけ（components/ViewToggle.tsx）
        view={
          <ViewToggle
            view={view}
            hrefFor={(v) => buildHref(selected, isJapanese, v)}
          />
        }
      />

      {view === "list" ? (
        <LiveList rows={rows} showPlatform={selected === "all"} />
      ) : (
        <LiveCards rows={rows} showPlatform={selected === "all"} />
      )}
    </main>
  );
}
