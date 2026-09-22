import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCreator,
  getCreatorAccounts,
  getCreatorContents,
} from "@/lib/creators";
import { relationLabel } from "@/lib/platform";
import type { ContentItem } from "@/lib/platform";

// 1時間ごとに作り直す。YouTube APIの無料枠を使いすぎないため長めにしている
export const revalidate = 3600;

type Props = {
  // Next.js 16 では params は Promise なので await して取り出す
  params: Promise<{ id: string }>;
};

/** 動画・クリップの一覧。中身が無ければ何も描かない */
function ItemGrid({ title, items }: { title: string; items: ContentItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      <h3 className="mt-5 text-sm font-bold text-gray-400">{title}</h3>
      <ul className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.id} className="group">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10">
                <Image
                  src={item.thumbnailUrl}
                  alt={item.title}
                  fill
                  className="object-cover transition duration-300 group-hover:scale-105"
                  unoptimized
                />
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-gray-200 group-hover:text-purple-300">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-gray-500">{item.meta}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function CreatorPage({ params }: Props) {
  const { id } = await params;
  const creatorId = Number(id);

  // "/creators/abc" のような数字でないURLは404にする
  if (!Number.isInteger(creatorId)) notFound();

  const creator = await getCreator(creatorId);
  if (!creator) notFound();

  const accounts = await getCreatorAccounts(creatorId);
  const contents = await getCreatorContents(accounts);

  // 今配信中のものだけ集める（プラットフォームをまたいで横断表示）
  const liveNow = contents.filter((c) => c.live !== null);

  // ヘッダーのアイコンは本人アカウントのものを優先して1つ選ぶ
  const headerIcon =
    contents.find((c) => c.relation === "self" && c.iconUrl)?.iconUrl ??
    contents.find((c) => c.iconUrl)?.iconUrl ??
    null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-purple-400">
        ← 配信ランキング
      </Link>

      {/* ヘッダー：人物そのものの情報 */}
      <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/5 p-6">
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
          {/* 持っているプラットフォームをバッジで並べる */}
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
                  className="group flex flex-wrap gap-4 rounded-xl border border-white/10 p-4 transition hover:border-purple-400/50"
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg sm:w-56">
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
                  <div className="flex-1">
                    <p className="line-clamp-2 font-bold text-gray-100 group-hover:text-purple-300">
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

      {/* アカウントごとの中身 */}
      {contents.map((content) => (
        <section key={content.accountId} className="mt-12">
          <div className="flex items-center gap-3 border-b border-white/10 pb-3">
            {content.iconUrl && (
              <Image
                src={content.iconUrl}
                alt={content.displayName}
                width={40}
                height={40}
                className="rounded-full"
              />
            )}
            <div>
              <a
                href={content.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-gray-100 hover:text-purple-300"
              >
                {content.displayName}
              </a>
              <p className="text-xs text-gray-500">
                {content.label} ・ {relationLabel(content.relation)}
              </p>
            </div>
          </div>

          <ItemGrid title="人気クリップ" items={content.clips} />
          <ItemGrid title="最近の動画" items={content.videos} />

          {content.clips.length === 0 && content.videos.length === 0 && (
            <p className="mt-4 text-sm text-gray-500">
              表示できる動画がありません。
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
