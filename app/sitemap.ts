import type { MetadataRoute } from "next";
import { getCreators } from "@/lib/creators";
import { getTopGames, isRealGame } from "@/lib/twitch";
import { SITE_URL } from "@/lib/site";

// sitemap.xml を自動生成する。
// 検索エンジンに「このサイトにはどんなURLがあるか」を一覧で渡す仕組み。
// クリエイターページは100人近くあり、トップから全部に辿れるわけではないので、
// 一覧を渡さないと見つけてもらえない。
export const revalidate = 3600;

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

  return [...staticPages, ...creatorPages, ...gamePages];
}
