#!/usr/bin/env python3
"""Gaps of the /verify-ddd-tdd verdicts not yet run through /learn.

Why. A gap fixed inside its batch leaves no trace anywhere but the auditor's
transcript: the same gap comes back in the next batch, the auditor finds it
again, it gets fixed again. /learn reads those gaps, draws the recurring motifs
out of them and has them written into a layer rule after confirmation. This
script is the model-free half: extract, remember what was treated, count.

Source. The `ddd-tdd-auditor` sub-transcripts (and the /verify-ddd-tdd forks)
one message of which starts with `## Verdict — GAPS`. Measured on 2026-10-02 on
the repo this kit comes from: 53 verdicts out of 175 sub-transcripts quoting the
literal, the rest quote it without producing it (skill template loaded, docs
agent). 1.7 GB of transcripts, 9.5 s for a full grep: the state remembers the
mtime of every file read, only what moved is read again.

State. `.claude/learn-state.json` (ignored by git): files read, rows extracted,
treated ids, refused motifs. A refused motif is handed back to /learn so that it
does not propose it again.

Usage:
  cctoolkit learn-candidates                   # summary per axis
  cctoolkit learn-candidates --axis Plan       # untreated gaps of one axis
  cctoolkit learn-candidates --count           # one line, for doctor
  cctoolkit learn-candidates --treat-axis Plan # marks the axis treated
  cctoolkit learn-candidates --refuse "motif"  # refused motif, never proposed again
  cctoolkit learn-candidates --memory          # mechanical defects of the memory

Memory. /learn memory audits the project auto-memory. This script delivers its
judgement-free half: index (file indexed twice, not indexed, gone), incomplete
frontmatter, repo paths quoted in backticks that no longer exist. Seen on
2026-10-02 in the repo this kit comes from: one file indexed twice under two
contradictory summaries ("frozen", then "unfrozen"), its description still on
the frozen state, the only part read at recall.
"""

import argparse
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
try:
    from kit_config import project_root
    ROOT = project_root()
except ImportError:
    ROOT = HERE
