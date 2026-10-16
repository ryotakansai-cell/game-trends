@AGENTS.md

# game-trends

Twitch・YouTube Live・ツイキャス・Kick の配信ランキングサイト。将来的に他プラットフォームも統合予定。
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
├── daily/page.tsx              日付ごとのまとめの一覧
├── daily/[date]/page.tsx       その日のまとめ（最高同接・前日から伸びた人・長時間配信・見られたゲーム）。ナビは「急上昇」の仲間
├── daily/[date]/opengraph-image.tsx  その日の上位3人の OGP 画像
├── opengraph-image.tsx         サイト全体の OGP 画像（個別の画像が無いページで使われる）
├── creators/suggest/route.ts   検索欄の候補の一覧（JSON。直近14日の集計＋直近24時間の記録から上位2,000人。6時間作り置き）
├── creators/page.tsx           配信者一覧・検索（日本の配信者全体。配信中 / 7日の最高同接 / 7日の配信時間で並べ替え）
├── creators/[id]/page.tsx      クリエイター統合ページ（全プラットフォームを1ページに）
├── games/page.tsx              ゲームランキングの「総合」（上に「いま話題のゲーム」、下に各プラットフォームの上位5本。単位が違うので順位は混ぜない）
├── games/twitch/page.tsx       ゲームランキング（Twitch で見られている順。YouTube側にゲーム判定が無いため。以前は /games だった）
├── games/kick/page.tsx         ゲームランキング（Kick で見られている順。日本語の上位100配信 / 全世界の上位100配信。雑談・外配信は含まない）
├── games/steam/page.tsx        ゲームランキング（Steam で遊ばれている順。24時間前比・Twitch の視聴者数・日本の配信数）
├── games/roblox/page.tsx       ゲームランキング（Roblox で遊ばれている順）
├── games/appstore/page.tsx     ゲームランキング（App Store の日本のゲーム。セールス / 無料。24時間前からの順位の変化）
├── games/ratio/page.tsx        見られ度（Twitch の視聴者 ÷ Steam で遊んでいる人）
├── games/[id]/page.tsx         ゲーム詳細（配信者一覧 + 外部リンク）
├── streamers/[login]/page.tsx  配信者ページ（Twitch単体。配信の記録・クリップ・アーカイブ）
├── youtube/[channelId]/page.tsx YouTube チャンネルのページ（名寄せしていない人。DB の記録だけで作る）
├── twitcasting/[userId]/page.tsx ツイキャスの配信者のページ（同上。中身は components/AccountRecordPage.tsx で共通）
├── kick/[userId]/page.tsx      Kick の配信者のページ（同上）
└── api/
    ├── cron/snapshot/route.ts        Twitch: 毎時DBに保存（games/snapshots、accounts/live_snapshots）
    ├── cron/youtube-snapshot/route.ts YouTube: 毎時DBに保存（accounts/live_snapshots、監視リスト）
    ├── cron/daily/route.ts           毎日: 前日分を daily_stats にまとめ、90日より古い毎時の記録を消す
    ├── cron/bluesky/route.ts         Bluesky に投稿（?kind=daily / live。cron-worker が決まった時刻に呼ぶ）
    ├── cron/play-snapshot/route.ts   毎時: ゲームを遊んでいる人数（Steam・Roblox）を play_snapshots に記録
    ├── cron/twitcasting-snapshot/route.ts ツイキャス: 毎時DBに保存（おすすめ上位100 + 名寄せ済みの人）
    ├── cron/kick-snapshot/route.ts   Kick: 毎時DBに保存（日本語の上位100 + 全世界の上位100 + 名寄せ済みの人）
    └── cron/appstore/route.ts        App Store の順位表を受け取って保存（POST。GitHub Actions が RSS を送ってくる）
