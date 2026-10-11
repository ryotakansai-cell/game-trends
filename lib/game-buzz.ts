// ゲームの「総合」ページの一番上に出す「いま話題のゲーム」を選ぶ。
// 配信（Twitch の日本語配信）・Steam・Roblox・App Store から、24時間前と比べて大きく動いたものを集め、
// 配信元が偏らないように順番に1つずつ取って最大5つにする。
// 条件を満たすものが無ければ空を返し、ページは枠ごと出さない（無理に5つ並べると、ただの飾りになるため）。
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
  reason: string; // 「日本の配信 300人 → 2,100人」のような根拠の1行
  source: string; // 「Twitch」「Steam」など
  imageUrl: string | null;
  imageFit: "cover" | "contain"; // 横長の画像（Steam）は切り取らずに収める
  href: string;
  external: boolean;
};

const MAX = 5;

// ============================================
// 配信で急に見られ始めたゲーム（Twitch の日本語配信）
// ============================================

/** 最新の収集と、24時間前に一番近い収集で、日本語の配信のゲームごとの視聴者数を比べる。
 *  人数ではなく「全体に占める割合」で比べるのは、毎時の記録の件数が時間によって揺れるため
 *  （2026-10-11 の実測で、日本語の配信が202件の回も1,064件の回もあった）。割合なら取りこぼしの影響を受けにくい */
async function twitchSurges(): Promise<BuzzItem[]> {
  const db = getDbClient();
  const latest = await db.execute(
    `SELECT l.captured_at AS at FROM live_snapshots l
     JOIN accounts a ON a.id = l.account_id
     WHERE a.platform = 'twitch' ORDER BY l.captured_at DESC LIMIT 1`,
  );
  const nowAt = latest.rows[0]?.at ? String(latest.rows[0].at) : null;
  if (!nowAt) return [];
  const target = new Date(new Date(nowAt).getTime() - 24 * 3600 * 1000);
  const past = await db.execute({
    sql: `SELECT l.captured_at AS at FROM live_snapshots l
          JOIN accounts a ON a.id = l.account_id
          WHERE a.platform = 'twitch' AND l.captured_at BETWEEN ? AND ?
          GROUP BY l.captured_at
          ORDER BY ABS(strftime('%s', l.captured_at) - strftime('%s', ?))
          LIMIT 1`,
    args: [
      new Date(target.getTime() - 2 * 3600 * 1000).toISOString(),
      new Date(target.getTime() + 2 * 3600 * 1000).toISOString(),
      target.toISOString(),
    ],
  });
  const pastAt = past.rows[0]?.at ? String(past.rows[0].at) : null;
  if (!pastAt) return [];

  const byGame = async (at: string) => {
    const r = await db.execute({
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
  };
  const [now, before] = await Promise.all([byGame(nowAt), byGame(pastAt)]);
  const sum = (
    m: Map<string, { viewers: number; streams: number }>,
    key: "viewers" | "streams",
  ) => [...m.values()].reduce((acc, x) => acc + x[key], 0);
  const nowTotal = sum(now, "viewers");
  const pastTotal = sum(before, "viewers");
  // 24時間前の記録が、いまより明らかに少ない回は比べない（収集の失敗や、記録の範囲を広げる前の時間）。
  // 2026-10-11 に、日本語の配信を77件しか記録していなかった時間と比べて
  // 「Apex Legends の配信が始まった」と誤って出したので、合計人数ではなく配信の件数で見る
  const nowStreams = sum(now, "streams");
  const pastStreams = sum(before, "streams");
  if (nowTotal === 0 || pastStreams < 100 || pastStreams < nowStreams * 0.5)
    return [];

  const surges = [...now]
    .filter(([, x]) => x.viewers >= 500 && x.streams >= 3)
    .map(([gameId, x]) => {
      const p = before.get(gameId);
      const shareNow = x.viewers / nowTotal;
      // 24時間前に誰も配信していなかったゲームは、割合を小さな値（0.1%）とみなして比べる
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
          ? `日本の配信 ${formatViewers(s.past.viewers)}人 → ${formatViewers(s.now.viewers)}人`
          : `日本で${s.now.streams}人が配信中・${formatViewers(s.now.viewers)}人が視聴`,
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
): Promise<BuzzItem[]> {
  const rows = await getPlayRanking(platform, 100);
  // 24時間前の記録が1件も無いあいだ（集め始めて1日以内）は、全部が「初登場」に見えるので比べない
  if (!rows.some((r) => r.rank24hAgo !== null)) return [];
  const isSteam = platform === "steam";
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
      reason: `${source} 24時間で +${Math.round((r.players! / r.players24hAgo! - 1) * 100)}%（${formatViewers(r.players!)}人）`,
      source,
      imageUrl: r.imageUrl,
      imageFit: isSteam ? ("contain" as const) : ("cover" as const),
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
      reason: `${source} ${r.rank}位に初登場`,
      source,
      imageUrl: r.imageUrl,
      imageFit: isSteam ? ("contain" as const) : ("cover" as const),
      href: href(r.twitchGameId),
      external: false,
    }));
  return [...surges, ...newcomers];
}

// ============================================
// App Store（売上の順位）
// ============================================

async function appStoreBuzz(): Promise<BuzzItem[]> {
  const rows = await getAppStoreRanking("grossing", 30);
  return rows.flatMap((r): BuzzItem[] => {
    // undefined は「比べる記録がまだ無い」（lib/appstore.ts）
    if (r.rank24hAgo === undefined) return [];
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
          kind: "new" as const,
          label: "初登場",
          reason: `App Store セールス ${r.rank}位に初登場`,
        },
      ];
    if (r.rank24hAgo - r.rank >= 15)
      return [
        {
          ...base,
          kind: "surge" as const,
          label: "急上昇",
          reason: `App Store セールス ${r.rank24hAgo}位 → ${r.rank}位`,
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
    const before = picked.length;
    for (const list of lists) {
      const item = list[i];
      // 同じゲームが Steam の急上昇と Twitch の急増の両方に出たら、先に入った方だけ残す
      if (item && !seen.has(item.name) && picked.length < MAX) {
        picked.push(item);
        seen.add(item.name);
      }
    }
    if (picked.length === before && lists.every((l) => i >= l.length)) break;
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
    const lists = results.map((r) => (r.status === "fulfilled" ? r.value : []));
    return pickRoundRobin(lists);
  },
  ["game-buzz"],
  { revalidate: 3600 },
);
