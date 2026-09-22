// 「あるアカウントを、ある人物(creator)に紐付ける」処理の本体。
// links-confirm.mjs（候補から確定）と links-add.mjs（手動登録）の両方から使う。
// 同じSQLを2か所に書くと、片方だけ直したときに食い違うため1か所にまとめる。

/**
 * @param db        libSQLのクライアント
 * @param sourceAccountId 紐付け元のアカウントid（通常はTwitch側）
 * @param sourceName      creatorを新規作成するときに使う名前
 * @param platform        追加する側のプラットフォーム（"youtube" など）
 * @param platformId      追加する側のID（YouTubeならチャンネルID）
 * @param title           追加する側の表示名
 * @param relation        self / clip / archive
 * @returns { creatorId, created } created は creator を新しく作ったかどうか
 */
export async function linkAccount(
  db,
  { sourceAccountId, sourceName, platform, platformId, title, relation },
) {
  const now = new Date().toISOString();

  // ① 紐付け元のアカウントに、もう creator が付いているか確認する
  const src = await db.execute({
    sql: `SELECT creator_id, display_name FROM accounts WHERE id = ?`,
    args: [sourceAccountId],
  });
  const srcRow = src.rows[0];
  if (!srcRow)
    throw new Error(`account_id=${sourceAccountId} が見つかりません`);

  // ② まだ無ければ creators に1人作り、元アカウントに書き戻す
  let creatorId = srcRow.creator_id;
  let created = false;
  if (!creatorId) {
    const inserted = await db.execute({
      sql: `INSERT INTO creators (display_name, created_at) VALUES (?, ?)`,
      args: [sourceName ?? srcRow.display_name, now],
    });
    // libSQL は採番されたIDを BigInt で返すので数値に直す
    creatorId = Number(inserted.lastInsertRowid);
    created = true;

    await db.execute({
      sql: `UPDATE accounts SET creator_id = ? WHERE id = ?`,
      args: [creatorId, sourceAccountId],
    });
  }

  // ③ 追加する側のアカウントを登録する。
  //    cronが既に収集していれば display_name はそちらが新しいので上書きしない
  await db.execute({
    sql: `
      INSERT INTO accounts
        (platform, platform_id, login, display_name, creator_id, relation, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_id) DO UPDATE SET
        creator_id = excluded.creator_id,
        relation   = excluded.relation,
        updated_at = excluded.updated_at
    `,
    args: [platform, platformId, title, creatorId, relation, now],
  });

  return { creatorId, created };
}

/** 現在の名寄せ状況を表示する（各スクリプトの最後で共通して使う） */
export async function printSummary(db) {
  const summary = await db.execute(`
    SELECT c.id, c.display_name, COUNT(a.id) AS n
    FROM creators c
    JOIN accounts a ON a.creator_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `);
  console.log("\n---- 現在の名寄せ状況 ----");
  for (const s of summary.rows) {
    console.log(`[creator_id=${s.id}] ${s.display_name}: ${s.n}アカウント`);
  }
}
