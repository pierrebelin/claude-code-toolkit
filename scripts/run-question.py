#!/usr/bin/env python3
"""Questions a running run-lot / run-plan workflow asks the user, answered in the session.

Lines of `run/.work.jsonl` (lib/work_file.py): the workflow appends a `question` and waits for
its `answer`, which the session appends after AskUserQuestion.

    run-question.py ask <work> FX
        workflow side: appends the question JSON read on stdin as `FX-<n>`, prints that id
    run-question.py wait <work> <id> [--seconds N]
        workflow side: exit 0 printing `{"answers": [...]}` as soon as an answer to <id> at
        least as recent as the question exists, exit 3 printing PENDING after N seconds
        (default 540)
    run-question.py watch <run folder|work> [--since EPOCH] [--seconds N]
        session side: exit 0 printing `QUESTION <work> <id> since=<epoch> next=<epoch>`
        then the question JSON on the next line, for the first unanswered question asked
        after EPOCH (default: start time); exit 3 printing `TIMEOUT since=<epoch>` after N
        seconds (default 0 = never). Re-arm with `--since <next>`.
    run-question.py pending <run folder|work>
        unanswered question ids, one per line
    run-question.py answer <work> <id> <answers-json>
        appends the answer; <answers-json> = [{"id": "q1", "text": "..."}] or
        {"answers": [...]} (the shape `wait` prints), one entry per question id,
        `STOP` as text stops the batch

Question: {"batch", "sheet", "kind": "stop"|"review", "context",
"questions": [{"id", "severity", "question", "evidence", "options", "recommendation"}]}.
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
for _lib in (HERE / "lib", HERE / ".claude" / "lib"):
    sys.path.insert(0, str(_lib))
import work_file  # noqa: E402

POLL = 2.0


def work_of(target: Path) -> Path:
    return work_file.work_path(target) if target.is_dir() else target


def answer_of(records: list[dict], question: dict) -> dict | None:
    return next((r for r in reversed(work_file.of(records, "answer"))
                 if r.get("id") == question["id"] and r.get("at", 0) >= question.get("at", 0)), None)


def unanswered(work: Path, since: float = 0.0) -> list[dict]:
    records = work_file.read(work)
    return [q for q in work_file.of(records, "question") if q.get("at", 0) >= since and not answer_of(records, q)]


def question_of(work: Path, qid: str) -> dict | None:
    return next((q for q in reversed(work_file.of(work_file.read(work), "question")) if q.get("id") == qid), None)


def option(args: list[str], name: str, default: float) -> float:
    if name in args:
        return float(args[args.index(name) + 1])
    return default


def ask(work: Path, batch: str) -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as error:
        print(f"question is not JSON: {error}", file=sys.stderr)
        return 1
    n = len(work_file.of(work_file.read(work), "question", batch)) + 1
    qid = f"{batch}-{n}"
    work_file.append(work, {"kind": "question", "batch": batch, "id": qid, "payload": payload})
    print(qid)
    return 0


def wait(work: Path, qid: str, seconds: float) -> int:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        question = question_of(work, qid)
        found = question and answer_of(work_file.read(work), question)
        if found:
            print(json.dumps({"answers": found["answers"]}, ensure_ascii=False))
            return 0
        time.sleep(POLL)
    print("PENDING")
    return 3


def watch(work: Path, since: float, seconds: float) -> int:
    deadline = time.monotonic() + seconds if seconds > 0 else None
    while deadline is None or time.monotonic() < deadline:
        pending = unanswered(work, since)
        if pending:
            q = pending[0]
            print(f"QUESTION {work} {q['id']} since={since:.0f} next={q['at'] + 0.001:.3f}")
            print(json.dumps(q["payload"], ensure_ascii=False))
            return 0
        time.sleep(POLL)
    print(f"TIMEOUT since={since:.0f}")
    return 3


def answer(work: Path, qid: str, raw: str) -> int:
    question = question_of(work, qid)
    if not question:
        print(f"no question {qid} in {work}", file=sys.stderr)
        return 1
    asked = {q["id"] for q in question["payload"]["questions"]}
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
    work_file.append(work, {"kind": "answer", "batch": question.get("batch", ""), "id": qid, "answers": answers})
    print(f"{qid} answered")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    command, work, rest = argv[0], work_of(Path(argv[1])), argv[2:]
    if command == "ask" and rest:
        return ask(work, rest[0])
    if command == "wait" and rest:
        return wait(work, rest[0], option(rest, "--seconds", 540))
    if command == "watch":
        return watch(work, option(rest, "--since", time.time()), option(rest, "--seconds", 0))
    if command == "pending":
        for q in unanswered(work):
            print(q["id"])
        return 0
    if command == "answer" and len(rest) >= 2:
        return answer(work, rest[0], rest[1])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