components/
├── SiteHeader.tsx              全ページ共通のヘッダー（ホーム + 下線ナビ）
├── PageHeader.tsx              各ページの見出し（紫の小さな英字 + 白い見出し + 右上に地域 + 下に絞り込み）
├── SegmentedTabs.tsx           日本/Global の切り替え（つながった2択スイッチ）
├── FilterPills.tsx             配信元の丸ボタン（すべて/Twitch/YouTube。増えても折り返す）
├── PlatformIcons.tsx           配信元の単色アイコン（色は付けず currentColor）。PlatformIcon で配信元から引ける
├── PlatformFilter.tsx          配信元の絞り込み（すべて/Twitch/YouTube/…。台帳の順に並ぶ）
├── ScrollRow.tsx               横に送る1行（右に隠れたボタンがあるあいだ右端を暗くする）
├── LiveViews.tsx               ライブランキングのカード表示とリスト表示（?view=list で切り替え）
├── GameBuzz.tsx                「いま話題のゲーム」の帯（スマホは横に送る、PC は5列）
├── CreatorSearch.tsx           配信者の検索欄（打つと候補、Enter で検索結果）
├── RelativeTime.tsx            「◯分前」（ブラウザ側で計算。作り置きされても数字が古くならない）
├── StreamStats.tsx             配信者ページの「配信の記録」（数字・日ごとの最高同接の棒グラフ・よく遊んだゲーム・比較表）
├── ShareOnX.tsx                「Xで共有」ボタン（X の投稿画面を開くだけ。API を使わない）
├── DayStreams.tsx              グラフで選んだ日の配信（タイトル・ゲーム・数字、Twitch はその日のアーカイブとクリップ）
├── HourHeatmap.tsx             よく配信する時間帯（曜日×時間。白の濃淡で、紫は使わない）
└── SameGameStreamers.tsx       同じゲームを配信している人（雑談などゲームではない分類は飛ばす）
lib/
├── twitch.ts                   Twitch APIとの通信（唯一の窓口）
├── youtube.ts                  YouTube Data API v3との通信 + DBからのランキング読み取り
├── twitcasting.ts              ツイキャス API v2 との通信（唯一の窓口。上限1分60回）
├── kick.ts                     Kick の公開 API との通信（唯一の窓口）
├── platforms.ts                配信元の台帳（名前・URL・サムネ・日本の判定など。API や DB を読まない）
├── platform-loaders.ts         配信元ごとの読み取りの振り分け（アイコン・統合ページの中身・ライブランキング）
├── platform-content.ts         統合ページの共通の型（PlatformContent など）。処理は書かない
├── rising.ts                   急上昇（24時間前との比較。全配信元で1つの SQL）
├── game-buzz.ts                いま話題のゲーム（配信で急増・Steam/Roblox/App Store の急上昇と初登場。24時間前と比べる。1時間作り置き）
├── creators.ts                 人物とアカウントのDB読み取り、各libへの振り分け
├── daily-stats.ts              日ごとの集計（まとめる・古い記録を消す）
├── daily.ts                    日付ごとのまとめページのデータ（日本の配信者に絞る JAPAN_FILTER もここ）
├── streamer-list.ts            配信者タブの一覧（並び替え）と検索
├── stats-extras.ts             配信者ページの追加情報（時間帯・同じゲームの人・選んだ日の配信）を3ページ共通で取る
├── og.tsx                      OGP 画像の共通部品（日本語フォントの取得・ロゴ・枠）
├── play.ts                     ゲームの人数の記録と読み取り（Steam・Roblox 共通。play_titles / play_snapshots）
├── steam.ts                    Steam の人数の収集（鍵なしの公開 API）と、Twitch のゲームへの結び付け（IGDB 経由）
├── roblox.ts                   Roblox の人数の収集（公式に案内されていない公開の窓口）
├── appstore.ts                 App Store の日本のゲームのランキング（Apple 公式の RSS を読み解いて保存・DB から読む）
├── bluesky.ts                  Bluesky への投稿（朝8時に前日のまとめ、12・18・21時にいま見られている配信）
├── account-stats.ts            アカウントの直近30日の統計（daily_stats と、ゲームは毎時の記録から）
├── snapshot-range.ts           live_snapshots を時刻の範囲で絞る部品、日本時間の日付
└── db.ts                       Turso接続（読み書き共通の1関数）と、大量書き込みを500件ずつに分ける部品
scripts/
├── db-migrate.mjs              npm run db:migrate（2026-10 以降に足した表を作る。何度実行しても安全）
├── test-cron.mjs               ローカル/本番のcronエンドポイントを手軽に叩くテスト用スクリプト
├── links-probe.mjs             Twitchのloginをハンドル(@xxx)として引く（1人1ユニット）
├── links-kick.mjs              Kick の候補（Twitch の login・ツイキャスの ID と同じ名前）を集め、Kick で配信しているかで判定
├── links-twitcasting.mjs       Twitchのloginをツイキャスの ID として引き、判定つきで一覧（1人1回・1.1秒間隔）
├── name-match.mjs              名前の似ている度合い（links:review と links:twitcasting で共用）
├── suggest-links.mjs           名寄せ候補をYouTube検索で集める（1人100ユニット）
├── links-review.mjs            候補を根拠つきで判定して一覧（50件1ユニット）
├── links-confirm.mjs           候補を確定・却下して紐付ける
├── links-undo.mjs              確定を取り消して pending に戻す
├── links-add.mjs               URL直指定で手動紐付け（channels.list 1ユニット）
├── links-rename.mjs            creatorの表示名を直す
└── link-core.mjs               紐付け処理の共通部品（confirm / add で共用）
cron-worker/                    毎時の収集・毎日の集計のAPIを呼ぶだけの Worker（Cron Triggers。サイトとは別にデプロイ）
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

