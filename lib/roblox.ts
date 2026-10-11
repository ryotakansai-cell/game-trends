// Roblox との通信（ゲーム＝「体験」ごとの、今遊んでいる人数）。
//
// Roblox のサイト自身が使っている公開の窓口から取る（鍵なし。2026-10 に確認）:
//   - apis.roblox.com/explore-api/v1/get-sorts … 「Top Playing Now」の上位約100本（人数つき）
//   - thumbnails.roblox.com/v1/games/icons … アイコン画像
// 公式に案内された API ではないので、予告なく形が変わる可能性がある。取れなかった回は記録しない。
//
// Twitch では Roblox の体験はすべて「ROBLOX」という1つのカテゴリにまとまっているので、
// 体験ごとの配信とは結び付けられない。ページでは ROBLOX のカテゴリ全体の日本の配信数を出す。
import { titlesToRefresh, type PlayRow, type TitleInfo } from "@/lib/play";

/** Twitch の「ROBLOX」カテゴリ */
export const ROBLOX_TWITCH_GAME_ID = "23020";

type RobloxGame = { universeId: number; name: string; playerCount: number };

async function getTopPlaying(): Promise<RobloxGame[]> {
  const res = await fetch(
    "https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=stream-trends&device=computer&country=jp",
    { cache: "no-store" },
  );
  const json = await res.json();
  const sort = (json.sorts ?? []).find(
    (s: { sortId?: string }) => s.sortId === "top-playing-now",
  );
  return (sort?.games ?? []) as RobloxGame[];
}

async function getIcons(universeIds: string[]) {
  const map = new Map<string, string>();
  for (let i = 0; i < universeIds.length; i += 100) {
    const chunk = universeIds.slice(i, i + 100);
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk.join(",")}&size=150x150&format=Png`,
      { cache: "no-store" },
    );
    const json = await res.json();
    for (const d of json.data ?? []) {
      if (d.imageUrl) map.set(String(d.targetId), String(d.imageUrl));
    }
  }
  return map;
}

/** 毎時の収集：今遊ばれている上位の人数と、マスタの更新が要るものの情報 */
export async function collectRoblox(): Promise<{
  rows: PlayRow[];
  titles: TitleInfo[];
}> {
  const games = await getTopPlaying();
  // 人数の多い順に並べ直して順位を付ける（並びは Roblox のおすすめの都合で前後することがある）
  const sorted = [...games].sort((a, b) => b.playerCount - a.playerCount);
  const rows: PlayRow[] = sorted.map((g, i) => ({
    externalId: String(g.universeId),
    players: g.playerCount,
    rank: i + 1,
  }));

  const ids = sorted.map((g) => String(g.universeId));
  const refresh = await titlesToRefresh("roblox", ids);
  if (refresh.length === 0) return { rows, titles: [] };

  const icons = await getIcons(refresh).catch(() => new Map<string, string>());
  const byId = new Map(sorted.map((g) => [String(g.universeId), g]));
  const titles: TitleInfo[] = refresh.map((id) => ({
    externalId: id,
    name: byId.get(id)?.name ?? `Roblox ${id}`,
    imageUrl: icons.get(id) ?? null,
    twitchGameId: ROBLOX_TWITCH_GAME_ID,
  }));
  return { rows, titles };
}
