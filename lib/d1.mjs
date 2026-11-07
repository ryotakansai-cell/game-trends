// Cloudflare D1 を、今までの @libsql/client（Turso）と同じ形で使えるようにする部品。
// execute / batch と、結果の rows / rowsAffected / lastInsertRowid だけを同じにしてある。
// 呼ぶ側（ページ・cron・スクリプトの約90か所）を書き換えずに DB を移すため。
//
// つなぎ方は2つ：
// - Worker の中（本番のページ・cron の API）… バインディング（wrangler.jsonc の d1_databases の DB）
// - Worker の外（ビルド時の作り置き・next dev・手元のスクリプト）… D1 の HTTP API（Cloudflare の REST API）
// どちらも同じ D1 を読み書きする。
//
// TypeScript（lib/db.ts）と素の Node のスクリプト（scripts/*.mjs）の両方から使うので .mjs で書いている。

// アカウントと DB の ID は秘密ではない（鍵が無いと何もできない）ので、コードに書く。
// wrangler.jsonc の database_id と同じもの
const ACCOUNT_ID = "346df72433c570cb405fe76494959062";
const DATABASE_ID = "48f47f5d-a34b-4fbe-ab5c-62104bf09e71";

// D1 は1つの SQL に渡せる変数（?）が100個まで（2026-11 の公式の上限）。
// 超えると D1 側の分かりにくいエラーになるので、送る前にこちらで止める
export const MAX_PARAMS = 100;

/** "SELECT ..." と { sql, args } のどちらで渡されても { sql, args } にそろえる */
function normalize(stmt) {
  const { sql, args = [] } = typeof stmt === "string" ? { sql: stmt } : stmt;
  if (!Array.isArray(args)) {
    // 名前付きの変数（{ id: 1 }）は D1 が対応していないので使わない
    throw new Error("D1 では args は配列で渡す（名前付きの変数は使えない）");
  }
  if (args.length > MAX_PARAMS) {
    throw new Error(
      `D1 の1つの SQL に渡せる変数は${MAX_PARAMS}個まで（${args.length}個渡された）。lib/db.ts の inChunks で分ける: ${sql.slice(0, 80)}`,
    );
  }
  return {
    sql,
    args: args.map((v) => {
      // undefined はたいてい呼ぶ側の書き間違いなので、黙って NULL にせず止める
      if (v === undefined) throw new Error(`args に undefined がある: ${sql.slice(0, 80)}`);
      // D1 は true/false を受けないことがあるので、SQLite の流儀（1/0）にそろえる
      if (typeof v === "boolean") return v ? 1 : 0;
      // libSQL は大きな整数を BigInt で返すことがあり、それをそのまま渡す所がある
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
  };
}

/** D1 の結果を、@libsql/client の ResultSet と同じ名前に直す */
function toResult(r) {
  return {
    rows: r.results ?? [],
    rowsAffected: r.meta?.changes ?? 0,
    lastInsertRowid: r.meta?.last_row_id,
    // 何行読んだか・書いたか（rows_read / rows_written）。読み取りを測るときに使う
    meta: r.meta,
  };
}

/** Worker のバインディング（env.DB）を包む */
export function wrapD1Binding(d1) {
  const prepare = (stmt) => {
    const { sql, args } = normalize(stmt);
    const p = d1.prepare(sql);
    return args.length > 0 ? p.bind(...args) : p;
  };
  return {
    async execute(stmt) {
      return toResult(await prepare(stmt).all());
    },
    // D1 の batch は1つのトランザクション（途中で失敗すると全体が取り消し）。
    // Turso の batch(..., "write") と同じ扱いなので、2つ目の引数は受け取って無視する
    async batch(stmts) {
      if (stmts.length === 0) return [];
      const results = await d1.batch(stmts.map(prepare));
      return results.map(toResult);
    },
  };
}

/** D1 の HTTP API で SQL を流す（Worker の外用）。鍵は D1 の編集だけができる API トークン */
export function createD1HttpClient(token = process.env.D1_API_TOKEN) {
  if (!token) {
    throw new Error(
      "D1_API_TOKEN が未設定です（Cloudflare の API トークン。D1 の編集だけを許可したもの）",
    );
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

  async function post(body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const msg = json?.errors?.map((e) => e.message).join(" / ") ?? res.statusText;
      throw new Error(`D1 HTTP API が失敗しました（${res.status}）: ${msg}`);
    }
    return json.result;
  }

  return {
    async execute(stmt) {
      const { sql, args } = normalize(stmt);
      const [r] = await post({ sql, params: args });
      return toResult(r);
    },
    // HTTP API の batch も1つのトランザクションとして流れる
    async batch(stmts) {
      if (stmts.length === 0) return [];
      const batch = stmts.map((s) => {
        const { sql, args } = normalize(s);
        return { sql, params: args };
      });
      const results = await post({ batch });
      return results.map(toResult);
    },
  };
}
