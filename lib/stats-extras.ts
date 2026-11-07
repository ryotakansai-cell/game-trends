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
  PER_PAGE_NO_CACHE,
  type TwitchClip,
  type TwitchGame,
  type TwitchVideo,
} from "@/lib/twitch";
import { accountKey } from "@/lib/platforms";
import { getAccountIcons } from "@/lib/platform-loaders";
import type { SameGameEntry } from "@/components/SameGameStreamers";

/** 「同じゲームの人」に出す人数（getSameGameStreamers の既定と同じ） */
const SAME_GAME_SHOWN = 6;

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

  const [heatmap, sameGamePool, dayStreams, vods, clips] = await Promise.all([
    getHourHeatmap(accountIds).catch(() => undefined),
    // 本人を除く前の、ゲームごとに同じ並び（1人多めに取る）。下のアイコンの取得を
    // 同じゲームの配信者ページどうしで使い回すため。本人を除いてから取ると、
    // ページごとに並びが変わり、アイコンの作り置きが人数分できてしまう
    topGameId
      ? getSameGameStreamers(topGameId, [], SAME_GAME_SHOWN + 1).catch(
          () => [],
        )
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
    // 足りない分の並びはページごとに違うので作り置きしない（lib/twitch.ts の PER_PAGE_NO_CACHE）
    const more = await getGamesByIds(
      [...missing, ...(topGameId ? [topGameId] : [])],
      PER_PAGE_NO_CACHE,
    ).catch(() => new Map<string, TwitchGame>());
    more.forEach((g, id) => allGames.set(id, g));
  }

  // 同じゲームの人のアイコン（Twitch は100人まで1回、YouTube は50件で1ユニット・1日作り置き）。
  // 本人を除く前の並びで取り、本人を除くのはそのあと
  const icons = await getAccountIcons(sameGamePool);
  const self = new Set(accountIds);
  const sameGame: SameGameEntry[] = sameGamePool
    .filter((r) => !self.has(r.accountId))
    .slice(0, SAME_GAME_SHOWN)
    .map((r) => ({
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
