@AGENTS.md

# game-trends

Twitch・YouTube Liveの配信ランキングサイト。将来的に他プラットフォームも統合予定。
表示名は「配信トレンド」（`lib/site.ts` の `SITE_NAME`）。リポジトリ名は
game-trends のままだが、中身は配信者・配信が主役でゲームは従なので表示名とURLを寄せた。

- 本番: https://stream-trends.sukinote.com（Cloudflare Workers）
- 旧URL: https://game-trends-psi.vercel.app（Vercel。アカウント停止中で開けない）
- リポジトリ: https://github.com/ryotakansai-cell/game-trends

### ドメイン

`sukinote.com`（好きノート）を Cloudflare Registrar で取得し、作ったサイトを
サブドメインで並べる（`stream-trends.` / `yorushika.`）。サイトごとにドメインを
買うと年額が積み上がるため1つにまとめた。名前に本名を入れないのは、一般の人に
作者の名前を見せないため。

`stream-trends.sukinote.com` は Worker の Custom Domain（`wrangler.jsonc` の
`routes`）。DNS の行は Cloudflare が自動で作るので手で書かない。同じ名前の行が
既にあるとデプロイが失敗する。

### ホスティング（Vercel → Cloudflare Workers に移した経緯）

2026-10 に Vercel Hobby がアカウントごと30日停止した（画像最適化の変換が上限
5,000回の215%）。公式ドキュメントには「超えても新しい画像の最適化が止まるだけ」と
あったが、実際は全サイト停止だった。Hobby は数える項目が多く、どれか1つを超えると
全サイトが30日止まる。サイトを増やすほどその崖に近づくので、Cloudflare Workers の
有料プラン（月$5。アカウント単位で何サイトでも同額）に移した。

- 超えても止まらず従量課金（リクエスト100万回 $0.30、CPU 100万ms $0.02）。
  上限で止める機能は無いので、予算アラートを $1 で設定してある
- 無料プランは CPU が1回10msで、Next.js のページ組み立てが収まらない（エラー1102）
- Next.js は OpenNext（`@opennextjs/cloudflare`）で変換して動かす。Vercel ほど
  そのままは動かないので、更新時は `npm run preview` で手元確認してから出す
- 画像最適化は使わない（`next.config.ts` の `images.unoptimized`）。Twitch の
  アイコンは配信元の 70x70 版を使う（`getUsersByLogin`）
- `*.workers.dev` の既定URLは無効（アカウントのサブドメインに本名が入るため）

## 作者について

- 業務ではC#とBlazorを使用。JavaScript/TypeScriptは学習中。
- **コードを提案するときは、何をしているかを日本語で説明すること。**
- C#との対比があると理解しやすい（例: `Map` は `Dictionary`、`.filter()` は `.Where()`）。
- 目的は「動くものを作ること」と「転職時に説明できる技術力をつけること」の両方。

## 技術構成

| 領域           | 使用技術                              |
| -------------- | ------------------------------------- |
| フレームワーク | Next.js 16 (App Router)               |
| 言語           | TypeScript                            |
| スタイル       | Tailwind CSS v4                       |
| コード整形     | Prettier（保存時に自動整形）          |
| DB             | Turso (libSQL/SQLite)                 |
| ホスティング   | Cloudflare Workers 有料（OpenNext）   |
| 定期実行       | Cloudflare Cron Triggers              |
| 外部API        | Twitch Helix API、YouTube Data API v3 |

## ディレクトリ構成

