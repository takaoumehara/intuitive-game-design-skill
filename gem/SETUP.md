# Google Gem として使う

このスキルは Claude Code 向けに、20個ほどのリファレンスファイルとして書かれています。**Gem のナレッジは添付できる本数が少なく、そのままでは全部アップロードできません。** そこで、内容を変えずに数ファイルへ畳んだものを用意しています。

```bash
python3 scripts/build_gem.py
```

これで `dist/gem/` が生成されます（このリポジトリには生成済みのものが入っています）。

```
dist/gem/
├── instructions.md        ← Gem の「手順（Instructions）」欄に貼る本文
├── instructions-short.md  ← 上が長すぎて入らない場合の短縮版
├── SETUP.md               ← この手順書
├── split/                 ← ナレッジ 7ファイル（推奨）
│   ├── 01-router-and-principles.md
│   ├── 02-core-theory.md
│   ├── 03-feel-and-simple.md
│   ├── 04-audio-and-rhythm.md
│   ├── 05-input-and-camera.md
│   ├── 06-beauty-and-projection.md
│   └── 07-tech-workflows-code.md
└── single/
    └── intuitive-game-design-all.md   ← 全部入り1ファイル（本数制限が厳しい時）
```

## 手順

1. Gemini で **Gem マネージャー → 新しい Gem**
2. **名前**: 直感的ゲームデザイン（任意）
3. **手順（Instructions）** に `instructions.md` の中身を貼る
4. **ナレッジ** に `split/` の7ファイルをアップロード
5. 保存してプレビューで試す

**アップロードできる本数が7に満たない場合**は、代わりに `single/intuitive-game-design-all.md` を1本だけ入れてください。内容は同じです。

**手順欄に入りきらない場合**は `instructions-short.md` に差し替えてください。routing の細かさは落ちますが、5つの問いと出力の形は保たれます。ナレッジ側の `01-router-and-principles.md` に完全版が入っているので、Gem は結局そこを読みます。

**`.md` が受け付けられない場合**は、拡張子を `.txt` に変えてアップロードしてください。中身はプレーンテキストなので、そのまま読まれます。

## 動作確認

作った直後に、この3つを投げてください。**期待する反応が返らなければ、ナレッジが読まれていません。**

| 投げる文 | 期待する反応 |
| :--- | :--- |
| 「チュートリアルが7画面あって3割離脱します。文章を分かりやすくしたいです」 | 文章の書き直しではなく、**同時に渡している新規要素が4を超えている**ことを指摘し、チュートリアル自体の削減を主に提案する |
| 「テスターに"たまにジャンプが反応しない"と言われます」 | コヨーテタイムと入力バッファを、**発動時に両方のタイマーを同時に消費する**形で提示する |
| 「Chromeでは鳴るのに iPhone だと音が出ません」 | ユーザー操作のハンドラ内でしか AudioContext を再開できないこと、**失敗しても例外が出ず無音になるだけ**であることを指摘する |

## Claude Code 版との違い

Gem 版で落ちているのは次の2つです。どちらもファイルへ書き込む機能に依存していて、Gem では実行できません。

- **`feedback/log.md` への記録**（使うたびに7行残し、スキル自身を直す仕組み）
- **`evals/` による回帰テスト**

継続的にスキルを育てたい場合は、Claude Code 版を本体として、Gem 版はその**書き出し**として扱ってください。本体を更新したら `python3 scripts/build_gem.py` を回し、Gem のナレッジを差し替えます。

## 元になっているファイル

`dist/gem/` は生成物です。**直接編集しないでください。** 直すのは元のリファレンス（`references/`、`workflows/`、`assets/`、`SKILL.md`）と、手順文（`gem/instructions.md`、`gem/instructions-short.md`）のほうです。ビルドし直すと上書きされます。
