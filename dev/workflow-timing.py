#!/usr/bin/env python3
"""Duration per phase and per agent of one Workflow run (maintainer tool).

Usage:
    python3 <kit checkout>/dev/workflow-timing.py <run dir> [--json] [--slow SECONDS]

<run dir> = ~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/, holding
journal.jsonl (agent order, label, phase) and one agent-<id>.jsonl transcript per agent.
Output: one line per agent (phase, label, model, start offset, duration, reads, greps,
Bash calls, Bash time), then per phase its wall-clock (union of its agents' spans) and its
summed agent time, then the run's span. A gap of 5 min or more inside one transcript is a
stall (interruption, permission prompt, cut stream): shown apart, left out of the times. A Bash call longer than --slow (default 60 s) is
listed under its agent. --json prints the same figures as one JSON object.

A run-lot phase is read from the agent label (the journal names the calling skill only);
labels follow workflows/run-lot.js and run-plan.js.
"""

import argparse
import datetime
import json
import os
import re
import sys

# Label prefix → run-lot / run-plan phase, first match wins.
PHASES = [
    (r"^(resume state|design|index |declaratives|closing level)", "Design"),
    (r"^(RED \S+ w\d+ .*\+GREEN|CYCLE\b)", "CYCLE"),
    (r"^RED\b", "RED"),
    (r"^GREEN\b", "GREEN"),
    (r"^suites", "Global green"),
    (r"^pre-audit", "Closing"),
    (r"^(audit|verify|round |fix\b|capture|review light)", "Audit"),
    (r"^(next batch review|next sheet)", "Review"),
    # Runs before 2.6.0 only: run-lot no longer launches an arbiter nor a question.
    (r"^arbiter", "Arbiter"),
    (r"^(question|wait )", "Question"),
    (r"^report", "Report"),
]
# A gap this long between two entries of one transcript is a stall (interruption, permission
# prompt, cut stream), not work: reported apart and left out of the active time.
IDLE = 300
GREP_IN_BASH = re.compile(r"(^|[\s|;&(])(git grep|grep|rg|egrep|findstr)\b")


def phase_of(label, fallback):
    for pattern, name in PHASES:
        if re.search(pattern, label or ""):
            return name
    return fallback or "?"


def stamp(text):
    try:
        return datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def read_jsonl(path):
    out = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out


def agent_figures(path, slow):
    lines = read_jsonl(path)
    # Sorted: an entry can land out of order (a Bash call moved to the background writes its result
    # later), and a gap read in file order then counts twice — the stall outgrew the span (-7:56).
    times = sorted(t for t in (stamp(d.get("timestamp")) for d in lines) if t)
    idle = sum(b - a for a, b in zip(times, times[1:]) if b - a >= IDLE)
    calls, reads, greps, bash = 0, 0, 0, 0
    bash_time, slow_calls, opened, model = 0.0, [], {}, ""
    for d in lines:
        msg = d.get("message") if isinstance(d.get("message"), dict) else {}
        model = model or msg.get("model", "")
        content = msg.get("content") if isinstance(msg.get("content"), list) else []
        t = stamp(d.get("timestamp"))
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use":
                calls += 1
                name, inp = item.get("name", ""), item.get("input") or {}
                if name == "Read":
                    reads += 1
                elif name in ("Grep", "Glob"):
                    greps += 1
                elif name == "Bash":
                    bash += 1
                    cmd = str(inp.get("command", ""))
                    if GREP_IN_BASH.search(cmd):
                        greps += 1
                    if re.search(r"(^|[\s|;&])(cat|sed -n|head|tail)\b", cmd):
                        reads += 1
                    opened[item.get("id")] = (t, cmd)
            elif item.get("type") == "tool_result" and item.get("tool_use_id") in opened:
                began, cmd = opened.pop(item.get("tool_use_id"))
                if began and t:
                    bash_time += t - began
                    if t - began >= slow:
                        slow_calls.append({"seconds": round(t - began), "command": cmd.splitlines()[0][:120] if cmd else ""})
    return {
        "start": min(times) if times else None,
        "end": max(times) if times else None,
        "model": model,
        "calls": calls,
        "reads": reads,
        "greps": greps,
        "bash": bash,
        "bashSeconds": round(bash_time),
        "slow": slow_calls,
        "idle": round(idle),
    }


