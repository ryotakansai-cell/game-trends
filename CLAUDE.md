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
├── games/page.tsx              ゲームランキング（Twitchのみ。YouTube側にゲーム判定が無いため）
├── games/[id]/page.tsx         ゲーム詳細（配信者一覧 + 外部リンク）
├── streamers/[login]/page.tsx  配信者ページ（クリップ・アーカイブ）
└── api/
    ├── twitch/route.ts               動作確認用のJSONエンドポイント
    ├── cron/snapshot/route.ts        Twitch: 毎時DBに保存（games/snapshots、streamers/streamer_snapshots）
    └── cron/youtube-snapshot/route.ts YouTube: 毎時DBに保存（youtube_streamers/youtube_live_snapshots）
lib/
├── twitch.ts                   Twitch APIとの通信（唯一の窓口）
├── youtube.ts                  YouTube Data API v3との通信 + DBからのランキング読み取り
└── db.ts                       Turso接続（読み書き共通の1関数のみ。RLS相当の分離は不要）
scripts/
└── test-cron.mjs               ローカル/本番のcronエンドポイントを手軽に叩くテスト用スクリプト
```

## 設計上の決定と、その理由

外部API通信は必ず `lib/twitch.ts` / `lib/youtube.ts` を経由する。ページから直接fetchしない。

DBは正規化してある。プラットフォームごとに「マスタ」（`games`/`streamers`/
`youtube_streamers`）と「1時間ごとの履歴」（`snapshots`/`streamer_snapshots`/
`youtube_live_snapshots`）に分離。名前や画像URLを毎時間保存するのは冗長なため。

DBはSupabase(PostgreSQL)からTurso(libSQL)に移行済み。無料枠の容量
（Supabase 500MB → Turso 5GB）と、複数プラットフォームのスナップショットが
増える見込みを踏まえた判断。読み取り/書き込みクライアントの分離もやめた
（ページからDBを直接読む場面が無く、RLS前提の分離が最初から不要だった）。

プラットフォームごとに専用テーブルを持つ設計（`streamers`系/`youtube_streamers`系
が独立）。`platform` 列で1つのスキーマに統合する案もあるが、複数プラットフォーム
が実際に揃ってから安全に移行する方針で、今はまだ着手していない。

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

## 今後の予定

1. 前日比・急上昇の実装（`snapshots`系テーブルを活用。まだ着手していない）
2. ツイキャス統合（公式APIあり、Twitchと近い形で取得できる見込み）
3. Kick統合は保留（迷惑系配信者の存在が気になり、優先度を下げた）
4. `platform` 列によるスキーマ統合＋プラットフォーム横断の総合ランキング
5. `creators`/`creator_accounts` によるクロスプラットフォームの名寄せ
   （配信者本人のbio欄やlinktree的ページのヒントを参考に、最終確認は手動）
6. YouTubeの配信者手動登録（キーワード検索で拾えない配信者向けの補完）

## 方針

Twitch単体では本家に機能で勝てない。
**複数プラットフォームの横断**と**履歴データによる前日比**で差別化する。
