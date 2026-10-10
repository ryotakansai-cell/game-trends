import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  getCreator,
  getCreatorAccounts,
  getCreatorContents,
} from "@/lib/creators";
import { relationLabel } from "@/lib/platform";
import type { ContentItem } from "@/lib/platform";
import { SegmentedTabs } from "@/components/SegmentedTabs";

// 1時間ごとに作り直す。YouTube APIの無料枠を使いすぎないため長めにしている
export const revalidate = 3600;

type Props = {
  // Next.js 16 では params / searchParams は Promise なので await して取り出す
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; kind?: string }>;
};

// generateMetadata と本体の両方で creator が必要になる。
// cache() で包むと、同じリクエスト内の同じ引数の呼び出しが1回にまとめられる
// （DBへの問い合わせが2回走るのを防ぐ）
const loadCreator = cache((id: number) => getCreator(id));

// ページごとの <title> と説明文。これが無いと全ページ同じタイトルになり、
// 検索結果で区別がつかない
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const creatorId = Number(id);
  if (!Number.isInteger(creatorId)) return { title: "見つかりません" };

  const creator = await loadCreator(creatorId);
  if (!creator) return { title: "見つかりません" };

  const title = `${creator.display_name}の配信まとめ`;
  const description = `${creator.display_name}のTwitch・YouTubeのアカウントをまとめて表示。配信中かどうか、人気クリップ、最近の動画がわかります。`;

  return {
    title,
    description,
    alternates: { canonical: `/creators/${creatorId}` },
    openGraph: { title, description, url: `/creators/${creatorId}` },
  };
}

const DAY = 24 * 60 * 60 * 1000;

type Kind = "all" | "video" | "clip";

/** 選んだタブを維持したままリンク先のURLを組み立てる（トップページと同じ作り） */
function buildHref(creatorId: number, sortRecent: boolean, kind: Kind) {
  const params = new URLSearchParams();
  if (sortRecent) params.set("sort", "recent");
  if (kind !== "all") params.set("kind", kind);
  const qs = params.toString();
  return qs ? `/creators/${creatorId}?${qs}` : `/creators/${creatorId}`;
}

/** 人気順に並べる前に、期間で絞る。
 *  Twitchのクリップ（直近30日の再生数）とYouTubeの動画（公開以来の再生数）を
 *  そのまま比べると、常に古いYouTube動画が上に来てしまうため。
 *  該当が少ない人は期間を広げて、スカスカにならないようにする */
function narrowToRecent(items: ContentItem[]) {
  const now = Date.now();
  for (const days of [30, 90]) {
    const picked = items.filter(
      (i) => now - new Date(i.publishedAt).getTime() <= days * DAY,
    );
    if (picked.length >= 8) return { items: picked, label: `直近${days}日` };
  }
  return { items, label: "全期間" };
}

/** 1件ぶんのカード。どのプラットフォームの何なのかをバッジで示す。
 *  チャンネルごとに分けない代わりに、各カードが出自を持つ。
 *
 *  スマホで縦積みにすると1件で画面の半分を占めてしまうので、
 *  狭い画面では「サムネ左・文字右」の横並びにする（YouTubeアプリの検索結果と同じ形）。
 *  sm以上（640px〜）では従来どおりサムネの下に文字を置く。
 *  横スクロールの帯の中では常に縦積みにしたいので stacked で切り替える */
