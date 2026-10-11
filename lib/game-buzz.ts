// ゲームの「総合」ページの一番上に出す「いま話題のゲーム」を選ぶ。
// 配信（Twitch の日本語配信）・Steam・Roblox・App Store から、少し前と比べて大きく動いたものを集め、
// 配信元が偏らないように順番に1つずつ取って最大5つにする。
//
// 比べる相手は24時間前（同じ時刻）だけ。18時間前や6時間前と比べると、時間帯の違いを「急上昇」と見てしまう
// （2026-10-11 に試したところ、Steam で6時間で +134%、Twitch で深夜と夜を比べて VALORANT が急増、のように出た。
// 全世界の人数は日本の昼とヨーロッパの昼で遊ぶ人が入れ替わり、日本の配信も深夜と夜でゲームの顔ぶれが違う）。
// 24時間前の記録がまだ無いあいだや、大きな動きが無いときは空を返し、ページは枠ごと出さない。
// 条件を満たすものが無いときは空を返す。無理に小さな動きで埋めると、ただの飾りになるため。
import { unstable_cache } from "next/cache";
import { getDbClient } from "@/lib/db";
import { getPlayRanking, type PlayPlatform } from "@/lib/play";
import { getAppStoreRanking } from "@/lib/appstore";
import { boxArt, formatViewers, getGamesByIds, isRealGame } from "@/lib/twitch";

export type BuzzItem = {
  key: string;
  kind: "surge" | "new"; // 急に伸びた / 初めて入った
  label: string; // カードの印（「配信で急増」など）
  name: string;
  reason: string; // 「日本の配信 300人 → 2,100人（24時間）」のような根拠の1行
  source: string; // 「Twitch」「Steam」など
  imageUrl: string | null;
  imageFit: "cover" | "contain"; // 横長の画像（Steam）は切り取らずに収める
  href: string;
  external: boolean;
};

const MAX = 5;
/** 比べる相手（何時間前か）。前から順に試し、そろった記録が見つかった時間で比べる。
 *  上の理由で今は24時間前だけ。記録の欠けに備えて、24時間前の前後1時間までは探す */
const COMPARE_HOURS = [24];

// ============================================
// 配信で急に見られ始めたゲーム（Twitch の日本語配信）
// ============================================

type GameCount = Map<string, { viewers: number; streams: number }>;

/** その収集回の、日本語の配信のゲームごとの視聴者数と配信数 */
async function countByGame(at: string): Promise<GameCount> {
  const r = await getDbClient().execute({
    sql: `SELECT l.game_id, SUM(l.viewers) AS v, COUNT(*) AS n
          FROM live_snapshots l JOIN accounts a ON a.id = l.account_id
          WHERE a.platform = 'twitch' AND a.language = 'ja'
            AND l.captured_at = ? AND l.game_id IS NOT NULL
          GROUP BY l.game_id`,
    args: [at],
  });
  return new Map(
    r.rows.map((row) => [
      String(row.game_id),
      { viewers: Number(row.v), streams: Number(row.n) },
    ]),
  );
}

/** target に一番近い Twitch の収集回（前後1時間以内）。無ければ null */
async function nearestCapture(target: Date): Promise<string | null> {
  const r = await getDbClient().execute({
    sql: `SELECT l.captured_at AS at FROM live_snapshots l
          JOIN accounts a ON a.id = l.account_id
          WHERE a.platform = 'twitch' AND l.captured_at BETWEEN ? AND ?
          GROUP BY l.captured_at
          ORDER BY ABS(strftime('%s', l.captured_at) - strftime('%s', ?))
          LIMIT 1`,
    args: [
      new Date(target.getTime() - 3600 * 1000).toISOString(),
      new Date(target.getTime() + 3600 * 1000).toISOString(),
      target.toISOString(),
    ],
  });
  return r.rows[0]?.at ? String(r.rows[0].at) : null;
}

const sum = (m: GameCount, key: "viewers" | "streams") =>
  [...m.values()].reduce((acc, x) => acc + x[key], 0);

/** 人数ではなく「全体に占める割合」で比べる。毎時の記録の件数が時間によって揺れるため
 *  （2026-10-11 の実測で、日本語の配信が202件の回も1,064件の回もあった）。割合なら取りこぼしの影響を受けにくい */
