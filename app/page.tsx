import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";
import { getCreatorIdMap } from "@/lib/creators";
import {
  PLATFORM_IDS,
  PLATFORMS,
  accountHref,
  accountKey,
  isPlatformId,
  type PlatformId,
} from "@/lib/platforms";
import { LOADERS, getAccountIcons } from "@/lib/platform-loaders";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PageHeader } from "@/components/PageHeader";
import { PlatformFilter } from "@/components/PlatformFilter";
import { RelativeTime } from "@/components/RelativeTime";

export const revalidate = 180;

// トップページは layout の default タイトルを使うので title は指定しない
export const metadata = {
  alternates: { canonical: "/" },
};

type Props = {
  searchParams: Promise<{ lang?: string; platform?: string }>;
};

const LIMIT = 40;

/** 選んだタブを維持したまま、リンク先のURLを組み立てる */
function buildHref(platform: PlatformId | "all", isJapanese: boolean) {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (!isJapanese) params.set("lang", "all");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({ searchParams }: Props) {
  const { lang, platform } = await searchParams;
  const isJapanese = lang !== "all";
  const selected = isPlatformId(platform) ? platform : "all";
  const targets = selected === "all" ? [...PLATFORM_IDS] : [selected];

  // 配信元ごとの上位を同時に取り、視聴者数で混ぜて並べる。
  // 取り方（API か DB か）は配信元ごとに違うが、LOADERS が同じ形（LiveEntry）にそろえて返す。
  // 1つの配信元が取れなくても、ほかの配信元は出す
  const lists = await Promise.all(
    targets.map((p) => LOADERS[p].live(isJapanese, LIMIT).catch(() => [])),
  );
  const entries = lists
    .flat()
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, LIMIT);

  // アイコンと名寄せは、並べた後の上位だけ調べる（表に出ない分まで API や DB を読まない）
  const [icons, creatorIds] = await Promise.all([
    getAccountIcons(entries.filter((e) => !e.iconUrl)),
    getCreatorIdMap(entries),
  ]);

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
              {targets
                .map((p) => `${PLATFORMS[p].label} ${PLATFORMS[p].liveUpdate}`)
                .join(" / ")}
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
          const creatorId = creatorIds.get(accountKey(entry)) ?? null;
          const iconUrl = entry.iconUrl ?? icons.get(accountKey(entry));
          return (
            <li key={entry.key} className="group">
              <a
                href={entry.watchHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5">
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
                  {selected === "all" && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                      {PLATFORMS[entry.platform].label}
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

              {/* 配信者名とゲーム名は、長ければ「…」で省略する。名前のリンクに shrink-0 が
                  付いていた頃は縮まずに画面の外まで伸び、スマホでページごと横にずれていた。
                  縮むのは文字だけで、アイコンは shrink-0 で形を保つ */}
              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm">
                {/* 配信者のリンク先はすべてサイト内（名寄せ済み→統合ページ、
                    それ以外→配信元ごとの配信者ページ） */}
                <Link
                  href={accountHref({ ...entry, creatorId })}
                  className="flex min-w-0 items-center gap-2 text-gray-300 hover:text-purple-300"
                >
                  {iconUrl && (
                    <Image
                      src={iconUrl}
                      alt={entry.channelName}
                      width={28}
                      height={28}
                      className={`shrink-0 rounded-full ring-1 ${
                        creatorId !== null
                          ? "ring-purple-400/70"
                          : "ring-white/10"
                      }`}
                    />
                  )}
                  <span className="truncate">{entry.channelName}</span>
                </Link>
                {entry.gameName && entry.gameId && (
                  <>
                    <span className="text-gray-700">·</span>
                    <Link
                      href={`/games/${entry.gameId}`}
                      className="truncate text-xs text-gray-200 transition hover:text-purple-400"
                    >
                      {entry.gameName}
                    </Link>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
