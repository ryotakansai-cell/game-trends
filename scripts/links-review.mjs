// link_candidates に貯まった候補を、判定の根拠つきで一覧表示する。
//
// channels.list を1回だけ呼んでチャンネルの説明欄と登録者数を取り、
// 「本人か / 切り抜きか / 別人か」の提案を組み立てる。
// 50件ごとに1ユニットしか使わないので、検索（1人100ユニット）に比べれば無視できる。
//
// 判定はルールベースにしてある。AIに任せると根拠が残らず、
// 間違えたときに原因を特定できないため。
//
// 使い方: npm run links:review
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const apiKey = process.env.YOUTUBE_API_KEY;

// ============================================
// 名前を比べるための道具
// ============================================

/** 比較用に名前をそろえる。記号・敬称・「チャンネル」などの飾りを落とす */
function normalize(s) {
  return (
    String(s ?? "")
      .toLowerCase()
      // 全角の英数字を半角にする（ＡＢＣ → abc）
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      )
      // 記号と空白をすべて取り除く
      .replace(/[【】\[\]（）()｜|・,、。.\-_/\!！?？:：'"’”~〜\s]/g, "")
      // 敬称やチャンネルを表す語は名前の一部ではないので落とす
      .replace(/(さん|ちゃん|channel|チャンネル|ゲーム実況|公式|official)/g, "")
  );
}

/** 2文字ずつの組（バイグラム）に分ける */
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 2つの名前の似ている度合いを 0〜1 で返す（ダイス係数）。
 *  「共通する2文字組がどれだけ多いか」で測る素朴な方法 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const pool = [...B];
  let hit = 0;
  for (const g of A) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1); // 同じ組を二重に数えない
    }
  }
  return (2 * hit) / (A.length + B.length);
}

// ============================================
// 判定に使うキーワード
// ============================================
const CLIP = /切り抜き|まとめ|ダイジェスト|名場面|きりぬき|クリップ|clips?\b/i;
const ARCHIVE = /アーカイブ|保管庫|録画|archives?\b/i;

// ============================================
// ① 未確定の候補と、紐付け元の情報を取る
// ============================================
const rows = await db.execute(`
  SELECT
    c.id,
    c.account_id,
    c.platform,
    c.platform_id,
    c.title,
    a.display_name AS from_name,
    a.login        AS from_login,
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

// ============================================
// ② チャンネルの説明欄と登録者数をまとめて取る（50件で1ユニット）
// ============================================
const channelIds = [...new Set(rows.rows.map((r) => r.platform_id))];
const info = new Map();

if (apiKey) {
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${chunk.join(",")}&key=${apiKey}`,
    );
    const json = await res.json();
    if (json.error) {
      console.log(`（チャンネル情報の取得に失敗: ${json.error.message}）\n`);
      break;
    }
    for (const it of json.items ?? []) {
      info.set(it.id, {
        title: it.snippet.title,
        description: it.snippet.description ?? "",
        subscribers: Number(it.statistics?.subscriberCount ?? 0),
      });
    }
  }
  console.log(
    `チャンネル情報 ${info.size}/${channelIds.length}件を取得（${Math.ceil(channelIds.length / 50)}ユニット消費）\n`,
  );
}

