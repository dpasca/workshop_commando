英語版: [00-setup.md](../00-setup.md)

# 00 · セットアップ（15分）

**ゴール:** ノートPCでゲームが動き、エージェントが応答すること。

```sh
git clone https://github.com/dpasca/workshop_commando.git commando && cd commando
pnpm install
node workshop/preflight.mjs      # checks Node, pnpm, git and your agent CLIs, and asks each one to say "OK"
pnpm dev                         # open http://localhost:5173
```

操作: **WASD** 移動 · **マウス** 照準 · **クリック** 射撃 · **Space** または **右クリック** 手榴弾 · **R** リスタート。
捕虜を救出し、最上部までたどり着いてください。トーチカと戦車には銃弾が効きません。手榴弾を使うか、赤いドラム缶のそばにおびき寄せてください。

## プリフライトが失敗したら

- *Node が古い:* 20.19 以上（または 22.12 以上）が必要です。`nvm`、`fnm`、または nodejs.org のインストーラーを使ってください。
- *pnpm がない:* `corepack enable`（Node に同梱）、または `npm i -g pnpm`。
- *エージェントが応答しない:* 先にログインして（`claude`、`codex login`、`opencode auth login`）、再実行してください。動くものが1つあれば十分です。
- *Windows:* プリフライトと `pnpm` は動きます。演習でシェルコマンドが出てきたら、PowerShell か Git Bash を使ってください。動かないものがあれば教えてください。

## 次に

1. プロジェクトをエージェントで開き、こう伝えます: **「AGENTS.md を読んで、このゲームがどう構成されているか説明して。」** このファイルは、ここでどのエージェントも読む説明書です。答えが妥当か確認してください。
2. 2分間遊んでみてください。自分なら何を変えたいかに気づいてください。
3. どちらが先にタイプするか決めます。演習ごとに交代してください。

次へ: [01 自分のものにする](01-make-it-yours.md)。
