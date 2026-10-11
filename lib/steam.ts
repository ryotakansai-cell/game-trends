// Steam との通信（ゲームの「遊んでいる人数」）。
//
// Steam の公開 API は鍵（API キー）なしで使える（2026-10 に確認）:
//   - ISteamChartsService/GetMostPlayedGames … 遊ばれている上位100（今日のピーク・先週の順位つき）
//   - ISteamUserStats/GetNumberOfCurrentPlayers … ゲームごとの今の人数（result が 1 以外は非公開）
//   - store.steampowered.com/api/appdetails … 日本語の名前と画像のURL
// 数字は全世界。地域別の人数を出す API は無い。
//
// 毎時の cron（/api/cron/play-snapshot）が上位100本の人数を play_snapshots に記録し、
// ページは DB から読む。名前・画像・Twitch との対応は play_titles に1日1回だけ更新する
// （ページを開くたびに Steam へ100回問い合わせないため）。
//
// Twitch の視聴者数と並べるため、Steam のゲームを Twitch のゲームに結び付ける：
//   Steam のゲームID → IGDB（external_games。Steam は external_game_source = 1）→ Twitch のゲーム（igdb_id）
// 2026-10 の実測で上位100のうち86本が結べた。結べない大物は手で対応を書く（STEAM_TO_TWITCH）。
import { getDbClient } from "@/lib/db";
import {
  getTwitchAuth,
  getGamesByIgdbIds,
  getJapaneseStreamCountsForGames,
  getViewersForGames,
  boxArt,
} from "@/lib/twitch";
import {
  getPlayRanking,
  titlesToRefresh,
  type PlayRankingRow,
  type PlayRow,
  type TitleInfo,
} from "@/lib/play";

const STEAM_API = "https://api.steampowered.com";

/** IGDB 経由では結べない（Twitch 側に IGDB の ID が登録されていない）ものを手で対応づける。
 *  Steam のゲームID → Twitch のゲームID */
const STEAM_TO_TWITCH: Record<string, string> = {
  "730": "32399", // Counter-Strike 2 → Counter-Strike
  "570": "29595", // Dota 2
};

// ---------------------------------------------------------------
// 毎時の収集
// ---------------------------------------------------------------

async function getMostPlayed() {
  const res = await fetch(
    `${STEAM_API}/ISteamChartsService/GetMostPlayedGames/v1/`,
    { cache: "no-store" },
  );
  const json = await res.json();
  return (json.response?.ranks ?? []) as {
    rank: number;
    appid: number;
    last_week_rank: number;
    peak_in_game: number;
  }[];
}

/** 今の人数。result が 1 以外（42 など）は「人数を公開していない」ので null（0人と区別する） */
async function getCurrentPlayers(appid: string) {
  const res = await fetch(
    `${STEAM_API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
    { cache: "no-store" },
  );
  const json = await res.json();
  return json.response?.result === 1
    ? Number(json.response.player_count)
    : null;
}

/** Steam ストアの日本語の名前と画像。新しいゲームは昔の決まったURL（capsule_184x69.jpg）に
 *  画像が無く404になるので、ストアが返す本当のURLを使う（2026-10-11 に発見） */
async function getStoreInfo(appid: string) {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=japanese&filters=basic`,
    { cache: "no-store" },
  );
  const json = await res.json();
  const d = json[appid]?.data;
  if (!d) return null;
  return {
    name: String(d.name),
    image: (d.capsule_image ?? d.header_image ?? null) as string | null,
  };
}

/** Steam のゲームID → IGDB のゲームID（IGDB の external_games から） */
async function getIgdbBySteam(appids: string[]) {
  const map = new Map<string, string>();
  if (appids.length === 0) return map;
  const { clientId, token } = await getTwitchAuth();
  const res = await fetch("https://api.igdb.com/v4/external_games", {
    method: "POST",
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
    body: `fields uid, game; where external_game_source = 1 & uid = (${appids
      .map((a) => `"${a}"`)
      .join(",")}); limit 500;`,
    cache: "no-store",
  });
  if (!res.ok) return map;
  for (const e of (await res.json()) as { uid: string; game: number }[]) {
    map.set(e.uid, String(e.game));
  }
  return map;
}

