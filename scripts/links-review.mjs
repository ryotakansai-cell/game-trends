// link_candidates に貯まった候補を一覧表示する（確認専用）。
// YouTube APIを一切呼ばないので、何度実行してもクォータを消費しない。
//
// 使い方: npm run links:review
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 未確定(pending)の候補を、元アカウントごとにまとめて表示する
const rows = await db.execute(`
  SELECT
    c.id,
    c.account_id,
    a.display_name AS from_name,
    a.login        AS from_login,
    c.platform_id,
    c.title,
    c.source,
    -- その候補チャンネルを既に収集しているか（収集済みなら即データが出る）
    EXISTS (
      SELECT 1 FROM accounts x
      WHERE x.platform = c.platform AND x.platform_id = c.platform_id
    ) AS collected
  FROM link_candidates c
  JOIN accounts a ON a.id = c.account_id
  WHERE c.status = 'pending'
  ORDER BY a.display_name, c.id
`);

if (rows.rows.length === 0) {
  console.log("未確定の候補はありません。");
  process.exit(0);
}

let current = null;
for (const r of rows.rows) {
  if (r.from_name !== current) {
    current = r.from_name;
    console.log(
      `\n■ ${r.from_name}  (twitch: ${r.from_login} / account_id=${r.account_id})`,
    );
  }
  console.log(
    `   [候補id=${r.id}] ${r.collected ? "★収集済" : "  未収集"} ${r.title}`,
  );
  console.log(`      https://www.youtube.com/channel/${r.platform_id}`);
}

const counts = await db.execute(`
  SELECT status, COUNT(*) AS n FROM link_candidates GROUP BY status
`);
console.log("\n----------------------------------------");
for (const c of counts.rows) console.log(`${c.status}: ${c.n}件`);
console.log("\n確定させたい候補の「候補id」を伝えてください。");
