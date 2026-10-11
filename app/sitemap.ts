import type { MetadataRoute } from "next";
import { getCreators } from "@/lib/creators";
import { getTopGames, isRealGame } from "@/lib/twitch";
import { getTopUnlinkedAccounts } from "@/lib/account-stats";
import { SITE_URL } from "@/lib/site";

// sitemap.xml を自動生成する。
// 検索エンジンに「このサイトにはどんなURLがあるか」を一覧で渡す仕組み。
// クリエイターページは100人近くあり、トップから全部に辿れるわけではないので、
// 一覧を渡さないと見つけてもらえない。
//
// 1日1回作り直す。配信者の一覧は日ごとの集計（daily_stats）を14日分読むので
// （約8万行）、1時間ごとだと Turso の読み取り枠を月6,000万行近く使ってしまう
export const revalidate = 86400;

// 配信者ページは数千人分あるので、直近の配信時間が長い順に上位だけ載せる。
// 全員を載せても、配信の少ない人のページは検索で来る人がほぼいない
const TWITCH_STREAMERS = 500;
const YOUTUBE_CHANNELS = 200;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // 固定のページ。priority は「サイト内での相対的な重要度」の目安
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/trending`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/games`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/creators`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  // 名寄せ済みのクリエイター。DBから引くので確実に全員ぶん出せる。
  // 外部APIと違って失敗しにくいが、念のため落ちてもsitemap全体は返す
  let creatorPages: MetadataRoute.Sitemap = [];
  try {
    const creators = await getCreators(500);
    creatorPages = creators.map((c) => ({
      url: `${SITE_URL}/creators/${c.id}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
  } catch {
    // DBに繋がらないときは静かに諦める（sitemapが500を返すより良い）
  }

  // ゲームページ。Twitch APIから上位を取る。
  // 顔ぶれが入れ替わるので、上位だけ載せて残りは自然に見つけてもらう
  let gamePages: MetadataRoute.Sitemap = [];
  try {
    const games = await getTopGames(50);
    gamePages = games.filter(isRealGame).map((g) => ({
      url: `${SITE_URL}/games/${g.id}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
  } catch {
    // Twitch APIが落ちていてもsitemap自体は返す
  }

  // 名寄せしていない配信者のページ（Twitch / YouTube）。
  // DB が読めなくても sitemap 自体は返す
  let streamerPages: MetadataRoute.Sitemap = [];
  try {
    const [twitch, youtube] = await Promise.all([
      getTopUnlinkedAccounts("twitch", TWITCH_STREAMERS),
      getTopUnlinkedAccounts("youtube", YOUTUBE_CHANNELS),
    ]);
    streamerPages = [
      ...twitch
        .filter((a) => a.login)
        .map((a) => `${SITE_URL}/streamers/${a.login}`),
      ...youtube.map((a) => `${SITE_URL}/youtube/${a.platformId}`),
    ].map((url) => ({
      url,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
  } catch {
    // DBに繋がらないときは静かに諦める
  }

  return [...staticPages, ...creatorPages, ...gamePages, ...streamerPages];
}