**毎時の記録は90日だけ残し、それより前は日ごとの集計だけにする。**
`daily_stats`（アカウント×日本時間の日で1行：最高・平均同接、配信時間、一番遊んだゲーム）を
毎日 `cron/daily` が作り、その後で90日より古い `live_snapshots` を消す。
必ず「まとめてから消す」順で、集計が消す範囲まで済んでいなければ消さない（`lib/daily-stats.ts`）。
毎朝の集計が動かない日があった（2026-10-11。手動では正常に終わった）ので、毎時の Twitch の収集が
「昨日の分が無ければまとめる」保険も持っている（`rollupIfBehind`。あれば何もしない）。
配信者ページの統計は本人アカウントだけで出す（切り抜きの同接は本人の数字ではないため）。
名寄せ済みの人は、配信時間が一番長いアカウントで数字とグラフを出し、プラットフォームごとの比較表を添える。
グラフの棒を押すと `?day=日付` 付きの URL になり、サーバーがその日の配信をグラフの下に出す（JavaScript なし）。
90日を過ぎると毎時の記録が消えるので、`daily_stats` に「その日一番長く配信した1本」のタイトルと
YouTube の動画ID（`main_title` / `main_content_id`）を残している。全部の配信を残すと1年で数百MBになるため1本に絞った。
Twitch のアーカイブは Twitch 側で7〜60日で消えるので、リンクは残さずタイトルだけにしている。
日ごとの集計に列を足したら `npm run db:migrate` の後、`/api/cron/daily?from=日付` でその日からまとめ直せる。
配信者の統計やグラフは `daily_stats` から読む（読む行数が毎時の記録の数分の一で済む）。
間引き（古い毎時の記録を一部だけ残す）にしなかったのは、統計に必要な値は集計に全部あり、
残しても使い道が無いため。

**分析の対象は名寄せと切り離す。** 名寄せは同じ人の複数アカウントを1ページにまとめる役で、
同接・配信時間などの統計はアカウント単位で全員分を出す。そのため収集は広く取っている：

- Twitch：全世界の上位800配信 ＋ 日本語の配信は10人以上を全部（`getJapaneseStreams`。
  日本時間22時台で約1,600配信・API約20回。Twitch API の上限は1分800回で余裕がある）
  ＋ それでも漏れた名寄せ済みの人を `streams?user_id=` で直接
- YouTube：キーワード検索（新しい配信者を見つける入口）＋ 監視リスト（`youtube_watch`）の
  RSS。日本向けの検索で2日以上見つかり、30日以内に配信したチャンネルと、
  名寄せ済みの本人チャンネルが対象（2026-10 時点で約1,200）。新人も自動で入る
- ツイキャス：「おすすめ」の上位100件（日本語）＋ 名寄せ済みの人を `current_live` で直接（毎時48分）。
  2026-10-11 にカテゴリ72個を全部読んで比べたところ、同接30人以上の49件はすべておすすめに入っていた
  （10人以上だと112件中79件）。API の上限が1分60回と小さいので、カテゴリを毎時全部読むことはしていない。
  アイコンは表示のたびに API を呼ぶと上限に響くので、収集のついでに `accounts.icon_url` に残している
  （アイコンを DB に持つのはツイキャスだけ）。サムネイルは鍵なしの URL（`/users/<id>/live/thumbnail`）。
  ツイキャスの「カテゴリ」は配信者が選ぶ大まかな分類（約7割が「一般ゲーム」）で、どのゲームかが分からないので、
  ゲームのランキングには入れていない
