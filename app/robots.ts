import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// robots.txt を生成する。
// クロールしてよい範囲と、sitemapの場所を検索エンジンに伝える。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 動作確認用のJSONエンドポイントとcronは検索結果に出す意味がない
      disallow: ["/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
