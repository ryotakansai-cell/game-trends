import { createClient } from "@libsql/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createD1HttpClient, wrapD1Binding, MAX_PARAMS } from "./d1.mjs";

// ============================================
// テーブルに対応する型
// ============================================
export type GameRow = {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id: string | null;
  updated_at: string;
};

export type SnapshotRow = {
  id: number;
  game_id: string;
  viewers: number;
  captured_at: string;
};

// ============================================
// DB の窓口の型（Turso の @libsql/client と D1 で共通にしている部分だけ）
// ============================================
export type Value = null | string | number | bigint | ArrayBuffer;
export type Row = Record<string, Value>;
export type Arg = string | number | bigint | boolean | null;
export type Statement = string | { sql: string; args?: Arg[] };
export type QueryResult = {
  rows: Row[];
  rowsAffected: number;
  lastInsertRowid?: number | bigint;
};
export type Db = {
  execute(stmt: Statement): Promise<QueryResult>;
  /** 1つのトランザクションとして流す（途中で失敗すると全体が取り消し） */
  batch(stmts: Statement[], mode?: "write" | "read"): Promise<QueryResult[]>;
};

/** D1 のバインディングのうち、ここで使う分だけの型。
 *  wrangler types で作る型ファイルは、ビルド前には無い .open-next を参照していて
 *  Workers Builds の型チェックで落ちるおそれがあるので、使う分だけ自分で書いた */
type D1Like = {
  prepare(sql: string): unknown;
  batch(stmts: unknown[]): Promise<unknown[]>;
};

/** 大量の書き込みを500件ずつに分けて batch する。
 *  日本語の配信を全部記録するようになり、毎時の書き込みが2,000件を超えた。
 *  1回の batch に詰め込みすぎて送信サイズや時間（D1 は batch 全体で30秒）の上限に当たるのを避ける */
export async function batchInChunks(
  db: Db,
  statements: Statement[],
  size = 500,
) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size), "write");
  }
}

/** IN (?, ?, …) に渡す値を、D1 の変数の上限（1つの SQL に100個）に収まる大きさに分けて順に流し、
 *  結果の行をつなげて返す。reserved は IN 以外に使う変数の数（platform や日時など） */
export async function inChunks<T>(
  values: T[],
  reserved: number,
  run: (chunk: T[]) => Promise<QueryResult>,
): Promise<Row[]> {
  const size = MAX_PARAMS - reserved;
  const rows: Row[] = [];
  for (let i = 0; i < values.length; i += size) {
    rows.push(...(await run(values.slice(i, i + size))).rows);
  }
  return rows;
}

/** Worker の中で動いていれば D1 のバインディングを返す。
 *  ビルド時（作り置きのページを作るとき）や next dev では取れないので undefined */
function d1Binding(): D1Like | undefined {
  try {
    return (getCloudflareContext().env as { DB?: D1Like }).DB;
  } catch {
    return undefined;
  }
}

/** DB の窓口。読み書き共通。
 *  DB_BACKEND=d1 なら D1、それ以外は Turso（移行中だけの切り替え。Secret を変えるだけで行き来できるようにした） */
export function getDbClient(): Db {
  return withLog(pickDb());
}

function pickDb(): Db {
  if (process.env.DB_BACKEND === "d1") {
    const binding = d1Binding();
    return (binding ? wrapD1Binding(binding) : createD1HttpClient()) as Db;
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("Tursoの接続情報が未設定です");
  }
  return createClient({ url, authToken }) as unknown as Db;
}

/** 移行の確認用（一時的）：DB_LOG_FILE を指定して next dev を動かすと、流した SQL と引数を1行1件の JSON で書き出す。
 *  Turso と D1 で読み取り行数を比べるのに、本物のページが流す SQL をそのまま使うため。
 *  本番では指定しないので何もしない。Turso を外すときに一緒に消す */
function withLog(db: Db): Db {
  const file = process.env.DB_LOG_FILE;
  if (!file) return db;
  const log = async (stmts: Statement[]) => {
    const { appendFile } = await import("node:fs/promises");
    const lines = stmts.map((s) =>
      JSON.stringify(typeof s === "string" ? { sql: s, args: [] } : s, (_, v) =>
        typeof v === "bigint" ? Number(v) : v,
      ),
    );
    await appendFile(file, lines.join("\n") + "\n");
  };
  return {
    async execute(stmt) {
      await log([stmt]);
      return db.execute(stmt);
    },
    async batch(stmts, mode) {
      await log(stmts);
      return db.batch(stmts, mode);
    },
  };
}