/** 毎時の収集：上位100本の人数と、マスタの更新が要るゲームの情報を集める */
export async function collectSteam(): Promise<{
  rows: PlayRow[];
  titles: TitleInfo[];
}> {
  const ranks = await getMostPlayed();
  const appids = ranks.map((r) => String(r.appid));

  const players = await Promise.all(
    appids.map((a) => getCurrentPlayers(a).catch(() => null)),
  );
  const rows: PlayRow[] = ranks.map((r, i) => ({
    externalId: String(r.appid),
    players: players[i],
    rank: r.rank,
    peakToday: r.peak_in_game,
    prevRank: r.last_week_rank > 0 ? r.last_week_rank : null,
  }));

  // マスタは新しいゲームと、1日以上前に更新したものだけ（ストアと IGDB への問い合わせを減らすため）
  const refresh = await titlesToRefresh("steam", appids);
  if (refresh.length === 0) return { rows, titles: [] };

  const [store, igdb] = await Promise.all([
    Promise.all(refresh.map((a) => getStoreInfo(a).catch(() => null))),
    getIgdbBySteam(refresh).catch(() => new Map<string, string>()),
  ]);
  const twitchByIgdb = await getGamesByIgdbIds([...igdb.values()]).catch(
    () => new Map(),
  );

  const titles: TitleInfo[] = refresh.map((appid, i) => {
    const igdbId = igdb.get(appid);
    const twitchGame = igdbId ? twitchByIgdb.get(igdbId) : undefined;
    const twitchGameId = STEAM_TO_TWITCH[appid] ?? twitchGame?.id ?? null;
    return {
      externalId: appid,
      name: store[i]?.name ?? `Steam ${appid}`,
      // ストアに画像が無いときは、Twitch のゲームの画像（縦長のパッケージ）で代わりにする。
      // マスタは毎日更新されるので、ストアに画像が付けば翌日には差し替わる
      imageUrl:
        store[i]?.image ??
        (twitchGame ? boxArt(twitchGame.box_art_url, 184, 245) : null),
      twitchGameId,
    };
  });
  return { rows, titles };
}

// ---------------------------------------------------------------
// ページ用
// ---------------------------------------------------------------

export type SteamGame = PlayRankingRow & {
  twitchViewers: number; // Twitch で今見ている人数（上位100配信の合計）
  jpStreams: number; // 日本語の Twitch 配信で今遊ばれている数
};

/** Steam で遊ばれている上位を、Twitch の視聴者数・日本の配信数と並べて返す。
 *  人数は毎時の記録から、Twitch の数字は API から（5分作り置き） */
export async function getSteamRanking(limit = 50): Promise<SteamGame[]> {
  const games = await getPlayRanking("steam", limit);
  const twitchIds = games
    .map((g) => g.twitchGameId)
    .filter((id): id is string => id !== null);

  const [viewers, jp] = await Promise.all([
    getViewersForGames(twitchIds).catch(() => new Map<string, number>()),
    getJapaneseStreamCountsForGames(twitchIds).catch(
      () => new Map<string, number>(),
    ),
  ]);

  return games.map((g) => ({
    ...g,
    twitchViewers: g.twitchGameId ? (viewers.get(g.twitchGameId) ?? 0) : 0,
    jpStreams: g.twitchGameId ? (jp.get(g.twitchGameId) ?? 0) : 0,
  }));
}

/** Twitch のゲームから、Steam で今遊んでいる人数を引く（ゲームの詳細ページ用）。
 *  毎時の記録（上位100本）にあるゲームだけ。Steam に無いゲームや圏外は null */
export async function getSteamPlayersForTwitchGame(twitchGameId: string) {
  const db = getDbClient();
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const r = await db.execute({
    sql: `SELECT s.players FROM play_snapshots s
          JOIN play_titles t ON t.id = s.title_id
          WHERE t.platform = 'steam' AND t.twitch_game_id = ? AND s.captured_at >= ?
          ORDER BY s.captured_at DESC LIMIT 1`,
    args: [twitchGameId, since],
  });
  const players = r.rows[0]?.players;
  return players === undefined || players === null ? null : Number(players);
}
