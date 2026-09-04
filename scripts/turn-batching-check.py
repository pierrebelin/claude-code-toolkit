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
import glob
import json
import os
import re
import time

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PROJECT = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(REPO_ROOT)).strip("-")
READ_TOOLS = {"Read", "Grep", "Glob"}
READ_COMMANDS = {
    "cat", "ls", "head", "tail", "wc", "find", "grep", "sed", "awk",
    "git", "python3", "rg", "file", "stat",
}


def is_read_only(name, command):
    if name in READ_TOOLS:
        return True
    if name != "Bash":
        return False
    return command.strip().split(" ")[0] in READ_COMMANDS


def turns_of(path, seen):
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
            message = entry.get("message") or {}
            role = message.get("role")
            if role == "assistant":
                identifier = message.get("id")
                if not identifier or identifier in seen:
                    continue
                seen.add(identifier)
                for block in message.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        order.append(block)
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
                        results[block.get("tool_use_id")] = size
    for block in order:
        payload = block.get("input") or {}
        yield (
            block.get("name"),
            payload.get("command", "") or "",
            payload,
            results.get(block.get("id"), 0),
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=0, help="keep only the last N days")
    parser.add_argument("--project", default=DEFAULT_PROJECT, help="filter on the project folder name")
    args = parser.parse_args()

    pattern = os.path.join(PROJECTS_DIR, f"*{args.project}*", "*.jsonl")
    files = glob.glob(pattern)
    if args.days:
        cutoff = time.time() - args.days * 86400
        files = [f for f in files if os.path.getmtime(f) >= cutoff]
    if not files:
        print(f"No transcript for the filter '{args.project}'.")
        return 1

    seen = set()
    calls_per_turn = collections.Counter()
    read_runs = collections.Counter()
    reads = collections.defaultdict(list)
    total_calls = read_calls = 0

    for path in files:
        run = 0
        session_reads = collections.defaultdict(list)
        for name, command, payload, size in turns_of(path, seen):
            total_calls += 1
            calls_per_turn[1] += 1
            if is_read_only(name, command):
                read_calls += 1
                run += 1
            else:
                if run:
                    read_runs[run] += 1
                run = 0
            if name == "Read":
                partial = "offset" in payload or "limit" in payload
                session_reads[payload.get("file_path", "?")].append((size, partial))
        if run:
            read_runs[run] += 1
        for file_path, entries in session_reads.items():
            reads[file_path].append(entries)

    turns = sum(calls_per_turn.values())
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
    print(f"\nRead with offset/limit: {partials}/{total_reads} "
          f"({partials / max(total_reads, 1) * 100:.0f} %)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
