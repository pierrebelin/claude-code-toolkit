#!/usr/bin/env python3
"""Wall-clock breakdown of an /implement-tdd batch, from the transcripts.

Why. The harness audit of 2026-09-13 broke ten batches down with a script thrown
into a session scratchpad, so it died at the first reboot. Measuring five batches
after a harness change needs a script that survives.

What turn-batching-check.py does not do. Its "wall clock" section aggregates a
window of days (round trips, tool calls, gaps, graph rebuilds). Here the unit is
the batch: one line per session, the four buckets that share the wall time, the
turns that fall after the first audit, and the per-subagent-type detail. The two
measurements answer different questions and do not replace each other.

Splitting the wall time. A transcript carries timestamps, not durations: every
interval is attributed to what caused it.
  - model: from the end of a group to the last event of the next assistant group
  - tools: from a tool_use to its tool_result, main chain only
  - agents: waiting on a subagent notification (background work)
  - human: waiting on a prompt, AskUserQuestion counted separately

Usage:
  python3 scripts/batch-wallclock.py                        # batches found over 14 days
  python3 scripts/batch-wallclock.py --days 30
  python3 scripts/batch-wallclock.py --sessions 414e09fe cbbd2284
  python3 scripts/batch-wallclock.py --project <repo folder> --subagents
"""

import argparse
import collections
import datetime
import glob
import json
import os
import re
import statistics
import sys

PROJECTS = os.path.expanduser("~/.claude/projects")
LAUNCH_RE = re.compile(r"<command-name>/?implement-tdd</command-name>", re.I)
AUDIT_SKILL = "verify-ddd-tdd"
AUDITOR_AGENT = "ddd-tdd-auditor"


def project_dir(name):
    """The transcript folder normalises every non-alphanumeric character to a dash.

    Same fix as turn-batching-check.py: a name passed verbatim finds nothing, the
    folder is called "-Users-…-My-Repo".
    """
    slug = re.sub(r"[^A-Za-z0-9]", "-", name)
    hits = [d for d in glob.glob(os.path.join(PROJECTS, "*")) if d.endswith(slug)]
    if not hits:
        hits = [d for d in glob.glob(os.path.join(PROJECTS, "*")) if slug in os.path.basename(d)]
    return hits[0] if hits else None


def parse_ts(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load(path):
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") not in ("user", "assistant") or not o.get("timestamp"):
                continue
            out.append(o)
    out.sort(key=lambda o: o["timestamp"])
    return out


def blocks(o):
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list):
        return c
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return []


def text_of(o):
    return " ".join(b.get("text", "") for b in blocks(o) if b.get("type") == "text")


def classify(o):
    """A user message without a tool_result is either an agent notification, a human
    prompt, or a harness injection. The three do not wait on the same thing and are
    not counted together."""
    txt = text_of(o)
    low = txt.lower()
    if "task-notification" in low or "async agent" in low:
        return "notif"
    if "agent" in low and "completed" in low[:400]:
        return "notif"
    stripped = txt.lstrip()
    if not stripped or stripped.startswith(("<local-command", "<command-", "<system-reminder")):
        return "system"
    return "prompt"


