#!/usr/bin/env python3
"""
Rebuild dist/<skill-name>.zip from the files tracked in git.

claude.ai's uploader requires two things — get either wrong and the skill
silently fails to trigger after upload:
  1. The archive must have a `.zip` extension (`.skill` is rejected).
  2. The archive's only top-level entry must be a folder matching SKILL.md's
     `name:` field, with SKILL.md directly inside it.

`evals/` (grading data), `gem/` (the Google Gem export's source text) and
`dist/` itself are excluded — the first two are not part of the skill's
runtime, and excluding `dist/` keeps the archive from containing itself.

Usage:
    python3 scripts/package.py
"""
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def skill_name():
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    m = re.search(r"^name:\s*(.+)$", text, re.M)
    if not m:
        sys.exit("SKILL.md has no `name:` field in its frontmatter.")
    return m.group(1).strip()


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    # `gem/` は Google Gem 用の書き出し元（SKILL.md の凝縮版）。同梱すると
    # スキル内に指示文が二重に存在することになり、読む側が混乱する。
    return [f for f in out
            if not f.startswith(("evals/", "dist/", "gem/")) and f != ".gitignore"]


def main():
    name = skill_name()
    files = tracked_files()
    if not files:
        sys.exit("`git ls-files` returned nothing — run this from inside the repo.")

    dest = ROOT / "dist" / f"{name}.zip"
    dest.parent.mkdir(exist_ok=True)

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(files):
            z.write(ROOT / f, str(Path(name) / f))

    tops = {n.split("/")[0] for n in zipfile.ZipFile(dest).namelist()}
    if tops != {name}:
        sys.exit(f"top-level entries must be exactly {{'{name}'}}, got {tops}")

    print(f"{dest.relative_to(ROOT)} — {len(files)} files, {dest.stat().st_size / 1024:.1f} KB")
    print(f"top-level folder: {name}/  (matches SKILL.md name — claude.ai will accept this)")


if __name__ == "__main__":
    main()
