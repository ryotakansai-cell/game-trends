// ツイキャス API v2 との通信（唯一の窓口）。
// アプリの ClientID と ClientSecret の Basic 認証で、公開されている情報だけを読む
// （ユーザーにツイキャスへログインしてもらう仕組みは使わない）。
//
// 呼び出しの上限は1分60回と小さい（2026-10-11 に応答のヘッダーで確認）。
// そのため表示のたびに API を呼ぶのは「いま配信中の一覧」の1回（5分作り置き）だけにして、
// アイコンは毎時の収集のついでに DB（accounts.icon_url）へ残し、ページはそこから読む。
import type {
  ContentItem,
  PlatformAccount,
  PlatformContent,
} from "@/lib/platform-content";

const API = "https://apiv2.twitcasting.tv";

function headers() {
  const id = process.env.TWITCASTING_CLIENT_ID;
  const secret = process.env.TWITCASTING_CLIENT_SECRET;
  if (!id || !secret) throw new Error("ツイキャスの鍵が未設定です");
  return {
    Accept: "application/json",
    "X-Api-Version": "2.0",
    Authorization: "Basic " + btoa(`${id}:${secret}`),
  };
}

/** revalidate 秒だけ返事を作り置きする。0 は作り置きしない（毎時の収集用） */
async function tcFetch<T>(path: string, revalidate: number): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: headers(),
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" }),
  });
  if (!res.ok) {
    throw new Error(`ツイキャス API エラー ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export type TwitcastingMovie = {
  id: string;
  user_id: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  link: string;
  is_live: boolean;
  is_recorded: boolean;
  large_thumbnail: string;
  created: number; // 配信開始（UNIX 秒）
  duration: number; // 秒
  current_view_count: number;
  total_view_count: number;
};

export type TwitcastingUser = {
  id: string;
  screen_id: string; // URL 用の名前（twitcasting.tv/<screen_id>）
  name: string;
  image: string;
};

export type TwitcastingLive = {
  movie: TwitcastingMovie;
  broadcaster: TwitcastingUser;
};

/** 画像の URL は http で返ってくるが、https でも同じ画像が読める（2026-10-11 に確認）。
 *  https のページに http の画像を混ぜるとブラウザに止められるので、https に直す */
export function toHttps(url: string) {
  return url.replace(/^http:\/\//, "https://");
}

/** いま配信中の「おすすめ」上位100件（日本語）。
 *  2026-10-11 の実測で、同接30人以上の配信はすべてここに入っていた
 *  （カテゴリを全部読んで比べた。10人以上だと7割）。1回で上位を取れるので、これを主に使う */
export async function getRecommendedLives(revalidate = 300) {
  const json = await tcFetch<{ movies: TwitcastingLive[] }>(
    "/search/lives?limit=100&type=recommend&lang=ja",
    revalidate,
  );
  return json.movies ?? [];
}

/** 1人の配信中の情報。配信していなければ null（API は 404 を返す） */
export async function getCurrentLive(
  userId: string,
  revalidate = 300,
): Promise<TwitcastingLive | null> {
  try {
    return await tcFetch<TwitcastingLive>(
      `/users/${encodeURIComponent(userId)}/current_live`,
      revalidate,
    );
  } catch (e) {
    if (String(e).includes(" 404")) return null;
    throw e;
  }
}

/** 1人のユーザー情報。いなければ null */
export async function getUser(userId: string): Promise<TwitcastingUser | null> {
  try {
    const json = await tcFetch<{ user: TwitcastingUser }>(
      `/users/${encodeURIComponent(userId)}`,
      0,
    );
    return json.user;
  } catch (e) {
    if (String(e).includes(" 404")) return null;
    throw e;
  }
}

/** 配信中のサムネイル。鍵なしで読める URL なので、DB の記録からでも組み立てられる */
export function liveThumbnail(userId: string) {
  return `${API}/users/${userId}/live/thumbnail?size=large&position=latest`;
}

// ============================================
// クリエイターページ用（共通の形に変換して返す）
// ============================================

/** ツイキャスのアカウントの中身を PlatformContent に変換する。
 *  配信中かどうかと、録画（アーカイブ）の一覧。1アカウント2回なので、上限（1分60回）のため作り置きを長めにする */
export async function getTwitcastingContent(
  accounts: PlatformAccount[],
): Promise<PlatformContent[]> {
  return Promise.all(
    accounts.map(async (account) => {
      const [live, movies] = await Promise.all([
        getCurrentLive(account.platform_id).catch(() => null),
        tcFetch<{ movies: TwitcastingMovie[] }>(
          `/users/${encodeURIComponent(account.platform_id)}/movies?limit=20`,
          3600,
        )
          .then((j) => j.movies ?? [])
          .catch(() => []),
      ]);
      const login = account.login ?? account.platform_id;
      const items: ContentItem[] = movies
        // 配信中の枠は上の「配信中」に出すので、録画の一覧からは外す
        .filter((m) => m.is_recorded && !m.is_live)
        .map((m) => ({
          id: m.id,
          title: m.title,
          url: m.link.replace(/^http:/, "https:"),
          thumbnailUrl: toHttps(m.large_thumbnail),
          platform: "twitcasting" as const,
          platformLabel: "ツイキャス",
          relation: account.relation,
          kindLabel: "アーカイブ",
          channelName: account.display_name,
          publishedAt: new Date(m.created * 1000).toISOString(),
          viewCount: m.total_view_count,
          meta: `${m.total_view_count.toLocaleString("ja-JP")}回視聴 ・ ${new Date(
            m.created * 1000,
          ).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
        }));
      return {
        accountId: account.id,
        platform: "twitcasting" as const,
        label: "ツイキャス",
        relation: account.relation,
        displayName: live?.broadcaster.name ?? account.display_name,
        iconUrl: live ? toHttps(live.broadcaster.image) : null,
        profileUrl: `https://twitcasting.tv/${login}`,
        live: live
          ? {
              title: live.movie.title,
              url: `https://twitcasting.tv/${login}`,
              thumbnailUrl: toHttps(live.movie.large_thumbnail),
              meta: `${live.movie.current_view_count.toLocaleString("ja-JP")}人が視聴中`,
            }
          : null,
        items,
      };
    }),
  );
}