- Kick：日本語の上位100件（視聴者順なので同接10人以上は全部入る。2026-10-11 の実測で10人以上58件・最高1.1万人）
  ＋ 全世界の上位100件 ＋ 名寄せ済みの人を `channels` で直接（毎時13分）。**除外・フィルターはかけない**（オーナーの決定。
  除外の理由づけが難しく、そのままのランキングの方が価値があるため）。Kick には日本語の表示名が無く、名前は英数字のユーザー名。
  カテゴリ名を Twitch のゲームに名前で結び付けて `game_id` に入れる（`getGamesByNames`。括弧の補足を外しても探す。
  2026-10-11 の実測で視聴者の92%が結べた）。日本の Kick は視聴者の約9割が Just Chatting と IRL（ゲームではない）。
  サムネイルの URL の一部（配信ごとのID）を `content_id` に残し、急上昇などであとから同じサムネイルを出す。
  ゲームの詳細ページは Twitch と Kick の配信を混ぜて並べる（Kick の一覧は5分作り置きの1回分を使い回す）。
  名寄せは、Twitch の上位とは別の人たちが多い（同じ名前の Kick を持つ名寄せ済みの38人は、Kick で配信していなかった）

毎時の書き込みは2,000行を超えるので、名前などが前回と同じならアカウントを上書きしない
（UPSERT の末尾の `WHERE ... IS NOT excluded...`）。Turso の書き込み枠は月1,000万行。

**読み取り枠（月5億行）は「読んだ行数」で数える。** 2026-10-14 に半月で75%を使った。原因は、
SQLite が表の統計（`ANALYZE`）を持たず、意図と違う順で読んでいたこと（急上昇1回で15万行など）。
`ANALYZE` は全部の SQL の読み方が一度に変わり、事前に確かめられないのでしていない。代わりに SQL で指示する：

- `live_snapshots` と `accounts` の結合は `CROSS JOIN`（SQLite では「左の表から読め」）。普通の JOIN だと
  「その配信元のアカウント（Twitch は2万人以上）を1人ずつ見に行く」順を選ぶ
- 索引を選び間違えるときは `INDEXED BY 索引名`（この索引で読め）、索引を使わせたくない列は `+列名`
- `MIN(x), MAX(x)` を1つの SELECT に並べると全行を読む。`(SELECT MIN…), (SELECT MAX…)` に分ける
- 索引を足したら、同じ表のほかの SQL が新しい索引に乗り換えて悪化していないかも測る
  （`youtube_video_checks` で実際に 1,000行 → 2万行になった）

1回の SQL が何行読んだかは、Turso の HTTP API（`/v2/pipeline`）の返事の `rows_read` で分かる
（`@libsql/client` は返さない）。結果が変わらないかと合わせて、直す前後で必ず測る。

使用量は Turso のダッシュボード（app.turso.tech）の Billing と左下の Usage で見る。DB ごとの読み取りは Databases の一覧。
請求期間は毎月1日から。無料プランは1つでも上限に当たると**組織全体（ヨルシカも）が止まる**ので、
2026-10-15 に Developer プラン（月$5.99＋税、読み取り月25億行、超過料金オフ）に変えた。初回は月末までの日割り。
D1 に移したら戻す。月の途中で無料に戻すとその月の読み取りはそのまま数えられるので、5億行に近い月に戻すと止まる。
（Turso の CLI は Windows では WSL が必要なので入れていない）

毎時の記録から作る結果は、`unstable_cache` の鍵に「その配信元の収集の回」（`captureHour`。台帳の
`snapshotMinute` = 収集の分）を入れて、1時間に1回だけ読む。日ごとの集計から作る結果は「集計がある最新の日」を鍵に入れる。

**作り置き（`unstable_cache`）はデプロイのたびに全部消える。** OpenNext が R2 に置く作り置きの名前に
ビルドの番号が入っているため（`prefix/buildId/hash`）。push するたびに、ボットの巡回で重い集計が作り直される
（2026-10-16 の Turso の Top Queries で、日付ページのまとめが11時間に16回・約270万行）。対策は2つ：

