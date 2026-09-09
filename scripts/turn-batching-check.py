#!/usr/bin/env python3
"""Measures tool-call batching in this project's Claude Code sessions.

The cost of a session follows the number of turns: every turn resends the whole
accumulated context. Two independent calls made in two turns pay that accumulation
twice. This script measures what could have fitted in a single message.

Usage:
    python3 scripts/turn-batching-check.py [--days N] [--project <substring>]

By default the project filter is derived from the repository folder name, which is
how Claude Code names the transcript directory under ~/.claude/projects.

Output: calls per turn, batchable read runs, files read whole more than once.
"""

import argparse
import collections
import datetime
import glob
import json
import os
import re
import time

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PROJECT = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(REPO_ROOT)).strip("-")
READ_TOOLS = {"Read", "Grep", "Glob"}
# Emitted verbatim by .claude/hooks/read-bounds.sh — frozen literal.
DENIAL_MARK = "Unbounded Read on"

LB = {
    "read_bounded": "Read with offset/limit: ",
    "fill_header": "=== context fill ===",
    "injected": "bytes injected by tools: ",
    "over": "over",
    "turns": "turns",
    "per_turn": "B/turn",
    "calls": "calls",
    "avg": "avg",
    "denials": "read-bounds denials: ",
    "forcings": "forcings (same Read re-issued): ",
    "forced": " · forced",
    "written": "baseline written: ",
    "delta_header": "=== delta against baseline ===",
    "better": "better",
    "worse": "worse",
    "flat": "flat",
    "help_save": "write the current snapshot to this JSON file",
    "help_compare": "compare the current snapshot to this JSON file",
    "help_until": "ignore turns from this date on (YYYY-MM-DD)",
}

READ_COMMANDS = {
    "cat", "ls", "head", "tail", "wc", "find", "grep", "sed", "awk",
    "git", "python3", "rg", "file", "stat",
}


def within(stamp, cutoff, until=None):
    """True when the entry's ISO timestamp is at or after the epoch threshold."""
    if not stamp:
        return False
    try:
        moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
        if until and moment >= until:
            return False
        return moment >= (cutoff or 0)
    except ValueError:
        return False


def is_read_only(name, command):
    if name in READ_TOOLS:
        return True
    if name != "Bash":
        return False
    return command.strip().split(" ")[0] in READ_COMMANDS


