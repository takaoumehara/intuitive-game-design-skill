# intuitive-game-design 使用ログ

このファイルをAIに渡して「このログを見てスキルを改善して」と言ってください。手順は `feedback/README.md` にあります。

> **このファイルはメンテナーが整理して載せるログです。** スキルは使用中、ユーザーのプロジェクトの `.claude/feedback/intuitive-game-design.md` に記録します（スキルのディレクトリはプラグイン更新で置き換わるため）。ユーザーから渡されたログのうち、残す価値のあるエントリをここへ転記します。英語版スキルは見出しを `Route <A–J>`、空欄を `none` で書きます。どちらの書き方もスクリプトで読めます。

書き方の要点は3つだけです。**`Corrected:` はユーザーの言葉のまま書く（和らげない）。うまくいった回も書く。空欄は `なし` と書いて省略しない。**

---

## テンプレート（コピーして使う）

```markdown
## YYYY-MM-DD · 経路<A〜J> · <ユーザーが最初に言ったこと、そのまま>
Read: <実際に開いたファイル>
Output: <何を出したか、1行>
Corrected: <ユーザーが言い直したこと。彼らの言葉のまま。なければ「なし」>
Missed: <言うべきだったのに言わなかったこと。なければ「なし」>
Wrong: <実行不能なコード・存在しないAPI・事実誤り。なければ「なし」>
Unused: <読んだが使わなかったファイル。なければ「なし」>
Verdict: <worked / partly / failed>
```

---

## 記入例（この形式で書いてください）

## 2026-08-07 · 経路E · 「たまにジャンプが反応しないってバグ報告が来る」
Read: SKILL.md, references/simple/juice-and-feel.md, assets/juice-controller.js
Output: コヨーテタイムと入力バッファの不在を原因として特定し、juice-controller を import する形の修正コードを提示
Corrected: 「そのファイルうちにないんだけど」
Missed: import ではなく実コードを回答内に展開すべきだった。ユーザーは assets/ を持っていない
Wrong: `import { JuiceInputController } from './assets/juice-controller.js'` — 解決不能なパス
Unused: なし
Verdict: partly
→ Fixed: SKILL.md §7 に鉄則1「ユーザーが持っていないファイルを import しない」を新設。判定基準を「コピーして貼ってそのまま動くか」に統一。evals eval-5 と eval-8 に import 検査のアサーションを追加

---

# ここから下に追記していく

