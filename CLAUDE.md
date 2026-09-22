@AGENTS.md

# game-trends

Twitch・YouTube Liveの配信ランキングサイト。将来的に他プラットフォームも統合予定。

- 本番: https://game-trends-psi.vercel.app
- リポジトリ: https://github.com/ryotakansai-cell/game-trends

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
| ホスティング   | Vercel (Hobbyプラン)                  |
| 定期実行       | GitHub Actions                        |
| 外部API        | Twitch Helix API、YouTube Data API v3 |

## ディレクトリ構成

```
app/
├── page.tsx                    トップ（Live Ranking。Twitch/YouTube統合 + プラットフォーム/地域タブ）
├── trending/page.tsx           急上昇（24時間前との比較。JP/Globalタブ）
├── creators/page.tsx           クリエイター一覧（名寄せ済みの人物）
├── creators/[id]/page.tsx      クリエイター統合ページ（全プラットフォームを1ページに）
├── games/page.tsx              ゲームランキング（Twitchのみ。YouTube側にゲーム判定が無いため）
├── games/[id]/page.tsx         ゲーム詳細（配信者一覧 + 外部リンク）
├── streamers/[login]/page.tsx  配信者ページ（Twitch単体。クリップ・アーカイブ）
└── api/
    ├── twitch/route.ts               動作確認用のJSONエンドポイント
    ├── cron/snapshot/route.ts        Twitch: 毎時DBに保存（games/snapshots、accounts/live_snapshots）
    └── cron/youtube-snapshot/route.ts YouTube: 毎時DBに保存（accounts/live_snapshots）
components/
└── SegmentedTabs.tsx           JP/Global などのタブUI（3ページで共用）
lib/
├── twitch.ts                   Twitch APIとの通信（唯一の窓口）
├── youtube.ts                  YouTube Data API v3との通信 + DBからのランキング読み取り
├── platform.ts                 プラットフォーム共通の型（PlatformContent など）。処理は書かない
├── creators.ts                 人物とアカウントのDB読み取り、各libへの振り分け
└── db.ts                       Turso接続（読み書き共通の1関数のみ。RLS相当の分離は不要）
scripts/
├── test-cron.mjs               ローカル/本番のcronエンドポイントを手軽に叩くテスト用スクリプト
├── suggest-links.mjs           名寄せ候補をYouTube検索で集める（1人100ユニット）
├── links-review.mjs            候補の一覧（API不使用。何度実行してもタダ）
├── links-confirm.mjs           候補を確定・却下して紐付ける
├── links-add.mjs               URL直指定で手動紐付け（channels.list 1ユニット）
├── links-rename.mjs            creatorの表示名を直す
└── link-core.mjs               紐付け処理の共通部品（confirmとaddで共用）
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
と高コストなため（無料枠は1日10,000ユニット）、日本語2キーワード＋全世界1
キーワードを時刻でローテーションする方式にしている（`lib/youtube.ts` の
`JP_LIVE_KEYWORDS` / `GLOBAL_LIVE_KEYWORDS` / `pickKeyword`）。`videos.list` は
一度に指定できる動画IDが50件までなので分割して呼ぶ。

定期実行はVercel CronではなくGitHub Actionsを使う。
Vercel Hobbyプランのcronは1日1回しか実行できないため。

`page.tsx` から自分のAPIルートをfetchしない。Server Componentなので
`lib/` の関数を直接呼ぶ。トップページはTwitch（API直叩き）とYouTube
（DB読み取り）の両方を呼び、`UnifiedEntry` という共通の形に変換して
から視聴者数でソートする（`app/page.tsx`）。YouTube側だけ例外的に
DBを直接読む（Twitchと違い、表示のたびにAPIを叩けないため）。

配信者アイコンは表示時にその場で取得し、DBには保存しない
（Twitchの`getUsersByLogin`、YouTubeの`getChannelIcons`とも同じ方針）。

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

変更時は `.env.local` / Vercel / GitHub Secrets の3箇所を更新し、
**Vercelは必ずRedeployする**（環境変数はビルド時に読まれるため）。
※ `YOUTUBE_API_KEY` / `TURSO_*` はcronの中でVercel上でのみ使われるため、
GitHub Secretsへの追加は不要（GitHub Actions自身はSITE_URLをcurlで
叩くだけで、DBやAPIキーには触れない）。

## 名寄せ（クロスプラットフォームの人物統合）の手順

機械が候補を集め、人間が目視で確認してから確定する半自動方式。
自動で紐付けないのは、名前検索は当たり外れがあり、間違った紐付けが
そのまま本番に出てしまうため。

```
1. npm run suggest-links -- 20                  候補を集める（1人100ユニット）
2. npm run links:review                         候補を目視で確認（API不使用）
3. npm run links:confirm -- 4 5:clip 9:reject   確定・却下する
4. npm run links:add -- <login> <YouTubeのURL>  検索で出ない人を手動登録
5. npm run links:rename -- <creator_id> <名前>  creatorの表示名を直す
```

却下（rejected）も `link_candidates` に記録として残す。削除すると
`suggest-links` が次回また同じ人を検索してクォータを無駄にするため。

名前検索の限界：Twitchの表示名をそのまま検索語にしているので、
伏字（例:「加藤純一うん〇ちゃん」）・別名・ローマ字表記の人は当たらない。
そこは `links:add` で手で埋める前提。

## 今後の予定

1. ~~前日比・急上昇の実装~~ 実装済み（`/trending`）
2. ツイキャス統合（公式APIあり、Twitchと近い形で取得できる見込み）← 次の本命
3. Kick統合は保留（迷惑系配信者の存在が気になり、優先度を下げた）
4. ~~`platform` 列によるスキーマ統合~~ 実装済み
   （プラットフォーム横断の総合ランキングは `app/page.tsx` で実現済み）
5. ~~クロスプラットフォームの名寄せ~~ 半自動の仕組みを実装済み。
   bio欄やlinktreeからの候補収集（`source=bio_link`）は未着手。
   調査したところTwitchのプロフィールにURLを書いている人は50人中5人しかおらず、
   リンクはAPIで取れないPanelsに置かれているため、優先度は低い
6. ~~YouTubeの配信者手動登録~~ `links:add` で実装済み
7. 旧テーブル（`streamers`系/`youtube_streamers`系）の削除（移行が安定したら）
8. 保存データの間引き（1年以上前は日次の代表値だけ残す）

## 方針

Twitch単体では本家に機能で勝てない。
**複数プラットフォームの横断**と**履歴データによる前日比**で差別化する。