```
app/
├── page.tsx                    トップ（Live Ranking。Twitch/YouTube統合 + プラットフォーム/地域タブ）
├── trending/page.tsx           急上昇（24時間前との比較。日本/Global・配信元の絞り込み）
├── creators/page.tsx           クリエイター一覧（名寄せ済みの人物）
├── creators/[id]/page.tsx      クリエイター統合ページ（全プラットフォームを1ページに）
├── games/page.tsx              ゲームランキング（Twitchのみ。YouTube側にゲーム判定が無いため）
├── games/[id]/page.tsx         ゲーム詳細（配信者一覧 + 外部リンク）
├── streamers/[login]/page.tsx  配信者ページ（Twitch単体。クリップ・アーカイブ）
└── api/
    ├── cron/snapshot/route.ts        Twitch: 毎時DBに保存（games/snapshots、accounts/live_snapshots）
    └── cron/youtube-snapshot/route.ts YouTube: 毎時DBに保存（accounts/live_snapshots）
components/
├── SiteHeader.tsx              全ページ共通のヘッダー（ホーム + 下線ナビ）
├── PageHeader.tsx              各ページの見出し（紫の小さな英字 + 白い見出し + 右上に地域 + 下に絞り込み）
├── SegmentedTabs.tsx           日本/Global の切り替え（つながった2択スイッチ）
├── FilterPills.tsx             配信元の丸ボタン（すべて/Twitch/YouTube。増えても折り返す）
├── PlatformIcons.tsx           配信元の単色アイコン（色は付けず currentColor）
└── RelativeTime.tsx            「◯分前」（ブラウザ側で計算。作り置きされても数字が古くならない）
lib/
├── twitch.ts                   Twitch APIとの通信（唯一の窓口）
├── youtube.ts                  YouTube Data API v3との通信 + DBからのランキング読み取り
├── platform.ts                 プラットフォーム共通の型（PlatformContent など）。処理は書かない
├── creators.ts                 人物とアカウントのDB読み取り、各libへの振り分け
└── db.ts                       Turso接続（読み書き共通の1関数のみ。RLS相当の分離は不要）
scripts/
├── test-cron.mjs               ローカル/本番のcronエンドポイントを手軽に叩くテスト用スクリプト
├── links-probe.mjs             Twitchのloginをハンドル(@xxx)として引く（1人1ユニット）
├── suggest-links.mjs           名寄せ候補をYouTube検索で集める（1人100ユニット）
├── links-review.mjs            候補を根拠つきで判定して一覧（50件1ユニット）
├── links-confirm.mjs           候補を確定・却下して紐付ける
├── links-undo.mjs              確定を取り消して pending に戻す
├── links-add.mjs               URL直指定で手動紐付け（channels.list 1ユニット）
├── links-rename.mjs            creatorの表示名を直す
└── link-core.mjs               紐付け処理の共通部品（confirm / add で共用）
cron-worker/                    毎時の収集APIを呼ぶだけの Worker（Cron Triggers。サイトとは別にデプロイ）
wrangler.jsonc                  サイト本体の Worker 設定（Custom Domain、R2 バインディング）
open-next.config.ts             OpenNext の設定（fetch の作り置きを R2 に置く）
```

## 設計上の決定と、その理由

外部API通信は必ず `lib/twitch.ts` / `lib/youtube.ts` を経由する。ページから直接fetchしない。

DBは正規化してある。「マスタ」と「1時間ごとの履歴」に分離する方針は一貫していて、
名前や画像URLを毎時間保存するのは冗長なため。

DBはSupabase(PostgreSQL)からTurso(libSQL)に移行済み。無料枠の容量
（Supabase 500MB → Turso 5GB）と、複数プラットフォームのスナップショットが
増える見込みを踏まえた判断。読み取り/書き込みクライアントの分離もやめた
（ページからDBを直接読む場面が無く、RLS前提の分離が最初から不要だった）。

DBはプラットフォーム非依存の3テーブルに統合済み。`creators`（人物）/
`accounts`（各プラットフォームのアカウント。`platform` + `platform_id` が一意）/
`live_snapshots`（1時間ごとの配信記録）。`accounts.creator_id` が `creators` を
指す1対Nで、これがクロスプラットフォームの名寄せの本体。`accounts.relation` で
self（本人）/ clip（切り抜き）/ archive（アーカイブ）を区別する。
旧テーブル（`streamers` / `streamer_snapshots` / `youtube_streamers` /
`youtube_live_snapshots`）は書き込みも読み取りも停止済み。移行直後なので
まだ削除していない。`games` / `snapshots` はTwitch専用のゲームランキング用で、
これは移行しない。