async function twitchSurges(): Promise<BuzzItem[] | null> {
  const latest = await getDbClient().execute(
    `SELECT l.captured_at AS at FROM live_snapshots l
     JOIN accounts a ON a.id = l.account_id
     WHERE a.platform = 'twitch' ORDER BY l.captured_at DESC LIMIT 1`,
  );
  const nowAt = latest.rows[0]?.at ? String(latest.rows[0].at) : null;
  if (!nowAt) return null;
  const now = await countByGame(nowAt);
  const nowTotal = sum(now, "viewers");
  const nowStreams = sum(now, "streams");
  if (nowTotal === 0) return null;

  // 比べる相手を、24 → 18 → 12 → 6時間前の順に探す。
  // 記録がいまより明らかに少ない回（収集の失敗や、記録の範囲を広げる前の時間）は使わない。
  // 2026-10-11 に、日本語の配信を77件しか記録していなかった時間と比べて
  // 「Apex Legends の配信が始まった」と誤って出したので、合計人数ではなく配信の件数で見る
  let before: GameCount | null = null;
  let hours = 0;
  for (const h of COMPARE_HOURS) {
    const at = await nearestCapture(
      new Date(new Date(nowAt).getTime() - h * 3600 * 1000),
    );
    if (!at) continue;
    const counts = await countByGame(at);
    const streams = sum(counts, "streams");
    if (streams >= 100 && streams >= nowStreams * 0.5) {
      before = counts;
      hours = h;
      break;
    }
  }
  if (!before) return null;
  const past = before;
  const pastTotal = sum(past, "viewers");

  const surges = [...now]
    .filter(([, x]) => x.viewers >= 500 && x.streams >= 3)
    .map(([gameId, x]) => {
      const p = past.get(gameId);
      const shareNow = x.viewers / nowTotal;
      // 前に誰も配信していなかったゲームは、割合を小さな値（0.1%）とみなして比べる
      const sharePast = Math.max((p?.viewers ?? 0) / pastTotal, 0.001);
      return { gameId, now: x, past: p, ratio: shareNow / sharePast };
    })
    .filter((x) => x.ratio >= 2)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, MAX * 2);

  // 名前と画像は Twitch API から（1日作り置き）。「雑談」などゲームではない分類は外す
  const games = await getGamesByIds(surges.map((s) => s.gameId)).catch(
    () => new Map(),
  );
  return surges
    .filter((s) => games.has(s.gameId) && isRealGame(games.get(s.gameId)!))
    .map((s) => {
      const g = games.get(s.gameId)!;
      return {
        key: `twitch-${s.gameId}`,
        kind: s.past ? ("surge" as const) : ("new" as const),
        label: s.past ? "配信で急増" : "配信が始まった",
        name: g.name,
        reason: s.past
          ? `日本の配信 ${formatViewers(s.past.viewers)}人 → ${formatViewers(s.now.viewers)}人（${hours}時間）`
          : `${hours}時間前は配信なし → いま日本で${s.now.streams}人が配信`,
        source: "Twitch",
        imageUrl: boxArt(g.box_art_url, 300, 400),
        imageFit: "cover" as const,
        href: `/games/${s.gameId}`,
        external: false,
      };
    });
}

// ============================================
// 遊んでいる人数（Steam・Roblox）
// ============================================

