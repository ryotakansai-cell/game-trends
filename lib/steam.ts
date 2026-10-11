// Steam との通信（ゲームの「遊んでいる人数」）。
//
// Steam の公開 API は鍵（API キー）なしで使える（2026-10 に確認）:
//   - ISteamChartsService/GetMostPlayedGames … 遊ばれている上位100（今日のピーク・先週の順位つき）
//   - ISteamUserStats/GetNumberOfCurrentPlayers … ゲームごとの今の人数
// 数字は全世界。地域別の人数を出す API は無い。
//
// Twitch の視聴者数と並べるため、Steam のゲームを Twitch のゲームに結び付ける：
//   Steam のゲームID → IGDB（external_games。Steam は external_game_source = 1）→ Twitch のゲーム（igdb_id）
// 2026-10 の実測で上位100のうち86本が結べた。結べない大物は手で対応を書く（STEAM_TO_TWITCH）。
import { getDbClient } from "@/lib/db";
import {
  getTwitchAuth,
  getGamesByIgdbIds,
  getGamesByIds,
  getViewersForGames,
  type TwitchGame,
} from "@/lib/twitch";

const STEAM_API = "https://api.steampowered.com";

/** IGDB 経由では結べない（Twitch 側に IGDB の ID が登録されていない）ものを手で対応づける。
 *  Steam のゲームID → Twitch のゲームID */
const STEAM_TO_TWITCH: Record<string, string> = {
  "730": "32399", // Counter-Strike 2 → Counter-Strike
  "570": "29595", // Dota 2
};

export type SteamGame = {
  appid: string;
  rank: number;
  lastWeekRank: number | null; // 先週の順位（圏外なら null）
  players: number | null; // 今遊んでいる人数（人数を公開していないゲームは null。Deadlock など）
  peakToday: number; // 今日のピーク
  name: string;
  twitchGame: TwitchGame | null; // 結び付けられた Twitch のゲーム
  twitchViewers: number; // Twitch で今見ている人数（上位の配信の合計）
  jpStreams: number; // 日本語の Twitch 配信で今遊ばれている数（毎時の記録から）
};

/** Steam のカプセル画像（横長）。Twitch のゲームと結べなかったときの画像に使う */
export function steamCapsule(appid: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_184x69.jpg`;
}

async function getMostPlayed() {
  // Steam 側は1日1回の集計なので、30分作り置きで十分
  const res = await fetch(
    `${STEAM_API}/ISteamChartsService/GetMostPlayedGames/v1/`,
    { next: { revalidate: 1800 } },
  );
  const json = await res.json();
  return (json.response?.ranks ?? []) as {
    rank: number;
    appid: number;
    last_week_rank: number;
    peak_in_game: number;
  }[];
}

async function getCurrentPlayers(appid: string) {
  const res = await fetch(
    `${STEAM_API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
    { next: { revalidate: 600 } },
  );
  const json = await res.json();
  // result が 1 以外（42 など）は「人数を公開していない」。0人と区別するため null にする
  return json.response?.result === 1
    ? Number(json.response.player_count)
    : null;
}

