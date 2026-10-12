#!/usr/bin/env python3
"""Questions a running run-lot / run-plan workflow asks the user, answered in the session.

The workflow writes `run/.work/<FX>/questions/<FX>-<n>.json`, then polls for its answer file
`<FX>-<n>.answer.json`; the session watches the run folder, asks through AskUserQuestion
and writes the answer. The run never stops nor resumes: it waits.

    run-question.py wait <question.json> [--seconds N]
        workflow side: exit 0 printing the answer JSON as soon as an answer file at least
        as recent as the question exists, exit 3 printing PENDING after N seconds
        (default 540). An older answer file is a leftover of an earlier run: ignored.
    run-question.py watch <dir> [--since EPOCH] [--seconds N]
        session side: exit 0 printing `QUESTION <path> since=<epoch> next=<epoch>` for the
        first unanswered question under <dir> modified after EPOCH (default: start time),
        exit 3 printing `TIMEOUT since=<epoch>` after N seconds (default 0 = never).
        Re-arm with `--since <next>`: the question being answered never fires twice.
    run-question.py pending <dir>
        unanswered questions under <dir>, one path per line
    run-question.py answer <question.json> <answers-json>
        writes the answer file atomically; <answers-json> = [{"id": "q1", "text": "..."}]
        or {"answers": [...]} (the shape `wait` prints), one entry per question id,
        `STOP` as text stops the batch

Question file: {"batch", "sheet", "kind": "stop"|"review", "context",
"questions": [{"id", "severity", "question", "evidence", "options", "recommendation"}]}.
"""
import json
import os
import sys
import time
from pathlib import Path

POLL = 2.0


def answer_path(question: Path) -> Path:
    return question.with_name(question.name[: -len(".json")] + ".answer.json")


def is_question(path: Path) -> bool:
    return path.parent.name == "questions" and path.name.endswith(".json") and not path.name.endswith(".answer.json")


def fresh(question: Path, answer: Path) -> bool:
    return answer.exists() and question.exists() and answer.stat().st_mtime >= question.stat().st_mtime


def unanswered(root: Path, since: float = 0.0) -> list[Path]:
    found = [p for p in root.rglob("*.json") if is_question(p) and not fresh(p, answer_path(p))]
    return sorted((p for p in found if p.stat().st_mtime >= since), key=lambda p: p.stat().st_mtime)


def option(args: list[str], name: str, default: float) -> float:
    if name in args:
        return float(args[args.index(name) + 1])
    return default


def wait(question: Path, seconds: float) -> int:
    deadline = time.monotonic() + seconds
    target = answer_path(question)
    while time.monotonic() < deadline:
        if fresh(question, target):
            print(target.read_text(encoding="utf-8"))
            return 0
        time.sleep(POLL)
    print("PENDING")
    return 3


def watch(root: Path, since: float, seconds: float) -> int:
    deadline = time.monotonic() + seconds if seconds > 0 else None
    while deadline is None or time.monotonic() < deadline:
        if root.exists():
            pending = unanswered(root, since)
            if pending:
                print(f"QUESTION {pending[0]} since={since:.0f} next={pending[0].stat().st_mtime + 0.001:.3f}")
                return 0
        time.sleep(POLL)
    print(f"TIMEOUT since={since:.0f}")
    return 3


def answer(question: Path, raw: str) -> int:
    asked = {q["id"] for q in json.loads(question.read_text(encoding="utf-8"))["questions"]}
    try:
        answers = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"answers are not JSON: {error}", file=sys.stderr)
        return 1
    if isinstance(answers, dict) and "answers" in answers:
        answers = answers["answers"]
    if not isinstance(answers, list) or not all(isinstance(a, dict) for a in answers):
        print('answers must be a JSON array of {"id", "text"} objects', file=sys.stderr)
        return 1
    given = {a["id"] for a in answers if str(a.get("text", "")).strip()}
    if given != asked:
        print(f"answers must cover exactly {sorted(asked)}, got {sorted(given)}", file=sys.stderr)
        return 1
    target = answer_path(question)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps({"answers": answers}, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, target)
    print(target)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    command, target, rest = argv[0], Path(argv[1]), argv[2:]
    if command == "wait":
        return wait(target, option(rest, "--seconds", 540))
    if command == "watch":
        return watch(target, option(rest, "--since", time.time()), option(rest, "--seconds", 0))
    if command == "pending":
        for path in unanswered(target):
            print(path)
        return 0
    if command == "answer" and rest:
        return answer(target, rest[0])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
