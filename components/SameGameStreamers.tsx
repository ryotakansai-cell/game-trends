import Image from "next/image";
import Link from "next/link";
import { formatViewers } from "@/lib/twitch";
import { TwitchIcon, YouTubeIcon } from "@/components/PlatformIcons";

export type SameGameEntry = {
  platform: "twitch" | "youtube";
  platformId: string;
  login: string | null;
  creatorId: number | null;
  displayName: string;
  peakViewers: number;
  iconUrl?: string;
};

function hrefOf(e: SameGameEntry) {
  if (e.creatorId !== null) return `/creators/${e.creatorId}`;
  return e.platform === "twitch"
    ? `/streamers/${e.login}`
    : `/youtube/${e.platformId}`;
}

/** 同じゲームを配信している人。配信者ページから、似た配信者へ移ってもらうための欄 */
export function SameGameStreamers({
  gameId,
  gameName,
  entries,
}: {
  gameId: string;
  gameName: string;
  entries: SameGameEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-gray-200">
        同じゲームを配信している人
        <Link
          href={`/games/${gameId}`}
          className="ml-2 text-sm font-normal text-gray-400 transition hover:text-purple-300"
        >
          {gameName}
        </Link>
        <span className="ml-2 text-sm font-normal text-gray-500">直近7日</span>
      </h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <li key={`${e.platform}-${e.platformId}`}>
            <Link
              href={hrefOf(e)}
              className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-purple-400/50"
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/5">
                {e.iconUrl && (
                  <Image
                    src={e.iconUrl}
                    alt={e.displayName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-gray-100 group-hover:text-purple-300">
                    {e.displayName}
                  </span>
                  <span className="shrink-0 text-gray-500">
                    {e.platform === "twitch" ? <TwitchIcon /> : <YouTubeIcon />}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  最高 {formatViewers(e.peakViewers)}人
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
