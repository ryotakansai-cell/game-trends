import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";

export type PlayListItem = {
  key: string;
  rank: number;
  name: string;
  imageUrl: string | null;
  players: number | null; // 人数を公開していないゲームは null
  players24hAgo: number | null;
  prevRank?: number | null; // Steam のみ：先週の順位
  href?: string; // 押したときの移動先（Twitch のゲームのページなど）
  extra?: React.ReactNode; // 2行目（Twitch の視聴者数など）
};

/** 先週の順位からの変化。矢印は方向そのものを表すので使う（サイトの決まりで「リンクの印」には使わない） */
function RankChange({
  rank,
  prevRank,
}: {
  rank: number;
  prevRank?: number | null;
}) {
  if (prevRank === undefined) return null;
  if (prevRank === null)
    return <span className="text-[10px] text-gray-400">NEW</span>;
  const diff = prevRank - rank;
  if (diff === 0) return <span className="text-[10px] text-gray-600">―</span>;
  return (
    <span className="text-[10px] text-gray-400">
      {diff > 0 ? `↑${diff}` : `↓${-diff}`}
    </span>
  );
}

/** 24時間前と比べた増減（+12%）。24時間前の記録が無いあいだは出さない */
function DayChange({
  now,
  before,
}: {
  now: number | null;
  before: number | null;
}) {
  if (now === null || before === null || before === 0) return null;
  const pct = Math.round((now / before - 1) * 100);
  if (pct === 0) return null;
  return (
    <span className="text-gray-400">
      {" ・ "}24時間前比 {pct > 0 ? `+${pct}` : pct}%
    </span>
  );
}

/** ゲームの「遊んでいる人数」の一覧（Steam・Roblox で共通）。
 *  画像が無いゲームは、壊れた画像の印ではなく頭文字のタイルにする（並びがそろって見えるため） */
export function PlayRankingList({
  items,
  imageShape,
}: {
  items: PlayListItem[];
  imageShape: "wide" | "square"; // Steam は横長、Roblox は正方形のアイコン
}) {
  const box =
    imageShape === "wide"
      ? "h-[46px] w-[123px] sm:h-[69px] sm:w-[184px]"
      : "h-12 w-12 sm:h-16 sm:w-16";
  return (
    <ol className="mt-8">
      {items.map((g) => {
        const name = (
          <span className="line-clamp-2 text-sm font-bold text-gray-100 group-hover:text-purple-300 sm:text-base">
            {g.name}
          </span>
        );
        return (
          <li
            key={g.key}
            className="group flex items-center gap-3 border-t border-white/5 py-3 first:border-t-0 sm:gap-4"
          >
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span className="text-sm tabular-nums text-gray-400">
                {g.rank}
              </span>
              <RankChange rank={g.rank} prevRank={g.prevRank} />
            </div>

            <div
              className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded bg-white/5 text-lg font-bold text-gray-500 ${box}`}
            >
              {g.imageUrl ? (
                <Image
                  src={g.imageUrl}
                  alt={g.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                [...g.name][0]
              )}
            </div>

            <div className="min-w-0 flex-1">
              {g.href ? <Link href={g.href}>{name}</Link> : name}
              <p className="mt-1 text-xs text-gray-500">
                {g.players !== null ? (
                  <>
                    <span className="text-gray-200">
                      {formatViewers(g.players)}人
                    </span>
                    がプレイ中
                  </>
                ) : (
                  "人数は非公開"
                )}
                <DayChange now={g.players} before={g.players24hAgo} />
              </p>
              {g.extra && (
                <p className="mt-0.5 text-xs text-gray-500">{g.extra}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