表示側はプラットフォームごとの違いを `lib/platform.ts` の `PlatformContent` という
共通の型に吸収する。ツイキャスを足すときは `lib/twitcasting.ts` に同じ形を返す関数を
1つ書き、`lib/creators.ts` の振り分けに数行足すだけで、ページ側は変更不要。

YouTubeは Twitch と仕組みが違う。「今ライブ中の一覧」を取る `search.list` は
キーワード（`q`）が実質必須で、地域・カテゴリだけでは0件になる。1回100ユニット
と高コストなため（無料枠は1日10,000ユニット。太平洋時間0時＝日本時間16時に
リセット）、日本語2キーワード＋全世界1
キーワードを時刻でローテーションする方式にしている（`lib/youtube.ts` の
`JP_LIVE_KEYWORDS` / `GLOBAL_LIVE_KEYWORDS` / `pickKeyword`）。`videos.list` は
一度に指定できる動画IDが50件までなので分割して呼ぶ。

キーワード検索だけでは名寄せ済みの配信者がほとんど拾えない（2026-10 の実測で、
YouTube 本人アカウントを持つ93人のうち記録があったのは5人）。そこで cron は
名寄せ済みの本人チャンネルの RSS（無料・枠を使わない）から直近7日の動画IDを集め、
検索結果と一緒に `videos.list` で配信中か確かめている（`getRecentVideoIdsFromFeeds`）。
Twitch も同じ理由で、上位800配信の圏外にいる名寄せ済みの人を `streams?user_id=` で
直接確かめている（実測で、ある1時間に98人中37人が圏外で配信していた）。
cron は `?dryRun=1` を付けると保存せずに件数だけ返す（`npm run test:cron -- "snapshot?dryRun=1"`）。

YouTubeの1日の枠の配分。cronはサイトの本体機能なので最優先で確保する。

```
10,000  1日の無料枠
-7,500  cron（毎時 検索300 + videos.list 約12 × 24回）
──────
 2,500  名寄せなどに自由に使える分
```

videos.list の回数は、名寄せ済みの人が増えるほど増える（RSS の候補 約500件で12回）。

名寄せを回すときはこの2,500を超えないこと。超えるとcronが落ちて
ランキングのデータが欠ける。作業は日をまたいで分割する。
この枠はヨルシカのサイトと同じキーで共有している（ヨルシカ側は1日数ユニット）。

定期実行は Cloudflare の Cron Triggers（`cron-worker/`）から収集APIを叩く。
以前は GitHub Actions の schedule だったが、混雑時に実行が飛ばされ、毎時の
はずが実際は4〜6時間おきだった（2026-10 に実行履歴とDBで確認）。Cron Triggers は
時刻どおりに動く。`cron-worker` は転送(3xx)を失敗として扱う（転送を追わずに
「成功したのに保存されない」状態になるのを防ぐ）。GitHub Actions の2つの
ワークフローは手動実行用にだけ残してある。

トップ・急上昇・各詳細ページは `searchParams` / `params` を読むため `ƒ`（表示のたびに
組み立てる）。外部APIの返事は fetch の `next.revalidate` で R2 に作り置きされる。
`/games`・`/creators`・`/sitemap.xml` は `○`（ビルド時に作り、5分ごとに作り直す）。
この3つは**ビルド時に Twitch API と DB を読む**ので、Workers Builds の
「Build variables」に `TWITCH_CLIENT_*` と `TURSO_*` を入れてある（無いとビルドが失敗する）。
Twitch のトークン取得を作り置き（force-cache）にしたことで `ƒ` から `○` に変わった
（以前は no-store だったので、トークンを使うページが全部 `ƒ` になっていた）。

`page.tsx` から自分のAPIルートをfetchしない。Server Componentなので
`lib/` の関数を直接呼ぶ。トップページはTwitch（API直叩き）とYouTube
（DB読み取り）の両方を呼び、`UnifiedEntry` という共通の形に変換して
から視聴者数でソートする（`app/page.tsx`）。YouTube側だけ例外的に
DBを直接読む（Twitchと違い、表示のたびにAPIを叩けないため）。

