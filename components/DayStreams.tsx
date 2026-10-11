import Image from "next/image";
import Link from "next/link";
import type { DayStream } from "@/lib/account-stats";
import {
  formatViewers,
  formatDate,
  videoThumb,
  type TwitchClip,
  type TwitchGame,
  type TwitchVideo,
} from "@/lib/twitch";

/** 2026-10-07T12:23:00Z → 21:23（日本時間） */
function jstTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** グラフで選んだ日の配信。配信のタイトル・ゲーム・数字（DB）と、
 *  Twitch ならその日のアーカイブとクリップ（Twitch API・無料）を出す */
export function DayStreams({
  dayLabel,
  closeHref,
  streams,
  games,
  vods = [],
  clips = [],
}: {
  dayLabel: string;
  closeHref: string;
  streams: DayStream[];
  games: Map<string, TwitchGame>;
  vods?: TwitchVideo[];
  clips?: TwitchClip[];
}) {
  return (
    // id はグラフの棒のリンク先（#stats-day）。選んだ後にこの欄まで画面が移動する
    <div
      id="stats-day"
      className="mt-6 scroll-mt-20 rounded-lg border border-purple-400/30 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-gray-200">{dayLabel}の配信</p>
        <Link
          href={closeHref}
          scroll={false}
          className="text-xs text-gray-500 transition hover:text-purple-300"
        >
          閉じる
        </Link>
      </div>

      {streams.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          この日の配信の記録はありません。
        </p>
      ) : (
        <ul className="mt-3">
          {streams.map((s) => {
            const game = s.gameId ? games.get(s.gameId)?.name : undefined;
            const meta = [
              game,
              s.startAt && `${jstTime(s.startAt)}ごろ〜`,
              `最高 ${formatViewers(s.peakViewers)}人`,
              `${s.hours}時間`,
            ]
              .filter(Boolean)
              .join(" ・ ");
            const title = (
              <span className="line-clamp-2 text-sm text-gray-200">
                {s.title}
              </span>
            );
            return (
              <li
                key={`${s.contentId ?? ""}${s.title}`}
                className="border-t border-white/5 py-2 first:border-t-0"
              >
                {s.contentId ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${s.contentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:[&>span]:text-purple-300"
                  >
                    {title}
                  </a>
                ) : (
                  title
                )}
                <p className="mt-0.5 text-xs text-gray-500">{meta}</p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Twitch のアーカイブは7〜60日で消えるので、残っている日だけ出る */}
      {vods.length > 0 && (
        <>
          <p className="mt-5 text-xs text-gray-400">この日のアーカイブ</p>
          <ul className="mt-2 flex gap-3 overflow-x-auto pb-2">
            {vods.map((v) => (
              <li key={v.id} className="group w-48 shrink-0">
                <a href={v.url} target="_blank" rel="noopener noreferrer">
                  <div className="relative aspect-video overflow-hidden rounded-md border border-white/10 bg-white/5">
                    <Image
                      src={videoThumb(v.thumbnail_url)}
                      alt={v.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-300 group-hover:text-purple-300">
                    {v.title}
                  </p>
                  <p className="text-[11px] text-gray-500">{v.duration}</p>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      {clips.length > 0 && (
        <>
          <p className="mt-4 text-xs text-gray-400">この日のクリップ</p>
          <ul className="mt-2 flex gap-3 overflow-x-auto pb-2">
            {clips.map((c) => (
              <li key={c.id} className="group w-48 shrink-0">
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  <div className="relative aspect-video overflow-hidden rounded-md border border-white/10 bg-white/5">
                    <Image
                      src={c.thumbnail_url}
                      alt={c.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-300 group-hover:text-purple-300">
                    {c.title}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {c.view_count.toLocaleString("ja-JP")}回再生 ・{" "}
                    {formatDate(c.created_at)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
