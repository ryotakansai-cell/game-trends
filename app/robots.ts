import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// robots.txt を生成する。
// クロールしてよい範囲と、sitemapの場所を検索エンジンに伝える。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // 動作確認用のJSONエンドポイントとcronは検索結果に出す意味がない
        "/api/",
        // グラフの日付を選んだページ（?day=）。配信者ページ1つにつき約30本の日付リンクがあり、
        // ボットが全部たどると読まれるページが約30倍になる。どれも canonical で本体のページを指していて
        // 検索結果には出ないので、読ませても得がない（2026-11-11。Search Console の「代替ページ」が4,633件あった）。
        // ? の後ろの最初の変数でも、& の後ろでも止める
        "/*?day=",
        "/*&day=",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
