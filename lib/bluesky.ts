// 毎朝、前日の配信ランキング（日付ページ）を Bluesky のボット用アカウントに投稿する。
// 毎日の集計（/api/cron/daily）の後に呼ばれる。毎時の収集が集計に追いついたとき
// （毎日の集計が動かなかった日）にも呼ばれるので、同じ日を二重に投稿しないよう bsky_posts に記録する。
//
// ヨルシカのサイト（yorushika-fan の lib/news/bluesky.ts）と同じ作り。
// API は公式の XRPC を fetch で直接呼ぶ（呼ぶのは4種類だけなので、ライブラリは入れない）。
// BLUESKY_HANDLE / BLUESKY_APP_PASSWORD が無いあいだは投稿しない（集計はそのまま動く）。
// 手元から誤って投稿しないよう、この2つは .env.local に入れず Worker の Secret にだけ置く。

import { getDbClient } from "@/lib/db";
import { dayTitle, getDailyHeadline } from "@/lib/daily";
import { formatViewers } from "@/lib/twitch";
import { SITE_URL } from "@/lib/site";
import { jstDay } from "@/lib/snapshot-range";

const HASHTAG = "配信トレンド";
// ログインはどのアカウントでもこの入口で受け付けてくれる。
// 投稿はアカウントが実際に置かれているサーバー（PDS）に送る（ログイン結果から分かる）
const ENTRYWAY = "https://bsky.social";

export type BlueskyReport = {
  enabled: boolean; // 認証情報が登録されていて、実際に投稿する設定か
  day?: string;
  text?: string;
  posted?: string; // 投稿のID（at://…）
  skipped?: string; // 投稿しなかった理由
  login?: string; // 確認用（preview）のときだけ：ログインできたか
  credentialCheck?: Record<string, boolean>;
};

function* segment(s: string) {
  for (const { segment } of new Intl.Segmenter("ja", {
    granularity: "grapheme",
  }).segment(s)) {
    yield segment;
  }
}
const graphemes = (s: string) => [...segment(s)].length;
/** 長い名前を n 文字（書記素）までに切る */
const clip = (s: string, n: number) =>
  graphemes(s) > n ? [...segment(s)].slice(0, n - 1).join("") + "…" : s;

/** 投稿の本文。Bluesky は300文字（書記素）まで。名前は1人20文字までに切るので必ず収まる */
function buildText(
  day: string,
  top: { displayName: string; peakViewers: number }[],
) {
  const lines = top.map(
    (e, i) =>
      `${i + 1}位 ${clip(e.displayName, 20)} ${formatViewers(e.peakViewers)}人`,
  );
  const tag = `#${HASHTAG}`;
  const text = [
    `${dayTitle(day)}の配信ランキング（最高同接）`,
    ...lines,
    tag,
  ].join("\n");
  return { text, tag };
}

/** ハッシュタグを「押せるタグ」にするための印（facet）。
 *  位置は文字数ではなく UTF-8 のバイト数で指定する決まり（日本語は1文字3バイト） */
function tagFacet(text: string, tag: string) {
  const enc = new TextEncoder();
  const start = enc.encode(text.slice(0, text.lastIndexOf(tag))).length;
  return {
    index: { byteStart: start, byteEnd: start + enc.encode(tag).length },
    features: [{ $type: "app.bsky.richtext.facet#tag", tag: HASHTAG }],
  };
}

type Session = { accessJwt: string; did: string; pds: string };

