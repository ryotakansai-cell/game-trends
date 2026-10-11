import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import {
  getTopGames,
  getViewerCountByGame,
  boxArt,
  isRealGame,
  formatViewers,
} from "@/lib/twitch";
import { getPlayRanking } from "@/lib/play";
import { getAppStoreRanking } from "@/lib/appstore";

export const metadata: Metadata = {
  title: "ゲームランキング",
  description:
    "Twitchで見られているゲーム、Steam・Robloxで遊ばれているゲーム、App Storeで売れているゲームの上位を1ページで。",
  alternates: { canonical: "/games" },
};

export const revalidate = 300;

const TOP = 5;

type Item = {
  key: string;
  name: string;
  imageUrl: string | null;
  value: string; // 「12.3万人が視聴」など。単位はプラットフォームごとに違う
  href?: string;
  external?: boolean; // App Store のようにサイトの外へ出るリンク
};

/** ゲームのタブの「総合」。各プラットフォームの上位5本を並べる。
 *  視聴者数・遊んでいる人数・売上の順位は意味も単位も違うので、合算して1つの順位にはしない
 *  （混ぜると「どの数字で何位なのか」が説明できなくなる）。全件は各タブで見る */
export default async function GamesOverviewPage() {
  // どれか1つが取れなくても、ほかのプラットフォームは出す
  const [twitch, viewerCounts, steam, roblox, appstore] = await Promise.all([
    getTopGames(40).catch(() => []),
    getViewerCountByGame(5).catch(() => new Map<string, number>()),
    getPlayRanking("steam", TOP).catch(() => []),
    getPlayRanking("roblox", TOP).catch(() => []),
    getAppStoreRanking("grossing", TOP).catch(() => []),
  ]);

  const sections: {
    title: string;
    unit: string;
    href: string;
    imageClass: string;
    items: Item[];
  }[] = [
    {
      title: "Twitch",
      unit: "いま見られている順",
      href: "/games/twitch",
      imageClass: "h-12 w-9",
      items: twitch
        .filter(isRealGame)
        .slice(0, TOP)
        .map((g) => ({
          key: g.id,
          name: g.name,
          imageUrl: boxArt(g.box_art_url, 72, 96),
          value: `${formatViewers(viewerCounts.get(g.id) ?? 0)}人が視聴`,
          href: `/games/${g.id}`,
        })),
    },
    {
      title: "Steam",
      unit: "いま遊ばれている順（全世界）",
      href: "/games/steam",
      imageClass: "h-[34px] w-[92px]",
      items: steam.map((g) => ({
        key: g.externalId,
        name: g.name,
        imageUrl: g.imageUrl,
        value:
          g.players !== null
            ? `${formatViewers(g.players)}人がプレイ中`
            : "人数は非公開",
        // Twitch のゲームと結べたものは、そのゲームの配信者の一覧へ
        href: g.twitchGameId ? `/games/${g.twitchGameId}` : undefined,
      })),
    },
    {
      title: "Roblox",
      unit: "いま遊ばれている順（全世界）",
      href: "/games/roblox",
      imageClass: "h-10 w-10",
      items: roblox.map((g) => ({
        key: g.externalId,
        name: g.name,
        imageUrl: g.imageUrl,
        value:
          g.players !== null
            ? `${formatViewers(g.players)}人がプレイ中`
            : "人数は非公開",
      })),
    },
    {
      title: "App Store",
      unit: "日本のセールス順（iPhone）",
      href: "/games/appstore",
      imageClass: "h-10 w-10 rounded-xl",
      items: appstore.map((g) => ({
        key: g.id,
        name: g.name,
        imageUrl: g.iconUrl || null,
        value: g.developer,
        href: g.url,
        external: true,
      })),
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            Twitch・Steam・Roblox・App Store の上位{TOP}本ずつ
            <span className="mt-0.5 block text-gray-500">
              更新：Twitch 5分ごと / Steam・Roblox・App Store 毎時
            </span>
          </>
        }
        filters={<GameTabs current="overview" />}
      />

      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
        {sections.map((s) => (
          <section key={s.title}>
            <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-2">
              <h2 className="text-lg font-bold text-white">
                {s.title}
                <span className="ml-2 text-xs font-normal text-gray-500">
                  {s.unit}
                </span>
              </h2>
              {/* 「もっと見る」は矢印そのものに意味があるので使う（サイトの決まり） */}
              <Link
                href={s.href}
                className="shrink-0 text-xs text-gray-400 transition hover:text-purple-300"
              >
                もっと見る →
              </Link>
            </div>

            {s.items.length === 0 ? (
              <p className="py-4 text-sm text-gray-500">
                いまは取得できませんでした。
              </p>
            ) : (
              <ol>
                {s.items.map((item, i) => (
                  <li
                    key={item.key}
                    className="border-t border-white/5 first:border-t-0"
                  >
                    <Row item={item} rank={i + 1} imageClass={s.imageClass} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

function Row({
  item,
  rank,
  imageClass,
}: {
  item: Item;
  rank: number;
  imageClass: string;
}) {
  const body = (
    <>
      <span className="w-5 shrink-0 text-right text-sm tabular-nums text-gray-400">
        {rank}
      </span>
      {/* 画像が無いゲームは頭文字のタイル（一覧の並びがそろって見えるため。PlayRankingList と同じ） */}
      <div
        className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded bg-white/5 text-sm font-bold text-gray-500 ${imageClass}`}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          [...item.name][0]
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-gray-100 group-hover:text-purple-300">
          {item.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-gray-500">{item.value}</p>
      </div>
    </>
  );
  const className = "group flex items-center gap-3 py-2.5";
  if (!item.href) return <div className={className}>{body}</div>;
  if (item.external)
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {body}
      </a>
    );
  return (
    <Link href={item.href} className={className}>
      {body}
    </Link>
  );
}