- 文書だけの変更ではビルドしない。Cloudflare の Worker `stream-trends` → Settings → Build →
  **Build watch paths** を Include `*` / Exclude `*.md` にしてある（`.md` しか変わらない push はビルドしない）
- 内容がもう変わらない結果は DB に保存する。日付ページのまとめは、2日前より前の日を `daily_summaries`
  （JSON で1日1行）に保存し、ページは1行読むだけ（約32万行 → 1行）。保存は毎朝の `cron/daily` が
  まだ無い日を新しい順に10日ずつやる（ページからは書かない）。まとめの形を変えたら `lib/daily.ts` の
  `SUMMARY_VERSION` を上げる（古い形の行は読まずに作り直される）。`?from=` でまとめ直すと、その日以降の保存も消える

Turso のダッシュボードの **Top Queries**（DB → Top Queries）で、本番でどの SQL が何回・何行読んだかを見られる。
「Rank by」で回数や合計時間の順にも並べ替えられる。読み取りが増えたら、まずここを見る。

**配信元ごとの違いは「台帳」に集め、ページに `platform === "twitch" ? … : …` を書かない。**
以前はトップ・急上昇・日付のまとめ・配信者一覧など19ファイルに分かれ道が散らばっていて、
配信元を1つ足すたびに10か所以上を直す必要があった（2026-10-11 に整理）。

- `lib/platforms.ts`：名前・サイト内のページのURL・配信のURL・サムネイル・「日本の配信」の SQL・
  急上昇の設定など、API や DB を読まない情報。`PLATFORMS[platform].label` のように引く
- `lib/platform-loaders.ts`：アイコン・統合ページの中身・ライブランキングを、配信元ごとの lib に振り分ける
- `components/PlatformIcons.tsx` の `PlatformIcon`、`components/PlatformFilter.tsx`（すべて/Twitch/YouTube/… のボタン）
- 急上昇は `lib/rising.ts` の1つの SQL を配信元ごとに呼ぶ（設定の違いは台帳の `rising`）

どれも `Record<PlatformId, …>` なので、`PLATFORM_IDS` に配信元を足すと、書き忘れた所が型チェックで止まる。
配信元を足す手順：`PLATFORM_IDS` に足す → 型チェックで止まった所（台帳・LOADERS・アイコン）を埋める →
`lib/<配信元>.ts` に収集と読み取りを書く → cron を足す。ページは触らない。
統合ページの中身は `lib/platform-content.ts` の `PlatformContent` という共通の形で返す。
Twitch だけの機能（その日のアーカイブとクリップ）のように、配信元に固有のものは分かれ道のままでよい。

YouTubeは Twitch と仕組みが違う。「今ライブ中の一覧」を取る `search.list` は
キーワード（`q`）が実質必須で、地域・カテゴリだけでは0件になる。1回100ユニット
と高コストなため（無料枠は1日10,000ユニット。太平洋時間0時＝日本時間16時に
リセット）、日本語2キーワード＋全世界1
キーワードを時刻でローテーションする方式にしている（`lib/youtube.ts` の
`JP_LIVE_KEYWORDS` / `GLOBAL_LIVE_KEYWORDS` / `pickKeyword`）。`videos.list` は
一度に指定できる動画IDが50件までなので分割して呼ぶ。

キーワード検索だけでは同じ配信者を毎時拾えない（2026-10 の実測で、YouTube 本人アカウントを
持つ名寄せ済み93人のうち記録があったのは5人）。そこで監視リストのチャンネルは
RSS（チャンネルごとの最新15本の動画一覧。公開ファイルなので枠を使わない）から直近7日の
動画IDを集め、`videos.list` で配信中か確かめている（`getRecentVideoIdsFromFeeds` / `checkVideos`）。
7日にしているのは、予約枠を前もって作る配信者がいて、配信中でも公開日時が最大5日前だったため。
一度確かめて「普通の動画・配信終了」だった動画は `youtube_video_checks` に覚え、二度と確かめない
（配信のたびに新しい動画IDが振られるので、新しい配信は必ず「初めて見るID」になる）。
覚えないと毎時8,000本以上を確かめることになり、それだけで1日の枠を超える。
RSS は Cloudflare の同時接続の上限（6本）に合わせて6件ずつ読む。2026-10 に Cloudflare 上で
783チャンネルを2回続けて読み、全件成功・約30秒だった。ただし YouTube の RSS は不安定な時期があり、2026-10-11 には Cloudflare からも自宅からも
大半が 404 / 500 だった（読み直しても戻りは小さく、他の開発者からも同じ報告がある）。
そのため「配信予定・配信中」と分かった動画は、RSS に載っていなくても毎時確かめる。
返り値の `feed_failed_by_status` が 429 / 403 なら弾かれている、404 / 500 なら YouTube 側の不調。
cron は `?dryRun=1` を付けると保存せずに件数だけ返す（`npm run test:cron -- "snapshot?dryRun=1"`）。

