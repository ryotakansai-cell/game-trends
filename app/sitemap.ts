import type { MetadataRoute } from "next";
import { getCreators } from "@/lib/creators";
import { getTopGames, isRealGame } from "@/lib/twitch";
import { getTopUnlinkedAccounts } from "@/lib/account-stats";
import { getDayRange, shiftDay } from "@/lib/daily";
import { SITE_URL } from "@/lib/site";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";

// sitemap.xml を自動生成する。
// 検索エンジンに「このサイトにはどんなURLがあるか」を一覧で渡す仕組み。
// クリエイターページは100人近くあり、トップから全部に辿れるわけではないので、
// 一覧を渡さないと見つけてもらえない。
//
// 1日1回作り直す。配信者の一覧は日ごとの集計（daily_stats）を14日分読むので
// （約8万行）、1時間ごとだと Turso の読み取り枠を月6,000万行近く使ってしまう
export const revalidate = 86400;

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
      url: `${SITE_URL}/games/twitch`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/games/kick`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/games/steam`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/games/roblox`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/games/appstore`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/games/ratio`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.7,
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

  // 名寄せしていない配信者のページ（配信元ごとのページ）。
  // DB が読めなくても sitemap 自体は返す
  let streamerPages: MetadataRoute.Sitemap = [];
  try {
    const perPlatform = await Promise.all(
      PLATFORM_IDS.map(async (platform) =>
        (
          await getTopUnlinkedAccounts(
            platform,
            PLATFORMS[platform].sitemapAccounts,
          )
        ).map((a) => ({ ...a, platform })),
      ),
    );
    streamerPages = perPlatform
      .flat()
      .map((a) => `${SITE_URL}${PLATFORMS[a.platform].accountPath(a)}`)
      .map((url) => ({
        url,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.6,
      }));
  } catch {
    // DBに繋がらないときは静かに諦める
  }

  // 日付ごとのまとめ。一覧と、直近60日分の各日。
  // 過去の日の中身は変わらないので changeFrequency は yearly にしている
  let dailyPages: MetadataRoute.Sitemap = [];
  try {
    const range = await getDayRange();
    if (range) {
      dailyPages.push({
        url: `${SITE_URL}/daily`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.7,
      });
      for (
        let d = range.last, i = 0;
        d >= range.first && i < 60;
        d = shiftDay(d, -1), i++
      ) {
        dailyPages.push({
          url: `${SITE_URL}/daily/${d}`,
          lastModified: now,
          changeFrequency: "yearly",
          priority: 0.6,
        });
      }
    }
  } catch {
    dailyPages = [];
  }

  return [
    ...staticPages,
    ...creatorPages,
    ...gamePages,
    ...streamerPages,
    ...dailyPages,
  ];
}
