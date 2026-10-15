#!/usr/bin/env python3
"""cctoolkit run-validate — the user's answers to `## To validate`, written into the batch sheets.

    cctoolkit run-validate apply <work>
        applies every answer of `run/.pane.jsonl` (lib/pane_file.py) not applied yet:
        - keep: nothing changes, the entry is marked applied;
        - reject / amend: the user's text goes into `decisions` of the cycles the entry names
          in the sheet's `## Cycles` block (the cycle whose behaviour the step names; none for a
          design, audit or gate entry), and as a row `| Hn | <text> | user decision |` of
          `## Assumptions` — the convention of the `## Resume` section of a batch report; the
          batch is marked to relaunch.
        One line per entry, then `relaunch: <command>` per batch to relaunch. Nothing pending:
        prints nothing. `run-plan` and `run-lot` run it before any batch starts, so an answer
        given in the pane reaches the next run without a hand edit.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import pane_file  # noqa: E402
import work_file  # noqa: E402

USER = "user decision"
CYCLES = re.compile(r"^## Cycles[ \t]*(?:<!--.*?-->)?[ \t]*$(.*?)(?=^## |\Z)", re.M | re.S)
ASSUMPTIONS = re.compile(r"^## (?:Assumptions|Hypotheses|Hypothèses)\b.*$|^## .*<!-- kit:assumptions -->.*$", re.M)
STEP = re.compile(r"^(?:RED|GREEN)\s+")


def sheet_of(work: Path, entry: dict) -> Path | None:
    if entry.get("sheet"):
        p = Path(entry["sheet"])
        return p if p.is_absolute() else Path.cwd() / p
    plans = sorted(work.parent.parent.glob("*-PLAN.md"))
    return plans[0].parent / f"{plans[0].stem}-{entry.get('batch')}.md" if plans else None


def plan_of(sheet: Path) -> Path:
    return sheet.parent / re.sub(r"-F\d+\.md$", ".md", sheet.name)


def behaviour_of(step: str) -> str:
    return STEP.sub("", step or "").rstrip("…").strip().lower()


def write_cycles(text: str, step: str, decision: str) -> tuple[str, list[str]]:
    m = CYCLES.search(text)
    wanted = behaviour_of(step)
    if not m or not wanted or not STEP.match(step or ""):
        return text, []
    fence = re.search(r"```json\s*\n(.*?)\n```", m.group(1), re.S)
    if not fence:
        return text, []
    try:
        data = json.loads(fence.group(1))
    except json.JSONDecodeError:
        return text, []
    touched = []
    for c in data.get("cycles", []):
        b = str(c.get("behaviour", "")).lower()
        if b.startswith(wanted) or wanted.startswith(b):
            c["decisions"] = f"{c['decisions']} ; {decision}" if c.get("decisions") else decision
            touched.append(c.get("id", c.get("behaviour", "")))
    if not touched:
        return text, []
    start = m.start(1) + fence.start(1)
    end = m.start(1) + fence.end(1)
    return text[:start] + json.dumps(data, ensure_ascii=False, indent=2) + text[end:], touched


def write_assumption(text: str, decision: str) -> tuple[str, str]:
    numbers = [int(n) for n in re.findall(r"^\|\s*H(\d+)\s*\|", text, re.M)]
    hn = f"H{max(numbers, default=0) + 1}"
    row = f"| {hn} | {' '.join(decision.split()).replace('|', '/')} | {USER} |"
    m = ASSUMPTIONS.search(text)
    if not m:
        return text.rstrip("\n") + f"\n\n## Assumptions <!-- kit:assumptions -->\n\n| # | Assumption | To be validated by |\n|---|------------|--------------------|\n{row}\n", hn
    nxt = re.search(r"^## ", text[m.end():], re.M)
    section_end = m.end() + (nxt.start() if nxt else len(text) - m.end())
    section = text[m.end():section_end]
    rows = list(re.finditer(r"^\|.*\|[ \t]*$", section, re.M))
    if rows:
        at = m.end() + rows[-1].end()
        return text[:at] + "\n" + row + text[at:], hn
    block = f"\n\n| # | Assumption | To be validated by |\n|---|------------|--------------------|\n{row}\n"
    return text[:m.end()] + block + text[m.end():], hn


def apply(work: Path) -> int:
    relaunch = {}
    for v in pane_file.pending_validations(work.parent, work):
        entry = v.get("entry") or {}
        batch = entry.get("batch", "")
        decision = str(v.get("decision"))
        text = " ".join(str(v.get("text", "")).split())
        ack = {"kind": "ack", "batch": batch, "ref": v["id"], "what": "applied"}
        if decision == "keep":
            work_file.append(work, ack)
            print(f"{batch} — kept: {entry.get('step', '')}")
            continue
        sheet = sheet_of(work, entry)
        if not text or sheet is None or not sheet.is_file():
            print(f"{batch} — not applied, {'no text' if not text else f'sheet missing: {sheet}'}: {entry.get('step', '')}")
            continue
        body = sheet.read_text(encoding="utf-8")
        stated = f"{'rejected' if decision == 'reject' else 'amended'}: {entry.get('text', '')} → {text}"
        body, cycles = write_cycles(body, entry.get("step", ""), text)
        body, hn = write_assumption(body, stated)
        sheet.write_text(body, encoding="utf-8")
        command = f"/run-plan {plan_of(sheet)}" if plan_of(sheet).is_file() else f"/run-lot {sheet}"
        relaunch[batch] = command
        work_file.append(work, {**ack, "relaunch": command, "hn": hn, "cycles": cycles})
        print(f"{batch} — {decision}: {hn} in {sheet.name}{f', decisions of {', '.join(cycles)}' if cycles else ''}")
    for batch, command in relaunch.items():
        print(f"relaunch: {batch} — {command}")
    return 0


def main(argv):
    if len(argv) != 3 or argv[1] != "apply":
        print(__doc__, file=sys.stderr)
        return 2
    return apply(Path(argv[2]))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