def analyse(entries):
    groups = []
    for o in entries:
        t = parse_ts(o["timestamp"])
        if o["type"] == "assistant":
            mid = (o.get("message") or {}).get("id") or o.get("uuid")
            if groups and groups[-1]["kind"] == "a" and groups[-1]["mid"] == mid:
                g = groups[-1]
                g["t_last"] = t
            else:
                g = {"kind": "a", "mid": mid, "t_first": t, "t_last": t, "tools": [], "usage": None}
                groups.append(g)
            usage = (o.get("message") or {}).get("usage") or {}
            if usage:
                g["usage"] = (
                    usage.get("input_tokens", 0)
                    + usage.get("cache_creation_input_tokens", 0)
                    + usage.get("cache_read_input_tokens", 0)
                )
            for b in blocks(o):
                if b.get("type") != "tool_use":
                    continue
                inp = b.get("input") or {}
                desc = (
                    inp.get("command")
                    or inp.get("description")
                    or inp.get("skill")
                    or inp.get("file_path")
                    or ""
                )
                g["tools"].append((b.get("id"), b.get("name"), " ".join(str(desc).split())[:60], t, inp))
        else:
            res = [b.get("tool_use_id") for b in blocks(o) if b.get("type") == "tool_result"]
            cls = "result" if res else classify(o)
            if groups and groups[-1]["kind"] == "u" and groups[-1]["cls"] == cls == "result":
                g = groups[-1]
                g["t_last"] = t
                g["results"] += res
            else:
                groups.append({"kind": "u", "t_first": t, "t_last": t, "results": res, "cls": cls})

    cat = collections.defaultdict(float)
    counts = collections.Counter()
    per_tool = collections.defaultdict(float)
    n_tool = collections.Counter()
    pending = {}
    audits, long_bash, agent_calls = [], [], []
    longest = (0.0, "", "")
    rounds = rounds_after = 0
    first_ctx = last_ctx = None
    seen_audit = False

    for i, g in enumerate(groups):
        if g["kind"] == "a":
            rounds += 1
            if seen_audit:
                rounds_after += 1
            if g["usage"]:
                first_ctx = g["usage"] if first_ctx is None else first_ctx
                last_ctx = g["usage"]
            if i > 0:
                cat["model"] += (g["t_last"] - groups[i - 1]["t_last"]).total_seconds()
            for tid, name, desc, t, inp in g["tools"]:
                pending[tid] = (name, desc, t, inp)
                if name == "Skill" and AUDIT_SKILL in str(inp.get("skill", "")):
                    seen_audit = True
                if name == "Agent" and inp.get("subagent_type") == AUDITOR_AGENT:
                    seen_audit = True
            if i + 1 < len(groups) and groups[i + 1]["kind"] == "u":
                # Two assistant groups in a row (split message, resume after an
                # interruption): the interval is already counted as "model" by the
                # next group, and that group carries no class.
                nxt = groups[i + 1]
                gap = (nxt["t_last"] - g["t_last"]).total_seconds()
                if nxt["cls"] == "result":
                    key = "ask" if any(n == "AskUserQuestion" for _, n, _, _, _ in g["tools"]) else "tool"
                    cat[key] += gap
                else:
                    cat[nxt["cls"]] += gap
                    counts[nxt["cls"]] += 1
        else:
            for tid in g["results"]:
                hit = pending.pop(tid, None)
                if not hit:
                    continue
                name, desc, t0, inp = hit
                dur = (g["t_last"] - t0).total_seconds()
                per_tool[name] += dur
                n_tool[name] += 1
                if name == "Skill" and AUDIT_SKILL in str(inp.get("skill", "")):
                    audits.append(dur)
                if name == "Agent":
                    agent_calls.append((inp.get("subagent_type", "?"), inp.get("prompt", "")[:200], dur))
                if name == "Bash" and dur > 120:
                    long_bash.append((dur, desc))
                if dur > longest[0]:
                    longest = (dur, name, desc)

    wall = (groups[-1]["t_last"] - groups[0]["t_first"]).total_seconds() if groups else 0.0
    return dict(
        wall=wall, cat=cat, counts=counts, rounds=rounds, rounds_after=rounds_after,
        audits=audits, long_bash=long_bash, agent_calls=agent_calls, longest=longest,
        per_tool=per_tool, n_tool=n_tool, first=first_ctx, last=last_ctx,
        start=groups[0]["t_first"] if groups else None,
    )


def is_batch(entries):
    """Two signals, both required: the batch was launched, and it delegated.

    The launch alone is not enough — a session that talks about the skill, quotes
    its name or reads its SKILL.md mentions it too. A batch always delegates at
    least one RED or one GREEN."""
    launched = delegated = False
    for o in entries:
        if o["type"] == "user" and LAUNCH_RE.search(text_of(o)):
            launched = True
        if o["type"] != "assistant":
            continue
        for b in blocks(o):
            if b.get("type") != "tool_use":
                continue
            inp = b.get("input") or {}
            if b.get("name") == "Skill" and inp.get("skill") == "implement-tdd":
                launched = True
            if b.get("name") == "Agent" and str(inp.get("subagent_type", "")).startswith("tdd-"):
                delegated = True
    return launched and delegated


