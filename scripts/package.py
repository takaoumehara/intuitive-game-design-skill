#!/usr/bin/env python3
"""
Rebuild dist/<skill-name>.zip from the skill's files tracked in git.

claude.ai's uploader requires two things — get either wrong and the skill
silently fails to trigger after upload:
  1. The archive must have a `.zip` extension (`.skill` is rejected).
  2. The archive's only top-level entry must be a folder matching SKILL.md's
     `name:` field, with SKILL.md directly inside it.

Only `skills/<skill-name>/` (SKILL.md, references/, workflows/, assets/) plus
LICENSE go into the archive. Everything else at the repo root — READMEs,
`evals/` (grading data), `gem/` (the Google Gem export's source text),
`feedback/`, `scripts/`, `i18n/` and `dist/` itself — is not part of the
skill's runtime.

Usage:
    python3 scripts/package.py                     # writes dist/<skill-name>.zip
    python3 scripts/package.py --out /tmp/x.zip    # writes somewhere else
"""
import argparse
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT / "skills" / "intuitive-game-design"
SKILL_PREFIX = SKILL_DIR.relative_to(ROOT).as_posix() + "/"


def skill_name():
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    m = re.search(r"^name:\s*(.+)$", text, re.M)
    if not m:
        sys.exit("SKILL.md has no `name:` field in its frontmatter.")
    return m.group(1).strip()


def tracked_files():
    """(path on disk relative to ROOT, path inside the skill folder) pairs."""
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    # スキル本体（skills/<name>/ 以下）だけを同梱する。`gem/` などリポ直下の
    # ものを入れると、スキル内に指示文が二重に存在することになり、読む側が混乱する。
    pairs = [(f, f[len(SKILL_PREFIX):]) for f in out if f.startswith(SKILL_PREFIX)]
    if "LICENSE" in out:
        pairs.append(("LICENSE", "LICENSE"))
    return pairs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--out", type=Path, help="output path (default: dist/<skill-name>.zip)")
    args = ap.parse_args()

    name = skill_name()
    files = tracked_files()
    if not files:
        sys.exit("`git ls-files` returned nothing under skills/ — run this from inside the repo.")

    dest = (args.out or ROOT / "dist" / f"{name}.zip").resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in sorted(files, key=lambda p: p[1]):
            z.write(ROOT / src, str(Path(name) / arc))

    tops = {n.split("/")[0] for n in zipfile.ZipFile(dest).namelist()}
    if tops != {name}:
        sys.exit(f"top-level entries must be exactly {{'{name}'}}, got {tops}")

    shown = dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest
    print(f"{shown} — {len(files)} files, {dest.stat().st_size / 1024:.1f} KB")
    print(f"top-level folder: {name}/  (matches SKILL.md name — claude.ai will accept this)")


if __name__ == "__main__":
    main()
