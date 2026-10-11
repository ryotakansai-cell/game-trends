// App Store（iPhone）の日本のゲームのランキング。
// Apple 公式の RSS（鍵なし・無料）から取る。人数ではなく「売上（セールス）」と「無料」の順位。
// Google Play には公式のランキング API が無いので、iPhone だけ（2026-10 に確認）。
// 1時間ごとに作り置きする（Apple 側の更新もそれくらいの頻度）。

export type AppStoreGame = {
  rank: number;
  id: string;
  name: string;
  developer: string;
  iconUrl: string;
  url: string;
};

export type AppStoreChart = "grossing" | "free";

const FEED: Record<AppStoreChart, string> = {
  grossing: "topgrossingapplications",
  free: "topfreeapplications",
};

/** genre=6014 は「ゲーム」 */
export async function getAppStoreRanking(
  chart: AppStoreChart,
  limit = 50,
): Promise<AppStoreGame[]> {
  const res = await fetch(
    `https://itunes.apple.com/jp/rss/${FEED[chart]}/limit=${limit}/genre=6014/json`,
    { next: { revalidate: 3600 } },
  );
  const json = await res.json();
  type Entry = {
    id: { attributes: { "im:id": string }; label: string };
    "im:name": { label: string };
    "im:artist": { label: string };
    "im:image": { label: string }[];
  };
  return ((json.feed?.entry ?? []) as Entry[]).map((e, i) => ({
    rank: i + 1,
    id: e.id.attributes["im:id"],
    name: e["im:name"].label,
    developer: e["im:artist"].label,
    // 一番大きいアイコン（配列の最後）
    iconUrl: e["im:image"].at(-1)?.label ?? "",
    url: e.id.label,
  }));
}
