// 配信のランキングを Bluesky のボット用アカウント（stream-trends.bsky.social）に投稿する。
//   - 朝8時：前日のまとめ（日付ページへのリンク）
//   - 9・12・18・21時：いま見られている配信（トップページへのリンク）
// 時刻は cron-worker が /api/cron/bluesky を呼ぶ時刻で決まる（2026-10-11 決定。1週間ほど見て見直す）。
// 12・18・21時は日本の配信の視聴者数を実測して決めた（昼休み・帰宅・夜のピーク）。
// 9時は、朝に配信する人も見つけてもらえるように足した。
//
// ヨルシカのサイト（yorushika-fan の lib/news/bluesky.ts）と同じ作り。
// API は公式の XRPC を fetch で直接呼ぶ（呼ぶのは4種類だけなので、ライブラリは入れない）。
// BLUESKY_HANDLE / BLUESKY_APP_PASSWORD が無いあいだは投稿しない。
// 手元から誤って投稿しないよう、この2つは .env.local に入れず Worker の Secret にだけ置く。
// 同じ回を二重に投稿しないよう、投稿した回を bsky_posts に記録する（cron が再実行されても安全）。

import { getDbClient } from "@/lib/db";
import { dayTitle, getDailyHeadline } from "@/lib/daily";
import { formatViewers, getTopStreams } from "@/lib/twitch";
import { getTopYouTubeLive } from "@/lib/youtube";
import { SITE_URL } from "@/lib/site";
import { jstDay } from "@/lib/snapshot-range";

const HASHTAG = "配信トレンド";
// ログインはどのアカウントでもこの入口で受け付けてくれる。
// 投稿はアカウントが実際に置かれているサーバー（PDS）に送る（ログイン結果から分かる）
const ENTRYWAY = "https://bsky.social";

export type BlueskyReport = {
  enabled: boolean; // 認証情報が登録されていて、実際に投稿する設定か
  key?: string; // 投稿した回の印（2026-10-10 / live-2026-10-11-12）
  text?: string;
  posted?: string; // 投稿のID（at://…）
  skipped?: string; // 投稿しなかった理由
  login?: string; // 確認用（preview）のときだけ：ログインできたか
  credentialCheck?: Record<string, boolean>;
};

// ---------------------------------------------------------------
// 文字の扱い
// ---------------------------------------------------------------

function* segment(s: string) {
  for (const { segment } of new Intl.Segmenter("ja", {
    granularity: "grapheme",
  }).segment(s)) {
    yield segment;
  }
}
const graphemes = (s: string) => [...segment(s)].length;
/** 長い名前を n 文字（書記素）までに切る。Bluesky は1投稿300文字まで */
const clip = (s: string, n: number) =>
  graphemes(s) > n ? [...segment(s)].slice(0, n - 1).join("") + "…" : s;

/** ハッシュタグを「押せるタグ」にするための印（facet）。
 *  位置は文字数ではなく UTF-8 のバイト数で指定する決まり（日本語は1文字3バイト） */
function tagFacet(text: string) {
  const tag = `#${HASHTAG}`;
  const enc = new TextEncoder();
  const start = enc.encode(text.slice(0, text.lastIndexOf(tag))).length;
  return {
    index: { byteStart: start, byteEnd: start + enc.encode(tag).length },
    features: [{ $type: "app.bsky.richtext.facet#tag", tag: HASHTAG }],
  };
}

// ---------------------------------------------------------------
// 投稿する仕組み（ログイン・画像・投稿・二重投稿の防止）
// ---------------------------------------------------------------

type Session = { accessJwt: string; did: string; pds: string };
type Card = { uri: string; title: string; description: string; image: string };

function credentials() {
  // コピーのときに付きやすい「先頭の @」と「前後の空白・改行」は取り除く。
  // 「.」を含まない（stream-trends だけ）なら .bsky.social を補う。ログインには末尾まで必要で、
  // 最初の登録で末尾を省いてログインに失敗したため（2026-10-11）。独自ドメインのハンドルは「.」を含むのでそのまま
  const raw = process.env.BLUESKY_HANDLE?.trim().replace(/^@/, "");
  const handle = raw && !raw.includes(".") ? `${raw}.bsky.social` : raw;
  const password = process.env.BLUESKY_APP_PASSWORD?.trim();
  return { handle, password };
}

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

/** 確認用：投稿はせず、登録された認証情報でログインできるかだけ試す。
 *  パスワードの写し間違いを、最初の本番投稿で初めて知るのではなく、ここで見つけるため */
async function checkLogin(): Promise<
  Pick<BlueskyReport, "login" | "credentialCheck">
> {
  const { handle, password } = credentials();
  if (!handle || !password) return { login: "認証情報が未登録" };
  try {
    await login(handle, password);
    return { login: "ok" };
  } catch (e) {
    // 失敗したときは、値そのものは出さずに「形」だけ確かめて返す
    const raw = process.env.BLUESKY_APP_PASSWORD ?? "";
    return {
      login: String(e).slice(0, 200),
      credentialCheck: {
        handleHadAt:
          process.env.BLUESKY_HANDLE?.trim().startsWith("@") ?? false,
        handleEndsWithBskySocial: handle.endsWith(".bsky.social"),
        passwordHadSpaces: raw !== raw.trim(),
        // アプリパスワードは「xxxx-xxxx-xxxx-xxxx」の形（英小文字と数字）
        passwordLooksLikeAppPassword: /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(
          password,
        ),
      },
    };
  }
}

