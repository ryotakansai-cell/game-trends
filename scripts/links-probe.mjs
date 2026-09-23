// TwitchのログインIDを、そのままYouTubeのハンドル(@xxx)として引いてみる。
// channels.list の forHandle は1ユニットしか使わない（検索は100ユニット）。
//
// 実測: 名寄せ済み28人で試したところ11人（39%）が本人チャンネルに当たった。
// 外れた分（@fps_shaka → かぺやま GAMES など）は links:review が
// 名前の類似度や説明欄を見て ？ や × に落とすので、そのまま流してよい。
//
// 使い方: npm run links:probe -- 70   （既定30人）
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

const LIMIT = Number(process.argv[2] ?? 30);
const now = new Date().toISOString();

// ① 対象を選ぶ。
//    - 日本語配信で、直近の視聴者数が多い順（上位から埋めるB方針）
//    - まだ名寄せしていない人（creator_id IS NULL）
//    - まだハンドルを試していない人（source='handle' の候補が無い）
//      → 検索済みかどうかは見ない。probeは安いので両方試す価値がある
const targets = await db.execute({
  sql: `
    WITH twitch_latest AS (
      SELECT l.account_id, l.viewers,
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id ORDER BY l.captured_at DESC
        ) AS rn
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
        SELECT 1 FROM link_candidates c
        WHERE c.account_id = a.id AND c.source = 'handle'
      )
    ORDER BY t.viewers DESC
    LIMIT ?
  `,
  args: [LIMIT],
});

if (targets.rows.length === 0) {
  console.log("試す対象がいません（全員すでにハンドルを試し済みです）。");
  process.exit(0);
}

console.log(
  `対象: ${targets.rows.length}人 / 消費見込み: ${targets.rows.length}ユニット\n`,
);

const toInsert = [];

for (const t of targets.rows) {
  // ② ログイン名をそのままハンドルとして問い合わせる。
  //    %40 は "@" のURLエンコード。forHandle は先頭の@を付けて渡す
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels` +
      `?part=snippet&forHandle=%40${encodeURIComponent(t.login)}&key=${apiKey}`,
  );
  const json = await res.json();

  if (json.error) {
    console.log(`エラー: ${json.error.message}`);
    break; // クォータ切れなどはそこで止める
  }

  const channel = json.items?.[0];
  if (!channel) {
    // そのハンドルは存在しない。珍しくないので静かに次へ
    continue;
  }

  console.log(
    `★ ${t.display_name} (${t.viewers}人) → ${channel.snippet.title}`,
  );
  toInsert.push({
    accountId: t.id,
    channelId: channel.id,
    title: channel.snippet.title,
  });
}

// ③ 候補として保存する。
//    検索で既に同じチャンネルを拾っていれば DO NOTHING で黙って飛ばされる
if (toInsert.length > 0) {
  await db.batch(
    toInsert.map((c) => ({
      sql: `
        INSERT INTO link_candidates
          (account_id, platform, platform_id, title, source, status, created_at)
        VALUES (?, 'youtube', ?, ?, 'handle', 'pending', ?)
        ON CONFLICT(account_id, platform, platform_id) DO NOTHING
      `,
      args: [c.accountId, c.channelId, c.title, now],
    })),
    "write",
  );
}

console.log(
  `\n${targets.rows.length}人中 ${toInsert.length}人でハンドルが見つかりました。`,
);
console.log("確認は npm run links:review");