function ItemCard({
  item,
  className = "",
  stacked = false,
}: {
  item: ContentItem;
  className?: string;
  stacked?: boolean;
}) {
  return (
    <li className={`group ${className}`}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={stacked ? "block" : "flex gap-3 sm:block"}
      >
        <div
          className={`relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5 ${
            stacked ? "" : "w-40 shrink-0 sm:w-auto"
          }`}
        >
          <Image
            src={item.thumbnailUrl}
            alt={item.title}
            fill
            className="object-cover transition duration-300 group-hover:scale-105"
            unoptimized
          />
          <span
            className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white sm:left-2 sm:top-2 sm:px-2 sm:text-xs ${
              item.platform === "twitch" ? "bg-purple-700/90" : "bg-red-700/90"
            }`}
          >
            {item.platformLabel}
          </span>
          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-gray-200 sm:right-2 sm:top-2 sm:px-2 sm:text-xs">
            {item.kindLabel}
          </span>
        </div>
        {/* min-w-0 が無いと、横並びのときに長いタイトルが幅を押し広げてはみ出す */}
        <div className="min-w-0 flex-1">
          <p
            className={`line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300 ${
              stacked ? "mt-2" : "sm:mt-2"
            }`}
          >
            {item.title}
          </p>
          <p className="mt-1 text-xs text-gray-500">{item.meta}</p>
          {/* 本人以外（切り抜き・アーカイブ）はどのチャンネルのものか明示する */}
          {item.relation !== "self" && (
            <p className="mt-0.5 truncate text-xs text-gray-600">
              {relationLabel(item.relation)} ・ {item.channelName}
            </p>
          )}
        </div>
      </a>
    </li>
  );
}

export default async function CreatorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { sort, kind } = await searchParams;
  const creatorId = Number(id);

  // "/creators/abc" のような数字でないURLは404にする
  if (!Number.isInteger(creatorId)) notFound();

  const creator = await loadCreator(creatorId);
  if (!creator) notFound();

  const accounts = await getCreatorAccounts(creatorId);
  const contents = await getCreatorContents(accounts);

  const sortByRecent = sort === "recent";
  const selectedKind: Kind = kind === "video" || kind === "clip" ? kind : "all";

  // 今配信中のものだけ集める（プラットフォームをまたいで横断表示）
  const liveNow = contents.filter((c) => c.live !== null);

  // ヘッダーのアイコンは本人アカウントのものを優先して1つ選ぶ
  const headerIcon =
    contents.find((c) => c.relation === "self" && c.iconUrl)?.iconUrl ??
    contents.find((c) => c.iconUrl)?.iconUrl ??
    null;

  // 全アカウントの中身を1本のリストに混ぜる。
  // flatMap は「各要素を配列に変換して、それを平らにつなぐ」
  const allItems = contents.flatMap((c) => c.items);

  // 最近順のときは期間で絞らない（新しい順に並べれば自然に最近のものが上に来る）。
  // 人気順のときだけ期間で絞ってから再生数で並べる
  const narrowed = sortByRecent
    ? { items: allItems, label: "全期間" }
    : narrowToRecent(allItems);

  const sorted = [...narrowed.items].sort((a, b) =>
    sortByRecent
      ? new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      : b.viewCount - a.viewCount,
  );

  // クリップは数十秒、アーカイブは数時間。再生数の桁が1〜2つ違うので、
  // 同じリストで再生数順に並べるとクリップが必ず埋もれる。
  // 「種別」は利用者にとって意味のある区切りなので、ここだけは分ける
  const clips = sorted.filter((i) => i.kindLabel === "クリップ");
  const videos = sorted.filter((i) => i.kindLabel !== "クリップ");

  const sortLabel = sortByRecent ? "新しい順" : `${narrowed.label}の人気順`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      {/* ヘッダー：人物そのものの情報 */}
      <div className="flex flex-wrap items-start gap-5 rounded-xl border border-white/10 bg-white/5 p-6">
        {headerIcon && (
          <Image
            src={headerIcon}
            alt={creator.display_name}
            width={96}
            height={96}
            className="rounded-full ring-2 ring-purple-500/40"
          />
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-100">
            {creator.display_name}
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {accounts.length}アカウントを統合表示
          </p>
          {/* 持っているアカウントをバッジで並べる（外部リンク） */}
          <div className="mt-3 flex flex-wrap gap-2">
            {contents.map((c) => (
              <a
                key={c.accountId}
                href={c.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400 transition hover:border-purple-400 hover:text-purple-300"
              >
                {c.label}・{relationLabel(c.relation)}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* 今配信中：プラットフォーム横断。ここがこのページの一番の価値 */}
      {liveNow.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-200">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            今配信中
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {liveNow.map((c) => (
              <li key={c.accountId}>
                <a
                  href={c.live!.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex gap-3 rounded-xl border border-white/10 p-3 transition hover:border-purple-400/50 sm:gap-4 sm:p-4"
                >
                  <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg sm:w-56">
                    <Image
                      src={c.live!.thumbnailUrl}
                      alt={c.live!.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                    <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                      {c.label}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-bold text-gray-100 group-hover:text-purple-300 sm:text-base">
                      {c.live!.title}
                    </p>
                    <p className="mt-2 text-sm text-gray-400">{c.live!.meta}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 並び替えと種別のタブ。必ず縦に2段（inline-flexは横に並ぶため） */}
      <div className="mt-12 flex flex-col gap-2">
        <SegmentedTabs
          options={[
            {
              label: "人気",
              href: buildHref(creatorId, false, selectedKind),
              active: !sortByRecent,
            },
            {
              label: "最近",
              href: buildHref(creatorId, true, selectedKind),
              active: sortByRecent,
            },
          ]}
        />
        <SegmentedTabs
          options={[
            {
              label: "すべて",
              href: buildHref(creatorId, sortByRecent, "all"),
              active: selectedKind === "all",
            },
            {
              label: "動画・配信",
              href: buildHref(creatorId, sortByRecent, "video"),
              active: selectedKind === "video",
            },
            {
              label: "クリップ",
              href: buildHref(creatorId, sortByRecent, "clip"),
              active: selectedKind === "clip",
            },
          ]}
        />
      </div>

      {/* 主役：動画とアーカイブ。「クリップだけ」を選んでいるときは出さない */}
      {selectedKind !== "clip" && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-gray-200">
            動画・アーカイブ
            <span className="ml-2 text-sm font-normal text-gray-500">
              {sortLabel}
            </span>
          </h2>
          {videos.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              表示できる動画がありません。
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {videos.slice(0, 24).map((item) => (
                <ItemCard key={`${item.platform}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* クリップ。「すべて」のときは横スクロールの帯にして縦の場所を取らない */}
      {selectedKind !== "video" && clips.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold text-gray-200">
            クリップ
            <span className="ml-2 text-sm font-normal text-gray-500">
              {sortLabel}
            </span>
          </h2>

          {selectedKind === "clip" ? (
            // 「クリップ」タブを選んだときは、動画と同じグリッドで全件見せる
            <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {clips.slice(0, 24).map((item) => (
                <ItemCard key={`${item.platform}-${item.id}`} item={item} />
              ))}
            </ul>
          ) : (
            // overflow-x-auto で横スクロール。
            // shrink-0 を付けないと、はみ出す代わりに各カードが潰れてしまう
            <ul className="mt-4 flex gap-4 overflow-x-auto pb-3">
              {clips.slice(0, 12).map((item) => (
                <ItemCard
                  key={`${item.platform}-${item.id}`}
                  item={item}
                  className="w-60 shrink-0"
                  stacked
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
