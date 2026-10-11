import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";
import { PLATFORMS, accountHref } from "@/lib/platforms";
import type { LiveEntry } from "@/lib/platform-loaders";

/** 表示する1件。名寄せの結果とアイコンは、ページ側で上位の分だけまとめて調べて渡す */
export type LiveRow = {
  entry: LiveEntry;
  creatorId: number | null;
  iconUrl?: string;
};

/** 配信者のアイコン。名寄せ済みの人は縁を紫にする（統合ページへ飛ぶ印） */
function ChannelIcon({ row, size }: { row: LiveRow; size: number }) {
  if (!row.iconUrl) return null;
  return (
    <Image
      src={row.iconUrl}
      alt={row.entry.channelName}
      width={size}
      height={size}
      className={`shrink-0 rounded-full ring-1 ${
        row.creatorId !== null ? "ring-purple-400/70" : "ring-white/10"
      }`}
    />
  );
}

/** カード表示（大きなサムネイルで「見てみたい」と思ってもらう、これまでの形） */
export function LiveCards({
  rows,
  showPlatform,
}: {
  rows: LiveRow[];
  showPlatform: boolean; // 「すべて」のときだけ配信元の印を出す
}) {
  return (
    <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row, index) => {
        const { entry, creatorId } = row;
        return (
          <li key={entry.key} className="group">
            <a href={entry.watchHref} target="_blank" rel="noopener noreferrer">
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
                {showPlatform && (
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
                <ChannelIcon row={row} size={28} />
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
  );
}

/** リスト表示（小さなサムネと大きな同接数で、たくさんの配信を見比べる形）。
 *  1画面に入る件数が多いので、スマホではこちらの方が見やすいこともある */
export function LiveList({
  rows,
  showPlatform,
}: {
  rows: LiveRow[];
  showPlatform: boolean;
}) {
  return (
    <ol className="mt-6">
      {rows.map((row, index) => {
        const { entry, creatorId } = row;
        const meta = [
          showPlatform ? PLATFORMS[entry.platform].label : null,
          entry.gameName,
          entry.elapsed,
        ].filter(Boolean);
        return (
          <li
            key={entry.key}
            className="flex items-center gap-3 border-t border-white/5 py-2.5 first:border-t-0 sm:gap-4"
          >
            <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500 sm:w-8">
              {index + 1}
            </span>
            <a
              href={entry.watchHref}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-video w-24 shrink-0 overflow-hidden rounded border border-white/10 bg-white/5 sm:w-36"
            >
              <Image
                src={entry.thumbnailUrl}
                alt={entry.title}
                fill
                className="object-cover transition duration-300 group-hover:scale-105"
                unoptimized
              />
            </a>
            <div className="min-w-0 flex-1">
              <Link
                href={accountHref({ ...entry, creatorId })}
                className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-gray-100 hover:text-purple-300"
              >
                <ChannelIcon row={row} size={20} />
                <span className="truncate">{entry.channelName}</span>
              </Link>
              <p
                className="mt-0.5 truncate text-xs text-gray-400"
                title={entry.title}
              >
                {entry.title}
              </p>
              {meta.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {meta.join(" ・ ")}
                </p>
              )}
            </div>
            {/* リスト表示の主役は同接数なので、右端に大きく出す */}
            <div className="shrink-0 text-right">
              <p className="text-base font-bold tabular-nums text-white sm:text-xl">
                {formatViewers(entry.viewers)}
              </p>
              <p className="text-[10px] text-gray-500">人が視聴</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