配信者アイコンは表示時にその場で取得し、DBには保存しない
（Twitchの`getUsersByLogin`、YouTubeの`getChannelIcons`とも同じ方針）。

## UIの約束ごと

ナビゲーションは `components/SiteHeader.tsx` に集約する。各ページに
「← 配信ランキング」のような戻りリンクを置かない。戻ることしかできず、
ゲーム一覧から配信者一覧へ移るのに一度トップへ戻る必要が出るため。

色は役割で決める。**紫は「現在地」と「hover」にだけ使う**。
使いすぎると「今どこにいるか」が伝わらなくなる。

| 役割                                 | 通常      | hover |
| ------------------------------------ | --------- | ----- |
| ナビの現在地                         | 紫 + 下線 | —     |
| 見出しの上の小さな英字（ページ名）   | 紫        | —     |
| 選択中の切り替え・絞り込みボタン     | 紫の塗り  | —     |
| ナビのその他                         | グレー    | 白    |
| 本文中のリンク（ゲーム名・配信者名） | 白        | 紫    |
| 補助情報（視聴者数・日付）           | グレー    | —     |

リンクの印に `→` を使わない。矢印は方向を表す記号であって「リンク」の意味はなく、
色で示せば足りる。「もっと見る」のように矢印そのものに意味がある場合だけ使う。

配信者を出す場所には必ずアイコンを付ける。

サイトのアイコンは `design/icon.svg`（横長の動画の枠の中で伸びる折れ線。2026-10-10 に決定）。
絵を変えたら `npm run make:icons` で `app/icon.svg`・`favicon.ico`・`apple-icon.png` を作り直す。

見出しは `PageHeader` を使い、全ページで形をそろえる。見出しは日本語（ライブランキング /
急上昇 / ゲームランキング / 配信者）、上に小さな英字を添える。地域は右上の `SegmentedTabs`
（ずっと2択のスイッチなのでつながった形）、配信元は下の `FilterPills`（ツイキャスなどで
増えていく選択肢なので、離れた丸ボタンで折り返せる形）。役割が違うので見た目も分ける。
配信元のアイコンは各サービスの色を使わず単色にする（紫で統一感を出すため）。

スマホ（sm 未満）だけの決まり：
- ナビは画面下に固定したタブバー（4つ）。上の下線ナビだと「配信者」が画面外に切れていたため。
  上には代わりにサイトのアイコンと名前を出す。body に同じ高さの下余白を入れてある
- 配信元の丸ボタンと地域の切り替えを1行にまとめ、スクロールしても上に固定する。
  1行（約48px）を超えると画面を占めて見づらいので、スマホでは丸ボタンのアイコンを省く
- 見出しは小さめ（text-2xl）

配色は暗い背景だけ（`globals.css` で固定）。以前は端末がライトモードだと背景だけ白になり、
白い見出しや配信タイトルが読めなくなっていた。

各ページの説明文に更新間隔と「◯分前」を出す（ライブ：Twitch 5分ごと / YouTube 毎時、
急上昇：毎時、ゲーム：5分ごと）。ランキングの鮮度が分かると信頼してもらいやすいため。
画像の入れ物には `bg-white/5` を敷き、読み込み中に真っ黒な四角が並ばないようにする。

## 禁止事項

- `.env.local` を読まない、内容を出力しない、コミットしない
- `getDbClient()`（書き込み含む）を `page.tsx` やクライアントコンポーネントで使わない
- 環境変数に `NEXT_PUBLIC_` を付けるのは公開してよい値のみ

## 環境変数

```
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
YOUTUBE_API_KEY
CRON_SECRET
```

本番の値は Cloudflare の Worker の Secret に置く。`.env.local` を変えたら、
プロジェクトのフォルダで `npx wrangler secret bulk .env.local` を実行すれば
まとめて反映される（値は表示されない。Secret の変更は即時反映でビルド不要）。
`cron-worker` には `CRON_SECRET` だけを、`cron-worker` フォルダで
`npx wrangler secret put CRON_SECRET` で入れる（フォルダを間違えるとサイト側に入る）。
GitHub Secrets（`CRON_SECRET` / `SITE_URL`）は手動実行のワークフロー用。