YouTubeの1日の枠の配分。cronはサイトの本体機能なので最優先で確保する。

```
10,000  1日の無料枠
-7,600  cron（毎時 検索300 + videos.list 約15 × 24回。見込みなので実測で直す）
──────
 2,400  名寄せなどに自由に使える分
```

videos.list の回数は、監視リストの人数と「配信予定・配信中」の動画の数で増える。

名寄せを回すときはこの2,400を超えないこと。超えるとcronが落ちて
ランキングのデータが欠ける。作業は日をまたいで分割する。
ヨルシカのサイトとは 2026-10-11 に Google Cloud のプロジェクトごと分けた（枠はプロジェクト単位。
同じプロジェクトでキーを2本作っても枠は共有のまま）。片方の使いすぎでもう片方が止まらないようにするため。

定期実行は Cloudflare の Cron Triggers（`cron-worker/`）から収集APIを叩く。
以前は GitHub Actions の schedule だったが、混雑時に実行が飛ばされ、毎時の
はずが実際は4〜6時間おきだった（2026-10 に実行履歴とDBで確認）。Cron Triggers は
時刻どおりに動く。`cron-worker` は転送(3xx)を失敗として扱う（転送を追わずに
「成功したのに保存されない」状態になるのを防ぐ）。GitHub Actions の2つの
ワークフローは手動実行用にだけ残してある。

トップ・急上昇・各詳細ページは `searchParams` / `params` を読むため `ƒ`（表示のたびに
組み立てる）。外部APIの返事は fetch の `next.revalidate` で R2 に作り置きされる。
`/games` は `○`（ビルド時に作り、5分ごとに作り直す）。
作り直しは OpenNext のキュー（`open-next.config.ts` の `memoryQueue`）が行う。指定しないと何もしないキューになり、
○ のページがデプロイした時の中身のまま止まる（2026-10-11 まで実際に止まっていた）。`/creators` は検索と並び替えで `ƒ` になったので、
一覧の結果を `unstable_cache` で5分作り置きしている（7日分の集計を毎回読まないため）。`/sitemap.xml` も `○` だが1日1回
（配信者の上位を日ごとの集計14日分から選ぶので、1時間ごとだと読み取り枠を使いすぎる）。
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

配信者のリンク先はすべてサイト内にする（名寄せ済み→`/creators/[id]`、それ以外→Twitch は
`/streamers/[login]`、YouTube は `/youtube/[channelId]`）。YouTube チャンネルのページは
**YouTube API をアイコンの1回（1日作り置き）しか使わず、DB の記録だけで作る**。sitemap に載せて
検索エンジンに巡回されるので、表示のたびに API を呼ぶと1日の枠を使い切るため。
記録に無いチャンネルIDは404にし、名寄せ済みのチャンネルは統合ページへ転送する。

OGP 画像（SNS に URL を貼ったときのカード）は `next/og` で作る。日本語フォントが入っていないので、
Google Fonts から**画像に使う文字だけを切り出したフォント**（ttf・10KB前後）を取ってくる（`lib/og.tsx`）。
ブラウザらしい User-Agent を付けないと ttf が返る性質を使っている。`npm run preview`（workerd）でも動くことを確認済み。
日付ページの画像（`getDailyHeadline`、上位3人と人数）は、まとめ（`getDailySummary`）から取り出す。
以前は画像用に別の SQL を流していた（1回約6万行）が、まとめと同じ SQL だったため。終わった日は `daily_summaries` の1行を読むだけ。
日付ページは「日本の配信者」に絞る（Twitch は日本語、YouTube は監視リスト、名寄せ済み）。
全世界の上位800配信も記録しているので、絞らないと英語圏の大物で埋まるため。

