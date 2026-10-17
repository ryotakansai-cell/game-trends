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

    // ゲームを「遊んでいる人数」のマスタ（Steam・Roblox など）。配信の accounts と同じ考え方で、
    // 名前や画像は毎時保存せずここに1行だけ持つ（1日1回更新）
    `CREATE TABLE IF NOT EXISTS play_titles (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      platform       TEXT NOT NULL,   -- 'steam' / 'roblox'
      external_id    TEXT NOT NULL,   -- Steam の appid / Roblox の universeId
      name           TEXT NOT NULL,
      image_url      TEXT,
      twitch_game_id TEXT,            -- 対応する Twitch のゲーム（Roblox は全部 Roblox のカテゴリ）
      updated_at     TEXT NOT NULL,
      UNIQUE (platform, external_id)
    )`,
    // 毎時の人数の記録。配信の live_snapshots と同じく90日で消す
    `CREATE TABLE IF NOT EXISTS play_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id    INTEGER NOT NULL REFERENCES play_titles(id),
      players     INTEGER,            -- 人数を公開していないゲームは NULL（Steam の Deadlock など）
      rank        INTEGER NOT NULL,   -- その回の順位
      peak_today  INTEGER,            -- Steam のみ：今日のピーク
      prev_rank   INTEGER,            -- Steam のみ：先週の順位
      captured_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_play_snapshots_title_time ON play_snapshots (title_id, captured_at)`,
    // ゲームの人数の日ごとの集計。毎時の記録は90日で消すので、それより前の推移はここから読む。
    // 配信の daily_stats と同じく、毎朝の集計（cron/daily）が作る
    `CREATE TABLE IF NOT EXISTS play_daily (
      title_id     INTEGER NOT NULL REFERENCES play_titles(id),
      day          TEXT NOT NULL,     -- 日本時間の日付
      peak_players INTEGER,           -- その日の毎時の記録の最大（人数非公開のゲームは NULL）
      avg_players  INTEGER,           -- その日の毎時の記録の平均
      best_rank    INTEGER NOT NULL,  -- その日の一番良かった順位
      PRIMARY KEY (title_id, day)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_play_daily_day ON play_daily (day)`,
    `CREATE INDEX IF NOT EXISTS idx_play_snapshots_time ON play_snapshots (captured_at)`,

    // Bluesky に投稿した日（同じ日を二重に投稿しないため。uri は投稿のID。削除するときに使う）
    `CREATE TABLE IF NOT EXISTS bsky_posts (
      day       TEXT PRIMARY KEY,  -- 日本時間の日付（その日の日付ページを投稿した）
      uri       TEXT NOT NULL,
      posted_at TEXT NOT NULL
    )`,

    // 一度確かめた YouTube の動画。配信ではない・配信が終わった動画（done）は
    // 二度と videos.list で確かめない。配信予定・配信中（pending）は毎時確かめる
    `CREATE TABLE IF NOT EXISTS youtube_video_checks (
      video_id   TEXT PRIMARY KEY,
      status     TEXT NOT NULL,  -- 'done' / 'pending'
      checked_at TEXT NOT NULL
    )`,

    // 2026-10-15 追加：Turso の読み取り枠（月5億行）の75%を半月で使ったので、重い読み取りに索引を足した。
    // 配信者ページの「同じゲームを配信している人」。day の索引だけだと7日分（約6万行）を全部読んでいた
    `CREATE INDEX IF NOT EXISTS idx_daily_stats_game_day ON daily_stats (top_game_id, day)`,
    // 毎時の YouTube の収集の「配信予定・配信中だった動画」。索引が無く、表（約2万行）を毎時全部読んでいた
    `CREATE INDEX IF NOT EXISTS idx_video_checks_status ON youtube_video_checks (status, checked_at)`,

    // 2026-10-16 追加：終わった日の日付ページのまとめ（lib/daily.ts の DailySummary を JSON で）。
    // まとめは1回約34万行を読む。作り置き（unstable_cache）はデプロイのたびに全部消えるので、
    // ボットが日付ページを巡回するとデプロイごとに全部の日を作り直していた。内容が変わらない日は
    // ここに1回だけ保存し、ページは1行読むだけにする。毎朝の集計（cron/daily）が書く。
    // version はまとめの形を変えたときに上げる（古い形の行は読まずに作り直す）
    // 2026-10-16 追加：今日（日本時間）これまでの、アカウントごとの最高同接と、その瞬間のタイトルなど。
    // 「今日これまで」のページ用。ページのたびに今日の毎時の記録（多いと10万行）を読み直さないよう、
    // 毎時の収集が記録した配信を、その場でここに反映させる（前より同接が多いときだけ書き換える）。
    // ページは上位の数十行を読むだけで済む。2日より前の行は毎朝の集計（cron/daily）で消す
    `CREATE TABLE IF NOT EXISTS today_peaks (
      day             TEXT NOT NULL,     -- 日本時間の日付
      account_id      INTEGER NOT NULL REFERENCES accounts(id),
      peak_viewers    INTEGER NOT NULL,
      peak_title      TEXT,
      peak_content_id TEXT,              -- YouTube の動画ID など（サムネイル・リンク用）
      peak_game_id    TEXT,
      peak_at         TEXT NOT NULL,     -- 最高同接を記録した収集の時刻
      PRIMARY KEY (day, account_id)
    )`,
    // その日の上位を、同接の多い順に索引からたどって読むため
    `CREATE INDEX IF NOT EXISTS idx_today_peaks_rank ON today_peaks (day, peak_viewers)`,

    `CREATE TABLE IF NOT EXISTS daily_summaries (
      day        TEXT PRIMARY KEY,  -- 日本時間の日付
      version    INTEGER NOT NULL,
      data       TEXT NOT NULL,     -- DailySummary の JSON
      created_at TEXT NOT NULL
    )`,
  ],
  "write",
);
console.log("表を作りました（既にあるものはそのまま）");