## デプロイ

**main に push すると、Cloudflare（Workers Builds）が自動でビルドして本番に出す。**
ビルドとデプロイのコマンドは `npx opennextjs-cloudflare build` / `deploy`
（Cloudflare の Worker `stream-trends` → Settings → Build に設定済み）。
手元から出すこともできる:

```
npm run preview   手元で Cloudflare と同じ環境（workerd）で動かして確認する
npm run deploy    OpenNext でビルドして本番にデプロイする（stream-trends.sukinote.com）
cd cron-worker && npm run deploy   cron の Worker をデプロイする
```

Windows では OpenNext のビルドがシンボリックリンクを作るため、Windows の
「開発者モード」をオンにしておく必要がある（設定 → システム → 詳細設定）。
cron-worker は自動デプロイの対象外（変更したら手元で `npm run deploy`）。
Vercel は GitHub と連携したままなので push すると動くが、アカウント停止中で無関係。

## 名寄せ（クロスプラットフォームの人物統合）の手順

機械が候補を集めて判定し、人間が確認してから確定する半自動方式。
自動で紐付けないのは、間違った紐付けがそのまま本番に出てしまうため。
見逃し（本人なのに紐付けない）は誰も気づかず後から足せるが、
誤り（別人を紐付けた）はサイトに嘘が出る。この2つは対称ではない。

```
1. npm run links:probe -- 70                    安い手段で当てる（1人1ユニット）
2. npm run suggest-links -- 25                  取りこぼしを検索で拾う（1人100ユニット）
3. npm run links:review                         判定と根拠を表示（50件1ユニット）
4. npm run links:confirm -- 4 5:clip 9:reject   確定・却下する
5. npm run links:undo -- 4                      確定を取り消す
6. npm run links:add -- <login> <YouTubeのURL>  検索で出ない人を手動登録
7. npm run links:rename -- <creator_id> <名前>  creatorの表示名を直す
```

### 安い手段から順に試す

`search.list` は1人100ユニット、`channels.list` は50件で1ユニット。
100倍の差があるので、必ず `links:probe` を先に回す。

| 手段                                       | コスト         | 的中率（実測）          |
| ------------------------------------------ | -------------- | ----------------------- |
| `links:probe`（loginをハンドルとして引く） | 1人1ユニット   | 上位層で44%、下位層で3% |
| `suggest-links`（表示名で検索）            | 1人100ユニット | 1人あたり候補3件        |

的中率が上位層に偏るのは、上位の配信者ほどYouTubeを持ち、名前も揃えているため。
下位に手を伸ばしても収穫が薄いので、上位100人を埋める方針にしている。

表示名をハンドルとして引く案も測ったが 2/21 と精度が低く不採用
（`@はんじょう` は無関係な「カニかま」というチャンネルが取得済みだった）。

### links:review の判定ルール

根拠の強い順に見る。AIではなくルールベースにしているのは、
判定根拠が出力に残り、間違えたときに原因を特定して直せるため。

1. 説明欄に**別の** `twitch.tv/<login>` → 別人（却下を提案）
2. 登録者100人未満 → 実質空のチャンネル（却下を提案）
3. タイトルに「切り抜き/まとめ/ダイジェスト」→ `clip`
4. タイトルに「アーカイブ/保管庫/録画」→ `archive`
5. 名前をそのまま含む、または類似度0.7以上 → `self`
6. 説明欄のキーワード → `clip` / `archive`（弱い根拠）

タイトルと説明欄でキーワードの重みを分けているのは、本人チャンネルの
説明欄に「切り抜き歓迎」と書かれていることがあり、説明欄だけで判定すると
本人を切り抜きと誤判定するため（実際に3件の誤判定を確認して修正した）。

`source='handle'`（probe由来）の候補は◎相当として扱う。
`@<login>` というハンドルは本人しか取得できないので、名前が全く違っていても
本人とみなせる（`@stylishnoob4` → 「関優太」のような本名チャンネル）。

