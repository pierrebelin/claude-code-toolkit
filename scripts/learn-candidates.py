#!/usr/bin/env python3
"""Gaps of the /verify-ddd-tdd verdicts not yet run through /learn.

Sources: the `## Audit gaps` of every `/run-lot` report (`todo/<code>/run/batches/FX.md`), then
the `ddd-tdd-auditor` sub-transcripts and /verify-ddd-tdd forks (`## Verdict — GAPS`, or the
French `ECARTS`); a gap found in both is counted once. State: `.claude/learn-state.json`
(git-ignored), files read with their mtime, rows, treated ids, refused motifs.

Usage:
  cctoolkit learn-candidates                   # summary per axis
  cctoolkit learn-candidates --axis Plan       # untreated gaps of one axis (`--axe` accepted)
  cctoolkit learn-candidates --count           # one line, for doctor
  cctoolkit learn-candidates --treat-axis Plan # marks the axis treated (`--treat-axe` accepted)
  cctoolkit learn-candidates --refuse "motif"  # refused motif, never proposed again
  cctoolkit learn-candidates --memory          # mechanical defects of the memory (`--memoire` accepted):
                                               # index, frontmatter, dead repo paths
"""

import argparse
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
try:
    from kit_config import project_root
    ROOT = project_root()
except ImportError:
    ROOT = HERE