// ============================================
// ③ 候補ごとに判定する
// ============================================
/** @returns { mark, relation, reasons, subscribers } */
function judge(row) {
  const ch = info.get(row.platform_id);
  const reasons = [];

  const title = ch?.title ?? String(row.title);
  const description = ch?.description ?? "";
  const subscribers = ch?.subscribers ?? null;
  const haystack = `${title}\n${description.slice(0, 400)}`;

  // --- 信号A/B: 説明欄に書かれたTwitchのURL ---
  const logins = [...description.matchAll(/twitch\.tv\/([A-Za-z0-9_]+)/gi)].map(
    (m) => m[1].toLowerCase(),
  );
  const srcLogin = String(row.from_login ?? "").toLowerCase();
  const linkedToSource = logins.includes(srcLogin);
  const foreignLogin = logins.find((l) => l !== srcLogin);

  // --- 信号C/D: キーワード ---
  // タイトルにある語は強い根拠、説明欄にあるだけの語は弱い根拠として分ける。
  // 本人チャンネルの説明欄に「切り抜き歓迎」と書いてあることがあり、
  // 説明欄だけで判断すると本人を切り抜きと誤判定するため
  const desc400 = description.slice(0, 400);
  const titleClip = CLIP.test(title);
  const titleArchive = ARCHIVE.test(title);
  const descClip = CLIP.test(desc400);
  const descArchive = ARCHIVE.test(desc400);

  // --- 信号E: 名前の似ている度合い ---
  const nt = normalize(title);
  const keys = [normalize(row.from_name), normalize(row.from_login)].filter(
    (k) => k.length >= 2,
  );
  const contains = keys.some(
    (k) => k.length >= 3 && (nt.includes(k) || k.includes(nt)),
  );
  const sim = keys.length ? Math.max(...keys.map((k) => similarity(k, nt))) : 0;
  const nameHit = contains || sim >= 0.5;

  // --- 別のTwitchアカウントが書かれていて、元のアカウントは無い → 別人 ---
  if (foreignLogin && !linkedToSource) {
    reasons.push(`説明欄に別アカウント twitch.tv/${foreignLogin}`);
    return { mark: "×", relation: "reject", reasons, subscribers };
  }

  // --- 関係（self/clip/archive）を決める。強い根拠から順に見る ---
  let relation;
  let relationReason;
  if (titleClip) {
    relation = "clip";
    relationReason = "タイトルに「切り抜き」系の語";
  } else if (titleArchive) {
    relation = "archive";
    relationReason = "タイトルに「アーカイブ」系の語";
  } else if (contains || sim >= 0.7) {
    // 名前がほぼそのまま入っているなら、説明欄に何が書いてあっても本人とみなす
    relation = "self";
    relationReason = contains
      ? "名前をそのまま含む"
      : `名前がほぼ一致(${sim.toFixed(2)})`;
  } else if (descClip) {
    relation = "clip";
    relationReason = "説明欄に「切り抜き」系の語（弱い根拠）";
  } else if (descArchive) {
    relation = "archive";
    relationReason = "説明欄に「アーカイブ」系の語（弱い根拠）";
  } else {
    relation = "self";
    relationReason = "切り抜き系の語なし";
  }

  if (linkedToSource) {
    // 説明欄に元配信者のTwitchが書いてある＝関係は確実。
    // ただし切り抜きチャンネルも元配信者のリンクを貼るので、
    // 本人かどうかは上のキーワード判定に任せる
    reasons.push(`説明欄に twitch.tv/${srcLogin}`);
    reasons.push(relationReason);
    return { mark: "◎", relation, reasons, subscribers };
  }

  if (nameHit) {
    // Twitchリンクは無いが名前が一致する。根拠としては一段弱い
    reasons.push(contains ? "名前を含む" : `名前が近い(${sim.toFixed(2)})`);
    // 名前を根拠にした判定は直前の行と重複するので出さない
    if (!/^(切り抜き系の語なし|名前)/.test(relationReason)) {
      reasons.push(relationReason);
    }
    return { mark: "○", relation, reasons, subscribers };
  }

  reasons.push(`手がかりなし(名前の類似度 ${sim.toFixed(2)})`);
  return { mark: "？", relation: null, reasons, subscribers };
}

// ============================================
// ④ 表示する
// ============================================
const strong = []; // ◎ 根拠あり
const weak = []; // ○ 名前だけ一致
const counts = { "◎": 0, "○": 0, "×": 0, "？": 0 };

let current = null;
for (const r of rows.rows) {
  const v = judge(r);
  counts[v.mark]++;

  if (r.from_name !== current) {
    current = r.from_name;
    console.log(
      `\n■ ${r.from_name}  (twitch: ${r.from_login} / account_id=${r.account_id})`,
    );
  }

  // 確定コマンドに貼り付ける形（self は関係を省ける）
  const token =
    v.relation === null
      ? null
      : v.relation === "self"
        ? `${r.id}`
        : `${r.id}:${v.relation}`;
  if (v.mark === "◎" || v.mark === "×") strong.push(token);
  else if (v.mark === "○") weak.push(token);

  const subs =
    v.subscribers === null
      ? ""
      : ` (${v.subscribers.toLocaleString("ja-JP")}人)`;
  const label = v.relation === null ? "不明" : v.relation;
  console.log(
    `   [${r.id}] ${v.mark}${label.padEnd(7)} ${r.collected ? "★収集済 " : ""}${info.get(r.platform_id)?.title ?? r.title}${subs}`,
  );
  console.log(`        根拠: ${v.reasons.join(" ／ ")}`);
  console.log(`        https://www.youtube.com/channel/${r.platform_id}`);
}

console.log("\n────────────────────────────────────────");
console.log(
  `◎根拠あり ${counts["◎"]}件 ／ ○名前のみ一致 ${counts["○"]}件 ／ ×別人 ${counts["×"]}件 ／ ？手がかりなし ${counts["？"]}件`,
);

if (strong.length > 0) {
  console.log("\n【確度の高いものだけ確定する】");
  console.log(`npm run links:confirm -- ${strong.join(" ")}`);
}
if (weak.length > 0) {
  console.log("\n【名前が一致するものも含める（要確認）】");
  console.log(`npm run links:confirm -- ${[...strong, ...weak].join(" ")}`);
}
console.log("\n？のものは自分で判断して、候補idを指定してください。");
