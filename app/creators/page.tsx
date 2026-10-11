import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FilterPills } from "@/components/FilterPills";
import { PlatformIcon } from "@/components/PlatformIcons";
import {
  getStreamerList,
  searchStreamers,
  type ListEntry,
  type ListSort,
} from "@/lib/streamer-list";
import { formatViewers } from "@/lib/twitch";
import {
  PLATFORM_IDS,
  accountHref,
  accountKey,
  PLATFORM_NAMES,
} from "@/lib/platforms";
import { getAccountIcons } from "@/lib/platform-loaders";

export const metadata: Metadata = {
  title: "配信者一覧・検索",
  description: `${PLATFORM_NAMES}の日本の配信者を、配信中・直近7日の最高同接・配信時間で並べた一覧。名前で検索して、同接や配信時間の記録を見られます。`,
  alternates: { canonical: "/creators" },
};

type Props = {
  searchParams: Promise<{ q?: string; sort?: string }>;
};

const SORTS: { value: ListSort; label: string; unit: (v: number) => string }[] =
  [
    {
      value: "week",
      label: "7日の最高同接",
      unit: (v) => `${formatViewers(v)}人`,
    },
    {
      value: "live",
      label: "配信中",
      unit: (v) => `${formatViewers(v)}人が視聴中`,
    },
    { value: "hours", label: "7日の配信時間", unit: (v) => `${v}時間` },
  ];

export default async function CreatorsPage({ searchParams }: Props) {
  const { q, sort } = await searchParams;
  const query = q?.trim().slice(0, 50) ?? "";
  const current = SORTS.find((s) => s.value === sort) ?? SORTS[0];

  const entries = query
    ? await searchStreamers(query)
    : await getStreamerList(current.value);

  // アイコンは代表のアカウントから。Twitch は100人まで1回、YouTube は50件で1ユニット（1日作り置き）
  const icons = await getAccountIcons(entries);
  const iconOf = (e: ListEntry) => icons.get(accountKey(e));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="CREATORS"
        title="配信者"
        summary={
          query
            ? `「${query}」の検索結果 ・ ${entries.length}人`
            : `${PLATFORM_NAMES}の日本の配信者`
        }
        filters={
          query ? undefined : (
            <FilterPills
              options={SORTS.map((s) => ({
                label: s.label,
                href:
                  s.value === "week"
                    ? "/creators"
                    : `/creators?sort=${s.value}`,
                active: s.value === current.value,
              }))}
            />
          )
        }
      />

      {/* 検索。フォームの送信先を /creators?q=… にするだけなので、JavaScript を使わずに動く */}
      <form action="/creators" className="mt-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="配信者の名前で探す"
          aria-label="配信者の名前で探す"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-purple-400 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-white/10 px-4 text-sm text-gray-300 transition hover:border-purple-400 hover:text-purple-300"
        >
          検索
        </button>
      </form>
      {query && (
        <Link
          href="/creators"
          className="mt-2 inline-block text-xs text-gray-500 transition hover:text-purple-300"
        >
          検索をやめて一覧に戻る
        </Link>
      )}

      {entries.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">
          {query
            ? "見つかりませんでした。別の書き方（ひらがな・英字など）でも試してみてください。"
            : "まだ記録がありません。"}
        </p>
      ) : (
        <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => {
            const icon = iconOf(e);
            return (
              <li key={e.key}>
                <Link
                  href={accountHref(e)}
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-purple-400/50"
                >
                  {!query && (
                    <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500">
                      {i + 1}
                    </span>
                  )}
                  <div
                    className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/5 ring-2 ${
                      e.creatorId !== null
                        ? "ring-purple-500/40"
                        : "ring-white/10"
                    }`}
                  >
                    {icon && (
                      <Image
                        src={icon}
                        alt={e.displayName}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    )}
                  </div>
                  {/* min-w-0 を付けないと truncate が効かない（flexの子の既定は縮まない） */}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate font-bold text-gray-100 group-hover:text-purple-300">
                        {e.displayName}
                      </span>
                      <span className="flex shrink-0 gap-1 text-gray-500">
                        {PLATFORM_IDS.filter((p) =>
                          e.platforms.includes(p),
                        ).map((p) => (
                          <PlatformIcon key={p} platform={p} />
                        ))}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {query
                        ? e.value > 0
                          ? `7日の最高同接 ${formatViewers(e.value)}人`
                          : "直近7日の記録なし"
                        : current.unit(e.value)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