// 2026-10-11 追加：その日一番長く配信したもの1本のタイトルと、YouTube なら動画ID。
// 毎時の記録は90日で消えるので、それ以降も「その日何の配信をしていたか」を残すため。
// 全部の配信を残すと1年で数百MBになるので1本に絞っている。
// ALTER TABLE ADD COLUMN は2回実行するとエラーになるので、列が無いときだけ足す
const columns = (await db.execute("PRAGMA table_info(daily_stats)")).rows.map(
  (r) => r.name,
);
for (const [name, type] of [
  ["main_title", "TEXT"],
  ["main_content_id", "TEXT"],
]) {
  if (!columns.includes(name)) {
    await db.execute(`ALTER TABLE daily_stats ADD COLUMN ${name} ${type}`);
    console.log(`daily_stats に ${name} を足しました`);
  }
}

// 2026-10-11 追加：ゲームの開発元（App Store のランキングで出す）。
// App Store は Apple が Cloudflare からの読み取りを拒否するので、GitHub Actions が取って
// play_titles / play_snapshots に保存し、ページは DB から読む。そのとき開発元も残す
const titleColumns = (
  await db.execute("PRAGMA table_info(play_titles)")
).rows.map((r) => r.name);
if (!titleColumns.includes("developer")) {
  await db.execute("ALTER TABLE play_titles ADD COLUMN developer TEXT");
  console.log("play_titles に developer を足しました");
}

// 2026-10-11 追加：アカウントのアイコンの URL（今はツイキャスだけが使う）。
// アイコンは表示のたびに API から取る方針だが、ツイキャスの API は1分60回までと小さく、
// 一覧のページを開くたびに人数分呼ぶと毎時の収集の分まで足りなくなる。
// 毎時の収集の返事にアイコンの URL が付いてくるので、そのついでに残す
const accountColumns = (
  await db.execute("PRAGMA table_info(accounts)")
).rows.map((r) => r.name);
if (!accountColumns.includes("icon_url")) {
  await db.execute("ALTER TABLE accounts ADD COLUMN icon_url TEXT");
  console.log("accounts に icon_url を足しました");
}

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
