# LINE 人生立て直しBot

「人生を1日で立て直すテンプレート」を毎日LINEで回す仕組み。

- 定時（JST 9 / 11 / 12 / 15 / 17 / 21時）に質問がLINEに届く
- 返信するとCloudflare D1データベースに保存される
- 夜の全11問に答え終わると、その日の全回答まとめが返ってくる
- コマンド：「まとめ」「きのう」「いま」「修正 朝① 新しい内容」

## 構成

```
LINE公式アカウント (Messaging API)
   ↕ push / webhook
Cloudflare Worker (line-reset-bot)  ← cronで定時送信
   ↕
Cloudflare D1 (line-reset-bot)      ← 回答の保存先（作成済み: dca98961-a3a9-4bee-80f2-641fb3b539c2）
```

LINE無料プラン（月200通）内に収まる設計：push は1日6通 × 31日 = 186通。
回答への返信・次の質問・夜のまとめはすべて reply API（無料・無制限）で送る。

## デプロイ手順（Cloudflareダッシュボード版・コマンド不要）

1. https://dash.cloudflare.com → **Workers & Pages** → **作成** → **Worker を作成**
   - 名前を `line-reset-bot` にして **デプロイ**（Hello Worldのままで一旦OK）
2. **コードを編集** を開き、中身を全部消して `src/index.js` の内容を貼り付け → **デプロイ**
3. Workerの **設定** タブで以下を追加：
   - **変数とシークレット**：
     - `LINE_CHANNEL_ACCESS_TOKEN`（シークレット）＝ LINE Developersで発行した長期トークン
     - `LINE_CHANNEL_SECRET`（シークレット）＝ チャネルシークレット
   - **バインディング** → **D1 データベース**：変数名 `DB`、データベース `line-reset-bot`
   - **トリガーイベント（Cron トリガー）**：以下の1本を追加（UTC）
     - `0 0,2,3,6,8,12 * * *`（無料プランはCronトリガー5本までのため1本にまとめる）
4. WorkerのURLを確認（例 `https://line-reset-bot.xxxx.workers.dev`）
5. LINE Developersコンソール → チャネル → **Messaging API設定**：
   - Webhook URL に `https://line-reset-bot.xxxx.workers.dev/webhook` を設定 → **検証** → 成功を確認
   - **Webhookの利用** をオン
   - LINE Official Account Manager側の **応答メッセージ** はオフ
6. 自分のスマホでBotに何かメッセージを送る（これでユーザー登録される）

## デプロイ手順（wrangler CLI版）

```sh
cd line-reset-bot
npx wrangler login
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler deploy
```

D1・スキーマは適用済み。作り直す場合は `npx wrangler d1 execute line-reset-bot --file schema.sql --remote`。

## 運用メモ

- 質問に答えないまま次の定時が来ると、回答待ちは新しい質問に切り替わる。
  答えそびれた分は「修正 昼① 〜〜」の形式であとから記入できる。
- 過去ログはD1の `answers` テーブルに全部残る（date × question_key × answer）。
- 質問文・時刻を変えたいときは `src/index.js` の `QUESTIONS` / `SESSIONS` と
  `wrangler.toml` の crons を編集して再デプロイ。