/** リンクカードの画像（自分のサイトの OGP 画像）を Bluesky に上げる。
 *  自分のサイトの画像なので、上げ直しても問題ない。失敗したら画像なしのカードにする */
async function uploadImage(session: Session, url: string) {
  try {
    const img = await fetch(url);
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

async function createPost(session: Session, text: string, card: Card) {
  const thumb = await uploadImage(session, card.image);
  const record = {
    $type: "app.bsky.feed.post",
    text,
    langs: ["ja"],
    createdAt: new Date().toISOString(),
    facets: [tagFacet(text)],
    // サイトへのリンクカード。続きはサイトで見てもらう
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: card.uri,
        title: card.title,
        description: card.description,
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

/** 投稿の流れの共通部分：二重投稿の確認 → 確認用なら中身とログインの確認だけ → 投稿して記録 */
async function publish(
  key: string,
  text: string,
  card: Card,
  preview: boolean,
): Promise<BlueskyReport> {
  const { handle, password } = credentials();
  const enabled = Boolean(handle && password) && !preview;
  const report: BlueskyReport = { enabled, key, text };

  const db = getDbClient();
  const done = await db.execute({
    sql: "SELECT uri FROM bsky_posts WHERE day = ?",
    args: [key],
  });
  if (done.rows.length > 0) return { ...report, skipped: "投稿済み" };

  if (!enabled) return { ...report, ...(await checkLogin()) };

  const session = await login(handle!, password!);
  const uri = await createPost(session, text, card);
  // bsky_posts.day には、日付のほか「live-日付-時」の印も入る（同じ回を二重に投稿しないための鍵）
  await db.execute({
    sql: "INSERT INTO bsky_posts (day, uri, posted_at) VALUES (?, ?, ?)",
    args: [key, uri, new Date().toISOString()],
  });
  return { ...report, posted: uri };
}

// ---------------------------------------------------------------
// 何を投稿するか
// ---------------------------------------------------------------

/** 前日のまとめ。まとめがある一番新しい日（ふつうは昨日）の最高同接の上位3人 */
export async function postDailyRanking(
  preview: boolean,
): Promise<BlueskyReport> {
  const db = getDbClient();
  const last = await db.execute("SELECT MAX(day) AS day FROM daily_stats");
  const day = last.rows[0]?.day ? String(last.rows[0].day) : null;
  if (!day) return { enabled: false, skipped: "まとめがまだ無い" };

  // 2日以上前の分は流さない（集計が何日も止まって追いついたとき、古い日をまとめて投稿しないため）
  if (day < jstDay(new Date(Date.now() - 2 * 24 * 3600 * 1000)))
    return { enabled: false, key: day, skipped: "最新のまとめが古い" };

  const { top } = await getDailyHeadline(day);
  if (top.length === 0)
    return { enabled: false, key: day, skipped: "その日の記録が無い" };

  const text = [
    `${dayTitle(day)}の配信ランキング（最高同接）`,
    ...top.map(
      (e, i) =>
        `${i + 1}位 ${clip(e.displayName, 20)} ${formatViewers(e.peakViewers)}人`,
    ),
    `#${HASHTAG}`,
  ].join("\n");

  return publish(
    day,
    text,
    {
      uri: `${SITE_URL}/daily/${day}`,
      title: `${dayTitle(day)}の配信ランキング`,
      description:
        "最高同接ランキング・前日から伸びた配信者・自己ベスト更新・見られたゲーム",
      image: `${SITE_URL}/daily/${day}/opengraph-image`,
    },
    preview,
  );
}

/** いま見られている配信（日本）の上位5つ。Twitch は API で今の数字、
 *  YouTube は直近の毎時の収集（最大1時間前）から。トップページと同じ組み合わせ */
export async function postLiveRanking(
  preview: boolean,
): Promise<BlueskyReport> {
  const [twitch, youtube] = await Promise.all([
    getTopStreams({ language: "ja", limit: 20 }).catch(() => []),
    getTopYouTubeLive("jp", 20).catch(() => []),
  ]);
  const entries = [
    ...twitch.map((s) => ({
      name: s.user_name,
      viewers: s.viewer_count,
      platform: "Twitch",
    })),
    ...youtube.map((v) => ({
      name: v.channel_title,
      viewers: v.viewers,
      platform: "YouTube",
    })),
  ]
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 5);
  if (entries.length === 0)
    return { enabled: false, skipped: "配信中の記録が無い" };

  const now = new Date();
  const hour = new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
  const text = [
    `${hour}時 いま見られている配信`,
    ...entries.map(
      (e, i) =>
        `${i + 1}位 ${clip(e.name, 18)} ${formatViewers(e.viewers)}人（${e.platform}）`,
    ),
    `#${HASHTAG}`,
  ].join("\n");

  return publish(
    `live-${jstDay(now)}-${hour}`,
    text,
    {
      uri: SITE_URL,
      title: "ライブ配信ランキング",
      description: "Twitch・YouTubeを横断して、いま見られている配信",
      image: `${SITE_URL}/opengraph-image`,
    },
    preview,
  );
}
