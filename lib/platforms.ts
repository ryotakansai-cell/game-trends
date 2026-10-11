// 配信元（Twitch・YouTube・…）ごとの違いを1か所にまとめた「台帳」。
//
// 以前はページごとに `platform === "twitch" ? … : …` と書いていて、配信元を1つ足すたびに
// 10か所以上を直す必要があった。ここに1行足せば、ページは台帳を引くだけで済む。
// Record<PlatformId, …> の形にしてあるので、PLATFORM_IDS に足したのに台帳の行を書き忘れると
// 型チェックで止まる（C# で interface のメンバーを実装し忘れたときと同じ）。
//
// このファイルは API や DB を読まない（ブラウザ側の部品からも使えるように）。
// サーバーで読む処理の振り分けは lib/platform-loaders.ts に置く。

/** 扱っている配信元。並び順はボタンなどに出す順番 */
export const PLATFORM_IDS = ["twitch", "youtube"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatformId(v: unknown): v is PlatformId {
  return (PLATFORM_IDS as readonly unknown[]).includes(v);
}

/** DB の accounts.platform を型付きにする。知らない値は来ない前提だが、来たら気づけるよう例外にする */
export function toPlatformId(v: unknown): PlatformId {
  if (isPlatformId(v)) return v;
  throw new Error(`未知の配信元です: ${String(v)}`);
}

/** アカウントを指す最小限の情報（accounts の platform / platform_id / login） */
export type AccountRef = {
  platform: PlatformId;
  platformId: string;
  login: string | null; // URL 用の名前。YouTube には無い
};

type PlatformInfo = {
  label: string;
  /** 名寄せしていない人の、サイト内の配信者ページ */
  accountPath: (a: AccountRef) => string;
  /** 配信を見に行くリンク（外部）。contentId は live_snapshots.content_id（YouTube は動画ID） */
  liveUrl: (a: AccountRef, contentId: string | null) => string;
  /** 配信中のサムネイル。URL の規則で組み立てられないものは null */
  liveThumbnail: (a: AccountRef, contentId: string | null) => string | null;
  /** 日本の配信とみなす条件（SQL。accounts を a、live_snapshots を l と書く）。
   *  急上昇の「日本」タブで使う */
  japanLiveSql: string;
  /** 日本の配信者とみなす条件（SQL。accounts を a と書く）。sitemap に載せる人を選ぶのに使う */
  japanAccountSql: string;
  /** ライブランキングの更新間隔（説明文に出す） */
  liveUpdate: string;
  /** 急上昇の設定。毎時の記録が飛び飛びの配信元は、24時間前の記録を探す幅を広げる */
  rising: { windowHours: number; minViewers: number };
  /** 配信者ページの動画カードに付ける印の色 */
  badgeClass: string;
  /** sitemap に載せる配信者の数（名寄せしていない人を、直近の配信時間が長い順に）。
   *  全員を載せても、配信の少ない人のページは検索で来る人がほぼいない */
  sitemapAccounts: number;
};

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  twitch: {
    label: "Twitch",
    accountPath: (a) => `/streamers/${a.login}`,
    liveUrl: (a) => `https://twitch.tv/${a.login}`,
    // Twitch の CDN は live_user_{login}-{幅}x{高さ}.jpg という規則なので API に聞かなくてよい
    liveThumbnail: (a) =>
      a.login
        ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${a.login}-440x248.jpg`
        : null,
    japanLiveSql: "a.language = 'ja'",
    japanAccountSql: "a.language = 'ja'",
    liveUpdate: "5分ごと",
    // 日本語の配信は10人以上も記録しているので、小さな配信の上下動で埋まらないよう絞る
    rising: { windowHours: 3, minViewers: 200 },
    badgeClass: "bg-purple-700/90",
    sitemapAccounts: 500,
  },
  youtube: {
    label: "YouTube",
    accountPath: (a) => `/youtube/${a.platformId}`,
    liveUrl: (a, contentId) =>
      contentId
        ? `https://www.youtube.com/watch?v=${contentId}`
        : `https://www.youtube.com/channel/${a.platformId}`,
    liveThumbnail: (_a, contentId) =>
      contentId ? `https://i.ytimg.com/vi/${contentId}/hqdefault.jpg` : null,
    // YouTube は言語を持たないので、日本向けの検索・監視リストで見つかった記録（region='jp'）で見る
    japanLiveSql: "l.region = 'jp'",
    japanAccountSql: "a.id IN (SELECT account_id FROM youtube_watch)",
    liveUpdate: "毎時",
    // キーワードの入れ替えで記録が飛び飛びになるので、24時間前の記録を前後6時間から探す。
    // 11人規模から収集できているので広めに拾う
    rising: { windowHours: 6, minViewers: 50 },
    badgeClass: "bg-red-700/90",
    sitemapAccounts: 200,
  },
};

/** 配信者のページのURL。名寄せ済みなら統合ページ、それ以外は配信元ごとのページ */
export function accountHref(a: AccountRef & { creatorId: number | null }) {
  if (a.creatorId !== null) return `/creators/${a.creatorId}`;
  return PLATFORMS[a.platform].accountPath(a);
}

/** アイコンなどの Map の鍵（"twitch:12345"） */
export function accountKey(a: { platform: string; platformId: string }) {
  return `${a.platform}:${a.platformId}`;
}
