// 配信元ごとに「サーバーで読む処理」を振り分ける台帳（lib/platforms.ts のサーバー版）。
// 配信元を足すときは、lib/<配信元>.ts に読む関数を書き、ここに1行足す。
// Record<PlatformId, …> なので、書き忘れると型チェックで止まる。
import {
  PLATFORMS,
  accountKey,
  type AccountRef,
  type PlatformId,
} from "@/lib/platforms";
import type { PlatformAccount, PlatformContent } from "@/lib/platform-content";
import {
  getTopStreams,
  getUsersByLogin,
  getTwitchContent,
  streamThumb,
  elapsedSince,
} from "@/lib/twitch";
import {
  getTopYouTubeLive,
  getChannelIcons,
  getYouTubeContent,
} from "@/lib/youtube";
import {
  getRecommendedLives,
  getTwitcastingContent,
  toHttps,
} from "@/lib/twitcasting";
import { getDbClient } from "@/lib/db";

/** ライブランキングの1件。配信元が違っても同じ形にそろえる */
export type LiveEntry = AccountRef & {
  key: string;
  title: string;
  viewers: number;
  thumbnailUrl: string;
  watchHref: string;
  channelName: string;
  iconUrl?: string; // 配信の一覧と一緒に返ってくる配信元は、ここに入れておく（後で取りに行かない）
  gameName?: string;
  gameId?: string; // Twitch のゲームID（/games/[id] へのリンク）
  elapsed?: string; // 配信開始からの経過時間
  capturedAt?: string; // DB の毎時の記録から作ったものは、その収集時刻
};

type Loader = {
  /** アイコンの URL（platformId → URL）。表示のたびに取り、DB には保存しない */
  icons: (accounts: AccountRef[]) => Promise<Map<string, string>>;
  /** 統合ページ（/creators/[id]）に出す中身 */
  contents: (accounts: PlatformAccount[]) => Promise<PlatformContent[]>;
  /** いま配信中の上位（ライブランキング） */
  live: (japan: boolean, limit: number) => Promise<LiveEntry[]>;
};

export const LOADERS: Record<PlatformId, Loader> = {
  twitch: {
    icons: async (accounts) => {
      const users = await getUsersByLogin(
        accounts.map((a) => a.login).filter((l): l is string => !!l),
      );
      return new Map(
        [...users.values()].map((u) => [u.id, u.profile_image_url]),
      );
    },
    contents: getTwitchContent,
    // Twitch は表示のたびに API を読む（返事の作り置きは最大5分）
    live: async (japan, limit) => {
      const streams = await getTopStreams({
        language: japan ? "ja" : undefined,
        limit,
      });
      return streams.map((s) => ({
        platform: "twitch" as const,
        platformId: s.user_id,
        login: s.user_login,
        key: `twitch-${s.id}`,
        title: s.title,
        viewers: s.viewer_count,
        thumbnailUrl: streamThumb(s.thumbnail_url),
        watchHref: `https://twitch.tv/${s.user_login}`,
        channelName: s.user_name,
        gameName: s.game_name || undefined,
        gameId: s.game_id || undefined,
        elapsed: elapsedSince(s.started_at),
      }));
    },
  },
  youtube: {
    icons: (accounts) => getChannelIcons(accounts.map((a) => a.platformId)),
    contents: getYouTubeContent,
    // YouTube は表示のたびに API を呼べない（1日の枠が小さい）ので、毎時の収集結果を DB から読む
    live: async (japan, limit) => {
      const videos = await getTopYouTubeLive(japan ? "jp" : undefined, limit);
      return videos.map((v) => {
        const a: AccountRef = {
          platform: "youtube",
          platformId: v.channel_id,
          login: null,
        };
        return {
          ...a,
          key: `youtube-${v.video_id}`,
          title: v.title,
          viewers: v.viewers,
          thumbnailUrl: PLATFORMS.youtube.liveThumbnail(a, v.video_id) ?? "",
          watchHref: PLATFORMS.youtube.liveUrl(a, v.video_id),
          channelName: v.channel_title,
          capturedAt: v.captured_at,
        };
      });
    },
  },
  twitcasting: {
    // API の上限（1分60回）が小さいので、毎時の収集で残した URL を DB から読む（lib/twitcasting.ts の冒頭）
    icons: async (accounts) => {
      if (accounts.length === 0) return new Map();
      const ids = [...new Set(accounts.map((a) => a.platformId))];
      const r = await getDbClient().execute({
        sql: `SELECT platform_id, icon_url FROM accounts
              WHERE platform = 'twitcasting' AND icon_url IS NOT NULL
                AND platform_id IN (${ids.map(() => "?").join(",")})`,
        args: ids,
      });
      return new Map(
        r.rows.map((row) => [String(row.platform_id), String(row.icon_url)]),
      );
    },
    contents: getTwitcastingContent,
    // 「おすすめ」の上位100件を1回だけ読む（5分作り置き）。日本語の配信だけなので、日本/Global で同じ
    live: async (_japan, limit) => {
      const lives = await getRecommendedLives();
      return lives
        .sort((a, b) => b.movie.current_view_count - a.movie.current_view_count)
        .slice(0, limit)
        .map(({ movie, broadcaster }) => ({
          platform: "twitcasting" as const,
          platformId: broadcaster.id,
          login: broadcaster.screen_id,
          key: `twitcasting-${movie.id}`,
          title: movie.title,
          viewers: movie.current_view_count,
          thumbnailUrl: toHttps(movie.large_thumbnail),
          watchHref: `https://twitcasting.tv/${broadcaster.screen_id}`,
          channelName: broadcaster.name,
          iconUrl: toHttps(broadcaster.image),
          elapsed: elapsedSince(new Date(movie.created * 1000).toISOString()),
        }));
    },
  },
};

/** いろいろな配信元のアカウントのアイコンをまとめて取る。鍵は accountKey（"twitch:12345"）。
 *  1つの配信元の API が失敗しても、ほかの配信元のアイコンは返す */
export async function getAccountIcons(accounts: AccountRef[]) {
  const byPlatform = new Map<PlatformId, AccountRef[]>();
  for (const a of accounts) {
    byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  }
  const result = new Map<string, string>();
  await Promise.all(
    [...byPlatform].map(async ([platform, list]) => {
      const icons = await LOADERS[platform]
        .icons(list)
        .catch(() => new Map<string, string>());
      for (const [platformId, url] of icons) {
        result.set(accountKey({ platform, platformId }), url);
      }
    }),
  );
  return result;
}
