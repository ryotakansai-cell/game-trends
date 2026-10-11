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
  const lists = await Promise.all(
    targets.map((p) => LOADERS[p].live(isJapanese, limit).catch(() => [])),
  );
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
