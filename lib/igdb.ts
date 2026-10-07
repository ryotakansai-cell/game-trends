// IGDB（Internet Game Database）との通信。
//
// IGDBはTwitchが運営していて、認証もTwitchと同じ仕組みを使う。
// つまり TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET をそのまま使え、
// 新しいAPIキーの登録はいらない。
//
// Twitchの games/top のレスポンスに igdb_id が入っているので、
// それを手がかりにゲームの公式サイトやジャンルを引ける。
import { getTwitchAuth } from "@/lib/twitch";

const IGDB_API = "https://api.igdb.com/v4";

export type GameLink = {
  label: string;
  url: string;
};

export type GameDetails = {
  genres: string[];
  releaseDate: string | null; // 表示用に整形済み
  rating: number | null; // 0〜100。評価数が少ないものは出さない
  links: GameLink[];
};

// IGDBの websites.type のうち「公式サイト」を表す値
const TYPE_OFFICIAL = 1;

// ホスト名から表示名を決める。
// IGDBの type は種類が増えていくので、公式サイト(1)だけ type で判定し、
// 残りはホスト名で見分ける。番号の仕様変更に強くしておくため。
// ここに載っていないURL（Facebook、Instagramなど）は表示しない。
const HOST_LABELS: [RegExp, string][] = [
  [/store\.steampowered\.com/, "Steam"],
  [/ja\.wikipedia\.org/, "Wikipedia"],
  [/wikipedia\.org/, "Wikipedia（英語）"],
  [/youtube\.com/, "公式YouTube"],
  [/store\.playstation\.com/, "PlayStation Store"],
  [/nintendo\./, "Nintendo"],
  [/xbox\.com/, "Xbox"],
  [/epicgames\.com/, "Epic Games"],
  [/gog\.com/, "GOG"],
  [/reddit\.com/, "Reddit"],
  [/discord\./, "Discord"],
];

// 全部出すとApexで10個並んで読みにくかったので、上位6件までにする
const MAX_LINKS = 6;

type IgdbWebsite = { url: string; type?: number };
type IgdbGame = {
  slug?: string;
  genres?: { name: string }[];
  first_release_date?: number; // Unix秒
  rating?: number;
  rating_count?: number;
  websites?: IgdbWebsite[];
};

/** IGDBのwebsites配列を、表示用のリンク一覧に変換する */
function toLinks(websites: IgdbWebsite[], slug?: string): GameLink[] {
  const links: GameLink[] = [];

  // 公式サイトを先頭に置く。一番知りたいのはこれなので
  const official = websites.find((w) => w.type === TYPE_OFFICIAL);
  if (official) links.push({ label: "公式サイト", url: official.url });

  // 残りは HOST_LABELS に載っている順で並べる。
  // 配列の順番がそのまま表示の優先順位になる
  for (const [pattern, label] of HOST_LABELS) {
    const hit = websites.find(
      (w) =>
        w !== official &&
        pattern.test(w.url) &&
        !links.some((l) => l.label === label),
    );
    if (hit) links.push({ label, url: hit.url });
  }

  const result = links.slice(0, MAX_LINKS);

  // IGDBのゲームページ。ジャンル・スクリーンショット・関連作などが見られる。
  // 上限とは別枠で最後に付ける（情報源を示す意味もある）
  if (slug) {
    result.push({ label: "IGDB", url: `https://www.igdb.com/games/${slug}` });
  }

  return result;
}

/** IGDBのIDからゲームの詳細を取得する。取れなければ null（ページは従来どおり表示する） */
export async function getGameDetails(
  igdbId: string | number | undefined,
): Promise<GameDetails | null> {
  // Twitchの「Just Chatting」のような非ゲームカテゴリは igdb_id が空になる
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const { clientId, token } = await getTwitchAuth();

  // IGDBは独自のクエリ言語（APIcalypse）を本文に書くPOSTリクエスト。
  // fields で欲しい項目を指定し、where で絞り込む
  const res = await fetch(`${IGDB_API}/games`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: `fields slug,genres.name,first_release_date,rating,rating_count,websites.url,websites.type; where id = ${id};`,
    // ゲームの発売日やジャンルはほぼ変わらないので1日作り置きする。
    // POST は既定では作り置きされないので force-cache で明示する
    cache: "force-cache",
    next: { revalidate: 86400 },
  });

  if (!res.ok) return null;

  const rows = (await res.json()) as IgdbGame[];
  const game = rows[0];
  if (!game) return null;

  return {
    genres: (game.genres ?? []).map((g) => g.name),
    releaseDate: game.first_release_date
      ? // Unix秒なので1000倍してミリ秒にする
        new Date(game.first_release_date * 1000).toLocaleDateString("ja-JP")
      : null,
    // 評価数が少ないものは当てにならないので出さない
    rating:
      game.rating && (game.rating_count ?? 0) >= 20
        ? Math.round(game.rating)
        : null,
    links: toLinks(game.websites ?? [], game.slug),
  };
}
