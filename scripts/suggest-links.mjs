// 名寄せ（プラットフォーム横断の紐付け）の候補を集めて link_candidates に貯める。
// 確定は人間が目視で行う（自動では紐付けない）。
//
// 使い方: npm run suggest-links        （既定20人）
//         npm run suggest-links -- 10  （10人だけ）
//
// 注意: 1人あたり search.list = 100ユニット消費する。1日の無料枠は10,000。
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const apiKey = process.env.YOUTUBE_API_KEY;

if (!apiKey) {
  console.error("YOUTUBE_API_KEY が読み込めませんでした。");
  process.exit(1);
}

const LIMIT = Number(process.argv[2] ?? 20);
const now = new Date().toISOString();

// ① 対象にするTwitch配信者を選ぶ。
//    - 日本語配信で、直近の視聴者数が多い順（YouTubeも持っている可能性が高い）
//    - まだ名寄せしていない人（creator_id IS NULL）
//    - まだ候補を調べていない人（link_candidatesに1件も無い）
//      → 一度調べた人を再度調べない。クォータの節約と、却下済みの再表示防止
const targets = await db.execute({
  sql: `
    WITH twitch_latest AS (
      SELECT l.account_id, l.viewers,
        ROW_NUMBER() OVER (PARTITION BY l.account_id ORDER BY l.captured_at DESC) AS rn
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'twitch'
    )
    SELECT a.id, a.login, a.display_name, t.viewers
    FROM twitch_latest t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.rn = 1
      AND a.language = 'ja'
      AND a.creator_id IS NULL
      AND NOT EXISTS (
        -- 「検索済み」の人だけスキップする。
        -- probe(source=handle)の結果があっても検索は妨げない。
        -- probeが外れたチャンネルを拾った人まで検索対象から
        -- 外れてしまうのを防ぐため
        SELECT 1 FROM link_candidates c
        WHERE c.account_id = a.id AND c.source = name_search
      )
    ORDER BY t.viewers DESC
    LIMIT ?
  `,
  args: [LIMIT],
});

if (targets.rows.length === 0) {
  console.log("調べる対象がいません（全員すでに候補を取得済みです）。");
  process.exit(0);
}

// ② 既に収集済みのYouTubeチャンネル（★印を付けるため）
const known = await db.execute(
  `SELECT platform_id FROM accounts WHERE platform = 'youtube'`,
);
const knownSet = new Set(known.rows.map((r) => r.platform_id));

console.log(
  `対象: ${targets.rows.length}人 / 消費見込み: ${targets.rows.length * 100}ユニット\n`,
);

const toInsert = [];

for (const t of targets.rows) {
  // ③ 配信者名でYouTubeのチャンネルを検索
  const params = new URLSearchParams({
    part: "snippet",
    type: "channel",
    q: t.display_name,
    maxResults: "3",
    key: apiKey,
  });
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params}`,
  );
  const json = await res.json();

  if (json.error) {
    console.log(`[${t.display_name}] エラー: ${json.error.message}`);
    break; // クォータ切れなどの場合はそこで止める
  }

  console.log(`■ ${t.display_name} (${t.viewers}人)`);

  for (const item of json.items ?? []) {
    const channelId = item.snippet.channelId;
    console.log(
      `   ${knownSet.has(channelId) ? "★収集済" : "  未収集"} ${item.snippet.title}`,
    );
    toInsert.push({
      accountId: t.id,
      channelId,
      title: item.snippet.title,
    });
  }
  console.log();
}

// ④ 候補をDBに保存する。
//    UNIQUE(account_id, platform, platform_id) があるので、
//    同じ候補が既にあれば DO NOTHING で黙ってスキップされる
if (toInsert.length > 0) {
  await db.batch(
    toInsert.map((c) => ({
      sql: `
        INSERT INTO link_candidates
          (account_id, platform, platform_id, title, source, status, created_at)
        VALUES (?, 'youtube', ?, ?, 'name_search', 'pending', ?)
        ON CONFLICT(account_id, platform, platform_id) DO NOTHING
      `,
      args: [c.accountId, c.channelId, c.title, now],
    })),
    "write",
  );
}

console.log(`${toInsert.length}件の候補を link_candidates に保存しました。`);
console.log(`確認は npm run links:review`);