def turns_of(path, seen, cutoff=None, until=None):
    """Yield (tool_name, command, input, result_size) for each main-chain tool call."""
    order, results = [], {}
    with open(path, encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("isSidechain"):
                continue
            if (cutoff or until) and not within(entry.get("timestamp"), cutoff, until):
                continue
            message = entry.get("message") or {}
            role = message.get("role")
            if role == "assistant":
                identifier = message.get("id")
                if not identifier:
                    continue
                for block in message.get("content") or []:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    key = (identifier, block.get("id"))
                    if key in seen:
                        continue
                    seen.add(key)
                    order.append((identifier, block))
            elif role == "user" and isinstance(message.get("content"), list):
                for block in message["content"]:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        content = block.get("content")
                        size = (
                            len(content)
                            if isinstance(content, str)
                            else sum(
                                len(part.get("text", ""))
                                for part in content or []
                                if isinstance(part, dict)
                            )
                        )
                        text = (
                            content
                            if isinstance(content, str)
                            else " ".join(
                                part.get("text", "")
                                for part in content or []
                                if isinstance(part, dict)
                            )
                        )
                        results[block.get("tool_use_id")] = (size, text[:200])
    for turn_id, block in order:
        payload = block.get("input") or {}
        size, text = results.get(block.get("id"), (0, ""))
        yield (
            turn_id,
            block.get("name"),
            payload.get("command", "") or "",
            payload,
            size,
            DENIAL_MARK in text,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=0, help="keep only the last N days")
    parser.add_argument("--save-baseline", help=LB["help_save"])
    parser.add_argument("--compare", help=LB["help_compare"])
    parser.add_argument("--until", help=LB["help_until"])
    parser.add_argument("--project", default=DEFAULT_PROJECT, help="filter on the project folder name")
    args = parser.parse_args()

    pattern = os.path.join(PROJECTS_DIR, f"*{args.project}*", "*.jsonl")
    files = glob.glob(pattern)
    cutoff = time.time() - args.days * 86400 if args.days else None
    until = datetime.datetime.fromisoformat(args.until).timestamp() if args.until else None
    if cutoff:
        files = [f for f in files if os.path.getmtime(f) >= cutoff]
    if not files:
        print(f"No transcript for the filter '{args.project}'.")
        return 1

    seen = set()
    calls_per_turn = collections.Counter()
    read_runs = collections.Counter()
    reads = collections.defaultdict(list)
    tool_bytes = collections.Counter()
    tool_calls = collections.Counter()
    denials = collections.Counter()
    forcings = collections.Counter()
    total_calls = read_calls = 0

    for path in files:
        run = set()
        session_reads = collections.defaultdict(list)
        refused = set()
        for turn_id, name, command, payload, size, denied in turns_of(path, seen, cutoff, until):
            total_calls += 1
            tool_bytes[name] += size
            tool_calls[name] += 1
            if name == "Read":
                target = payload.get("file_path", "?")
                if denied:
                    denials[target] += 1
                    refused.add(target)
                elif target in refused and not ("offset" in payload or "limit" in payload):
                    forcings[target] += 1
            calls_per_turn[turn_id] += 1
            if is_read_only(name, command):
                read_calls += 1
                run.add(turn_id)
            else:
                if run:
                    read_runs[len(run)] += 1
                run = set()
            if name == "Read":
                partial = "offset" in payload or "limit" in payload
                session_reads[payload.get("file_path", "?")].append((size, partial))
        if run:
            read_runs[len(run)] += 1
        for file_path, entries in session_reads.items():
            reads[file_path].append(entries)

    turns = len(calls_per_turn)
    groupable = sum((n - 1) * c for n, c in read_runs.items() if n > 1)

    print(f"{len(files)} transcript(s) · {turns} turns with a tool · {total_calls} calls")
    print(f"calls per turn: {total_calls / max(turns, 1):.2f}  (target > 1.30)")
    print(f"\nreads (Read/Grep/Glob/read-only Bash): {read_calls} calls")
    print(f"turns saveable by batching the runs: {groupable} "
          f"({groupable / max(read_calls, 1) * 100:.0f} %)")

    full = []
    for file_path, sessions in reads.items():
        for entries in sessions:
            fulls = [s for s, p in entries if not p]
            if len(fulls) > 1:
                full.append((max(fulls), file_path, len(fulls)))
    if full:
        print("\nfiles read WHOLE more than once IN THE SAME session:")
        for size, file_path, count in sorted(full, reverse=True)[:10]:
            print(f"  {size // 1000:4d}k x{count}  {os.path.basename(file_path)}")
    else:
        print("\nno file read whole more than once in the same session.")

    partials = sum(1 for sessions in reads.values() for e in sessions for s, p in e if p)
    total_reads = sum(len(e) for sessions in reads.values() for e in sessions)
    bounded_pct = partials / max(total_reads, 1) * 100
    print(f"\n{LB['read_bounded']}{partials}/{total_reads} ({bounded_pct:.0f} %)")

    tool_total = sum(tool_bytes.values())
    print(f"\n{LB['fill_header']}")
    print(f"{LB['injected']}{tool_total / 1e6:.2f} Mo {LB['over']} {turns} {LB['turns']} "
          f"({tool_total // max(turns, 1)} {LB['per_turn']})")
    for name, count in tool_bytes.most_common(6):
        calls = tool_calls[name]
        print(f"  {name:12s} {count / 1e6:6.2f} Mo {count / max(tool_total, 1) * 100:5.1f} %  "
              f"{calls:5d} {LB['calls']} {LB['avg']} {count // max(calls, 1):6d}")

    denied_total = sum(denials.values())
    forced_total = sum(forcings.values())
    print(f"\n{LB['denials']}{denied_total} · {LB['forcings']}{forced_total}")
    for target, count in denials.most_common(5):
        suffix = LB["forced"] if forcings.get(target) else ""
        print(f"  x{count}  {os.path.basename(target)}{suffix}")

    snapshot = {
        "turns": turns,
        "calls": total_calls,
        "calls_per_turn": round(total_calls / max(turns, 1), 3),
        "read_bounded_pct": round(bounded_pct, 1),
        "bytes_per_turn": tool_total // max(turns, 1),
        "tool_bytes_total": tool_total,
        "bytes_per_tool": dict(tool_bytes.most_common(10)),
        "avg_bytes": {n: tool_bytes[n] // max(tool_calls[n], 1)
                      for n, _ in tool_bytes.most_common(6)},
        "reread_whole": len(full),
        "denials": denied_total,
        "forcings": forced_total,
    }
    if args.save_baseline:
        with open(args.save_baseline, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, indent=2)
        print(f"\n{LB['written']}{args.save_baseline}")
    if args.compare:
        with open(args.compare, encoding="utf-8") as handle:
            base = json.load(handle)
        print(f"\n{LB['delta_header']}")
        for key, lower_is_better in (("calls_per_turn", False), ("read_bounded_pct", False),
                                     ("bytes_per_turn", True), ("reread_whole", True),
                                     ("forcings", True)):
            was, now = base.get(key), snapshot.get(key)
            if was is None or not isinstance(now, (int, float)):
                continue
            delta = now - was
            good = (delta < 0) if lower_is_better else (delta > 0)
            sign = "+" if delta > 0 else ("-" if delta < 0 else "=")
            verdict = LB["flat"] if not delta else (LB["better"] if good else LB["worse"])
            print(f"  {key:20s} {was} -> {now}  ({sign}{abs(delta):g}, {verdict})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
