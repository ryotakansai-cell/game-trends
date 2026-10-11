// App Store（iPhone）の日本のゲームのランキング。
// Apple 公式の RSS（鍵なし・無料）から取る。人数ではなく「売上（セールス）」と「無料」の順位。
// Google Play には公式のランキング API が無いので、iPhone だけ（2026-10 に確認）。
//
// Apple は Cloudflare のサーバーからの読み取りを不安定に拒否する（2026-10-11、ブラウザと同じ
// User-Agent を付けても通ったり通らなかったり。手元の回線からは常に読める）。
// そこで RSS は GitHub Actions（.github/workflows/appstore.yml）が GitHub の回線で取り、
// /api/cron/appstore に送ってもらう。サイトは受け取った RSS を読み解いて DB に保存し、ページは DB から読む。
// 保存先は Steam・Roblox と同じ play_titles / play_snapshots（人数は無いので NULL、順位だけ）。
// 毎時の記録・日ごとの集計・90日で消す仕組みをそのまま使えて、24時間前からの順位の変化も出せる。
import {
  getPlayRanking,
  savePlaySnapshot,
  titlesToRefresh,
  type PlayPlatform,
} from "@/lib/play";

export type AppStoreGame = {
  rank: number;
  id: string;
  name: string;
  developer: string;
  iconUrl: string;
  url: string;
};

export type AppStoreChart = "grossing" | "free";

/** GitHub Actions が読む RSS の名前（workflow 側にも同じ対応を書いている） */
export const FEED: Record<AppStoreChart, string> = {
  grossing: "topgrossingapplications",
  free: "topfreeapplications",
};

const PLATFORM: Record<AppStoreChart, PlayPlatform> = {
  grossing: "appstore_grossing",
  free: "appstore_free",
};

/** 外から受け取った値が順位表の名前かを確かめる */
export function isAppStoreChart(v: string | null): v is AppStoreChart {
  return v === "grossing" || v === "free";
}

/** RSS（https://itunes.apple.com/jp/rss/<FEED>/limit=100/genre=6014/json）の中身を読み解く。
 *  genre=6014 は「ゲーム」 */
export function parseAppStoreFeed(json: unknown): AppStoreGame[] {
  type Entry = {
    id: { attributes: { "im:id": string }; label: string };
    "im:name": { label: string };
    "im:artist": { label: string };
    "im:image": { label: string }[];
  };
  const entries = ((json as { feed?: { entry?: Entry[] } })?.feed?.entry ??
    []) as Entry[];
  return entries.map((e, i) => ({
    rank: i + 1,
    id: e.id.attributes["im:id"],
    name: e["im:name"].label,
    developer: e["im:artist"].label,
    // 一番大きいアイコン（配列の最後）
    iconUrl: e["im:image"].at(-1)?.label ?? "",
    url: e.id.label,
  }));
}

/** 受け取った順位表を保存する。名前やアイコンはマスタに1日1回だけ書く（Steam・Roblox と同じ） */
export async function saveAppStoreRanking(
  chart: AppStoreChart,
  games: AppStoreGame[],
  capturedAt: string,
) {
  const platform = PLATFORM[chart];
  const stale = new Set(
    await titlesToRefresh(
      platform,
      games.map((g) => g.id),
    ),
  );
  await savePlaySnapshot(
    platform,
    games
      .filter((g) => stale.has(g.id))
      .map((g) => ({
        externalId: g.id,
        name: g.name,
        imageUrl: g.iconUrl || null,
        twitchGameId: null,
        developer: g.developer,
      })),
    games.map((g) => ({ externalId: g.id, players: null, rank: g.rank })),
    capturedAt,
  );
}

export type AppStoreRankingRow = AppStoreGame & {
  // 24時間前の順位。null は「24時間前は圏外（NEW）」、undefined は「比べる記録がまだ無い」
  rank24hAgo: number | null | undefined;
  capturedAt: string;
};

/** DB に保存した最新の順位表。GitHub Actions の定期実行は混雑時に数時間遅れるので、12時間以内なら出す */
export async function getAppStoreRanking(
  chart: AppStoreChart,
  limit = 50,
): Promise<AppStoreRankingRow[]> {
  const rows = await getPlayRanking(PLATFORM[chart], limit, 12);
  // 24時間前の記録が1件も無いあいだ（集め始めて1日以内・収集が抜けた）は、全部が NEW に見えてしまうので比べない
  const hasPast = rows.some((r) => r.rank24hAgo !== null);
  return rows.map((r) => ({
    rank: r.rank,
    id: r.externalId,
    name: r.name,
    developer: r.developer ?? "",
    iconUrl: r.imageUrl ?? "",
    url: `https://apps.apple.com/jp/app/id${r.externalId}`,
    rank24hAgo: hasPast ? r.rank24hAgo : undefined,
    capturedAt: r.capturedAt,
  }));
}