STATE = os.environ.get("LEARN_STATE") or os.path.join(ROOT, ".claude", "learn-state.json")
TRANSCRIPTS = os.environ.get("LEARN_TRANSCRIPTS") or os.path.join(
    os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", ROOT))
MEMORY = os.environ.get("LEARN_MEMORY") or os.path.join(TRANSCRIPTS, "memory")
INDEX_LINK = re.compile(r"^\s*-\s*\[[^\]]*\]\(([^)]+)\)")
REPO_PATH = re.compile(r"^[\w.@-]+(/[\w.@-]+)+/?$")
VERDICT = "## Verdict — GAPS"
AUDITORS = {"ddd-tdd-auditor", "fork"}
SEVERITIES = {"Blocking", "Major"}
NUDGE_BATCHES = 2
# Frozen axes of the verdict. Auditors write `Stale plan` (a classification of
# the Plan axis) as if it were an axis, and sometimes a lowercase label: 16 rows
# out of 131 in the source repo on 2026-10-02. Folded onto the frozen axis, otherwise one motif
# spreads over several labels and never reaches the recurrence threshold.
AXES = ("Correctness", "Reuse", "Simplification", "Cost", "Placement",
        "Comments", "Test", "Plan", "Scope")
ALIASES = {"stale plan": "Plan"}
CELL = 240


def load_state():
    try:
        with open(STATE, encoding="utf-8") as fh:
            s = json.load(fh)
    except (OSError, ValueError):
        s = {}
    for key, empty in (("files", {}), ("rows", []), ("treated", []), ("refused", [])):
        s.setdefault(key, empty)
    return s


def save_state(s):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(s, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def verdict_texts(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    if VERDICT not in raw:
        return
    for line in raw.splitlines():
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("type") != "assistant":
            continue
        for b in (o.get("message") or {}).get("content") or []:
            text = b.get("text", "") if isinstance(b, dict) and b.get("type") == "text" else ""
            if text.lstrip().startswith(VERDICT) or "\n" + VERDICT in text:
                yield text[text.index(VERDICT):], o.get("timestamp", "")


def fold(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def axis(label):
    folded = fold(label)
    alias = next((a for k, a in ALIASES.items() if folded.startswith(k)), None)
    return alias or next((a for a in AXES if folded.startswith(fold(a))), label)


def rows_of(text):
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 5 and cells[0] in SEVERITIES:
            yield cells[0], axis(cells[1]), " | ".join(cells[2:-2]), cells[-2], cells[-1]


def scan(s):
    seen = s["files"]
    known = {r["id"] for r in s["rows"]}
    for path in glob.glob(os.path.join(TRANSCRIPTS, "*", "subagents", "*.jsonl")):
        mtime = os.path.getmtime(path)
        if seen.get(path) == mtime:
            continue
        seen[path] = mtime
        try:
            with open(path[:-6] + ".meta.json", encoding="utf-8") as fh:
                meta = json.load(fh)
        except (OSError, ValueError):
            meta = {}
        if meta.get("agentType", "fork") not in AUDITORS:
            continue
        session = os.path.basename(os.path.dirname(os.path.dirname(path)))[:8]
        for text, ts in verdict_texts(path):
            for sev, ax, gap, evidence, fix in rows_of(text):
                rid = hashlib.sha1(f"{session}|{ax}|{gap}".encode()).hexdigest()[:10]
                if rid in known:
                    continue
                known.add(rid)
                s["rows"].append(dict(
                    id=rid, session=session, date=ts[:10], batch=meta.get("description", ""),
                    severity=sev, axis=ax, gap=gap, evidence=evidence, fix=fix))


def pending(s):
    done = set(s["treated"])
    return [r for r in s["rows"] if r["id"] not in done]


def short(text, n=CELL):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def frontmatter(text):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    keys = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r"^\s*([A-Za-z_]+):\s*(.*)$", line)
        if m:
            keys[m.group(1)] = m.group(2).strip()
    return keys


def cited_paths(text):
    for tok in re.findall(r"`([^`\s]+)`", text):
        tok = re.sub(r":\d+.*$", "", tok)
        if REPO_PATH.match(tok) and (tok.endswith("/") or "." in tok.rsplit("/", 1)[-1]):
            yield tok


def repo_entries():
    try:
        out = subprocess.run(["git", "-C", ROOT, "ls-files", "-co", "--exclude-standard"],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return set()
    entries = set()
    for path in out.splitlines():
        parts = path.split("/")
        entries.add(path)
        entries.update("/".join(parts[:i]) + "/" for i in range(1, len(parts)))
    return entries


def in_repo(path, entries):
    if os.path.exists(os.path.join(ROOT, path)):
        return True
    return any(e == path or e.endswith("/" + path) for e in entries)


def memory_report():
    index = os.path.join(MEMORY, "MEMORY.md")
    try:
        with open(index, encoding="utf-8") as fh:
            links = [m.group(1) for m in map(INDEX_LINK.match, fh) if m]
    except OSError:
        print(f"Index missing: {index}")
        return 1
    files = sorted(f for f in os.listdir(MEMORY) if f.endswith(".md") and f != "MEMORY.md")
    entries = repo_entries()
    found = []
    for f in sorted({l for l in links if links.count(l) > 1}):
        found.append(f"indexed {links.count(f)} times: {f}")
    for f in files:
        if f not in links:
            found.append(f"not indexed: {f}")
    for f in sorted(set(links)):
        if not os.path.exists(os.path.join(MEMORY, f)):
            found.append(f"indexed, file gone: {f}")
    for f in files:
        with open(os.path.join(MEMORY, f), encoding="utf-8") as fh:
            text = fh.read()
        keys = frontmatter(text)
        missing = [k for k in ("name", "description", "type") if not keys.get(k)]
        if missing:
            found.append(f"frontmatter without {', '.join(missing)}: {f}")
        for p in sorted(set(cited_paths(text))):
            if not in_repo(p, entries):
                found.append(f"cited path missing from repo: {f} → `{p}`")
    print(f"Memory: {MEMORY} — {len(files)} entry(ies)")
    print("\n".join(f"- {line}" for line in found) if found else "No mechanical defect.")
    kept = [m for m in load_state()["refused"] if m.startswith("keep: ")]
    if kept:
        print("\nEntries kept after refusal (never propose again):")
        print("\n".join(f"- {m}" for m in kept))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--axis")
    ap.add_argument("--treat-axis")
    ap.add_argument("--refuse")
    ap.add_argument("--memory", action="store_true")
    args = ap.parse_args()

    if args.memory:
        return memory_report()

    s = load_state()
    scan(s)

    if args.refuse:
        s["refused"].append(args.refuse)
    if args.treat_axis:
        s["treated"] += [r["id"] for r in pending(s) if r["axis"] == axis(args.treat_axis)]
    save_state(s)

    todo = pending(s)
    batches = {r["session"] for r in todo}

    if args.count:
        if len(batches) >= NUDGE_BATCHES:
            print(f"{len(todo)} untreated verdict gap(s) across {len(batches)} batches — run /learn")
        return 0

    if args.axis:
        rows = sorted((r for r in todo if r["axis"] == axis(args.axis)), key=lambda r: r["date"])
        for r in rows:
            print(f"- [{r['severity']}] {short(r['gap'])}\n"
                  f"  fix: {short(r['fix'], 120)} · batch {short(r['batch'], 40)} ({r['session']} {r['date']})")
        if not rows:
            print(f"No untreated gap on axis \"{args.axis}\".")
        return 0

    if args.treat_axis or args.refuse:
        return 0

    by_axis = {}
    for r in todo:
        by_axis.setdefault(r["axis"], []).append(r)
    print(f"{len(todo)} untreated gap(s), {len(batches)} batch(es)\n")
    print("axis               gaps batches blocking")
    for ax, rs in sorted(by_axis.items(), key=lambda kv: -len({r['session'] for r in kv[1]})):
        print(f"{ax[:16]:<16} {len(rs):>6} {len({r['session'] for r in rs}):>7} "
              f"{sum(r['severity'] == 'Blocking' for r in rs):>8}")
    if s["refused"]:
        print("\nMotifs already refused (never propose again):")
        for m in s["refused"]:
            print(f"- {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