### 機械が苦手な対応

文字列の類似度では測れないものが残る。ここは人が見る。

```
mago2dgod       → マゴ /MAGO         ローマ字 → カナ
mago2dgod       → 2D神ちゃんねる      2dgod → 2D神（意味の対応）
jasper7se       → じゃすぱーちゃんねる 英語 → カナ
tonakaito_hendy → カイトです          本人の別chが「…Gameです」で命名が揃う
aria_konkon     → こんぬき屋          「◯◯ぬき」= 切り抜きの慣習的な命名
```

決め手にならないときは、YouTubeの**動画タイトルを3つ見る**のが早い。
チャンネル名や説明文は飾れるが、動画タイトルは中身そのもの。
「その配信者が何を配信しているか」は `live_snapshots` に毎時保存してあるので、
外部を調べる前に手元のDBで照合できる。

### 運用上の注意

却下（rejected）も `link_candidates` に記録として残す。削除すると
`suggest-links` が次回また同じ人を検索してクォータを無駄にするため。
`suggest-links` の絞り込みが `source='name_search'` を見ているのは、
probeの結果がある人でも検索は妨げないようにするため。

**`links:confirm` は関係を省くと `self` になる。** 却下のつもりで
`158` と書くと「本人」として紐付いてしまう（実際に17件やらかした）。
`links:review` が出力するコマンドをそのまま使い、手で書き直さないこと。
やらかしたら `links:undo` で戻せる。

`links:undo` は、配信履歴（`live_snapshots`）を持つアカウント行は削除せず
紐付けだけ外す。cronが集めた履歴を失わないため。

## 今後の予定

1. ~~前日比・急上昇の実装~~ 実装済み（`/trending`）
2. ツイキャス統合（公式APIあり、Twitchと近い形で取得できる見込み）← 次の本命
3. Kick統合は保留（迷惑系配信者の存在が気になり、優先度を下げた）
4. ~~`platform` 列によるスキーマ統合~~ 実装済み
   （プラットフォーム横断の総合ランキングは `app/page.tsx` で実現済み）
5. ~~クロスプラットフォームの名寄せ~~ 半自動の仕組みを実装済み。
   上位100人のうち88人、上位50人のうち49人が紐付け済み（creators 98人）。
   bio欄やlinktreeからの候補収集（`source=bio_link`）は未着手。
   調査したところTwitchのプロフィールにURLを書いている人は50人中5人しかおらず、
   リンクはAPIで取れないPanelsに置かれているため、優先度は低い
6. ~~YouTubeの配信者手動登録~~ `links:add` で実装済み
7. 旧テーブル（`streamers`系/`youtube_streamers`系）の削除（移行が安定したら）
8. 保存データの間引き（1年以上前は日次の代表値だけ残す）。2026-10 の実測で
   1日約0.7MB・年約250MB、Turso の無料枠 5GB に対して約20年もつので急がない
9. ~~表示のたびに YouTube API を呼んでいた~~ fetch に revalidate を付けて作り置き済み。
   急上昇の SQL が全履歴を読んでいたのも、時間の範囲で絞るように直した
   （`lib/snapshot-range.ts`）。新しい SQL を書くときも、live_snapshots は
   必ず captured_at の範囲か最新時刻の一致で絞ること（全件を読むと遅く、Turso の枠も減る）
10. ~~ヨルシカのサイトも Cloudflare に移す~~ 移行済み（https://yorushika.sukinote.com）
11. ~~アクセス解析~~ Cloudflare Web Analytics の自動設定（sukinote.com 単位）で計測中。
    Cloudflare が配信時にスクリプトを差し込むので、コードには書かない（書くと二重計測になる）。
    新しいサブドメインのサイトも自動で対象になる
12. ~~デプロイの自動化~~ Workers Builds で main への push ごとに自動デプロイ

## 方針

Twitch単体では本家に機能で勝てない。
**複数プラットフォームの横断**と**履歴データによる前日比**で差別化する。
