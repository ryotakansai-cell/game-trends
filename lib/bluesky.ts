// 配信のランキングを Bluesky のボット用アカウント（stream-trends.bsky.social）に投稿する。
//   - 朝8時：前日のまとめ（日付ページへのリンク）
//   - 12・18・21時：いま見られている配信（トップページへのリンク）
// 時刻は cron-worker が /api/cron/bluesky を呼ぶ時刻で決まる（2026-10-11 決定。1週間ほど見て見直す）。
// 12・18・21時は日本の配信の視聴者数を実測して決めた（昼休み・帰宅・夜のピーク）。
// 9時も試したが、1日5回は多いので外した（2026-10-11）。
//
// ヨルシカのサイト（yorushika-fan の lib/news/bluesky.ts）と同じ作り。
// API は公式の XRPC を fetch で直接呼ぶ（呼ぶのは4種類だけなので、ライブラリは入れない）。
// BLUESKY_HANDLE / BLUESKY_APP_PASSWORD が無いあいだは投稿しない。
// 手元から誤って投稿しないよう、この2つは .env.local に入れず Worker の Secret にだけ置く。
// 同じ回を二重に投稿しないよう、投稿した回を bsky_posts に記録する（cron が再実行されても安全）。

import { getDbClient } from "@/lib/db";
import { dayTitle, getDailyHeadline } from "@/lib/daily";
import { formatViewers } from "@/lib/twitch";
import { PLATFORM_IDS, PLATFORMS, PLATFORM_NAMES } from "@/lib/platforms";
import { LOADERS } from "@/lib/platform-loaders";
import { SITE_URL } from "@/lib/site";
import { jstDay } from "@/lib/snapshot-range";
import { clip, shortTitle } from "@/lib/text";
import { rankingImage } from "@/lib/og";
import { getAccountIcons } from "@/lib/platform-loaders";
import { accountKey } from "@/lib/platforms";

// 2026-10-16 に「#配信トレンド」から変えた。サイト名のタグは、まだ誰も探さない（名前は投稿者名とリンクで分かる）。
// 「配信ランキング」は投稿の中身そのもので、探す人がいる言葉なので、見つけてもらう入口になる。
// 配信者の名前のタグは付けない（オーナーの決定。名前を宣伝に使うように見え、記号入りの名前はタグにならない）
const HASHTAG = "配信ランキング";
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
// ハッシュタグ
// ---------------------------------------------------------------

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
/** リンクカード。image は画像の URL か、その場で作った画像（PNG）そのもの */
type Card = {
  uri: string;
  title: string;
  description: string;
  image: string | ArrayBuffer;
};

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

/** リンクカードの画像を Bluesky に上げる。URL なら取ってきて（自分のサイトの OGP 画像）、
 *  PNG そのものならそのまま上げる。失敗したら画像なしのカードにする */
async function uploadImage(session: Session, image: string | ArrayBuffer) {
  try {
    let body: ArrayBuffer;
    if (typeof image === "string") {
      const img = await fetch(image);
      if (!img.ok) return undefined;
      body = await img.arrayBuffer();
    } else {
      body = image;
    }
    const res = await fetch(`${session.pds}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body,
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

/** 上位の行を Bluesky の本文にする。見出し、空行、「1位 名前 人数」を1人1行、空行、ハッシュタグ。
 *  2026-10-17：以前は各行の下に配信タイトルを字下げして入れていたが、スマホでは1行に全角15〜17文字ほどしか入らず、
 *  タイトルが2行に折り返してごちゃついた。タイトルはカードの画像に全員分あるので、本文は名前と人数だけにし、
 *  スマホでも1人1行に収まるよう名前は12文字で切る（オーナーの決定）。300文字には十分収まる */
type TextRow = { name: string; value: string };
function rankingText(header: string, rows: TextRow[]) {
  return [
    header,
    "",
    ...rows.map((r, i) => `${i + 1}位 ${clip(r.name, 12)} ${r.value}`),
    "",
    `#${HASHTAG}`,
  ].join("\n");
}

/** 2026-10-16 → 10/16（金）。スマホで見出しが1行に収まるよう、日付ページの「10月16日（金）」より短くする */
function shortDayTitle(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${wd}）`;
}

/** 日本時間の「10/16 21時」 */
function jstLabel(now: Date) {
  const j = new Date(now.getTime() + 9 * 3600 * 1000);
  return {
    hour: j.getUTCHours(),
    label: `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${j.getUTCHours()}時`,
  };
}

/** 前日のまとめ。まとめがある一番新しい日（ふつうは昨日）の最高同接の上位5人。
 *  カードの画像は日付ページの OGP 画像（アイコン・最高同接だった瞬間のタイトル付きの上位5人） */
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

  const { top } = await getDailyHeadline(day, 5);
  if (top.length === 0)
    return { enabled: false, key: day, skipped: "その日の記録が無い" };

  const text = rankingText(
    `${shortDayTitle(day)}の配信ランキング`,
    top.map((e) => ({
      name: e.displayName,
      value: `${formatViewers(e.peakViewers)}人`,
    })),
  );

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

/** いま見られている配信（日本）の上位5つと、カードに付ける画像（アイコン付きの上位5人）。
 *  トップページと同じく、全部の配信元から混ぜて並べる
 *  （Twitch は API で今の数字、YouTube は直近の毎時の収集＝最大1時間前から）。
 *  確認用に画像だけ見られるよう、投稿とは分けてある（/api/cron/bluesky?kind=live&dryRun=1&image=1） */
export async function buildLiveRanking(now = new Date()) {
  const lists = await Promise.all(
    PLATFORM_IDS.map((p) => LOADERS[p].live(true, 20).catch(() => [])),
  );
  const entries = lists
    .flat()
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 5);
  if (entries.length === 0) return null;

  const { hour, label } = jstLabel(now);
  const header = `${label} いま見られている配信`;
  const text = rankingText(
    header,
    entries.map((e) => ({
      name: e.channelName,
      value: `${formatViewers(e.viewers)}人`,
    })),
  );

  // アイコンは一覧に付いてくる配信元（ツイキャス・Kick）はそれを、ほかは表示のたびに取る方針どおり API から
  const icons = await getAccountIcons(entries.filter((e) => !e.iconUrl)).catch(
    () => new Map<string, string>(),
  );
  const image = await rankingImage(
    header,
    `日本の配信 ・ ${PLATFORM_NAMES}`,
    entries.map((e, i) => ({
      rank: i + 1,
      name: e.channelName,
      title: shortTitle(e.title, 40),
      value: `${formatViewers(e.viewers)}人`,
      platform: PLATFORMS[e.platform].label,
      iconUrl: e.iconUrl ?? icons.get(accountKey(e)),
    })),
  );
  return {
    key: `live-${jstDay(now)}-${hour}`,
    text,
    image: await image.arrayBuffer(),
  };
}

export async function postLiveRanking(
  preview: boolean,
): Promise<BlueskyReport> {
  const live = await buildLiveRanking();
  if (!live) return { enabled: false, skipped: "配信中の記録が無い" };
  return publish(
    live.key,
    live.text,
    {
      uri: SITE_URL,
      title: "ライブ配信ランキング",
      description: `${PLATFORM_NAMES}を横断して、いま見られている配信`,
      image: live.image,
    },
    preview,
  );
}