def subagent_runs(directory, session_file, agent_calls):
    """Each subagent transcript is tied back to its type through the prompt the
    parent sent: the file carries neither subagent_type nor a usable slug (checked
    on 2026-09-14: slug is None on 76 transcripts out of 80)."""
    base = os.path.join(directory, os.path.basename(session_file)[:-6], "subagents")
    runs = []
    for path in sorted(glob.glob(os.path.join(base, "*.jsonl"))):
        entries = load(path)
        if not entries:
            continue
        head = text_of(entries[0])[:200]
        # A transcript no Agent call explains is the verify-ddd-tdd fork: the skill
        # runs in context: fork on ddd-tdd-auditor, never through Agent.
        kind = "verify-ddd-tdd (fork)"
        for stype, prompt, _ in agent_calls:
            if prompt and head and (head[:120] in prompt or prompt[:120] in head):
                kind = stype
                break
        runs.append((kind, analyse(entries)))
    return runs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Like turn-batching-check.py: the filter is derived from the repository folder
    # name, which is how Claude Code names the transcript directory.
    ap.add_argument("--project", default=os.path.basename(os.getcwd()))
    ap.add_argument("--days", type=int, default=14, help="search window for batches (0 = everything)")
    ap.add_argument("--sessions", nargs="*", default=None, help="session id prefixes")
    ap.add_argument("--subagents", action="store_true", help="per-subagent-type table")
    args = ap.parse_args()

    directory = project_dir(args.project)
    if not directory:
        print(f"No transcript folder for \"{args.project}\"", file=sys.stderr)
        return 1

    files = sorted(glob.glob(os.path.join(directory, "*.jsonl")))
    if args.sessions:
        files = [f for f in files if any(os.path.basename(f).startswith(s) for s in args.sessions)]
    cutoff = None
    if not args.sessions and args.days:
        # mtime pre-filter (a 200 MB transcript is expensive to re-read), but the
        # window is judged on the first message: a file touched by a resume keeps
        # the date of its batch.
        floor = datetime.datetime.now().timestamp() - args.days * 86400
        files = [f for f in files if os.path.getmtime(f) >= floor]
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=args.days)

    rows, totals, all_runs, all_audits = [], collections.defaultdict(float), [], []
    for path in files:
        entries = load(path)
        if not entries or (not args.sessions and not is_batch(entries)):
            continue
        r = analyse(entries)
        if r["wall"] < 300:
            continue
        if cutoff and r["start"] and r["start"] < cutoff:
            continue
        sid = os.path.basename(path)[:8]
        rows.append((sid, r))
        for key in ("wall", "model", "tool", "ask", "notif", "prompt", "system"):
            totals[key] += r["wall"] if key == "wall" else r["cat"].get(key, 0.0)
        all_audits += r["audits"]
        if args.subagents:
            all_runs += subagent_runs(directory, path, r["agent_calls"])

    if not rows:
        print("No batch found in the window.", file=sys.stderr)
        return 1

    print("session  date   wall | model  tools  human agents | turns (after 1st audit) | audits (min) | Bash > 2 min | ctx k first -> last")
    for sid, r in rows:
        c = r["cat"]
        date = r["start"].astimezone().strftime("%d/%m")
        audits = " / ".join("%.0f" % (d / 60) for d in r["audits"]) or "none"
        bash = " / ".join("%.0f" % (d / 60) for d, _ in sorted(r["long_bash"], reverse=True)[:3]) or "-"
        human = c.get("prompt", 0.0) + c.get("ask", 0.0)
        print("%s %s %4.0fm | %5.0fm %5.0fm %5.0fm %5.0fm | %4d (%3d) | %-12s | %-12s | %3.0f -> %3.0f"
              % (sid, date, r["wall"] / 60, c.get("model", 0) / 60, c.get("tool", 0) / 60,
                 human / 60, c.get("notif", 0) / 60, r["rounds"], r["rounds_after"],
                 audits, bash, (r["first"] or 0) / 1000, (r["last"] or 0) / 1000))

    n = len(rows)
    human_total = totals["prompt"] + totals["ask"]
    print("\n%d batch(es), %.0f min: model %.0f (%.0f %%), tools %.0f (%.0f %%), agents %.0f (%.0f %%), human %.0f (%.0f %%)"
          % (n, totals["wall"] / 60, totals["model"] / 60, 100 * totals["model"] / max(totals["wall"], 1),
             totals["tool"] / 60, 100 * totals["tool"] / max(totals["wall"], 1),
             totals["notif"] / 60, 100 * totals["notif"] / max(totals["wall"], 1),
             human_total / 60, 100 * human_total / max(totals["wall"], 1)))
    if all_audits:
        print("audits: %d passes, %.1f per batch, %.0f s on average, %.0f min in total (%.0f %% of the wall)"
              % (len(all_audits), len(all_audits) / n, statistics.mean(all_audits),
                 sum(all_audits) / 60, 100 * sum(all_audits) / max(totals["wall"], 1)))

    if args.subagents and all_runs:
        by_kind = collections.defaultdict(list)
        for kind, r in all_runs:
            by_kind[kind].append(r)
        print("\ntype                    runs | mean wall | mean turns | model/turn | tools | longest call")
        for kind, runs in sorted(by_kind.items(), key=lambda kv: -len(kv[1])):
            walls = [r["wall"] for r in runs]
            turns = [r["rounds"] for r in runs]
            per_turn = [r["cat"].get("model", 0) / r["rounds"] for r in runs if r["rounds"]]
            tools = [r["cat"].get("tool", 0) for r in runs]
            longest = max(runs, key=lambda r: r["longest"][0])["longest"]
            print("%-22s %5d | %8.0fs | %10.1f | %9.1fs | %5.0fs | %.0fs"
                  % (kind[:22], len(runs), statistics.mean(walls), statistics.mean(turns),
                     statistics.mean(per_turn) if per_turn else 0, statistics.mean(tools), longest[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
