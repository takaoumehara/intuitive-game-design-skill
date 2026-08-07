#!/usr/bin/env python3
"""
使用ログを集計し、個別対応では見えない傾向を出す。

なぜこれが必要か:
ログが10件を超えると、1件ずつ読んで直すのは過剰適合になる。同じ指摘が
3回出ているのか1回なのかで対応が変わるため、頻度を機械的に数える。
また「Fixed 済みなのに再発している」は、その修正が効いていない証拠であり、
別の方法を試す合図になる。これは読んでいるだけでは気づけない。

使い方:
    python3 scripts/log_summary.py feedback/log.md
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from log_to_eval import parse, has, NONE_WORDS  # noqa: E402


def normalize(s):
    """表記ゆれを吸収して同一の指摘をまとめる。完全ではないので目視前提。"""
    s = re.sub(r"[「」\"'。、,.\s]", "", s.lower())
    return s[:40]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    entries = parse(Path(sys.argv[1]))
    if not entries:
        print("エントリがありません。")
        return

    n = len(entries)
    verdicts = Counter(e.get("Verdict", "?").lower() for e in entries)
    routes = defaultdict(lambda: Counter())
    for e in entries:
        routes[e["route"]][e.get("Verdict", "?").lower()] += 1

    print(f"= 全 {n} 件 =\n")
    print("Verdict:")
    for v in ("worked", "partly", "failed"):
        c = verdicts.get(v, 0)
        bar = "#" * int(30 * c / n) if n else ""
        print(f"  {v:8} {c:3}  {c/n*100:5.1f}%  {bar}")

    print("\n経路別:")
    for r in sorted(routes):
        c = routes[r]
        tot = sum(c.values())
        bad = c.get("failed", 0) + c.get("partly", 0)
        flag = "  ← 失敗率が高い" if tot >= 3 and bad / tot > 0.5 else ""
        print(f"  {r:10} {tot:3}件  失敗/部分 {bad}{flag}")

    # 繰り返される指摘 = スキルに書かれていない指示
    for field, label, threshold in (
        ("Corrected", "ユーザーが言い直したこと", 2),
        ("Missed", "言うべきだったのに言わなかったこと", 2),
        ("Wrong", "実行不能・事実誤り", 1),
        ("Unused", "読んだが使わなかったファイル", 3),
    ):
        vals = [e[field] for e in entries if has(e, field)]
        if not vals:
            continue
        counts = Counter(normalize(v) for v in vals)
        rep = {k: c for k, c in counts.items() if c >= threshold}
        print(f"\n{label}（{threshold}回以上）:")
        if not rep:
            print("  なし")
            continue
        seen = set()
        for v in vals:
            k = normalize(v)
            if k in rep and k not in seen:
                seen.add(k)
                mark = "★ 要修正" if rep[k] >= 3 or field == "Wrong" else "調査"
                print(f"  [{rep[k]}回] {mark}  {v[:70]}")

    # 修正済みなのに再発 = その修正が効いていない
    fixed_keys = {normalize(e["Corrected"]) for e in entries
                  if e["fixed"] and has(e, "Corrected")}
    recur = []
    for e in entries:
        if not e["fixed"] and has(e, "Corrected") and normalize(e["Corrected"]) in fixed_keys:
            recur.append(e)
    if recur:
        print("\n★★ 修正済みのはずが再発している（別の方法を試すべき）:")
        for e in recur:
            print(f"  {e['date']} {e['Corrected'][:60]}")

    unfixed = [e for e in entries
               if e.get("Verdict", "").lower() in ("failed", "partly") and not e["fixed"]]
    print(f"\n未修正の失敗: {len(unfixed)}件")
    if unfixed:
        print("  → python3 scripts/log_to_eval.py feedback/log.md で eval 化できます")


if __name__ == "__main__":
    main()