/** Steam ストアの名前（日本語があれば日本語）。IGDB に登録が無いもの用 */
async function getStoreName(appid: string) {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=japanese&filters=basic`,
    { next: { revalidate: 86400 } },
  );
  const json = await res.json();
  return (json[appid]?.data?.name as string | undefined) ?? null;
}

/** Steam のゲームID → IGDB のゲームID と名前（IGDB の external_games から。1日作り置き） */
async function getIgdbBySteam(appids: string[]) {
  const map = new Map<string, { igdbId: string; name: string }>();
  if (appids.length === 0) return map;
  const { clientId, token } = await getTwitchAuth();
  const res = await fetch("https://api.igdb.com/v4/external_games", {
    method: "POST",
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
    body: `fields uid, game, name; where external_game_source = 1 & uid = (${appids
      .map((a) => `"${a}"`)
      .join(",")}); limit 500;`,
    // POST は既定では作り置きされないので明示する（本文も作り置きの見分けに使われる）
    cache: "force-cache",
    next: { revalidate: 86400 },
  });
  if (!res.ok) return map;
  for (const e of (await res.json()) as {
    uid: string;
    game: number;
    name?: string;
  }[]) {
    map.set(e.uid, { igdbId: String(e.game), name: e.name ?? "" });
  }
  return map;
}

/** 日本語の Twitch 配信で、今（最新の毎時の記録で）ゲームごとに何配信あるか */
async function getJapaneseStreamCounts() {
  const db = getDbClient();
  const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const r = await db.execute({
    sql: `WITH latest AS (
            SELECT MAX(s.captured_at) AS at FROM live_snapshots s
            JOIN accounts a ON a.id = s.account_id
            WHERE s.captured_at >= ? AND a.platform = 'twitch'
          )
          SELECT s.game_id, COUNT(*) AS n
          FROM live_snapshots s JOIN accounts a ON a.id = s.account_id
          WHERE s.captured_at = (SELECT at FROM latest)
            AND a.platform = 'twitch' AND a.language = 'ja' AND s.game_id IS NOT NULL
          GROUP BY s.game_id`,
    args: [since],
  });
  return new Map(r.rows.map((row) => [String(row.game_id), Number(row.n)]));
}

/** Steam で遊ばれている上位 limit 本を、Twitch の視聴者数・日本の配信数と並べて返す */
export async function getSteamRanking(limit = 50): Promise<SteamGame[]> {
  const ranks = (await getMostPlayed()).slice(0, limit);
  const appids = ranks.map((r) => String(r.appid));

  const [players, igdb, jpCounts] = await Promise.all([
    Promise.all(appids.map((a) => getCurrentPlayers(a).catch(() => null))),
    getIgdbBySteam(appids).catch(() => new Map()),
    getJapaneseStreamCounts().catch(() => new Map<string, number>()),
  ]);

  // Twitch のゲームを引く（IGDB 経由と、手で書いた対応の両方）
  const [byIgdb, manual] = await Promise.all([
    getGamesByIgdbIds([...igdb.values()].map((v) => v.igdbId)).catch(
      () => new Map<string, TwitchGame>(),
    ),
    getGamesByIds(Object.values(STEAM_TO_TWITCH)).catch(
      () => new Map<string, TwitchGame>(),
    ),
  ]);
  const twitchOf = (appid: string): TwitchGame | null => {
    if (STEAM_TO_TWITCH[appid])
      return manual.get(STEAM_TO_TWITCH[appid]) ?? null;
    const i = igdb.get(appid);
    return i ? (byIgdb.get(i.igdbId) ?? null) : null;
  };

  const twitchIds = appids
    .map((a) => twitchOf(a)?.id)
    .filter((id): id is string => Boolean(id));
  const viewers = await getViewersForGames(twitchIds).catch(
    () => new Map<string, number>(),
  );

  // Twitch とも IGDB とも結べず名前が無いものは、Steam ストアから日本語の名前を取る（1日作り置き）
  const storeNames = new Map<string, string>();
  await Promise.all(
    appids
      .filter((a) => !twitchOf(a) && !igdb.get(a)?.name)
      .map(async (a) => {
        const name = await getStoreName(a).catch(() => null);
        if (name) storeNames.set(a, name);
      }),
  );

  return ranks.map((r, i) => {
    const appid = String(r.appid);
    const tg = twitchOf(appid);
    return {
      appid,
      rank: r.rank,
      lastWeekRank: r.last_week_rank > 0 ? r.last_week_rank : null,
      players: players[i],
      peakToday: r.peak_in_game,
      name:
        tg?.name ??
        (igdb.get(appid)?.name || storeNames.get(appid)) ??
        `Steam ${appid}`,
      twitchGame: tg,
      twitchViewers: tg ? (viewers.get(tg.id) ?? 0) : 0,
      jpStreams: tg ? (jpCounts.get(tg.id) ?? 0) : 0,
    };
  });
}

/** Twitch のゲームから、Steam で今遊んでいる人数を引く（ゲームの詳細ページ用）。
 *  Steam に無いゲーム（Valorant・LoL など）や結べないゲームは null */
export async function getSteamPlayersForTwitchGame(game: TwitchGame) {
  const manual = Object.entries(STEAM_TO_TWITCH).find(([, t]) => t === game.id);
  let appid = manual?.[0];
  if (!appid && game.igdb_id) {
    const { clientId, token } = await getTwitchAuth();
    const res = await fetch("https://api.igdb.com/v4/external_games", {
      method: "POST",
      headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
      body: `fields uid; where external_game_source = 1 & game = ${Number(game.igdb_id)}; limit 1;`,
      cache: "force-cache",
      next: { revalidate: 86400 },
    });
    if (res.ok) appid = ((await res.json()) as { uid: string }[])[0]?.uid;
  }
  if (!appid) return null;
  return { appid, players: await getCurrentPlayers(appid) };
}
