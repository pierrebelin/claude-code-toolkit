#!/usr/bin/env python3
"""Access cost of a behaviour — the COUT step of the TDD cycle, mechanically.

No test observes the number of Infrastructure calls a handler makes: a handler
doing 1 query and one doing 2N+2 are equally green. Until 2026-09-12 the
`tdd-implementer` stated "n reads + n writes" from memory and the
orchestrator re-opened the handler to check the number — 34 `Read` under
`src/` after 36 `## GREEN` across 12 batch sessions, 117 kB carried to the end
of each batch, plus the layer rules every such read attaches.

This script lists what the code actually awaits, from the syntax tree
(ast-grep, rules under scripts/access-cost/rules/), so the agent states the
cost from evidence and the orchestrator validates a line instead of a file.

Usage:
    python3 scripts/access-cost.py <file.cs> [...]       # files the implementer touched
    python3 scripts/access-cost.py --diff                # every .cs modified under src/,
                                                         # added lines flagged (audit)

Exit 0: no Infrastructure call inside a loop or lambda, no in-memory filter on
an awaited result. Exit 2: at least one (on an added line with --diff). Exit 3:
ast-grep missing. The last stdout line is the `Cost` line the `## GREEN`
report copies.

Receiver classification is a naming heuristic (repository, service, wrapper,
client, provider, unit of work, DbContext…): anything else is listed as
"to classify" and left to the reader — a validator runner or a stream is not
Infrastructure, a badly named gateway is.
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "scripts", "access-cost", "sgconfig.yml")

INFRA = re.compile(
    r"repositor|service|wrapper|client|provider|unitofwork|dbcontext|dbset|gateway|store|"
    r"publisher|bus|mediator|cache|queue|adapter|^_?db$|^_?context$",
    re.I,
)
WRITE = re.compile(
    r"^(Save|Add|Insert|Update|Delete|Remove|Persist|Publish|Send|Commit|Create|Put|Post|Write|Upsert|Store|Execute|Transfer)"
)
RECEIVER = re.compile(r"^await\s+\(?\s*([\w.]+?)(?:\s*\.\w+\s*(?:<[^>]*>)?\s*\(|\s*\.\s*$)")
METHOD = re.compile(r"\.(\w+)\s*(?:<[^>]*>)?\s*\(")
LIST_MAX = 12


def outer_methods(text):
    depth, out = 0, []
    for m in re.finditer(r"[()]|\.(\w+)\s*(?:<[^>]*>)?\s*(?=\()", text):
        if m.group(0) == "(":
            depth += 1
        elif m.group(0) == ")":
            depth -= 1
        elif depth == 0:
            out.append(m.group(1))
    return out


def call_label(text):
    receiver = RECEIVER.match(text)
    methods = outer_methods(text) or METHOD.findall(text)
    return (receiver.group(1) if receiver else text.split("(")[0]), (methods[-1] if methods else "?")


def plural(n, word):
    return f"{n} {word}{'s' if n > 1 else ''}"


def ast_grep():
    return shutil.which("ast-grep") or shutil.which("sg")


def added_lines(path):
    out = subprocess.run(["git", "diff", "-U0", "--", path], capture_output=True, text=True, cwd=ROOT).stdout
    lines = set()
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start, count = int(m.group(1)), int(m.group(2) or 1)
        lines.update(range(start, start + count))
    return lines


def scan(binary, files):
    proc = subprocess.run(
        [binary, "scan", "-c", CONFIG, "--json=compact", *files],
        capture_output=True, text=True, cwd=ROOT,
    )
    if not proc.stdout.strip().startswith("["):
        sys.stderr.write(proc.stderr[:600])
        sys.exit(3)
    return json.loads(proc.stdout)


def rel(path):
    return os.path.relpath(path, ROOT) if os.path.isabs(path) else path


def analyse(matches, path, added):
    by_rule = {}
    for m in matches:
        if rel(m["file"]) != path:
            continue
        key = (m["range"]["start"]["line"] + 1, m["range"]["start"]["column"])
        by_rule.setdefault(m["ruleId"], {})[key] = " ".join(m["text"].split())
    calls = by_rule.get("await-member", {})
    in_loop = set(by_rule.get("await-member-in-loop", {}))
    in_lambda = set(by_rule.get("await-member-in-lambda", {}))
    filters = by_rule.get("memory-filter", {})
    includes = by_rule.get("include", {})

    flat, loop, lam, other_loop = [], [], [], []
    reads = writes = 0
    for key, text in sorted(calls.items()):
        receiver, method = call_label(text)
        label = f"L{key[0]} {receiver}.{method}" if receiver.count(".") < 2 else f"L{key[0]} {receiver.split('.')[0]}…{method}"
        new = added is None or key[0] in added
        if not new:
            label += " (pre-existing)"
        infra = bool(INFRA.search(receiver))
        if key in in_loop or key in in_lambda:
            where = "loop" if key in in_loop else "lambda"
            if infra:
                (loop if key in in_loop else lam).append((label, new))
            else:
                other_loop.append((f"{label} [{where}]", new))
        elif infra:
            flat.append((label, new))
            if WRITE.match(method):
                writes += 1
            else:
                reads += 1
        else:
            other_loop.append((f"{label} [outside loop]", new))

    filt = [(f"L{k[0]} {t}" + ("" if added is None or k[0] in added else " (pre-existing)"), added is None or k[0] in added) for k, t in sorted(filters.items())]
    inc = [f"L{k[0]} {t}" for k, t in sorted(includes.items())]

    def show(title, items):
        if items:
            shown = " · ".join(i[0] for i in items[:LIST_MAX])
            more = f" · … +{len(items) - LIST_MAX}" if len(items) > LIST_MAX else ""
            print(f"{title} ({len(items)}): {shown}{more}")

    print(f"=== {path}")
    show("Infrastructure outside loop", flat)
    show("Infrastructure in loop", loop)
    show("Infrastructure in lambda", lam)
    show("Other awaits — to classify", other_loop)
    show("In-memory filter on awaited result", filt)
    if inc:
        print(f"Include ({len(inc)}) : " + " · ".join(inc))
    blocking = [i for i in loop + lam + filt if i[1]]
    return reads, writes, blocking


def main(argv):
    if not argv:
        print(__doc__.split("Usage:")[1].split("Exit 0")[0].strip())
        return 2
    binary = ast_grep()
    if not binary:
        print("ast-grep missing — brew install ast-grep — cost not checked mechanically, state it by hand")
        return 3
    diff_mode = argv == ["--diff"]
    if diff_mode:
        out = subprocess.run(["git", "diff", "--name-only", "--", "src/"], capture_output=True, text=True, cwd=ROOT).stdout
        files = [f for f in out.split() if f.endswith(".cs") and os.path.exists(os.path.join(ROOT, f))]
        if not files:
            print("no .cs file modified under src/")
            return 0
    else:
        files = [rel(f) for f in argv]
        missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
        if missing:
            print("not found: " + ", ".join(missing))
            return 2
    matches = scan(binary, files)
    reads = writes = 0
    blocking = []
    for f in files:
        r, w, b = analyse(matches, f, added_lines(f) if diff_mode else None)
        reads += r
        writes += w
        blocking += b
    verdict = "none" if not blocking else f"{len(blocking)} — design to revisit"
    print(f"Cost: {plural(reads, 'read')} + {plural(writes, 'write')} outside loop; Infrastructure in loop or in-memory filter: {verdict}")
    return 2 if blocking else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
