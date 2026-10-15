#!/usr/bin/env python3
"""What the RED and GREEN agents may write, checked on the tree, never on their word.

Why. Until 1.12.0 `run-lot` judged a GREEN by its `testsDiff` line and a RED by its
`productionDiff` line, both written by the agent being judged; `Expected failure` was
declared too, so a RED failing on a stub's `NotImplementedException` passed as red. Every
check here reads the repo: a snapshot when the agent starts, its Edit/Write calls, the
tree when it returns, and the test command it ran, rerun.

Scope: the two TDD agents only (`agent_type` ending in `tdd-implementer` or
`tdd-test-author`); every other caller passes untouched.

    start    SubagentStart          snapshot: content hash of every modified or untracked file
                                    under the source and test roots, a copy of each for restore
    edit     PreToolUse Edit|Write  implementer under a test root: denied unless granted or
                                    `.verified.txt`; every write logged under the agent's id
    bash     bash-dispatch module   a write through Bash under a root is denied for both (the
                                    Edit/Write log is then the whole story); the test command
                                    run is logged for the rerun
    final    PreToolUse StructuredOutput
                                    the tree since the snapshot, minus files other agents wrote:
                                    implementer, a test file changed and not granted; author, a
                                    source file changed and absent from `stubs`; author at RED,
                                    the test command rerun, a test failing on the stub. Denied
                                    with the exact reason the agent must restore, fix, or carry
                                    as `diagnostic` of a `BLOCKED`

Grants: `Test files you may modify, granted: <paths>.` in the agent's prompt (run-lot's
`decided()` and `escalation()`), read from the agent's transcript, never from its report.

State: `work_file.tmp_dir("tdd-scope")`, one `<agent id>.json` (snapshot), `.writes`,
`.commands`, and a `<agent id>/` copy folder; agents older than two days are swept at start.
Evidence the auditor judges (a stub whose added lines look like logic) is appended to
`evidence.jsonl` there; `cctoolkit tdd-scope evidence` prints it for the audit capture.
"""
import difflib
import glob
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config  # noqa: E402
import work_file  # noqa: E402

IMPLEMENTER = "tdd-implementer"
AUTHOR = "tdd-test-author"
# Frozen literals (rules/markdown-output.md): run-lot.js writes the first, parses the others.
GRANTED = "Test files you may modify, granted: "
TESTS_AT_GREEN = "tests modified at GREEN: "
GRANTED_SEP = " — granted: "
BEYOND_STUBS = "production code beyond the stubs: "
RED_ON_STUB = "RED on stub: "
EXIT_MISMATCH = "exit observed on rerun: "
KEPT_SECONDS = 2 * 86400
RERUN_TIMEOUT = 240
COPY_MAX = 2 * 1024 * 1024
DEFAULT_FAILED = r"^\s*(?:failed|Failed|FAILED|\[FAIL\]|✗|×)\s+(\S+)"


def role(agent_type):
    t = (agent_type or "").split(":")[-1]
    return t if t in (IMPLEMENTER, AUTHOR) else None


def state_dir():
    d = work_file.tmp_dir("tdd-scope")
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def deny(reason, event="PreToolUse"):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}, ensure_ascii=False))