async function login(identifier: string, password: string): Promise<Session> {
  const res = await fetch(`${ENTRYWAY}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok)
    throw new Error(`ログインに失敗: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const pds =
    json.didDoc?.service?.find((s: { id: string }) => s.id === "#atproto_pds")
      ?.serviceEndpoint ?? ENTRYWAY;
  return { accessJwt: json.accessJwt, did: json.did, pds };
}

/** リンクカードの画像（日付ページの OGP 画像）を Bluesky に上げる。
 *  自分のサイトの画像なので、上げ直しても問題ない。失敗したら画像なしのカードにする */
async function uploadThumb(session: Session, day: string) {
  try {
    const img = await fetch(`${SITE_URL}/daily/${day}/opengraph-image`);
    if (!img.ok) return undefined;
    const res = await fetch(`${session.pds}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: await img.arrayBuffer(),
    });
    if (!res.ok) return undefined;
    return (await res.json()).blob;
  } catch {
    return undefined;
  }
}

async function createPost(
  session: Session,
  day: string,
  text: string,
  tag: string,
) {
  const thumb = await uploadThumb(session, day);
  const record = {
    $type: "app.bsky.feed.post",
    text,
    langs: ["ja"],
    createdAt: new Date().toISOString(),
    facets: [tagFacet(text, tag)],
    // 日付ページへのリンクカード。続き（20位まで・伸びた人・ゲーム）はサイトで見てもらう
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: `${SITE_URL}/daily/${day}`,
        title: `${dayTitle(day)}の配信ランキング`,
        description:
          "最高同接ランキング・前日から伸びた配信者・自己ベスト更新・見られたゲーム",
        ...(thumb ? { thumb } : {}),
      },
    },
  };
  const res = await fetch(`${session.pds}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return String((await res.json()).uri);
}

/** まとめがある一番新しい日（ふつうは昨日）を、まだ投稿していなければ投稿する。
 *  preview=true のときは投稿も記録もせず、「投稿するならこれ」とログインの確認だけ返す */
export async function postDailyRanking(
  preview: boolean,
): Promise<BlueskyReport> {
  // コピーのときに付きやすい「先頭の @」と「前後の空白・改行」は取り除く
  // 「.」を含まない（stream-trend だけ）なら .bsky.social を補う。ログインには末尾まで必要で、
  // 最初の登録で末尾を省いてログインに失敗したため（2026-10-11）。独自ドメインのハンドルは「.」を含むのでそのまま
  const rawHandle = process.env.BLUESKY_HANDLE?.trim().replace(/^@/, "");
  const handle =
    rawHandle && !rawHandle.includes(".")
      ? `${rawHandle}.bsky.social`
      : rawHandle;
  const password = process.env.BLUESKY_APP_PASSWORD?.trim();
  const enabled = Boolean(handle && password) && !preview;
  const report: BlueskyReport = { enabled };

  const db = getDbClient();
  const last = await db.execute("SELECT MAX(day) AS day FROM daily_stats");
  const day = last.rows[0]?.day ? String(last.rows[0].day) : null;
  if (!day) return { ...report, skipped: "まとめがまだ無い" };
  report.day = day;

  // 2日以上前の分は流さない（集計が何日も止まって追いついたとき、古い日をまとめて投稿しないため）
  const twoDaysAgo = jstDay(new Date(Date.now() - 2 * 24 * 3600 * 1000));
  if (day < twoDaysAgo) return { ...report, skipped: "最新のまとめが古い" };

  const done = await db.execute({
    sql: "SELECT uri FROM bsky_posts WHERE day = ?",
    args: [day],
  });
  if (done.rows.length > 0) return { ...report, skipped: "投稿済み" };

  const { top } = await getDailyHeadline(day);
  if (top.length === 0) return { ...report, skipped: "その日の記録が無い" };
  const { text, tag } = buildText(day, top);
  report.text = text;

  if (!enabled) {
    // 認証情報があればログインだけ試す。パスワードの写し間違いを、
    // 最初の本番投稿で初めて知るのではなく、ここで見つけるため（投稿はしない）
    if (handle && password) {
      try {
        await login(handle, password);
        report.login = "ok";
      } catch (e) {
        report.login = String(e).slice(0, 200);
        // 失敗したときは、値そのものは出さずに「形」だけ確かめて返す
        const raw = process.env.BLUESKY_APP_PASSWORD ?? "";
        report.credentialCheck = {
          handleHadAt:
            process.env.BLUESKY_HANDLE?.trim().startsWith("@") ?? false,
          handleEndsWithBskySocial: handle.endsWith(".bsky.social"),
          passwordHadSpaces: raw !== raw.trim(),
          // アプリパスワードは「xxxx-xxxx-xxxx-xxxx」の形（英小文字と数字）
          passwordLooksLikeAppPassword: /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(
            password,
          ),
        };
      }
    } else {
      report.login = "認証情報が未登録";
    }
    return report;
  }

  const session = await login(handle!, password!);
  const uri = await createPost(session, day, text, tag);
  await db.execute({
    sql: "INSERT INTO bsky_posts (day, uri, posted_at) VALUES (?, ?, ?)",
    args: [day, uri, new Date().toISOString()],
  });
  return { ...report, posted: uri };
}
