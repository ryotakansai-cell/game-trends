// 確定した紐付けを取り消す。
//
// links:confirm は打ち間違いに弱い。関係を省くと self（本人）扱いになるため、
// 却下のつもりで "158" と書くと「本人」として紐付いてしまう（実際にやらかした）。
// 半手動のパイプラインでは「取り消せること」が安心して進める前提になる。
//
// 使い方: npm run links:undo -- 158 156 132
import { createClient } from "@libsql/client";
import { printSummary } from "./link-core.mjs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);

if (ids.length === 0) {
  console.error(
    "取り消す候補idを指定してください。例: npm run links:undo -- 158 156",
  );
  process.exit(1);
}

const placeholders = ids.map(() => "?").join(",");

// ① 対象の候補と、それによって紐付いたアカウントを調べる。
//    配信履歴（live_snapshots）を持っているかどうかで扱いを変えるので一緒に数える
const rows = await db.execute({
  sql: `
    SELECT c.id, c.title, a.id AS acc_id, a.display_name,
      (SELECT COUNT(*) FROM live_snapshots l WHERE l.account_id = a.id) AS snaps
    FROM link_candidates c
    JOIN accounts a ON a.platform = c.platform AND a.platform_id = c.platform_id
    WHERE c.id IN (${placeholders})
  `,
  args: ids,
});

if (rows.rows.length === 0) {
  console.log(
    "取り消す対象が見つかりません（すでに取り消し済みかもしれません）。",
  );
  process.exit(0);
}

// 紐付けのためだけに作られた行（履歴なし）は消す。
// cronが集めた履歴を持つ行は消さず、紐付けだけ外す（履歴を失わないため）
const toDelete = rows.rows
  .filter((r) => Number(r.snaps) === 0)
  .map((r) => Number(r.acc_id));
const toUnlink = rows.rows
  .filter((r) => Number(r.snaps) > 0)
  .map((r) => Number(r.acc_id));

for (const r of rows.rows) {
  const how = Number(r.snaps) > 0 ? "紐付け解除（履歴あり）" : "アカウント削除";
  console.log(`取消 [${r.id}] ${r.display_name ?? r.title} … ${how}`);
}

// ② 履歴を持たないアカウント行を削除する
if (toDelete.length > 0) {
  await db.execute({
    sql: `DELETE FROM accounts WHERE id IN (${toDelete.map(() => "?").join(",")})`,
    args: toDelete,
  });
}

// ③ 履歴を持つアカウントは、紐付けと関係だけ既定に戻す
if (toUnlink.length > 0) {
  await db.execute({
    sql: `UPDATE accounts SET creator_id = NULL, relation = 'self'
          WHERE id IN (${toUnlink.map(() => "?").join(",")})`,
    args: toUnlink,
  });
}

// ④ 候補を未確定（pending）に戻す。
//    却下ではなく pending にするのは、もう一度判断し直せるようにするため
await db.execute({
  sql: `UPDATE link_candidates SET status = 'pending' WHERE id IN (${placeholders})`,
  args: ids,
});

// ⑤ アカウントが1件以下になったcreatorは「人物をまとめる」意味を失うので解消する。
//    残った1件の紐付けも外してから削除する
const orphan = await db.execute(`
  SELECT c.id, c.display_name, COUNT(a.id) AS n
  FROM creators c
  LEFT JOIN accounts a ON a.creator_id = c.id
  GROUP BY c.id
  HAVING n < 2
`);
for (const o of orphan.rows) {
  await db.execute({
    sql: `UPDATE accounts SET creator_id = NULL WHERE creator_id = ?`,
    args: [o.id],
  });
  await db.execute({ sql: `DELETE FROM creators WHERE id = ?`, args: [o.id] });
  console.log(`creator削除: [${o.id}] ${o.display_name}（アカウント${o.n}件）`);
}

console.log(
  `\nアカウント削除 ${toDelete.length}件 / 紐付け解除 ${toUnlink.length}件 / 候補を pending に戻した ${ids.length}件`,
);
await printSummary(db);