ゲームを「遊んでいる人数」は、配信と同じく「マスタ（`play_titles`）＋毎時の記録（`play_snapshots`）」で持つ
（Steam 上位100本・Roblox 上位約100本。毎時8分に `cron/play-snapshot`。90日で消す）。
90日より前の推移は、毎朝の集計で作る `play_daily`（ゲーム×日：最高・平均の人数、一番良かった順位）から読む。
Steam の画像は毎日マスタを更新するときに取り直す。ストアに画像が無いゲームは Twitch のパッケージ画像で代わりにする。
名前・画像・Twitch との対応はマスタに1日1回だけ更新し、ページは DB から読む。
Steam の画像は昔の決まったURL（capsule_184x69.jpg）だと新しいゲームが404になるので、ストアの API が返すURLを使う。
「日本で◯人が配信中」は Twitch API でゲームごとに数える（DB の毎時の記録は10人以上の配信だけで、ゲームのページより少なく出ていた）。
Steam のランキング（`lib/steam.ts`）は鍵なしの公開 API。Steam のゲームを Twitch のゲームに結び付けるのは
Steam のID → IGDB（external_games、Steam は external_game_source = 1）→ Twitch（igdb_id）。上位100のうち86本が結べた。
Twitch 側の Counter-Strike と Dota 2 は IGDB の ID が空なので手で対応を書いている（`STEAM_TO_TWITCH`）。
同じ理由で、この2本は「IGDB の ID が空＝ゲームではない分類」の判定からも例外にしている（`isRealGame`）。
以前はこの判定でゲームランキングから抜け落ちていた。Twitch の視聴者数はゲームごとに上位100配信を数える
（複数のゲームをまとめて聞くと、小さな配信の多いゲームが3分の1ほどしか数えられなかった）。

App Store の順位は、Apple が Cloudflare のサーバーからの RSS の読み取りを不安定に拒否する
（2026-10-11。ブラウザの User-Agent を付けても通ったり通らなかったり）ため、GitHub Actions
（`.github/workflows/appstore.yml`）が GitHub の回線で RSS を取り、`/api/cron/appstore` に
POST で送って保存する。保存先は Steam・Roblox と同じ `play_titles` / `play_snapshots`
（platform は `appstore_grossing` / `appstore_free`、人数は NULL で順位だけ、開発元は `play_titles.developer`）。
ワークフローは cron-worker が毎時8分に GitHub の API（workflow_dispatch）で動かす。GitHub 自身の schedule は
4〜5時間おきにしか動かなかったので外した。鍵は cron-worker の Secret `GITHUB_TOKEN`（Actions の読み書きだけ・
game-trends だけに使える。期限 2027-10-12。切れたら作り直して入れ直す。無いあいだは App Store の収集が止まる）。
ページは12時間以内の記録なら出す。
サイトの URL は Secret ではなく workflow に直接書いた（GitHub の `SITE_URL` は旧 Vercel のままかもしれないため）。

ゲームの画像はプラットフォームをまたいで URL だけ持ち、毎日マスタで上書きする（画像ファイルは保存しない）。
Steam のストアに画像が無いゲームは Twitch のパッケージ画像で代わりにしている。

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

サイトのアイコンは `design/icon.svg`（角丸の四角の中に輪と再生ボタン。2026-10-11 に決定）。
以前の「動画の枠の中で伸びる折れ線」は分析寄りに見えたので、主役の「配信を見る」を表す形にした。
絵を変えたら `npm run make:icons` で `app/icon.svg`・`favicon.ico`・`apple-icon.png` を作り直す。

見出しは `PageHeader` を使い、全ページで形をそろえる。
PC は「配信元の丸ボタン（左）／地域とカード・リスト（右）」を1行に並べる。スマホは上に固定する行を配信元だけに使い
（このサイトの主役なので全部見えるように）、地域とカード・リストはその下の固定しない行に置く。見出しは日本語（ライブランキング /
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

ライブランキングは「カード」と「リスト」を切り替えられる（`?view=list`。リストは小さなサムネと大きな同接数で100件）。
既存の同接ランキングサイトのような一覧の需要に応えつつ、ナビは増やさない（スマホの下のタブは4つで満杯のため）。
切り替えはアイコンだけ（ViewToggle）。重要度が地域より低いので目立たせない。

