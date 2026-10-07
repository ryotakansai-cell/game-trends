import { getDbClient } from "@/lib/db";
import { pastWindow } from "@/lib/snapshot-range";
import type { PlatformAccount, PlatformContent } from "@/lib/platform";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

function getApiKey() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY が未設定です");
  }
  return apiKey;
}

export type YouTubeSearchResult = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl: string;
};

export type YouTubeLiveVideo = YouTubeSearchResult & {
  viewers: number;
};

/** 今ライブ中の動画を検索する（キーワード必須。地域は任意） */
export async function searchLiveVideos(
  query: string,
  regionCode?: string,
): Promise<YouTubeSearchResult[]> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    eventType: "live",
    order: "viewCount",
    maxResults: "25",
    q: query,
    key: apiKey,
  });
  if (regionCode) params.set("regionCode", regionCode);

  const res = await fetch(`${YOUTUBE_API}/search?${params}`);
  const json = await res.json();

  if (json.error) {
    throw new Error(`YouTube search.list エラー: ${json.error.message}`);
  }

  return (json.items ?? [])
    .filter((item: { id?: { videoId?: string } }) => item.id?.videoId)
    .map((item: any) => ({
      videoId: item.id.videoId as string,
      channelId: item.snippet.channelId as string,
      channelTitle: item.snippet.channelTitle as string,
      title: item.snippet.title as string,
      thumbnailUrl:
        item.snippet.thumbnails?.high?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
    }));
}

