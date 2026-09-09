@AGENTS.md

# game-trends

Twitchの配信ランキングサイト。将来的にKick・YouTubeも統合予定。

- 本番: https://game-trends-psi.vercel.app
- リポジトリ: https://github.com/ryotakansai-cell/game-trends

## 作者について

- 業務ではC#とBlazorを使用。JavaScript/TypeScriptは学習中。
- **コードを提案するときは、何をしているかを日本語で説明すること。**
- C#との対比があると理解しやすい（例: `Map` は `Dictionary`、`.filter()` は `.Where()`）。
- 目的は「動くものを作ること」と「転職時に説明できる技術力をつけること」の両方。

## 技術構成

| 領域           | 使用技術                |
| -------------- | ----------------------- |
| フレームワーク | Next.js 16 (App Router) |
| 言語           | TypeScript              |
| スタイル       | Tailwind CSS v4         |
| DB             | Supabase (PostgreSQL)   |
| ホスティング   | Vercel (Hobbyプラン)    |
| 定期実行       | GitHub Actions          |
| 外部API        | Twitch Helix API        |

## ディレクトリ構成

```
app/
├── page.tsx                    トップ（配信ランキング / 言語切替）
├── games/page.tsx              ゲームランキング
├── games/[id]/page.tsx         ゲーム詳細（配信者一覧 + 外部リンク）
├── streamers/[login]/page.tsx  配信者ページ（クリップ・アーカイブ）
└── api/
    ├── twitch/route.ts         動作確認用のJSONエンドポイント
    └── cron/snapshot/route.ts  定期実行でDBに保存
lib/
├── twitch.ts                   Twitch APIとの通信（唯一の窓口）
└── supabase.ts                 DB接続（読み取り用 / 書き込み用）
```

## 設計上の決定と、その理由

外部API通信は必ず `lib/twitch.ts` を経由する。ページから直接fetchしない。

DBは正規化してある。`games`（マスタ）と `snapshots`（1時間ごとの履歴）に分離。
ゲーム名や画像URLを毎時間保存するのは冗長なため。

RLSは読み取りのみ許可。書き込みポリシーは意図的に作っていない。
書き込みは `createWriteClient()`（Secretキー）からのみ可能。

定期実行はVercel CronではなくGitHub Actionsを使う。
Vercel Hobbyプランのcronは1日1回しか実行できないため。

`page.tsx` から自分のAPIルートをfetchしない。Server Componentなので
`lib/` の関数を直接呼ぶ。

## 禁止事項

- `.env.local` を読まない、内容を出力しない、コミットしない
- `createWriteClient()` を `page.tsx` やクライアントコンポーネントで使わない
- 環境変数に `NEXT_PUBLIC_` を付けるのは公開してよい値のみ

## 環境変数

```
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
CRON_SECRET
```

変更時は `.env.local` / Vercel / GitHub Secrets の3箇所を更新し、
**Vercelは必ずRedeployする**（環境変数はビルド時に読まれるため）。

## 今後の予定

1. スマホ表示の最適化（モバイルファースト）
2. 前日比・急上昇の実装（`snapshots` を活用）
3. Kick API統合（`/livestreams` でTwitchとほぼ同形のデータが取れる）
4. YouTube配信者の手動登録

## 方針

Twitch単体では本家に機能で勝てない。
**複数プラットフォームの横断**と**履歴データによる前日比**で差別化する。
