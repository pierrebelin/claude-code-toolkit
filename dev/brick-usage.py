#!/usr/bin/env python3
"""What each hook of the kit did, read from the transcripts (maintainer tool).

Usage:
    python3 <kit checkout>/dev/brick-usage.py [--days N] [--until YYYY-MM-DD] [--project <substring>] [--top K]

Run from inside the repo measured: the default project filter is its folder name. Reads every
transcript of the matching projects, subagents included. Two sources:

- `hook_success` records whose command runs a script of this kit (`hooks/<name>.sh`,
  `tools/doctor`). Claude Code writes one only when the hook printed something: the count is
  of outputs, not of fires — a hook that exits silently leaves no trace.
- refusals: a tool result opening `PreToolUse:<Tool> hook error:`, attributed to the kit hook
  `hooks/hooks.json` wires on that tool.

One line per hook: outputs, their total and median wall time, then what reached the model —
`deny` (a refusal), `ask`, `context` (an additionalContext injection), `rewrite` (the call
rewritten, `updatedInput`), `other` (any other output). Under each hook, its K most frequent
outputs by their first words: for `bash-dispatch.sh` they name the `lib/` module that answered.

It fills the Evidence column of `docs/BRICKS.md`: a brick that fires often and never
reaches the model costs time for nothing; one whose outputs are mostly the same reminder
is a candidate for the re-test. What followed an output (the next call) is
`dev/turn-batching-check.py`'s.
"""

import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import statistics
import sys

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
from kit_config import project_root  # noqa: E402

DEFAULT_PROJECT = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(project_root())).strip("-")
SCRIPT = re.compile(r"(hooks/[\w.-]+\.sh|tools/doctor)")
KIT_HOOKS = {n for n in os.listdir(os.path.join(HERE, "hooks")) if n.endswith(".sh")} | {"doctor"}
DENIAL = re.compile(r"^PreToolUse:(\w+) hook error: (.*)", re.S)


def wiring():
    """Tool name → the kit hook PreToolUse runs on it (hooks/hooks.json)."""
    with open(os.path.join(HERE, "hooks", "hooks.json")) as fh:
        hooks = json.load(fh)["hooks"]
    out = {}
    for m in hooks.get("PreToolUse", []):
        names = [SCRIPT.search(h["command"]).group(1).split("/")[-1] for h in m["hooks"] if SCRIPT.search(h["command"])]
        for tool in m.get("matcher", "").split("|"):
            if names:
                out[tool] = names[0]
    return out


def moment(stamp):
    try:
        return dt.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def outcome(stdout):
    """(kind, text) of what a hook printed: the kind that reached the model and its words."""
    out = (stdout or "").strip()
    if not out or out == "{}":
        return None, ""
    try:
        data = json.loads(out)
    except ValueError:
        return "other", out
    spec = data.get("hookSpecificOutput") or {}
    decision = spec.get("permissionDecision") or data.get("decision")
    if decision in ("deny", "block"):
        return "deny", spec.get("permissionDecisionReason") or data.get("reason") or ""
    if decision == "ask":
        return "ask", spec.get("permissionDecisionReason") or ""
    if spec.get("additionalContext"):
        return "context", spec["additionalContext"]
    if spec.get("updatedInput"):
        new = spec["updatedInput"]
        text = new.get("command") or new.get("description") or json.dumps(new)
        text = re.sub(r"^cd \S+ && ", "", text)
        return "rewrite", text.split()[0] if "command" in new and text.split() else text
    if data.get("systemMessage"):
        return "other", data["systemMessage"]
    return None, ""


def head(text, words=7):
    """First words, paths folded: one key per message, not per file."""
    text = re.sub(r"\d+", "N", re.sub(r"(?<![\w`])/\S+", "<path>", str(text)))
    return " ".join(text.split()[:words])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--until", help="ignore records from this date on (YYYY-MM-DD)")
    ap.add_argument("--project", default=DEFAULT_PROJECT, help="substring of the project folder")
    ap.add_argument("--top", type=int, default=3)
    args = ap.parse_args()

    until = dt.datetime.fromisoformat(args.until) if args.until else dt.datetime.now()
    since = until - dt.timedelta(days=args.days)
    dirs = [d for d in glob.glob(os.path.join(PROJECTS_DIR, "*")) if args.project in os.path.basename(d)]
    if not dirs:
        sys.exit(f"no project folder matching {args.project!r} under {PROJECTS_DIR}")

    fires = collections.Counter()
    times = collections.defaultdict(list)
    kinds = collections.defaultdict(collections.Counter)
    texts = collections.defaultdict(collections.Counter)
    wired = wiring()
    files = sessions = 0
    for d in dirs:
        for path in glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True):
            files += 1
            seen = False
            with open(path, errors="ignore") as fh:
                for line in fh:
                    success = '"hook_success"' in line
                    if not success and "hook error:" not in line:
                        continue
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    when = moment(entry.get("timestamp"))
                    if not when or not (since <= when < until):
                        continue
                    if not success:
                        for block in (entry.get("message") or {}).get("content") or []:
                            body = block.get("content") if isinstance(block, dict) and block.get("type") == "tool_result" else None
                            body = body[0].get("text", "") if isinstance(body, list) and body else body
                            m = DENIAL.match(body) if isinstance(body, str) else None
                            if m and m.group(1) in wired:
                                key = f"{wired[m.group(1)]} (PreToolUse)"
                                kinds[key]["deny"] += 1
                                texts[key][f"deny: {head(m.group(2))}"] += 1
                                seen = True
                        continue
                    a = entry.get("attachment") or {}
                    m = SCRIPT.search(a.get("command") or "")
                    if not m or m.group(1).split("/")[-1] not in KIT_HOOKS:
                        continue
                    seen = True
                    name = m.group(1).split("/")[-1]
                    event = a.get("hookEvent", "")
                    key = f"{name} ({event})"
                    fires[key] += 1
                    times[key].append(a.get("durationMs") or 0)
                    kind, text = outcome(a.get("stdout"))
                    if kind:
                        kinds[key][kind] += 1
                        texts[key][f"{kind}: {head(text)}"] += 1
            sessions += seen

    print(f"{len(dirs)} project folder(s) · {files} transcript(s) · {sessions} with a kit hook · "
          f"{since:%Y-%m-%d} → {until:%Y-%m-%d}")
    keys = sorted(set(fires) | set(kinds), key=lambda k: -(fires[k] + sum(kinds[k].values())))
    if not keys:
        print("no kit hook output")
        return
    print(f"\n{'hook':<44}{'outputs':>8}{'total s':>9}{'median ms':>11}  reached the model")
    for key in keys:
        ms = times[key] or [0]
        reached = ", ".join(f"{k} {v}" for k, v in kinds[key].most_common()) or "never"
        print(f"{key:<44}{fires[key]:>8}{sum(ms) / 1000:>9.0f}{statistics.median(ms):>11.0f}  {reached}")
        for text, c in texts[key].most_common(args.top):
            print(f"{'':<6}x{c:<5} {text}")


if __name__ == "__main__":
    main()
