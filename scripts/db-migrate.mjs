// DBに表を作る（何度実行しても安全。既にある表はそのまま）
// 使い方: npm run db:migrate
//
// 既存の表（accounts / live_snapshots など）は手で作ったので、ここには
// 2026-10 以降に足した表だけを書いている。
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.batch(
  [
    // 日ごとの集計。毎時の記録（live_snapshots）は90日で消すので、
    // それより前の統計やグラフはここから読む。アカウント×日で1行
    `CREATE TABLE IF NOT EXISTS daily_stats (
      account_id   INTEGER NOT NULL REFERENCES accounts(id),
      day          TEXT NOT NULL,     -- 日本時間の日付（2026-10-10）
      peak_viewers INTEGER NOT NULL,  -- その日の毎時の記録の最大
      avg_viewers  INTEGER NOT NULL,  -- その日の毎時の記録の平均
      hours_live   INTEGER NOT NULL,  -- 配信を確認できた時間数（毎時の記録の数）
      top_game_id  TEXT,              -- 一番長く遊んだゲーム（Twitch のみ）
      PRIMARY KEY (account_id, day)
    )`,
    // 「ある日の全配信者」を読む用（日ごとのランキングなど）
    `CREATE INDEX IF NOT EXISTS idx_daily_stats_day ON daily_stats (day)`,

    // YouTube の自動監視リスト。日本向けの検索で見つかったチャンネルを記録し、
    // 2日以上見つかった人は、以後は検索に頼らず RSS で毎時確かめる
    `CREATE TABLE IF NOT EXISTS youtube_watch (
      account_id    INTEGER PRIMARY KEY REFERENCES accounts(id),
      seen_days     INTEGER NOT NULL,  -- 日本向けの検索で見つかった日数
      last_seen_day TEXT NOT NULL,     -- 最後に検索で見つかった日（日本時間）
      last_live_at  TEXT NOT NULL      -- 最後に配信中を確認した時刻（30日なければ監視をやめる）
    )`,

    // 一度確かめた YouTube の動画。配信ではない・配信が終わった動画（done）は
    // 二度と videos.list で確かめない。配信予定・配信中（pending）は毎時確かめる
    `CREATE TABLE IF NOT EXISTS youtube_video_checks (
      video_id   TEXT PRIMARY KEY,
      status     TEXT NOT NULL,  -- 'done' / 'pending'
      checked_at TEXT NOT NULL
    )`,
  ],
  "write",
);
console.log("表を作りました（既にあるものはそのまま）");

// 監視リストの初期値を、これまでの記録から作る（既に行があれば何もしない）
const { rows } = await db.execute("SELECT COUNT(*) AS n FROM youtube_watch");
if (Number(rows[0].n) === 0) {
  // 日本向けの検索（region='jp'）で見つかった日数を、日本時間の日付で数える
  const r = await db.execute(`
    INSERT INTO youtube_watch (account_id, seen_days, last_seen_day, last_live_at)
    SELECT s.account_id,
           COUNT(DISTINCT date(s.captured_at, '+9 hours')),
           MAX(date(s.captured_at, '+9 hours')),
           MAX(s.captured_at)
    FROM live_snapshots s
    JOIN accounts a ON a.id = s.account_id
    WHERE a.platform = 'youtube' AND s.region = 'jp'
    GROUP BY s.account_id
  `);
  console.log(`監視リストの初期値: ${r.rowsAffected} チャンネル`);
}
