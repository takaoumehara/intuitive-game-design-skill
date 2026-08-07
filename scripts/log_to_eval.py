#!/usr/bin/env python3
"""
使用ログの失敗エントリを eval ケースの雛形に変換する。

なぜこれが必要か:
スキルを直しただけでは、次の修正で静かに元へ戻る。実際に起きた失敗を
テストとして固定して初めて、修正が永続する。ログを回帰テストに変えるのが
「使うほど良くなる」の実体。

使い方:
    python3 scripts/log_to_eval.py feedback/log.md              # 雛形を表示
    python3 scripts/log_to_eval.py feedback/log.md --write      # evals/evals.json へ追記
"""
import json
import re
import sys
from pathlib import Path

FIELDS = ["Read", "Output", "Corrected", "Missed", "Wrong", "Unused", "Verdict"]
NONE_WORDS = {"なし", "none", "-", "n/a", ""}

# 症状 -> 観測可能なアサーション。Wrong/Missed の文面から機械的に引ける分だけ用意する。
# ここに無いものは人間が書く前提。推測でアサーションを捏造しない。
PATTERNS = [
    (r"import|require|パス|モジュール|ファイルがない|持ってな",
     "コード内に、ユーザーが持っていないファイルへの import が含まれていない（コピーしてそのまま実行できる）"),
    (r"存在しない|実在しない|そんなAPI|deprecated|廃止",
     "提示されたコードに、実在しないAPI・メソッドの呼び出しが含まれていない"),
    (r"経路|問い\d|SKILL\.md|references/|workflows/|章番号|内部用語",
     "スキル内部の呼び名（経路A〜F、問い1〜5、ファイルパスや章番号）をユーザー向け本文に出していない"),
    (r"優先度|P0|P1|P2",
     "各修正案に優先度（P0/P1/P2）が付いている"),
    (r"検証方法|どうなれば成功|測れ",
     "検証方法が観測可能な行動として書かれている"),
    (r"長い|冗長|回りくど|多すぎ",
     "回答が要点に絞られており、使わないセクションで水増しされていない"),
    (r"チュートリアル|説明を足|テキストで",
     "チュートリアルや説明テキストの追加を第一の解決策にしていない"),
    (r"数値|パラメータ|調整",
     "提示した数値について、変えるとどうなるかの調整指針が書かれている"),
]


def parse(path: Path):
    """ログをエントリ単位に分解する。テンプレート節と記入例は除外する。"""
    text = path.read_text(encoding="utf-8")
    # コードフェンス内（テンプレート）は対象外
    text = re.sub(r"```.*?```", "", text, flags=re.S)

    entries = []
    for block in re.split(r"^## ", text, flags=re.M)[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue
        header = lines[0].strip()
        if not re.match(r"\d{4}-\d{2}-\d{2}", header):
            continue  # 見出しでない節（テンプレート等）
        e = {"header": header, "fixed": None}
        for line in lines[1:]:
            line = line.strip()
            if line.startswith("→ Fixed:"):
                e["fixed"] = line.split(":", 1)[1].strip()
                continue
            for f in FIELDS:
                if line.startswith(f + ":"):
                    e[f] = line.split(":", 1)[1].strip()
        parts = header.split("·")
        e["date"] = parts[0].strip()
        e["route"] = parts[1].strip() if len(parts) > 1 else "?"
        e["prompt"] = parts[2].strip().strip("「」\"") if len(parts) > 2 else ""
        entries.append(e)
    return entries


def has(e, field):
    v = e.get(field, "").strip().lower()
    return v not in NONE_WORDS


def assertions_for(e):
    """症状の文面から、機械的に引けるアサーションだけを返す。"""
    blob = " ".join(e.get(f, "") for f in ("Corrected", "Missed", "Wrong"))
    out = []
    for pat, assertion in PATTERNS:
        if re.search(pat, blob, re.I) and assertion not in out:
            out.append(assertion)
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    log = Path(sys.argv[1])
    write = "--write" in sys.argv
    entries = parse(log)

    # 未修正の失敗のみ対象。Fixed 済みは既に eval 化されている前提。
    targets = [e for e in entries
               if e.get("Verdict", "").lower() in ("failed", "partly")
               and not e["fixed"]]

    if not targets:
        print(f"{len(entries)} エントリを読みました。eval 化すべき未修正の失敗はありません。")
        return

    print(f"{len(entries)} エントリ中、{len(targets)} 件が未修正の失敗です。\n")

    stubs = []
    for i, e in enumerate(targets):
        a = assertions_for(e)
        stub = {
            "id": None,  # 追記時に採番
            "name": f"regression-{e['date']}-{i}",
            "domain": "regression",
            "source": f"使用ログ {e['date']} / {e['route']}",
            "prompt": e.get("prompt", "") or "（ログのヘッダーから復元できませんでした。実際のユーザー発言を貼ってください）",
            "expected_output": " / ".join(filter(None, [
                e.get("Missed", "") if has(e, "Missed") else "",
                e.get("Wrong", "") if has(e, "Wrong") else "",
            ])) or "（何が起きるべきだったかを書いてください）",
            "assertions": a or ["（このケース固有のアサーションを観測可能な形で書いてください）"],
        }
        stubs.append(stub)
        print(f"--- {stub['name']} ---")
        print(f"  prompt    : {stub['prompt'][:70]}")
        print(f"  Corrected : {e.get('Corrected','なし')}")
        print(f"  自動生成された assertion: {len(a)}件")
        for x in a:
            print(f"    - {x}")
        if not a:
            print("    （自動では引けませんでした。手で書いてください）")
        print()

    if write:
        p = Path("evals/evals.json")
        d = json.loads(p.read_text(encoding="utf-8"))
        next_id = max((x["id"] for x in d["evals"]), default=-1) + 1
        for s in stubs:
            s["id"] = next_id
            next_id += 1
            d["evals"].append(s)
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"evals/evals.json に {len(stubs)} 件を追記しました。")
        print("必ずアサーションを観測可能な形に書き直してから使ってください。")
        print("「良い回答をする」のような主観的アサーションは、通してしまうので意味がありません。")
    else:
        print("--write を付けると evals/evals.json へ追記します。")


if __name__ == "__main__":
    main()
