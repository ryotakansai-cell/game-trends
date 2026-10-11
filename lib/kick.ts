// Kick の公開 API との通信（唯一の窓口）。
// アプリの ClientID と ClientSecret でトークンをもらい（ユーザーにログインしてもらわない方式）、公開の情報だけを読む。
//
// 2026-10-11 の実測：日本語の配信を視聴者の多い順に1回で100件取れ、同接10人以上はその中に全部入っていた。
// 呼び出しの上限はヘッダーに出ていないので、表示のたびに呼ぶのは「いま配信中の一覧」の1回（5分作り置き）だけにして、
// アイコンは毎時の収集のついでに DB（accounts.icon_url）へ残す（ツイキャスと同じ）。
import type { PlatformAccount, PlatformContent } from "@/lib/platform-content";

const API = "https://api.kick.com";

function getCredentials() {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Kick の鍵が未設定です");
  return { clientId, clientSecret };
}

/** アプリ用のトークン。有効期限は60日なので、1日作り置きして使い回す（Twitch と同じ考え方） */
async function getAccessToken() {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    // POST は既定では作り置きされないので、force-cache で明示する
    cache: "force-cache",
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`Kick のトークン取得に失敗: ${res.status}`);
  return (await res.json()).access_token as string;
}

/** revalidate 秒だけ返事を作り置きする。0 は作り置きしない（毎時の収集用） */
async function kickFetch<T>(path: string, revalidate: number): Promise<T[]> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" }),
  });
  if (!res.ok) {
    throw new Error(`Kick API エラー ${res.status}: ${await res.text()}`);
  }
  return ((await res.json()).data ?? []) as T[];
}

export type KickLivestream = {
  broadcaster_user_id: number;
  channel_id: number;
  slug: string; // URL 用の名前（kick.com/<slug>）
  stream_title: string;
  language: string;
  viewer_count: number;
  thumbnail: string;
  started_at: string;
  category: { id: number; name: string } | null;
  profile_picture: string | null;
};

/** いま配信中の上位100件。language を渡すとその言語だけ（日本語は "ja"） */
export async function getLivestreams(language?: string, revalidate = 300) {
  const params = new URLSearchParams({ limit: "100", sort: "viewer_count" });
  if (language) params.set("language", language);
  return kickFetch<KickLivestream>(
    `/public/v1/livestreams?${params}`,
    revalidate,
  );
}

export type KickUser = {
  user_id: number;
  name: string; // 表示に使う名前（Kick は表示名とユーザー名が同じ）
  profile_picture: string | null;
};

/** ユーザーIDから名前とアイコンを引く（50人ずつ） */
export async function getUsers(ids: number[], revalidate = 0) {
  const unique = [...new Set(ids)];
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += 50)
    chunks.push(unique.slice(i, i + 50));
  const results = await Promise.all(
    chunks.map((c) =>
      kickFetch<KickUser>(
        `/public/v1/users?${c.map((id) => `id=${id}`).join("&")}`,
        revalidate,
      ),
    ),
  );
  return new Map(results.flat().map((u) => [u.user_id, u]));
}

export type KickChannel = {
  broadcaster_user_id: number;
  slug: string;
  stream_title: string;
  category: { id: number; name: string } | null;
  stream: {
    is_live: boolean;
    viewer_count: number;
    thumbnail: string;
    start_time: string;
    language: string;
  } | null;
};

/** チャンネル（配信の状態つき）を slug またはユーザーIDで引く（50件ずつ） */
export async function getChannels(
  by: "slug" | "broadcaster_user_id",
  keys: (string | number)[],
  revalidate = 0,
) {
  const unique = [...new Set(keys)];
  const chunks: (string | number)[][] = [];
  for (let i = 0; i < unique.length; i += 50)
    chunks.push(unique.slice(i, i + 50));
  const results = await Promise.all(
    chunks.map((c) =>
      kickFetch<KickChannel>(
        `/public/v1/channels?${c.map((k) => `${by}=${encodeURIComponent(String(k))}`).join("&")}`,
        revalidate,
      ),
    ),
  );
  return results.flat();
}

/** サムネイルの URL（images.kick.com/video_thumbnails/<A>/<B>/480.webp）から、配信ごとのID「A/B」を取り出す。
 *  live_snapshots.content_id に残しておくと、あとから急上昇などで同じサムネイルの URL を組み立てられる */
export function thumbnailId(url: string | null | undefined) {
  return url?.match(/video_thumbnails\/([^/]+\/[^/]+)\//)?.[1] ?? null;
}

export function thumbnailUrl(contentId: string) {
  return `https://images.kick.com/video_thumbnails/${contentId}/480.webp`;
}

/** 配信開始からの経過時間を「3時間20分」の形にする（Twitch と同じ表記） */
export function elapsedSince(startedAt: string) {
  const minutes = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / 60000,
  );
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}分` : `${hours}時間${minutes % 60}分`;
}

// ============================================
// クリエイターページ用（共通の形に変換して返す）
// ============================================

/** Kick のアカウントの中身を PlatformContent に変換する。
 *  公開 API に過去の配信（アーカイブ）の一覧が無いので、配信中の情報だけ */
export async function getKickContent(
  accounts: PlatformAccount[],
): Promise<PlatformContent[]> {
  if (accounts.length === 0) return [];
  const [channels, users] = await Promise.all([
    getChannels(
      "broadcaster_user_id",
      accounts.map((a) => a.platform_id),
      300,
    ).catch(() => []),
    getUsers(
      accounts.map((a) => Number(a.platform_id)),
      86400,
    ).catch(() => new Map<number, KickUser>()),
  ]);
  const byId = new Map(channels.map((c) => [String(c.broadcaster_user_id), c]));
  return accounts.map((account) => {
    const ch = byId.get(account.platform_id);
    const slug = ch?.slug ?? account.login ?? "";
    const user = users.get(Number(account.platform_id));
    const live = ch?.stream?.is_live ? ch.stream : null;
    return {
      accountId: account.id,
      platform: "kick" as const,
      label: "Kick",
      relation: account.relation,
      displayName: user?.name ?? account.display_name,
      iconUrl: user?.profile_picture ?? null,
      profileUrl: `https://kick.com/${slug}`,
      live: live
        ? {
            title: ch!.stream_title,
            url: `https://kick.com/${slug}`,
            thumbnailUrl: live.thumbnail,
            meta: `${live.viewer_count.toLocaleString("ja-JP")}人が視聴中`,
          }
        : null,
      items: [],
    };
  });
}
