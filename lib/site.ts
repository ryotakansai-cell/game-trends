// サイト全体で使う定数。
// 絶対URLが必要な場面（sitemap、OGP画像、canonical）で使う。
// 相対パスでは「どのドメインのページか」を検索エンジンに伝えられないため。
export const SITE_URL = "https://stream-trends.sukinote.com";

// 実態は配信者・配信が主役なので、ゲームではなく配信に寄せた名前にしている。
// ここ1か所を変えればサイト全体の表示名とタイトルが変わる
export const SITE_NAME = "配信トレンド";