async function fetchViewerCounts(
  videoIds: string[],
): Promise<YouTubeLiveVideo[]> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoIds.join(","),
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API}/videos?${params}`);
  const json = await res.json();

  if (json.error) {
    throw new Error(`YouTube videos.list エラー: ${json.error.message}`);
  }

  return (json.items ?? [])
    .filter((item: any) => item.liveStreamingDetails?.concurrentViewers)
    .map((item: any) => ({
      videoId: item.id as string,
      channelId: item.snippet.channelId as string,
      channelTitle: item.snippet.channelTitle as string,
      title: item.snippet.title as string,
      thumbnailUrl:
        item.snippet.thumbnails?.high?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
      // concurrentViewers は文字列で返ってくるので数値に変換する
      viewers: Number(item.liveStreamingDetails.concurrentViewers),
    }));
}

/** 動画IDから今の同時接続数を取得する（配信が終わっていたら除外される） */
export async function getViewerCounts(
  videoIds: string[],
): Promise<YouTubeLiveVideo[]> {
  if (videoIds.length === 0) return [];

  // videos.list は一度に指定できるIDが50件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const results = await Promise.all(chunks.map(fetchViewerCounts));
  return results.flat();
}

/** 日本向け検索で使うキーワードのローテーション候補 */
export const JP_LIVE_KEYWORDS = ["配信", "ゲーム実況", "vtuber", "雑談"];

/** 全世界向け検索で使うキーワードのローテーション候補 */
export const GLOBAL_LIVE_KEYWORDS = [
  "esports",
  "gameplay",
  "playthrough",
  "vtuber",
];

/** 時刻（0-23）に応じてキーワードを1つ選ぶ（順番に一周する） */
export function pickKeyword(keywords: string[], hour: number) {
  return keywords[hour % keywords.length];
}

/** 動画IDからサムネイル画像のURLを組み立てる（保存不要、その場で作れる） */
export function youtubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export type YouTubeLiveRankingRow = {
  video_id: string;
  title: string;
  viewers: number;
  region: "jp" | "global";
  channel_id: string;
  channel_title: string;
};

/** チャンネルIDから、アイコン画像のURLをまとめて取得する（表示時にその場で取得。TwitchのgetUsersByLoginと同じ考え方） */
export async function getChannelIcons(
  channelIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = [...new Set(channelIds)];
  if (uniqueIds.length === 0) return map;

  const apiKey = getApiKey();

  // channels.listも一度に指定できるIDが50件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    chunks.push(uniqueIds.slice(i, i + 50));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        part: "snippet",
        id: chunk.join(","),
        key: apiKey,
      });
      // トップ・急上昇・クリエイターページの表示のたびに呼ばれるので、返事を1日作り置きする。
      // 作り置きが無いと表示1回で1ユニット減り、毎時の cron（1日約7,250）と合わせて
      // 1日1万の枠を超えかねない。アイコンはめったに変わらないので1日で十分
      const res = await fetch(`${YOUTUBE_API}/channels?${params}`, {
        next: { revalidate: 86400 },
      });
      const json = await res.json();
      if (json.error) return;

      for (const item of json.items ?? []) {
        const url =
          item.snippet?.thumbnails?.default?.url ??
          item.snippet?.thumbnails?.medium?.url;
        if (url) map.set(item.id, url);
      }
    }),
  );

  return map;
}

/** DBに貯めた直近の収集結果から、ランキングを読み出す */
export async function getTopYouTubeLive(
  region?: "jp" | "global",
  limit = 40,
): Promise<YouTubeLiveRankingRow[]> {
  const db = getDbClient();

  const sql = `
    -- 最新の収集に含まれる YouTube の配信だけを読む。
    -- 最新の時刻は captured_at の索引を新しい順にたどって最初の YouTube の行で止める
    -- （以前は YouTube の全履歴から MAX を取っていた）
    SELECT
      -- 列名は移行前と同じにする（呼び出し側は変更不要）
      l.content_id AS video_id,
      l.title,
      l.viewers,
      l.region,
      a.platform_id AS channel_id,
      a.display_name AS channel_title
    FROM live_snapshots l
    JOIN accounts a ON a.id = l.account_id
    WHERE a.platform = 'youtube'
      AND l.captured_at = (
        SELECT l2.captured_at
        FROM live_snapshots l2
        JOIN accounts a2 ON a2.id = l2.account_id
        WHERE a2.platform = 'youtube'
        ORDER BY l2.captured_at DESC
        LIMIT 1
      )
      ${region ? "AND l.region = ?" : ""}
    ORDER BY l.viewers DESC
    LIMIT ?
  `;
  const args = region ? [region, limit] : [limit];

  const result = await db.execute({ sql, args });
  return result.rows as unknown as YouTubeLiveRankingRow[];
}

// ============================================
// 急上昇ランキング用（DBに貯めた履歴を読む）
// ============================================

export type RisingYouTubeChannel = {
  channel_id: string;
  channel_title: string; // チャンネル名（accounts.display_nameから取得）
  video_id: string; // 今ライブ中の動画ID（サムネとリンクに使う）
  video_title: string; // 今の配信タイトル
  region: "jp" | "global"; // どちらの検索で見つかったか
  current_viewers: number;
  past_viewers: number;
  current_at: string;
  past_at: string;
  growth_rate: number; // 0.35 なら 35%増
};

/** 24時間前と比べて視聴者数が伸びているYouTubeチャンネルを取得する */
export async function getRisingYouTubeLive(
  minViewers = 50, // YouTubeは11人規模から収集できているので広めに拾う
  limit = 20,
  region?: "jp" | "global", // "jp"を渡すと日本向け検索で見つけた配信だけ
): Promise<RisingYouTubeChannel[]> {
  const db = getDbClient();

  // 24時間前の前後6時間だけを読む（全履歴を読まないため。lib/snapshot-range.ts）。
  // YouTubeはキーワードローテーションで記録が飛び飛びになるので、Twitch(3時間)より広く取る
  const [pastFrom, pastTo] = pastWindow(6);

  const sql = `
    -- ⓪ YouTube の最新の収集時刻（索引を新しい順にたどって最初の行で止める）
    WITH latest_at AS (
      SELECT l.captured_at AS at
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'youtube'
      ORDER BY l.captured_at DESC
      LIMIT 1
    ),

    -- ① 最新の収集に含まれているチャンネル（＝最後の観測時点で配信中）
    latest AS (
      SELECT
        l.account_id,
        l.content_id,
        l.title AS video_title,
        l.region,
        l.viewers AS current_viewers,
        l.captured_at AS current_at,
        -- 同じ時刻に複数の動画を配信している場合は、視聴者が多い方を採用
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id
          ORDER BY l.viewers DESC
        ) AS rn
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE l.captured_at = (SELECT at FROM latest_at)
        AND a.platform = 'youtube'
    ),

    -- ② チャンネルごとに「24時間前に一番近い記録」を特定する（前後6時間に絞ってある）
    past AS (
      SELECT
        l.account_id,
        l.viewers AS past_viewers,
        l.captured_at AS past_at,
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id
          ORDER BY ABS(strftime('%s', l.captured_at) - strftime('%s', 'now', '-24 hours')), l.viewers DESC
        ) AS rn
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'youtube'
        AND l.captured_at BETWEEN ? AND ?
    )

    -- ③ ①と②を突き合わせて増加率を計算する
    SELECT
      -- 列名は移行前と同じにする（呼び出し側は変更不要）
      a.platform_id AS channel_id,
      a.display_name AS channel_title,
      l.content_id AS video_id,
      l.video_title,
      l.region,
      l.current_viewers,
      p.past_viewers,
      l.current_at,
      p.past_at,
      (CAST(l.current_viewers AS REAL) - p.past_viewers) / p.past_viewers AS growth_rate
    FROM latest l
    JOIN past p ON p.account_id = l.account_id AND p.rn = 1
    JOIN accounts a ON a.id = l.account_id
    WHERE l.rn = 1
      AND l.current_viewers >= ?
      AND p.past_viewers > 0
      -- 増えている人だけ（急上昇ページなので、減っている人は載せない）
      AND l.current_viewers > p.past_viewers
      ${region ? "AND l.region = ?" : ""}
    ORDER BY growth_rate DESC
    LIMIT ?
  `;

  // ?の数に合わせて渡す値を変える。順番はSQL内の ? の出現順と一致させる
  const args = region
    ? [pastFrom, pastTo, minViewers, region, limit]
    : [pastFrom, pastTo, minViewers, limit];

  const result = await db.execute({ sql, args });
  return result.rows as unknown as RisingYouTubeChannel[];
}

// ============================================
// クリエイターページ用（共通の形に変換して返す）
// ============================================

export type YouTubeUpload = {
  videoId: string;
  title: string;
  publishedAt: string;
};

/** チャンネルの最近の投稿を取得する（playlistItems.list = 1ユニット） */
export async function getRecentUploads(
  channelId: string,
  limit = 6,
): Promise<YouTubeUpload[]> {
  const apiKey = getApiKey();

  // 「アップロード済み動画」は "UU..." というプレイリストにまとまっている。
  // チャンネルID "UCxxxx" の先頭2文字を "UU" に変えるだけで求まるので、
  // channels.list を呼ばずに済む（1ユニット節約）
  const playlistId = `UU${channelId.slice(2)}`;

  const params = new URLSearchParams({
    part: "snippet",
    playlistId,
    maxResults: String(limit),
    key: apiKey,
  });

  // クリエイターページの表示のたびに呼ばれるので、1時間作り置きする（枠の節約）
  const res = await fetch(`${YOUTUBE_API}/playlistItems?${params}`, {
    next: { revalidate: 3600 },
  });
  const json = await res.json();

  // 非公開チャンネルなどで取れないことがある。
  // その場合はページ全体を落とさず、空の一覧として扱う
  if (json.error) return [];

  // playlistItems から必要な部分だけを型として書いておく（anyを避けるため）
  type PlaylistItem = {
    snippet: {
      resourceId: { videoId: string };
      title: string;
      publishedAt: string;
    };
  };

  return (json.items ?? []).map((item: PlaylistItem) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
  }));
}

/** DBに貯めた直近のスナップショットから「今配信中か」を判定する（API消費ゼロ） */
async function getLiveByAccountIds(accountIds: number[]) {
  const map = new Map<
    number,
    { title: string; viewers: number; contentId: string }
  >();
  if (accountIds.length === 0) return map;

  const db = getDbClient();
  // IN (?, ?, ?) の ? を件数ぶん作る
  const placeholders = accountIds.map(() => "?").join(",");
  // 2時間以上前の記録なら、もう配信は終わっているとみなす。
  // 以前は対象アカウントの全履歴を読んでから2時間で絞っていたので、先に範囲で絞る
  const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  const result = await db.execute({
    sql: `
      WITH recent AS (
        SELECT account_id, title, viewers, content_id, captured_at,
          ROW_NUMBER() OVER (
            PARTITION BY account_id ORDER BY captured_at DESC, viewers DESC
          ) AS rn
        FROM live_snapshots
        WHERE account_id IN (${placeholders})
          AND captured_at >= ?
      )
      SELECT account_id, title, viewers, content_id
      FROM recent
      WHERE rn = 1
    `,
    args: [...accountIds, since],
  });

  for (const r of result.rows) {
    map.set(Number(r.account_id), {
      title: String(r.title),
      viewers: Number(r.viewers),
      contentId: String(r.content_id),
    });
  }
  return map;
}

/** 動画IDから再生数をまとめて取得する（videos.list = 50件で1ユニット）。
 *  playlistItems には再生数が含まれないので、人気順に並べるために別途取る */
async function fetchVideoStats(
  videoIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(videoIds)];
  if (unique.length === 0) return map;

  const apiKey = getApiKey();

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) {
    chunks.push(unique.slice(i, i + 50));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        part: "statistics",
        id: chunk.join(","),
        key: apiKey,
      });
      // 最近の動画の再生数。表示のたびに呼ばれるので1時間作り置きする（枠の節約）
      const res = await fetch(`${YOUTUBE_API}/videos?${params}`, {
        next: { revalidate: 3600 },
      });
      const json = await res.json();
      if (json.error) return; // 取れなくても再生数0として扱い、表示は続ける

      for (const item of json.items ?? []) {
        // viewCount は文字列で返ってくるので数値に直す
        map.set(item.id, Number(item.statistics?.viewCount ?? 0));
      }
    }),
  );

  return map;
}

/** YouTubeアカウントの中身を PlatformContent に変換する */
export async function getYouTubeContent(
  accounts: PlatformAccount[],
): Promise<PlatformContent[]> {
  if (accounts.length === 0) return [];

  const [icons, live] = await Promise.all([
    // アイコンは50件まで1回で取れる（合計1ユニット）
    getChannelIcons(accounts.map((a) => a.platform_id)),
    // 配信中かは自前のDBから読む（0ユニット）
    getLiveByAccountIds(accounts.map((a) => a.id)),
  ]);

  // 最近の動画は1チャンネルにつき1ユニットかかる。
  // 無料枠（1日10,000、うちcronが約7,300使う）を守るため、
  // 本人を優先して先頭3チャンネルまでに絞る
  const uploadTargets = new Set(accounts.slice(0, 3).map((a) => a.id));

  // まず全チャンネルの投稿一覧を取る（1チャンネル1ユニット）
  const uploadsByAccount = new Map<number, YouTubeUpload[]>();
  await Promise.all(
    accounts.map(async (account) => {
      if (!uploadTargets.has(account.id)) return;
      const uploads = await getRecentUploads(account.platform_id, 12).catch(
        () => [],
      );
      uploadsByAccount.set(account.id, uploads);
    }),
  );

  // 再生数は全チャンネル分まとめて1回で取る（合計1ユニット）
  const allVideoIds = [...uploadsByAccount.values()]
    .flat()
    .map((u) => u.videoId);
  const stats = await fetchVideoStats(allVideoIds).catch(() => new Map());

  return accounts.map((account) => {
    const uploads = uploadsByAccount.get(account.id) ?? [];
    const liveRow = live.get(account.id);

    return {
      accountId: account.id,
      platform: "youtube",
      label: "YouTube",
      relation: account.relation,
      displayName: account.display_name,
      iconUrl: icons.get(account.platform_id) ?? null,
      profileUrl: `https://www.youtube.com/channel/${account.platform_id}`,
      live: liveRow
        ? {
            title: liveRow.title,
            url: `https://www.youtube.com/watch?v=${liveRow.contentId}`,
            thumbnailUrl: youtubeThumbnail(liveRow.contentId),
            meta: `${liveRow.viewers.toLocaleString("ja-JP")}人が視聴中`,
          }
        : null,
      items: uploads.map((v) => {
        const viewCount = stats.get(v.videoId) ?? 0;
        return {
          id: v.videoId,
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnailUrl: youtubeThumbnail(v.videoId),
          platform: "youtube",
          platformLabel: "YouTube",
          relation: account.relation,
          kindLabel: "動画",
          channelName: account.display_name,
          publishedAt: v.publishedAt,
          viewCount,
          meta:
            (viewCount > 0
              ? `${viewCount.toLocaleString("ja-JP")}回視聴 ・ `
              : "") + new Date(v.publishedAt).toLocaleDateString("ja-JP"),
        };
      }),
    };
  });
}