async function playBuzz(
  platform: PlayPlatform,
  source: string,
  minPlayers: number,
  listHref: string,
): Promise<BuzzItem[] | null> {
  // 24時間前とだけ比べる。全世界の人数は1日の中で大きく波打つので（日本の昼とヨーロッパの昼で遊ぶ人が入れ替わる）、
  // 6時間前などと比べると時間帯の違いを「急上昇」と見てしまう（2026-10-11 に Steam で +134% などが出た）。
  // 同じ時刻どうしなら波が打ち消し合う。24時間前の記録が無いあいだは比べない（全部が「初登場」に見えるため）
  const hours = 24;
  const rows = await getPlayRanking(platform, 100, 3, hours);
  if (!rows.some((x) => x.rank24hAgo !== null)) return null;
  const isSteam = platform === "steam";
  const fit = isSteam ? ("contain" as const) : ("cover" as const);
  const href = (twitchGameId: string | null) =>
    isSteam && twitchGameId ? `/games/${twitchGameId}` : listHref;

  const surges = rows
    .filter(
      (r) =>
        r.players !== null &&
        r.players24hAgo !== null &&
        r.players24hAgo > 0 &&
        r.players >= minPlayers &&
        r.players / r.players24hAgo >= 1.5,
    )
    .sort(
      (a, b) => b.players! / b.players24hAgo! - a.players! / a.players24hAgo!,
    )
    .map((r) => ({
      key: `${platform}-${r.externalId}`,
      kind: "surge" as const,
      label: "急上昇",
      name: r.name,
      reason: `${source} ${hours}時間で +${Math.round((r.players! / r.players24hAgo! - 1) * 100)}%（${formatViewers(r.players!)}人）`,
      source,
      imageUrl: r.imageUrl,
      imageFit: fit,
      href: href(r.twitchGameId),
      external: false,
    }));
  const newcomers = rows
    .filter((r) => r.rank <= 50 && r.rank24hAgo === null)
    .map((r) => ({
      key: `${platform}-${r.externalId}`,
      kind: "new" as const,
      label: "初登場",
      name: r.name,
      reason: `${source} ${r.rank}位に初登場（${hours}時間前は圏外）`,
      source,
      imageUrl: r.imageUrl,
      imageFit: fit,
      href: href(r.twitchGameId),
      external: false,
    }));
  return [...surges, ...newcomers];
}

// ============================================
// App Store（売上の順位）
// ============================================

async function appStoreBuzz(): Promise<BuzzItem[] | null> {
  let rows = null;
  let hours = 0;
  for (const h of COMPARE_HOURS) {
    const r = await getAppStoreRanking("grossing", 30, h);
    // undefined は「比べる記録がまだ無い」（lib/appstore.ts）
    if (r.length > 0 && r[0].rank24hAgo !== undefined) {
      rows = r;
      hours = h;
      break;
    }
  }
  if (!rows) return null;
  return rows.flatMap((r): BuzzItem[] => {
    const base = {
      key: `appstore-${r.id}`,
      name: r.name,
      source: "App Store",
      imageUrl: r.iconUrl || null,
      imageFit: "cover" as const,
      href: r.url,
      external: true,
    };
    if (r.rank24hAgo === null)
      return [
        {
          ...base,
          kind: "new",
          label: "初登場",
          reason: `App Store セールス ${r.rank}位に初登場（${hours}時間前は圏外）`,
        },
      ];
    if (r.rank24hAgo !== undefined && r.rank24hAgo - r.rank >= 15)
      return [
        {
          ...base,
          kind: "surge",
          label: "急上昇",
          reason: `App Store セールス ${r.rank24hAgo}位 → ${r.rank}位（${hours}時間）`,
        },
      ];
    return [];
  });
}

/** 配信元ごとの候補から、順番に1つずつ取って最大5つにする（1つの配信元で埋まらないように）。
 *  並びは「配信で急増」を先にする（このサイトにしか出せない情報なので） */
function pickRoundRobin(lists: BuzzItem[][]): BuzzItem[] {
  const picked: BuzzItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; picked.length < MAX; i++) {
    if (lists.every((l) => i >= l.length)) break;
    for (const list of lists) {
      const item = list[i];
      // 同じゲームが Steam の急上昇と Twitch の急増の両方に出たら、先に入った方だけ残す
      if (item && !seen.has(item.name) && picked.length < MAX) {
        picked.push(item);
        seen.add(item.name);
      }
    }
  }
  return picked;
}

/** いま話題のゲーム（最大5つ）。元のデータは毎時なので、1時間作り置きする
 *  （ページは5分ごとに作り直すが、ここで毎回 DB を数千行読まないため） */
export const getGameBuzz = unstable_cache(
  async (): Promise<BuzzItem[]> => {
    const results = await Promise.allSettled([
      twitchSurges(),
      playBuzz("steam", "Steam", 3000, "/games/steam"),
      appStoreBuzz(),
      playBuzz("roblox", "Roblox", 5000, "/games/roblox"),
    ]);
    // 1つの配信元が失敗しても、ほかの配信元の話題は出す
    return pickRoundRobin(
      results.map((r) => (r.status === "fulfilled" ? (r.value ?? []) : [])),
    );
  },
  // 選び方を変えたら鍵も変える（作り置きの鍵は外側のこの関数で決まり、中の関数を直しても古い結果が残るため）
  ["game-buzz-v5"],
  { revalidate: 3600 },
);
