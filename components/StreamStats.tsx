import Image from "next/image";
import Link from "next/link";
import type { AccountStats } from "@/lib/account-stats";
import { boxArt, formatViewers, type TwitchGame } from "@/lib/twitch";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-10-09 → 10/9（木） */
function dayLabel(day: string, withWeekday = false) {
  // 日付だけの文字列を UTC として読めば、その暦日の曜日がずれずに取れる
  const d = new Date(`${day}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return withWeekday ? `${md}（${WEEKDAYS[d.getUTCDay()]}）` : md;
}

/** 目盛りの上限をきりのいい数にする（1,234 → 2,000、38,000 → 50,000） */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * exp >= value) return m * exp;
  }
  return 10 * exp;
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

/** 日ごとの最高同接の棒グラフ。
 *  色はサイトの決まり（紫は「現在地」と「hover」だけ）に合わせ、棒は灰色、
 *  指した棒だけ紫にする。1系列なので凡例は付けず、見出しで何の棒かを示す。
 *  吹き出しは CSS の hover だけで出す（ブラウザ側の JavaScript を増やさないため） */
function PeakChart({ days }: { days: AccountStats["days"] }) {
  const max = niceMax(Math.max(...days.map((d) => d.peak)));
  const ticks = [max, max / 2, 0];
  const mid = Math.floor(days.length / 2);

  return (
    <div>
      <div className="flex gap-2">
        {/* 縦軸の目盛り。棒の高さと同じ箱に、上・中・下の3つだけ置く */}
        <div className="flex h-36 w-10 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-gray-500 sm:h-44">
          {ticks.map((t) => (
            <span
              key={t}
              className="-translate-y-1/2 first:translate-y-0 last:translate-y-0"
            >
              {formatViewers(t)}
            </span>
          ))}
        </div>

        <div className="relative h-36 flex-1 sm:h-44">
          {/* 目盛りの線（1px・実線・背景より一段明るいだけの控えめな灰色） */}
          {[0, 50, 100].map((p) => (
            <div
              key={p}
              className="absolute inset-x-0 border-t border-white/10"
              style={{ top: `${p}%` }}
            />
          ))}

          {/* 棒どうしは2pxの隙間で分ける。指せる範囲は棒ではなく、その日の列全体（細い棒でも狙いやすい） */}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {days.map((d, i) => {
              const align =
                i < 4
                  ? "left-0"
                  : i > days.length - 5
                    ? "right-0"
                    : "left-1/2 -translate-x-1/2";
              return (
                <div
                  key={d.day}
                  className="group relative flex h-full flex-1 items-end justify-center"
                >
                  {d.peak > 0 && (
                    <div
                      className="w-full max-w-6 rounded-t bg-gray-500 transition-colors group-hover:bg-purple-400"
                      style={{ height: `${(d.peak / max) * 100}%` }}
                    />
                  )}
                  <div
                    className={`pointer-events-none absolute -top-2 z-10 hidden -translate-y-full whitespace-nowrap rounded-md border border-white/10 bg-gray-900 px-2.5 py-1.5 text-xs shadow-lg group-hover:block ${align}`}
                  >
                    <p className="text-gray-400">{dayLabel(d.day, true)}</p>
                    <p className="mt-0.5 text-gray-100">
                      {d.peak > 0
                        ? `最高 ${formatViewers(d.peak)}人 ・ ${d.hours}時間`
                        : "配信なし"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 横軸は最初・真ん中・最後の日付だけ（30本すべてに付けると読めない） */}
      <div className="ml-12 mt-1.5 flex justify-between text-[10px] text-gray-500">
        <span>{dayLabel(days[0].day)}</span>
        <span>{dayLabel(days[mid].day)}</span>
        <span>{dayLabel(days[days.length - 1].day)}</span>
      </div>

      {/* 色や hover に頼らず数字を確かめられる表（スマホやスクリーンリーダー向け） */}
      <details className="mt-3 text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-purple-300">
          表で見る
        </summary>
        <table className="mt-2 w-full max-w-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="py-1 font-normal">日付</th>
              <th className="py-1 text-right font-normal">最高同接</th>
              <th className="py-1 text-right font-normal">配信時間</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day} className="border-t border-white/5 text-gray-300">
                <td className="py-1">{dayLabel(d.day, true)}</td>
                <td className="py-1 text-right">
                  {d.peak > 0 ? `${d.peak.toLocaleString("ja-JP")}人` : "—"}
                </td>
                <td className="py-1 text-right">
                  {d.hours > 0 ? `${d.hours}時間` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** 配信者ページの「配信の記録」欄。Twitch の配信者ページとクリエイターページで共用する */
export function StreamStats({
  stats,
  games,
  platforms = [],
  chartLabel,
}: {
  stats: AccountStats | null;
  games: Map<string, TwitchGame>;
  /** 名寄せ済みの人だけ：プラットフォームごとの比較表に出す行（2つ以上あるときだけ表を出す） */
  platforms?: { label: string; stats: AccountStats | null }[];
  /** 数字とグラフがどのアカウントの分かを見出しに添える（比較表を出すときに使う） */
  chartLabel?: string;
}) {
  const compared = platforms.filter((p) => p.stats !== null);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-gray-200">
        配信の記録
        <span className="ml-2 text-sm font-normal text-gray-500">
          直近30日{chartLabel && ` ・ ${chartLabel}`}
        </span>
      </h2>

      {!stats ? (
        <p className="mt-4 text-sm text-gray-500">
          直近30日の配信の記録はまだありません。
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="平均同接"
              value={`${formatViewers(stats.avgViewers)}人`}
            />
            <StatTile
              label="最高同接"
              value={`${formatViewers(stats.peakViewers)}人`}
              sub={dayLabel(stats.peakDay, true)}
            />
            <StatTile label="配信時間" value={`${stats.hoursLive}時間`} />
            <StatTile
              label="配信した日"
              value={`${stats.liveDays}日`}
              sub={`${stats.days.length}日のうち`}
            />
          </div>

          {/* プラットフォームごとの比較。名寄せしているこのサイトだから出せる情報 */}
          {compared.length >= 2 && (
            <div className="mt-6 overflow-x-auto">
              <p className="text-sm text-gray-300">プラットフォームごと</p>
              <table className="mt-2 w-full min-w-[22rem] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-1.5 font-normal" />
                    <th className="py-1.5 text-right font-normal">平均同接</th>
                    <th className="py-1.5 text-right font-normal">最高同接</th>
                    <th className="py-1.5 text-right font-normal">配信時間</th>
                    <th className="py-1.5 text-right font-normal">
                      配信した日
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compared.map((p) => (
                    <tr
                      key={p.label}
                      className="border-t border-white/5 text-gray-200"
                    >
                      <td className="py-2 text-gray-400">{p.label}</td>
                      <td className="py-2 text-right">
                        {formatViewers(p.stats!.avgViewers)}人
                      </td>
                      <td className="py-2 text-right">
                        {formatViewers(p.stats!.peakViewers)}人
                      </td>
                      <td className="py-2 text-right">
                        {p.stats!.hoursLive}時間
                      </td>
                      <td className="py-2 text-right">{p.stats!.liveDays}日</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-white/10 p-4">
            <p className="mb-6 text-sm text-gray-300">日ごとの最高同接</p>
            <PeakChart days={stats.days} />
          </div>

          {stats.topGames.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-gray-300">よく遊んだゲーム</p>
              <ul className="mt-3 flex flex-wrap gap-3">
                {stats.topGames.map((g) => {
                  const game = games.get(g.gameId);
                  if (!game) return null;
                  return (
                    <li key={g.gameId}>
                      <Link
                        href={`/games/${g.gameId}`}
                        className="group flex items-center gap-3 rounded-lg border border-white/10 py-2 pl-2 pr-4 transition hover:border-purple-400/50"
                      >
                        <div className="relative h-14 w-[42px] shrink-0 overflow-hidden rounded bg-white/5">
                          <Image
                            src={boxArt(game.box_art_url, 84, 112)}
                            alt={game.name}
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-48 truncate text-sm text-gray-200 group-hover:text-purple-300">
                            {game.name}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {g.hours}時間
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
