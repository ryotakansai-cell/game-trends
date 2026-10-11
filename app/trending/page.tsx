import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";
import { getCreatorIdMap } from "@/lib/creators";
import { getDayRange, dayTitle } from "@/lib/daily";
import { getRising } from "@/lib/rising";
import { getAccountIcons } from "@/lib/platform-loaders";
import {
  PLATFORM_IDS,
  PLATFORMS,
  accountHref,
  accountKey,
  isPlatformId,
  type PlatformId,
  PLATFORM_NAMES,
} from "@/lib/platforms";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PageHeader } from "@/components/PageHeader";
import { PlatformFilter } from "@/components/PlatformFilter";
import { RelativeTime } from "@/components/RelativeTime";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "急上昇の配信者",
  description: `24時間前と比べて視聴者数が伸びている配信者のランキング。${PLATFORM_NAMES}を横断して表示します。`,
  alternates: { canonical: "/trending" },
};

// 5分間キャッシュする。cronが数時間おきなので、これ以上短くしても意味がない
export const revalidate = 300;

// URLの ?lang=all を受け取る（トップページと同じ規則）
type Props = {
  searchParams: Promise<{ lang?: string; platform?: string }>;
};

/** 選んだタブを維持したまま、リンク先のURLを組み立てる（トップページと同じ規則） */
function buildHref(platform: PlatformId | "all", isJapanese: boolean) {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (!isJapanese) params.set("lang", "all");
  const qs = params.toString();
  return qs ? `/trending?${qs}` : "/trending";
}

export default async function TrendingPage({ searchParams }: Props) {
  const { lang, platform } = await searchParams;
  const isJapanese = lang !== "all"; // デフォルトは日本
  const selected = isPlatformId(platform) ? platform : "all";
  const targets = selected === "all" ? [...PLATFORM_IDS] : [selected];

  // 配信元ごとの急上昇を同時に取り、増加率が高い順に混ぜて並べる。
  // 絞り込みで選ばれていない配信元は問い合わせ自体をしない（DBの読み取りを減らす）
  const lists = await Promise.all(
    targets.map((p) => getRising(p, isJapanese, 20)),
  );
  const entries = lists
    .flat()
    .sort((a, b) => b.growthRate - a.growthRate)
    .slice(0, 30);

  // アイコンは表示時にその場で取得する（DBには保存しない方針）。
  // 名寄せ済みの配信者は、アイコンから統合ページへ飛ばす
  const [icons, creatorIds] = await Promise.all([
    getAccountIcons(entries),
    getCreatorIdMap(entries),
  ]);

  // 最終集計の時刻（どれも毎時の収集結果なので、一番新しいものを出す）
  const latestAt = lists
    .flat()
    .map((e) => e.currentAt)
    .sort()
    .at(-1);

  // まとめがある一番新しい日（ふつうは昨日）。日付が変わった直後は昨日の集計がまだ無いので、
  // 「昨日」を決め打ちせず DB の最新の日にリンクする
  const latestDay = (await getDayRange().catch(() => null))?.last;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="TRENDING"
        title="急上昇"
        summary={
          <>
            24時間前と比べて伸びている配信 ・ {entries.length}件
            <span className="mt-0.5 block text-gray-500">
              更新：毎時
              {latestAt && (
                <>
                  （<RelativeTime iso={latestAt} />）
                </>
              )}
              {/* 1日単位で振り返るまとめへの入口。急上昇は「今」、こちらは「その日1日」 */}
              {latestDay && (
                <Link
                  href={`/daily/${latestDay}`}
                  className="ml-3 text-gray-300 transition hover:text-purple-300"
                >
                  {dayTitle(latestDay)}のまとめ
                </Link>
              )}
            </span>
          </>
        }
        region={
          <SegmentedTabs
            options={[
              {
                label: "日本",
                href: buildHref(selected, true),
                active: isJapanese,
              },
              {
                label: "Global",
                href: buildHref(selected, false),
                active: !isJapanese,
              },
            ]}
          />
        }
        filters={
          <PlatformFilter
            selected={selected}
            hrefFor={(p) => buildHref(p, isJapanese)}
          />
        }
      />

      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry, index) => {
          const info = PLATFORMS[entry.platform];
          const creatorId = creatorIds.get(accountKey(entry)) ?? null;
          const iconUrl = icons.get(accountKey(entry));
          const thumbnailUrl = info.liveThumbnail(entry, entry.contentId);
          // title 列を追加する前の古い行は null なので、その場合は配信者名を出す
          const title = entry.title ?? entry.displayName;
          return (
            <li key={accountKey(entry)} className="group">
              <a
                href={info.liveUrl(entry, entry.contentId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* aspect-video で縦横比を固定。配信元ごとにサムネの
                    元サイズが違っても、カードの高さが揃う */}
                <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  {thumbnailUrl && (
                    <Image
                      src={thumbnailUrl}
                      alt={title}
                      fill
                      className="object-cover transition duration-300 group-hover:scale-105"
                      unoptimized
                    />
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  {/* 急上昇ページの主役なので、増加率を目立つ緑バッジで表示 */}
                  <span className="absolute right-2 top-2 rounded bg-green-600/90 px-2 py-0.5 text-xs font-bold text-white">
                    +{Math.round(entry.growthRate * 100)}%
                  </span>
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                    {info.label}
                  </span>
                </div>
              </a>

              <p
                className="mt-3 truncate font-bold text-gray-100"
                title={title}
              >
                {title}
              </p>

              <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                {/* 配信者のページへのリンク（名寄せ済みなら統合ページ）。
                    上のサムネの <a> は既に閉じているので入れ子にはならない */}
                <Link
                  href={accountHref({ ...entry, creatorId })}
                  className="flex min-w-0 items-center gap-2 transition hover:text-purple-300"
                >
                  {iconUrl && (
                    <Image
                      src={iconUrl}
                      alt={entry.displayName}
                      width={24}
                      height={24}
                      className={`shrink-0 rounded-full ring-1 ${
                        creatorId !== null
                          ? "ring-purple-400/70"
                          : "ring-white/10"
                      }`}
                    />
                  )}
                  <span className="truncate">{entry.displayName}</span>
                </Link>
              </div>

              {/* 「1068人 → 3091人」という変化そのものを見せる */}
              <div className="mt-1 text-xs text-gray-500">
                {formatViewers(entry.pastViewers)}人 →{" "}
                <span className="font-bold text-purple-300">
                  {formatViewers(entry.currentViewers)}人
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
