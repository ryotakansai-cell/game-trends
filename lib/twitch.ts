const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

export type TwitchGame = {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id: string;
};

function getCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET が未設定です");
  }
  return { clientId, clientSecret };
}

async function getAccessToken() {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`トークン取得に失敗: ${res.status}`);

  const json = await res.json();
  return json.access_token as string;
}

async function twitchFetch<T>(path: string, revalidate = 300): Promise<T[]> {
  const { clientId } = getCredentials();
  const token = await getAccessToken();

  const res = await fetch(`${HELIX}${path}`, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
    next: { revalidate },
  });

  if (!res.ok) {
    throw new Error(`Twitch APIエラー ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return json.data as T[];
}

export async function getTopGames(limit = 30) {
  return twitchFetch<TwitchGame>(`/games/top?first=${limit}`);
}

export function boxArt(url: string, width = 285, height = 380) {
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}

export function isRealGame(game: TwitchGame) {
  return game.igdb_id !== "";
}

export type TwitchStream = {
  id: string;
  user_name: string;
  game_id: string;
  title: string;
  viewer_count: number;
  language: string;
};

async function helixPage<T>(
  path: string,
  cursor?: string,
): Promise<{ data: T[]; cursor?: string }> {
  const { clientId } = getCredentials();
  const token = await getAccessToken();

  const url = new URL(`${HELIX}${path}`);
  if (cursor) url.searchParams.set("after", cursor);

  const res = await fetch(url, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`Twitch APIエラー ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return { data: json.data as T[], cursor: json.pagination?.cursor };
}

export async function getViewerCountByGame(pages = 5) {
  const counts = new Map<string, number>();
  let cursor: string | undefined = undefined;

  for (let i = 0; i < pages; i++) {
    const page: { data: TwitchStream[]; cursor?: string } =
      await helixPage<TwitchStream>("/streams?first=100", cursor);

    for (const stream of page.data) {
      const current = counts.get(stream.game_id) ?? 0;
      counts.set(stream.game_id, current + stream.viewer_count);
    }

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return counts;
}

export function formatViewers(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("ja-JP");
}