def _hash(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha1(fh.read()).hexdigest()
    except OSError:
        return "-"


def _git(cfg, *args):
    try:
        return subprocess.run(["git", *args], cwd=cfg.root, capture_output=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return b""


def roots(cfg):
    return cfg.source_roots + cfg.test_roots


def dirty(cfg):
    """Repo-relative paths under the roots that differ from HEAD (modified, untracked, deleted)."""
    raw = _git(cfg, "status", "--porcelain", "-z", "--untracked-files=all").decode("utf-8", "replace")
    out, parts, i = set(), raw.split("\0"), 0
    while i < len(parts):
        entry = parts[i]
        i += 1
        if len(entry) < 4:
            continue
        path = entry[3:]
        if entry[0] in "RC":
            i += 1  # the rename's source follows
        if cfg.under(path, roots(cfg)):
            out.add(path)
    return out


def tree(cfg):
    return {p: _hash(os.path.join(cfg.root, p)) for p in dirty(cfg)}


def head_hash(cfg, path):
    blob = _git(cfg, "show", f"HEAD:{path}")
    return hashlib.sha1(blob).hexdigest() if blob else "-"


def _record_path(agent_id):
    return os.path.join(state_dir(), f"{agent_id}.json")


def load_record(agent_id):
    try:
        with open(_record_path(agent_id), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _lines(agent_id, kind):
    try:
        with open(os.path.join(state_dir(), f"{agent_id}.{kind}"), encoding="utf-8") as fh:
            return [l.rstrip("\n") for l in fh if l.strip()]
    except OSError:
        return []


def _append(agent_id, kind, line):
    with open(os.path.join(state_dir(), f"{agent_id}.{kind}"), "a", encoding="utf-8") as fh:
        fh.write(line.replace("\n", " ") + "\n")


def sweep():
    now = time.time()
    for f in glob.glob(os.path.join(state_dir(), "*")):
        try:
            if now - os.path.getmtime(f) > KEPT_SECONDS:
                shutil.rmtree(f) if os.path.isdir(f) else os.remove(f)
        except OSError:
            pass


# --- start ----------------------------------------------------------------------------
def start(cfg, agent_id, agent_type):
    sweep()
    snap = tree(cfg)
    copies = os.path.join(state_dir(), agent_id)
    for path, digest in snap.items():
        src = os.path.join(cfg.root, path)
        if digest != "-" and os.path.getsize(src) <= COPY_MAX:
            dst = os.path.join(copies, path)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
    with open(_record_path(agent_id), "w", encoding="utf-8") as fh:
        json.dump({"type": agent_type, "start": time.time(), "snapshot": snap}, fh)


# --- grants ---------------------------------------------------------------------------
def prompt_of(transcript_path, agent_id):
    """First user message of the agent: `<session>/subagents/[workflows/<run>/]agent-<id>.jsonl`."""
    if not transcript_path or not agent_id:
        return ""
    base = os.path.splitext(transcript_path)[0]
    for path in glob.glob(os.path.join(base, "subagents", "**", f"agent-{agent_id}.jsonl"), recursive=True):
        try:
            with open(path, encoding="utf-8") as fh:
                first = json.loads(fh.readline())
        except (OSError, ValueError):
            continue
        content = (first.get("message") or {}).get("content", "")
        if isinstance(content, list):
            content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
        return content if isinstance(content, str) else ""
    return ""


def grants(prompt):
    found = set()
    for m in re.finditer(re.escape(GRANTED) + r"(.+?)\.(?:\s|$)", prompt):
        found.update(p.strip().strip("`") for p in m.group(1).split(",") if p.strip())
    return found


def _norm(cfg, path):
    path = str(path or "").replace("`", "").strip()
    path = re.sub(r"^[ MADRCU?!]{1,2}\s+", "", path).split()[0] if path else ""
    return cfg.rel(path) if path else ""


# --- edit -----------------------------------------------------------------------------
def edit(cfg, d, kind):
    ti = d.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    if not path:
        return
    rel = cfg.rel(path)
    agent_id = d.get("agent_id", "")
    if kind == IMPLEMENTER and cfg.under(rel, cfg.test_roots) and not rel.endswith(".verified.txt"):
        allowed = {_norm(cfg, g) for g in grants(prompt_of(d.get("transcript_path", ""), agent_id))}
        if rel not in allowed:
            deny(f"`{rel}` is a test file: test files are read-only at GREEN (agents/tdd-implementer.md § Scope). "
                 f"Make production code pass the test as written. A test that cannot pass untouched is a `BLOCKED` "
                 f"whose `diagnostic` names it; the orchestrator's arbiter may grant it for a later attempt.")
            return
    if cfg.under(rel, roots(cfg)):
        _append(agent_id, "writes", rel)


# --- bash -----------------------------------------------------------------------------
WRITERS = {"rm", "mv", "cp", "touch", "truncate", "ln", "install", "rsync", "dd", "unlink", "rmdir", "mkdir", "patch"}
FORMATTERS = [r"\bdotnet\s+format\b", r"\bprettier\b.*--write", r"\bblack\b", r"\bruff\s+format\b",
              r"\beslint\b.*--fix", r"\bgofmt\b.*-w", r"\bspotless"]
GIT_WRITES = {"checkout", "restore", "reset", "stash", "clean", "apply", "am", "mv", "rm", "switch", "revert", "cherry-pick", "merge", "rebase"}
INTERPRETERS = {"python", "python3", "node", "perl", "ruby", "php", "bash", "sh", "zsh"}
WRITE_CALL = re.compile(r"open\([^)]*['\"][wa+]|write_text|write_bytes|writeFile|appendFile|unlink|os\.remove|shutil\.|rename|>\s*\S")


def _segments(cmd):
    return [s.strip() for s in re.split(r"\|\||&&|[;|\n]", cmd) if s.strip()]


def _tokens(segment):
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def _under_root(cfg, token):
    token = token.strip("'\"")
    if not token or token.startswith("-") or token.startswith("/dev/"):
        return False
    try:
        return cfg.under(token, roots(cfg)) is not None
    except ValueError:
        return False


def without_heredocs(cmd):
    kept, end = [], None
    for line in cmd.split("\n"):
        if end is not None:
            if line.strip() == end:
                end = None
            continue
        kept.append(line)
        m = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", line)
        if m:
            end = m.group(1)
    return "\n".join(kept)


def bash_write(cfg, cmd):
    """The path under a root a command would write, or None. A heredoc body is data (the
    `cycle` line run-lot has the agent append holds arrows and paths): only its command line counts."""
    cmd = without_heredocs(cmd)
    for m in re.finditer(r"(?<![0-9&])>{1,2}\s*([^\s;&|]+)", cmd):
        if _under_root(cfg, m.group(1)):
            return m.group(1)
    for seg in _segments(cmd):
        toks = _tokens(seg)
        if toks and toks[0] == "rtk":
            toks = toks[2:] if len(toks) > 1 and toks[1] == "proxy" else toks[1:]
        if not toks:
            continue
        prog = os.path.basename(toks[0])
        args = toks[1:]
        hit = next((a for a in args if _under_root(cfg, a)), None)
        if prog in WRITERS or prog == "tee":
            if hit:
                return hit
        if prog in ("sed", "perl", "gsed") and any(a.startswith("-i") or a.startswith("--in-place") for a in args) and hit:
            return hit
        if prog == "git" and args and args[0] in GIT_WRITES:
            return f"git {args[0]}"
        if prog in INTERPRETERS and WRITE_CALL.search(seg) and any(re.search(rf"(^|[\s'\"/]){re.escape(r)}/", seg) for r in roots(cfg)):
            return f"{prog} inline code"
    for rx in FORMATTERS:
        if re.search(rx, cmd):
            return "formatter"
    return None


def _test_verb(cfg):
    words = [w for w in cfg.command("test").split() if w != "rtk" and w != "proxy"]
    return " ".join(words[:2])


def bash(cfg, d, kind, cmd):
    target = bash_write(cfg, cmd)
    if target:
        deny(f"Write through Bash refused for the TDD agents ({target}): every file goes through Edit or Write, "
             f"so the orchestrator's check sees what you wrote. Read with Read, write with Edit/Write.")
        return
    verb = _test_verb(cfg)
    if verb and verb in cmd:
        _append(d.get("agent_id", ""), "commands", cmd)


# --- final ----------------------------------------------------------------------------
def changed(cfg, agent_id, record):
    """Files under the roots this agent changed since its snapshot: the tree compared to the
    snapshot, minus every file another TDD agent wrote meanwhile."""
    snap = record.get("snapshot", {})
    now = tree(cfg)
    out = set()
    for path in set(snap) | set(now):
        before = snap[path] if path in snap else head_hash(cfg, path)
        after = now[path] if path in now else _hash(os.path.join(cfg.root, path))
        if before != after:
            out.add(path)
    since = record.get("start", 0)
    others = set()
    for f in glob.glob(os.path.join(state_dir(), "*.writes")):
        if os.path.basename(f) == f"{agent_id}.writes" or os.path.getmtime(f) < since:
            continue
        with open(f, encoding="utf-8") as fh:
            others.update(l.strip() for l in fh if l.strip())
    return sorted(out - (others - set(_lines(agent_id, "writes"))))


def _before_text(cfg, agent_id, record, path):
    if path in record.get("snapshot", {}):
        try:
            with open(os.path.join(state_dir(), agent_id, path), encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except OSError:
            return ""
    return _git(cfg, "show", f"HEAD:{path}").decode("utf-8", "replace")


def added(cfg, agent_id, record, path):
    try:
        with open(os.path.join(cfg.root, path), encoding="utf-8", errors="replace") as fh:
            after = fh.read().splitlines()
    except OSError:
        return []
    before = _before_text(cfg, agent_id, record, path).splitlines()
    return [l[1:] for l in difflib.unified_diff(before, after, lineterm="", n=0)
            if l.startswith("+") and not l.startswith("+++")]


def evidence(entry):
    work_file_path = os.path.join(state_dir(), "evidence.jsonl")
    entry["at"] = time.time()
    with open(work_file_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _restore_hint(agent_id, paths):
    return f"`cctoolkit tdd-scope restore {agent_id} {' '.join(paths)}` puts them back as they were at your start"


def rerun(cfg, agent_id):
    """(command, exit, output) of the last test command the agent ran, rerun now, or None."""
    cmds = _lines(agent_id, "commands")
    if not cmds:
        return None
    verb = _test_verb(cfg)
    seg = next((s for s in reversed(_segments(cmds[-1])) if verb in s), "")
    seg = re.sub(r"^\s*rtk\s+(proxy\s+)?", "", seg)
    seg = re.sub(r"\s+[0-9]?>\s*\S+|\s+2>&1", "", seg).strip()
    if not seg:
        return None
    try:
        p = subprocess.run(["bash", "-c", seg], cwd=cfg.root, capture_output=True, text=True, timeout=RERUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        return seg, 124, ""
    except OSError:
        return None
    out = (p.stdout or "") + (p.stderr or "")
    with open(os.path.join(state_dir(), f"{agent_id}.rerun.txt"), "w", encoding="utf-8") as fh:
        fh.write(out)
    return seg, p.returncode, out


def failures_on_stub(cfg, output):
    """(failed tests, those whose failure block carries the stub marker)."""
    tdd = cfg.data.get("tdd", {}) or {}
    failed_rx = re.compile(tdd.get("failedTest") or DEFAULT_FAILED)
    stub_rx = re.compile(tdd["stubFailure"]) if tdd.get("stubFailure") else None
    failed, on_stub, current, block = [], [], None, []

    def close():
        if current and stub_rx and stub_rx.search("\n".join(block)):
            on_stub.append(current)

    for line in output.splitlines():
        m = failed_rx.search(line)
        if m:
            close()
            current, block = m.group(1), [line]
            failed.append(current)
        elif current:
            block.append(line)
    close()
    return failed, on_stub


def final(cfg, d, kind):
    agent_id = d.get("agent_id", "")
    record = load_record(agent_id)
    if record is None:
        return
    ti = d.get("tool_input") or {}
    status = str(ti.get("status", ""))
    diagnostic = str(ti.get("diagnostic", "") or "")
    files = changed(cfg, agent_id, record)

    if kind == IMPLEMENTER:
        allowed = {_norm(cfg, g) for g in grants(prompt_of(d.get("transcript_path", ""), agent_id))}
        tests = [f for f in files if cfg.under(f, cfg.test_roots) and not f.endswith(".verified.txt") and f not in allowed]
        if not tests:
            return
        reason = f"{TESTS_AT_GREEN}{', '.join(tests)}{GRANTED_SEP}{', '.join(sorted(allowed)) or 'none'}"
        if status == "BLOCKED" and diagnostic.startswith(TESTS_AT_GREEN):
            return
        deny(f"The tree shows test files changed since this GREEN started: {', '.join(tests)}. Test files are read-only "
             f"at GREEN (agents/tdd-implementer.md § Scope); {_restore_hint(agent_id, tests)}. Then make production "
             f"pass and return the report again. If the test cannot pass untouched, return `status: BLOCKED` with "
             f"`diagnostic` starting with exactly: {reason}")
        return

    sources = [f for f in files if cfg.under(f, cfg.source_roots)]
    stubs = {_norm(cfg, s) for s in (ti.get("stubs") or [])}
    if status == "BLOCKED":
        return
    beyond = [f for f in sources if f not in stubs]
    if status == "ALREADY_GREEN":
        beyond = sources
    if beyond:
        deny(f"The tree shows source files changed since this RED started and absent from `stubs`: {', '.join(beyond)}. "
             f"A RED writes signature stubs only (common-rules.md §4.1): list each stub you wrote in `stubs`, or put back "
             f"a file you should not have touched — {_restore_hint(agent_id, beyond)}.")
        return
    logic_rx = (cfg.data.get("tdd", {}) or {}).get("stubLogic")
    if logic_rx:
        for f in sources:
            lines = [l.strip() for l in added(cfg, agent_id, record, f) if re.search(logic_rx, l)]
            if lines:
                evidence({"kind": "stub-logic", "agent": agent_id, "file": f, "lines": lines[:5]})
    if status != "RED" or not (cfg.data.get("tdd", {}) or {}).get("stubFailure"):
        return
    ran = rerun(cfg, agent_id)
    if ran is None:
        return
    seg, code, output = ran
    reported = ti.get("exit")
    if isinstance(reported, int) and (reported == 0) != (code == 0):
        deny(f"{EXIT_MISMATCH}{code} on `{seg}`, the report says exit {reported}. Report the exit the command gives.")
        return
    if code == 0:
        return
    failed, on_stub = failures_on_stub(cfg, output)
    if on_stub:
        marker = cfg.data["tdd"]["stubFailure"]
        reason = f"{RED_ON_STUB}{marker} in {', '.join(on_stub)}"
        deny(f"Rerun of `{seg}`: {', '.join(on_stub)} fail on the stub, not on an assertion ({marker}). common-rules.md §4.1: "
             f"a RED fails on its assertion — the stub is too thin (return a default value, still no logic) or the "
             f"assertion comes too late. Fix that and run the command again. If it cannot be done, return `status: BLOCKED` "
             f"with `diagnostic` starting with exactly: {reason}")


# --- restore (cctoolkit tdd-scope restore) ----------------------------------------------
def restore(cfg, agent_id, paths):
    record = load_record(agent_id)
    if record is None:
        print(f"no snapshot for agent {agent_id}", file=sys.stderr)
        return 2
    allowed = set(changed(cfg, agent_id, record))
    for path in paths:
        rel = cfg.rel(path)
        if rel not in allowed:
            print(f"{rel}: not changed by agent {agent_id}, left as is")
            continue
        dst = os.path.join(cfg.root, rel)
        if rel in record.get("snapshot", {}):
            copy = os.path.join(state_dir(), agent_id, rel)
            if os.path.isfile(copy):
                shutil.copyfile(copy, dst)
            elif os.path.exists(dst):
                os.remove(dst)
        elif _git(cfg, "ls-tree", "HEAD", "--", rel):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as fh:
                fh.write(_git(cfg, "show", f"HEAD:{rel}"))
        elif os.path.exists(dst):
            os.remove(dst)
        print(f"{rel}: restored")
    return 0


def hook(event):
    try:
        d = json.loads(os.environ.get("HOOK_INPUT") or "{}")
    except ValueError:
        return 0
    kind = role(d.get("agent_type"))
    if kind is None or not d.get("agent_id"):
        return 0
    try:
        cfg = kit_config.load()
    except kit_config.KitConfigError:
        return 0
    if event == "start":
        start(cfg, d["agent_id"], d.get("agent_type", ""))
    elif event == "edit":
        edit(cfg, d, kind)
    elif event == "final":
        final(cfg, d, kind)
    elif event == "bash":
        bash(cfg, d, kind, os.environ.get("HOOK_CMD", ""))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(hook(sys.argv[1] if len(sys.argv) > 1 else ""))
    except Exception:  # a hook never breaks a session
        sys.exit(0)