ゲームの総合ページの「いま話題のゲーム」は、総合にだけ置く（各タブはランキングだけ見たい人の場所なので足さない）。
高さは1列ぶん、スマホは横に送る帯。条件を満たすものが無い時間は枠ごと出さない（小さな動きで埋めない）。
比べるのは24時間前（同じ時刻）だけ。6時間前や18時間前と比べると、時間帯の違い（全世界の人数の1日の波、
日本の深夜と夜のゲームの顔ぶれ）を急上昇と見てしまった（2026-10-11 に試して確認）。
配信の急増は「人数」ではなく「全体に占める割合」で比べ、24時間前の記録の件数がいまの半分未満なら比べない
（記録の取りこぼしや記録の範囲を広げる前の時間と比べて、Apex を「配信が始まった」と誤って出したことがある）。

配信者の検索欄は、打つと候補が出て Enter で検索結果へ。候補は上位2,000人の一覧を最初に1回だけ読み、
絞り込みはブラウザでやる。打つたびにサーバーへ聞くと、1文字ごとにアカウントの表（2万行以上）を全部読むため
（`LIKE %…%` は索引が使えない）。

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
TWITCASTING_CLIENT_ID      ツイキャスのアプリ（https://twitcasting.tv/developer.php。Read only）
TWITCASTING_CLIENT_SECRET
KICK_CLIENT_ID             Kick のアプリ（https://kick.com/settings/developer。アプリ名は英数字のみ・2段階認証が必要）
KICK_CLIENT_SECRET
BLUESKY_HANDLE         Bluesky のボット（stream-trends.bsky.social）。Worker の Secret のみ
BLUESKY_APP_PASSWORD   ボット用のアプリパスワード（本パスワードではない）。Worker の Secret のみ
CRON_SECRET
```

本番の値は Cloudflare の Worker の Secret に置く。`.env.local` を変えたら、
プロジェクトのフォルダで `npx wrangler secret bulk .env.local` を実行すれば
まとめて反映される（値は表示されない。Secret の変更は即時反映でビルド不要）。
`cron-worker` には `CRON_SECRET` だけを、`cron-worker` フォルダで
`npx wrangler secret put CRON_SECRET` で入れる（フォルダを間違えるとサイト側に入る）。
GitHub Secrets（`CRON_SECRET` / `SITE_URL`）は手動実行のワークフロー用。
`BLUESKY_*` は手元から誤って投稿しないよう `.env.local` に入れず、`npx wrangler secret put BLUESKY_HANDLE` のように
個別に入れる（ヨルシカと同じ）。無いあいだは投稿しない。入れた後は
`npm run test:cron -- "bluesky?kind=live&dryRun=1" https://stream-trends.sukinote.com` で文面とログインだけ確かめられる。
投稿は cron-worker が呼ぶ時刻で決まる（日本時間8時：前日のまとめ、12・18・21時：いま見られている配信）。
12・18・21時は日本の配信の視聴者数を実測して決めた（2026-10-11、土日の1日分。1週間ほどたまったら見直す）。
同じ回は `bsky_posts`（day 列に日付か live-日付-時 が入る）を見て二重に投稿しない。
ハンドルは末尾まで必要（stream-trends.bsky.social）。「.」が無ければコードで .bsky.social を補う。

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
8. npm run links:twitcasting -- 50              ツイキャスの候補（Twitch の login と同じ ID）を集めて判定
9. npm run links:kick                            Kick の候補（Twitch の login・ツイキャスの ID と同じ名前）を集めて判定
                                                 確定は links:confirm（YouTube と共通）
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

名寄せ済みのアカウントの一覧は1時間作り置きしている（`lib/creators.ts` の `getLinkedAccounts`）ので、
確定・取り消しがトップや急上昇のリンクに出るまで最大1時間かかる。

`links:undo` は、配信履歴（`live_snapshots`）を持つアカウント行は削除せず
紐付けだけ外す。cronが集めた履歴を失わないため。

## 今後の予定

1. ~~前日比・急上昇の実装~~ 実装済み（`/trending`）
2. ~~ツイキャス統合~~ 2026-10-11 に実装（収集・ライブ・急上昇・配信者ページ・名寄せ）
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
8. ~~保存データの間引き~~ 日ごとの集計（`daily_stats`）を作り、毎時の記録は90日で消す形にした
   （日本語の配信を全部記録するようになり、量が約3倍になったため早めに入れた）
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
