# Evals

`evals.json` holds the eval cases for the `intuitive-game-design` skill: **21 cases, 158 assertions** (count them with the snippet below). Each case has a `prompt`, an `expected_output` describing the right behaviour, and a list of objective `assertions` a grader checks. The case text is in Japanese, as is most of the skill's reference material.

```bash
python3 -c "import json; d=json.load(open('evals/evals.json')); print(len(d['evals']), sum(len(e['assertions']) for e in d['evals']))"
```

The `notes` field records why cases were added or replaced (iterations 1–6). New cases from real failures come from `scripts/log_to_eval.py` (see `feedback/README.md`).

## Status of the published result

The READMEs quote a with-skill vs. without-skill result of **62/64 (97%) vs. 42/64 (66%)**. That was a **historical run on an earlier 12-case / 64-assertion set**, before routes G–J were added. Its raw answers, grading output, model names, run date and run script were **not committed**, so it cannot be reproduced from this repo. It needs to be re-measured on the current 21-case set.

## What a re-measurement must commit

Put each run in its own folder, e.g. `evals/results/<YYYY-MM-DD>-<short-label>/`, containing:

| What | Why |
| :--- | :--- |
| `run.md` — date, the exact command(s) or script used, the git commit SHA of the skill under test | So anyone can rerun the same thing against the same skill |
| Model IDs for the **answering** model (with and without the skill) and the **grading** model, plus settings (temperature, max tokens, harness/CLI version) | Scores mean nothing without the model and settings |
| The script itself (or a pinned reference to it in `scripts/`) | "Graded by a model" is not a method until the grading prompt is visible |
| Raw answers: one file per case per arm (`with_skill/<id>.md`, `without_skill/<id>.md`) | So the grades can be checked by a person |
| Grading output as JSON: per case, per assertion, pass/fail plus the grader's short reason | So totals can be recomputed and disagreements inspected |
| `summary.json` — totals per arm and per area, standard deviation, token usage and wall-clock time per arm | The numbers quoted in the README, derived from the files above |
| Number of runs per case (if more than one) and how they were aggregated | Variance claims need repeated runs |

Only after that folder is committed should the README numbers and the eval badge be updated, and the README should link to the folder.

Note: `claude plugin eval` (Claude Code CLI) expects a different layout (`evals/**/case.yaml` or `prompt.md` + `graders/*.md`). Converting `evals.json` to that layout would let the CLI run with-plugin and no-plugin arms directly; this has not been done yet.