def union(spans):
    total, cur = 0.0, None
    for a, b in sorted(s for s in spans if s[0] is not None and s[1] is not None):
        if cur and a <= cur[1]:
            cur[1] = max(cur[1], b)
            continue
        if cur:
            total += cur[1] - cur[0]
        cur = [a, b]
    if cur:
        total += cur[1] - cur[0]
    return total


def minutes(seconds):
    seconds = int(round(seconds or 0))
    return f"{seconds // 60}:{seconds % 60:02d}"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run", help="workflow run folder (wf_<id>)")
    ap.add_argument("--json", action="store_true", help="print one JSON object")
    ap.add_argument("--slow", type=float, default=60, help="list Bash calls at least this long (seconds)")
    a = ap.parse_args()

    journal = read_jsonl(os.path.join(a.run, "journal.jsonl"))
    if not journal:
        print(f"workflow-timing: no journal.jsonl under {a.run}", file=sys.stderr)
        return 2
    agents, seen = [], set()
    for d in journal:
        if d.get("type") != "started" or d.get("agentId") in seen:
            continue
        seen.add(d["agentId"])
        figures = agent_figures(os.path.join(a.run, f"agent-{d['agentId']}.jsonl"), a.slow)
        agents.append({"id": d["agentId"], "label": d.get("label", ""), "phase": phase_of(d.get("label", ""), d.get("phase", "")), **figures})

    starts = [x["start"] for x in agents if x["start"]]
    origin = min(starts) if starts else 0
    ends = [x["end"] for x in agents if x["end"]]
    phases = {}
    for x in agents:
        p = phases.setdefault(x["phase"], {"agents": 0, "spans": [], "summed": 0.0, "idle": 0, "reads": 0, "greps": 0})
        p["agents"] += 1
        p["spans"].append((x["start"], x["end"]))
        p["summed"] += (x["end"] or 0) - (x["start"] or 0) - x["idle"]
        p["idle"] += x["idle"]
        p["reads"] += x["reads"]
        p["greps"] += x["greps"]
    out = {
        "run": a.run.replace("\\", "/"),
        "span": (max(ends) - origin) if ends else 0,
        "idle": sum(x["idle"] for x in agents),
        "agents": [{**x, "offset": (x["start"] - origin) if x["start"] else None, "seconds": ((x["end"] or 0) - (x["start"] or 0) - x["idle"])} for x in agents],
        "phases": [{"phase": k, "agents": v["agents"], "wall": union(v["spans"]) - v["idle"], "summed": v["summed"], "idle": v["idle"], "reads": v["reads"], "greps": v["greps"]} for k, v in phases.items()],
    }
    if a.json:
        for x in out["agents"]:
            x.pop("start", None)
            x.pop("end", None)
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 0

    print(f"{'phase':<13} {'label':<44} {'model':<18} {'at':>6} {'time':>6} {'reads':>5} {'greps':>5} {'bash':>4} {'bash t':>6}")
    for x in out["agents"]:
        print(f"{x['phase']:<13} {x['label'][:44]:<44} {x['model'][:18]:<18} {minutes(x['offset']):>6} {minutes(x['seconds']):>6} {x['reads']:>5} {x['greps']:>5} {x['bash']:>4} {minutes(x['bashSeconds']):>6}")
        if x["idle"]:
            print(f"{'':<13}   stalled {minutes(x['idle'])} (gaps of {IDLE // 60} min or more, left out of its time)")
        for s in x["slow"]:
            print(f"{'':<13}   slow Bash {s['seconds']} s: {s['command']}")
    print()
    print(f"{'phase':<13} {'agents':>6} {'wall':>7} {'summed':>7} {'reads':>5} {'greps':>5}")
    for p in out["phases"]:
        print(f"{p['phase']:<13} {p['agents']:>6} {minutes(p['wall']):>7} {minutes(p['summed']):>7} {p['reads']:>5} {p['greps']:>5}")
    print(f"\nrun span: {minutes(out['span'])}, stalled: {minutes(out['idle'])}, active: {minutes(out['span'] - out['idle'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
