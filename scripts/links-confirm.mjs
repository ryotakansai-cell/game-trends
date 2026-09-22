// 候補（link_candidates）を確定して、creators と accounts を紐付ける。
//
// 使い方:
//   npm run links:confirm -- 4 7 10           本人(self)として紐付け
//   npm run links:confirm -- 5:clip 6:archive 切り抜き・アーカイブとして紐付け
//   npm run links:confirm -- 9:reject         別人なので却下（以後表示されない）
import { createClient } from "@libsql/client";
import { linkAccount, printSummary } from "./link-core.mjs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 引数は「候補id」または「候補id:関係」の形で受け取る
const tokens = process.argv.slice(2);
if (tokens.length === 0) {
  console.error(
    "候補idを指定してください。例: npm run links:confirm -- 4 5:clip",
  );
  process.exit(1);
}

// accounts.relation に入れてよい値。reject だけは紐付けずに却下する特別扱い
const RELATIONS = new Set(["self", "clip", "archive", "reject"]);

for (const token of tokens) {
  // "5:clip" → ["5", "clip"] に分解。関係を省いたら self（本人）扱い
  const [idPart, relation = "self"] = token.split(":");
  const candidateId = Number(idPart);

  if (!Number.isInteger(candidateId) || !RELATIONS.has(relation)) {
    console.log(`× "${token}" は解釈できません（例: 5 / 5:clip / 5:reject）`);
    continue;
  }

  // ① 候補と、その元になったアカウントの情報をまとめて取る
  const found = await db.execute({
    sql: `
      SELECT c.account_id, c.platform, c.platform_id, c.title,
             a.display_name AS from_name, a.creator_id
      FROM link_candidates c
      JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ?
    `,
    args: [candidateId],
  });
  const row = found.rows[0];
  if (!row) {
    console.log(`× 候補id=${candidateId} は見つかりません`);
    continue;
  }

  // ② 却下の場合はここで終わり。status だけ書き換える
  if (relation === "reject") {
    await db.execute({
      sql: `UPDATE link_candidates SET status = 'rejected' WHERE id = ?`,
      args: [candidateId],
    });
    console.log(`却下: ${row.title}（${row.from_name} の候補）`);
    continue;
  }

  // ③④ creatorの作成と accounts への登録は共通部品に任せる
  const { creatorId, created } = await linkAccount(db, {
    sourceAccountId: Number(row.account_id),
    sourceName: row.from_name,
    platform: row.platform,
    platformId: row.platform_id,
    title: row.title,
    relation,
  });
  if (created) {
    console.log(`creator作成: ${row.from_name} (creator_id=${creatorId})`);
  }

  // ⑤ 候補を確定済みにする
  await db.execute({
    sql: `UPDATE link_candidates SET status = 'confirmed' WHERE id = ?`,
    args: [candidateId],
  });

  console.log(`紐付け[${relation}]: ${row.from_name} ← ${row.title}`);
}

// 最後に今の状態をまとめて出す
await printSummary(db);
