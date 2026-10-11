import {
  getDayStreams,
  getHourHeatmap,
  getSameGameStreamers,
  type AccountStats,
  type DayStream,
} from "@/lib/account-stats";
import {
  getClipsInRange,
  getGamesByIds,
  getVideosByUser,
  isRealGame,
  type TwitchClip,
  type TwitchGame,
  type TwitchVideo,
} from "@/lib/twitch";
import { accountKey } from "@/lib/platforms";
import { getAccountIcons } from "@/lib/platform-loaders";
import type { SameGameEntry } from "@/components/SameGameStreamers";

/** グラフで選べる日か（2026-10-10 の形で、グラフの期間内の配信した日） */
export function pickSelectedDay(stats: AccountStats | null, day?: string) {
  if (!stats || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return stats.days.some((d) => d.day === day && d.peak > 0) ? day : undefined;
}

/** 配信者ページの「配信の記録」に添える追加の情報をまとめて取る。
 *  Twitch・名寄せ・YouTube の3つのページで共通。どれか1つ取れなくても他は出す */
export async function loadStatsExtras({
  accountIds,
  stats,
  games,
  twitchUserId,
  selectedDay,
}: {
  accountIds: number[]; // 本人アカウント（時間帯・その日の配信はこれらを合わせて見る）
  stats: AccountStats | null;
  games: Map<string, TwitchGame>; // よく遊んだゲームの分（取得済み）。足りない分を足して返す
  twitchUserId?: string; // あれば、選んだ日の Twitch のアーカイブとクリップも取る
  selectedDay?: string;
}) {
  // 「同じゲームの人」は、実際のゲームの中で一番遊んだもので探す。
  // Just Chatting（雑談）などのゲームではない分類は IGDB の ID が空なので飛ばす
  // （雑談の人の「同じゲーム」が雑談の人一覧になっても意味が薄いため）
  const topGameId = stats?.topGames
    .map((g) => g.gameId)
    .find((id) => {
      const game = games.get(id);
      return game !== undefined && isRealGame(game);
    });

  // 選んだ日の範囲（日本時間の0時〜24時）
  const dayStart = selectedDay
    ? new Date(`${selectedDay}T00:00:00+09:00`)
    : undefined;
  const dayEnd = dayStart
    ? new Date(dayStart.getTime() + 24 * 3600 * 1000)
    : undefined;

  const [heatmap, sameGameRows, dayStreams, vods, clips] = await Promise.all([
    getHourHeatmap(accountIds).catch(() => undefined),
    topGameId
      ? getSameGameStreamers(topGameId, accountIds).catch(() => [])
      : Promise.resolve([]),
    selectedDay
      ? getDayStreams(accountIds, selectedDay).catch(() => [] as DayStream[])
      : Promise.resolve([] as DayStream[]),
    // その日に始まったアーカイブ。直近20本から日付で選ぶ（Twitch API は日付で絞れないため）
    twitchUserId && dayStart && dayEnd
      ? getVideosByUser(twitchUserId, 20)
          .then((vs) =>
            vs.filter((v) => {
              const t = new Date(v.created_at).getTime();
              return t >= dayStart.getTime() && t < dayEnd.getTime();
            }),
          )
          .catch(() => [] as TwitchVideo[])
      : Promise.resolve([] as TwitchVideo[]),
    twitchUserId && dayStart && dayEnd
      ? getClipsInRange(twitchUserId, dayStart, dayEnd).catch(
          () => [] as TwitchClip[],
        )
      : Promise.resolve([] as TwitchClip[]),
  ]);

  // ゲーム名が足りない分（その日の配信のゲーム）を足す。1日作り置きされるので重くない
  const missing = dayStreams
    .map((s) => s.gameId)
    .filter((id): id is string => id !== null && !games.has(id));
  const allGames = new Map(games);
  if (missing.length > 0 || (topGameId && !games.has(topGameId))) {
    const more = await getGamesByIds([
      ...missing,
      ...(topGameId ? [topGameId] : []),
    ]).catch(() => new Map<string, TwitchGame>());
    more.forEach((g, id) => allGames.set(id, g));
  }

  // 同じゲームの人のアイコン（Twitch は100人まで1回、YouTube は50件で1ユニット・1日作り置き）
  const icons = await getAccountIcons(sameGameRows);
  const sameGame: SameGameEntry[] = sameGameRows.map((r) => ({
    ...r,
    iconUrl: icons.get(accountKey(r)),
  }));

  return {
    heatmap,
    games: allGames,
    topGameId,
    sameGame,
    dayStreams,
    vods,
    clips,
  };
}