STATE = os.environ.get("LEARN_STATE") or os.path.join(ROOT, ".claude", "learn-state.json")
REPORTS = os.path.join(os.environ.get("LEARN_REPORTS") or ROOT, "todo", "*", "run", "batches", "F*.md")
TRANSCRIPTS = os.environ.get("LEARN_TRANSCRIPTS") or os.path.join(
    os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", ROOT))
MEMORY = os.environ.get("LEARN_MEMORY") or os.path.join(TRANSCRIPTS, "memory")
INDEX_LINK = re.compile(r"^\s*-\s*\[[^\]]*\]\(([^)]+)\)")
REPO_PATH = re.compile(r"^[\w.@-]+(/[\w.@-]+)+/?$")
VERDICT = re.compile(r"^## Verdict — (?:GAPS|ECARTS)", re.M)
AUDIT_GAPS = ("## audit gaps", "## ecarts d'audit")
# `- <severity> — <axis> — <gap> (evidence: <evidence>). Fix: <fix>; applied in round n: … .[ Closure: <closure>.]`
# or `; not applied.` — the line renderReport() of workflows/run-lot.js writes.
REPORT_GAP = re.compile(r"^- (\w+) — ([^—]+?) — (.*) \(evidence: (.*)\)\. Fix: (.*?)(?:; applied in round \d+: .*?|; not applied)\.(?: Closure: .*\.)?$")
AUDITORS = {"ddd-tdd-auditor", "fork"}
# French severities and axes fold onto the English ones.
SEVERITIES = {"Blocking": "Blocking", "Major": "Major", "Bloquant": "Blocking", "Majeur": "Major"}
NUDGE_BATCHES = 2
# Frozen axes of the verdict, (English, French); aliases and lowercase labels fold onto them.
AXES = (("Correctness", "Correction"), ("Reuse", "Réutilisation"), ("Simplification", "Simplification"),
        ("Cost", "Coût"), ("Placement", "Placement"), ("Comments", "Commentaires"),
        ("Test", "Test"), ("Plan", "Plan"), ("Scope", "Périmètre"))
ALIASES = {"stale plan": ("Plan", "Plan")}
KEEP_PREFIXES = ("keep: ", "garder : ")
ROW_KEYS = {"lot": "batch", "severite": "severity", "axe": "axis", "ecart": "gap",
            "preuve": "evidence", "correction": "fix"}
CELL = 240


def load_state():
    try:
        with open(STATE, encoding="utf-8") as fh:
            s = json.load(fh)
    except (OSError, ValueError):
        s = {}
    for key, empty in (("files", {}), ("rows", []), ("treated", []), ("refused", [])):
        s.setdefault(key, empty)
    s["rows"] = [normalised(r) for r in s["rows"] if isinstance(r, dict)]
    return s


def normalised(row):
    """A row saved with the French keys, severity and axis, in the English ones; the id kept."""
    for old, new in ROW_KEYS.items():
        if old in row:
            value = row.pop(old)
            row.setdefault(new, value)
    row["severity"] = SEVERITIES.get(row.get("severity"), row.get("severity"))
    row["axis"] = axis(row.get("axis", ""))
    return row


def save_state(s):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(s, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def verdict_texts(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    if "## Verdict — " not in raw:
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
            body = text.lstrip()
            found = VERDICT.search(body)
            if found:
                yield body[found.start():], o.get("timestamp", "")


def fold(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def axis_pair(label):
    """(English axis, label as written in the verdict's language)."""
    folded = fold(label)
    alias = next((a for k, a in ALIASES.items() if folded.startswith(k)), None)
    if alias:
        return alias
    for english, french in AXES:
        if folded.startswith(fold(english)):
            return english, english
        if folded.startswith(fold(french)):
            return english, french
    return label, label


def axis(label):
    return axis_pair(label)[0]


CLOSURE = ("closure", "fermeture")


def rows_of(text):
    """Rows of a GAPS table: Severity, Axis, Gap, Evidence, [Closure,] Expected fix — per the header row."""
    closure = False
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if any(fold(c) in CLOSURE for c in cells):
            closure = True
            continue
        tail = 3 if closure else 2
        if len(cells) >= 3 + tail and cells[0] in SEVERITIES:
            english, written = axis_pair(cells[1])
            yield SEVERITIES[cells[0]], english, written, " | ".join(cells[2:-tail]), cells[-tail], cells[-1]


def same_gap(axis_, gap):
    return axis_, " ".join(fold(gap.replace("\\|", "|")).split())


def report_rows(path):
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    start = next((i for i, l in enumerate(lines) if fold(l.strip()) in AUDIT_GAPS), None)
    if start is None:
        return
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        m = REPORT_GAP.match(line.strip())
        if m and m.group(1) in SEVERITIES:
            english, written = axis_pair(m.group(2))
            yield SEVERITIES[m.group(1)], english, written, m.group(3), m.group(4), m.group(5)


def scan(s):
    seen = s["files"]
    known = {r["id"] for r in s["rows"]}
    gaps = {same_gap(r["axis"], r["gap"]) for r in s["rows"]}

    def add(row, written):
        rid = hashlib.sha1(f"{row['session']}|{written}|{row['gap']}".encode()).hexdigest()[:10]
        key = same_gap(row["axis"], row["gap"])
        if rid in known or key in gaps:
            return
        known.add(rid)
        gaps.add(key)
        s["rows"].append(dict(id=rid, **row))

    for path in glob.glob(REPORTS):
        mtime = os.path.getmtime(path)
        if seen.get(path) == mtime:
            continue
        seen[path] = mtime
        code = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(path))))
        batch = os.path.basename(path)[:-3]
        date = time.strftime("%Y-%m-%d", time.localtime(mtime))
        for sev, ax, written, gap, evidence, fix in report_rows(path):
            add(dict(session=f"{code}/{batch}", date=date, batch=f"{code} {batch}",
                     severity=sev, axis=ax, gap=gap, evidence=evidence, fix=fix), written)

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
        if str(meta.get("agentType", "fork")).rsplit(":", 1)[-1] not in AUDITORS:
            continue
        session = os.path.basename(os.path.dirname(os.path.dirname(path)))[:8]
        for text, ts in verdict_texts(path):
            for sev, ax, written, gap, evidence, fix in rows_of(text):
                add(dict(session=session, date=ts[:10], batch=meta.get("description", ""),
                         severity=sev, axis=ax, gap=gap, evidence=evidence, fix=fix), written)


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
        out += subprocess.run(["git", "-C", ROOT, "ls-files", "-oi", "--exclude-standard", "--", ".claude"],
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
    kept = [m for m in load_state()["refused"] if m.startswith(KEEP_PREFIXES)]
    if kept:
        print("\nEntries kept after refusal (never propose again):")
        print("\n".join(f"- {m}" for m in kept))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--axis", "--axe")
    ap.add_argument("--treat-axis", "--treat-axe")
    ap.add_argument("--refuse")
    ap.add_argument("--memory", "--memoire", action="store_true")
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
