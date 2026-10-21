#!/usr/bin/env python3
"""What the RED and GREEN agents may write, checked on the tree, never on their word.

Scope: `agent_type` ending in `tdd-implementer`, `tdd-test-author` or `tdd-cycle`; every other caller
passes. A `tdd-cycle` agent writes a cycle's RED then its GREEN: an author until its RED checkpoint
(`cctoolkit tdd-scope red`, the author's final checks run on the tree, then a new snapshot), an
implementer after it; its structured output carries the checkpointed `red` and its `green`.

    start    SubagentStart          snapshot (hash and copy) of every dirty file under the roots
    edit     PreToolUse Edit|Write  every write under a root logged
    bash     bash-dispatch module   a Bash write under a root denied; the test command logged; a
                                    cycle's `tdd-scope red` rewritten to carry its agent id
    final    PreToolUse StructuredOutput
                                    the tree since the snapshot, minus other agents' writes:
                                    author, a source file absent from `stubs`; author at RED, a test
                                    failing on the stub once the test command is rerun; implementer,
                                    never refused: each test file it changed is one `test-edit` line
                                    of the run work file, its assertion lines removed and added

State: `work_file.tmp_dir("tdd-scope")` of the main worktree, shared by its linked worktrees; swept of
agents older than two days at start; `evidence.jsonl` there is printed by `cctoolkit tdd-scope evidence`.

Tree: the session's checkout, unless the agent works in a linked worktree of it (a batch run beside
another, run-lot's `root`): its first Edit or Write of a file there, or its first Bash call opening with
`cd <worktree> &&`, moves its record to that worktree — snapshot taken again there, before any write —
and every later check reads that tree.
"""
import difflib
import glob
import hashlib
import json
import os
import posixpath
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
CYCLE = "tdd-cycle"
# Frozen literals (docs/FROZEN-LITERALS.md): run-lot.js parses the reason, audit-capture the work file line.
RED_ON_STUB = "RED on stub: "
TEST_EDIT = "test-edit"
# Opens a deny message to the agent, parsed by nothing: not frozen.
EXIT_MISMATCH = "exit observed on rerun: "
KEPT_SECONDS = 2 * 86400
RERUN_TIMEOUT = 240
COPY_MAX = 2 * 1024 * 1024
EDIT_LINES_MAX = 8
DEFAULT_FAILED = r"^\s*(?:failed|Failed|FAILED|\[FAIL\]|✗|×)\s+(\S+)"


def role(agent_type):
    t = (agent_type or "").split(":")[-1]
    return t if t in (IMPLEMENTER, AUTHOR, CYCLE) else None


def state_dir():
    # Keyed on the main worktree: the CLI, run from a linked worktree, finds the records the hook wrote.
    d = work_file.tmp_dir("tdd-scope", kit_config.main_worktree(kit_config.project_root()))
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
    return {p for p in kit_config.porcelain_paths(raw, sources=False) if cfg.under(p, roots(cfg))}


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
def snapshot(cfg, copies):
    """{path: hash} of the dirty files under the roots, each copied under `copies`. Also used by `cctoolkit audit-round`."""
    snap = tree(cfg)
    for path, digest in snap.items():
        src = os.path.join(cfg.root, path)
        if digest != "-" and os.path.getsize(src) <= COPY_MAX:
            dst = os.path.join(copies, path)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
    return snap


def changed_since(cfg, snap):
    """Paths under the roots whose content differs from the snapshot (HEAD for a path absent from it)."""
    now = tree(cfg)
    out = set()
    for path in set(snap) | set(now):
        before = snap[path] if path in snap else head_hash(cfg, path)
        after = now[path] if path in now else _hash(os.path.join(cfg.root, path))
        if before != after:
            out.add(path)
    return out


def text_before(cfg, snap, copies, path):
    if path in snap:
        try:
            with open(os.path.join(copies, path), encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except OSError:
            return ""
    return _git(cfg, "show", f"HEAD:{path}").decode("utf-8", "replace")


def copies_of(agent_id, record):
    return (record or {}).get("copies") or os.path.join(state_dir(), agent_id)


def save_record(agent_id, record):
    with open(_record_path(agent_id), "w", encoding="utf-8") as fh:
        json.dump(record, fh)


# --- tree -----------------------------------------------------------------------------
# The prefix run-lot.js puts before every Bash call of an agent working in a worktree.
CD = re.compile(r"""^\s*cd\s+('[^']+'|"[^"]+"|[^\s;&|]+)\s*&&""")


def worktree_named(d, event):
    """The project's linked worktree this event points at — the file an Edit or Write targets, the folder a
    Bash call opens with `cd <folder> &&` — or None."""
    if event == "edit":
        ti = d.get("tool_input") or {}
        return kit_config.worktree_of(ti.get("file_path") or ti.get("notebook_path") or "")
    if event == "bash":
        m = CD.match(os.environ.get("HOOK_CMD", ""))
        return kit_config.worktree_of(m.group(1).strip("'\"")) if m else None
    return None


def tree_config(cfg, record):
    """The Config of the tree the record follows: its linked worktree, else `cfg`."""
    if not (record or {}).get("root"):
        return cfg
    try:
        return kit_config.load(record["root"])
    except kit_config.KitConfigError:
        return cfg


def follow(cfg, d, event, record):
    """`cfg`, or the Config of the linked worktree the agent turns out to work in: on its first event pointing
    there, the record moves to it — snapshot taken again in that tree, before the write the event announces."""
    if record is None or record.get("root"):
        return tree_config(cfg, record)
    top = worktree_named(d, event)
    if not top:
        return cfg
    try:
        tree_cfg = kit_config.load(top)
    except kit_config.KitConfigError:
        return cfg
    agent_id = d["agent_id"]
    copies = os.path.join(state_dir(), f"{agent_id}.tree")
    record.update({"root": top, "start": time.time(), "snapshot": snapshot(tree_cfg, copies), "copies": copies})
    save_record(agent_id, record)
    return tree_cfg


def start(cfg, agent_id, agent_type):
    sweep()
    snap = snapshot(cfg, os.path.join(state_dir(), agent_id))
    record = {"type": agent_type, "start": time.time(), "snapshot": snap}
    if role(agent_type) == CYCLE:
        record["phase"] = "red"
    save_record(agent_id, record)


# --- prompt ---------------------------------------------------------------------------
# The Workflow harness writes its relay of the user request as the agent's first message, the step's prompt after it.
RELAY = "[Workflow harness"


def prompt_of(transcript_path, agent_id):
    """The agent's prompt, its user messages before its first answer, the harness relay left out:
    `<session>/subagents/[workflows/<run>/]agent-<id>.jsonl`."""
    if not transcript_path or not agent_id:
        return ""
    base = os.path.splitext(transcript_path)[0]
    for path in glob.glob(os.path.join(base, "subagents", "**", f"agent-{agent_id}.jsonl"), recursive=True):
        texts = []
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        break
                    if entry.get("type") == "assistant":
                        break
                    if entry.get("type") != "user":
                        continue
                    content = (entry.get("message") or {}).get("content", "")
                    if isinstance(content, list):
                        content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
                    if isinstance(content, str) and not content.startswith(RELAY):
                        texts.append(content)
        except OSError:
            continue
        return "\n".join(texts)
    return ""


def _norm(cfg, path):
    path = str(path or "").replace("`", "").strip()
    path = re.sub(r"^[ MADRCU?!]{1,2}\s+", "", path).split()[0] if path else ""
    return cfg.rel(path) if path else ""


# --- edit -----------------------------------------------------------------------------
def edit(cfg, d):
    ti = d.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    if not path:
        return
    rel = cfg.rel(path)
    if cfg.under(rel, roots(cfg)):
        _append(d.get("agent_id", ""), "writes", rel)


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


def _at(cwd, token):
    """`token` as seen from the folder a `cd` moved to: a relative path joined to it."""
    token = token.strip("'\"")
    if not cwd or not token or token.startswith(("-", "/", "~")) or re.match(r"^[A-Za-z]:[\\/]", token):
        return token
    return posixpath.join(cwd.replace("\\", "/"), token)


def _under_root(cfg, token):
    token = token.strip("'\"")
    if not token or token.startswith("-") or token.startswith("/dev/"):
        return False
    if os.name == "nt":  # Git Bash spells `C:\x` or `/c/x` what Python reads as `C:/x`
        token = re.sub(r"^/([A-Za-z])(?=/|$)", r"\1:", token.replace("\\", "/"))
    try:
        return cfg.under(token, roots(cfg)) is not None
    except ValueError:
        return False


# A write in the code an interpreter reads from a heredoc (`python - <<'E'`). Narrower than
# WRITE_CALL: that body is whole code, where `>` is a comparison and `.replace(` a string method.
CODE_WRITE = re.compile(r"\bopen\([^)]*,\s*(?:mode\s*=\s*)?['\"][rbt]*[wax+]|write_text|write_bytes|writeFile|appendFile"
                        r"|os\.(?:remove|unlink|rename|replace)\b|shutil\.(?:copy|move|rmtree)|\.unlink\(|fs\.(?:rm|rename)")


def heredocs(cmd):
    """(command lines, [(program reading the heredoc, body)]): the heredoc bodies taken out of the command."""
    kept, bodies, end, prog, body = [], [], None, "", []
    for line in cmd.split("\n"):
        if end is not None:
            if line.strip() == end:
                bodies.append((prog, "\n".join(body)))
                end, body = None, []
            else:
                body.append(line)
            continue
        kept.append(line)
        m = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", line)
        if m:
            end = m.group(1)
            toks = _tokens((_segments(line[:m.start()]) or [""])[-1])
            prog = os.path.basename(toks[0]) if toks else ""
    return "\n".join(kept), bodies


def without_heredocs(cmd):
    return heredocs(cmd)[0]


def bash_write(cfg, cmd):
    """The path under a root a command would write, or None. A heredoc body is data, save when an interpreter
    reads it as code: a write call there is refused wherever it points — after a `cd`, its paths are relative."""
    cmd, bodies = heredocs(cmd)
    for prog, body in bodies:
        if prog in ("bash", "sh", "zsh"):
            hit = bash_write(cfg, body)
            if hit:
                return hit
        elif prog in INTERPRETERS and CODE_WRITE.search(body):
            return f"{prog} heredoc code"
    # Paths after a `cd` are relative to its folder (`cd src/A && sed -i … a.cs`).
    cwd = None
    for seg in _segments(cmd):
        for m in re.finditer(r"(?<![0-9&])>{1,2}\s*([^\s;&|]+)", seg):
            if _under_root(cfg, _at(cwd, m.group(1))):
                return m.group(1)
        toks = _tokens(seg)
        if toks and toks[0] == "rtk":
            toks = toks[2:] if len(toks) > 1 and toks[1] == "proxy" else toks[1:]
        if not toks:
            continue
        prog = os.path.basename(toks[0])
        args = toks[1:]
        if prog == "cd":
            cwd = _at(cwd, args[0]) if args and args[0] != "-" else None
            continue
        hit = next((a for a in args if _under_root(cfg, _at(cwd, a))), None)
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


def _verb(command):
    words = [w for w in command.split() if w != "rtk" and w != "proxy"]
    return " ".join(words[:2])


def _test_verbs(cfg):
    """What marks a test run: `dotnet test` of commands.test; for commands.testFast, its last step cut at the
    first placeholder or wildcard (`dotnet tests/`), the build before it being no test run."""
    verbs = [_verb(cfg.command("test"))]
    fast = cfg.commands.get("testFast")
    if isinstance(fast, str) and fast:
        last = re.split(r"&&|;", cfg.expand(fast))[-1]
        verbs.append(re.split(r"[{*]", _verb(last))[0])
    return [v for v in verbs if v.strip()]


# The checkpoint closing a cycle agent's RED (agents/tdd-cycle.md, docs/FROZEN-LITERALS.md).
CHECKPOINT = re.compile(r"(^|[\s;&|(])((?:\S*/)?cctoolkit\s+tdd-scope|\S*tdd-scope\.py)\s+red(?![\w-])((?:\s+--(?:agent|transcript)\s+\S+)*)")


def checkpoint_command(cmd, d):
    """The checkpoint command carrying this agent's id and transcript, whatever the agent wrote there."""
    m = CHECKPOINT.search(cmd)
    if not m:
        return None
    ids = f" --agent {shlex.quote(d.get('agent_id', ''))} --transcript {shlex.quote(d.get('transcript_path', '') or '-')}"
    return cmd[:m.start(3)] + ids + cmd[m.end(3):]


def bash(cfg, d, kind, cmd):
    if kind == CYCLE:
        fixed = checkpoint_command(cmd, d)
        if fixed is not None:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                                     "permissionDecisionReason": "RED checkpoint: agent id added",
                                                     "updatedInput": {"command": fixed}}}, ensure_ascii=False))
            return
    target = bash_write(cfg, cmd)
    if target:
        deny(f"Write through Bash refused for the TDD agents ({target}): every file goes through Edit or Write, "
             f"so the orchestrator's check sees what you wrote. Read with Read, write with Edit/Write.")
        return
    if any(v in cmd for v in _test_verbs(cfg)):
        _append(d.get("agent_id", ""), "commands", cmd)


# --- final ----------------------------------------------------------------------------
def changed(cfg, agent_id, record):
    """Files under the roots this agent changed since its snapshot, minus other TDD agents' writes."""
    out = changed_since(cfg, record.get("snapshot", {}))
    since = record.get("start", 0)
    others = set()
    for f in glob.glob(os.path.join(state_dir(), "*.writes")):
        if os.path.basename(f) == f"{agent_id}.writes" or os.path.getmtime(f) < since:
            continue
        # An agent of the other tree (checkout or batch worktree) writes the same relative paths elsewhere.
        if (load_record(os.path.basename(f)[:-len(".writes")]) or {}).get("root") != record.get("root"):
            continue
        with open(f, encoding="utf-8") as fh:
            others.update(l.strip() for l in fh if l.strip())
    return sorted(out - (others - set(_lines(agent_id, "writes"))))


def added(cfg, agent_id, record, path):
    try:
        with open(os.path.join(cfg.root, path), encoding="utf-8", errors="replace") as fh:
            after = fh.read().splitlines()
    except OSError:
        return []
    before = text_before(cfg, record.get("snapshot", {}), copies_of(agent_id, record), path).splitlines()
    return [l[1:] for l in difflib.unified_diff(before, after, lineterm="", n=0)
            if l.startswith("+") and not l.startswith("+++")]


# The RED contract call and the frame of run-lot.js (docs/FROZEN-LITERALS.md), read off the agent's prompt.
RED_CONTRACT = re.compile(r"cctoolkit sheet-cycles (\S+) --cycle (\S+) --red")
WORK_FILE = re.compile(r"Run work file: (\S+?)\.?$", re.M)
BATCH = re.compile(r"^Workflow run-lot, batch (\S+)\.", re.M)
CYCLE_OF = re.compile(r"cctoolkit sheet-cycles \S+ --cycle (\S+) --(?:red|green)\b")


def pending_ripple(cfg, prompt):
    """Sorted `sheet-cycles --pending` lines of the cycle the prompt names, or None when it names none."""
    contract, work = RED_CONTRACT.search(prompt or ""), WORK_FILE.search(prompt or "")
    if not contract or not work:
        return None
    script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "sheet-cycles.py")
    try:
        p = subprocess.run([sys.executable, script, contract.group(1).strip("`"), "--cycle", contract.group(2).strip("`"),
                            "--pending", work.group(1).strip("`")], cwd=cfg.root, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if p.returncode != 0:
        return None
    return sorted({_norm(cfg, l) for l in p.stdout.splitlines() if l.strip()})


METHODS_LINE = re.compile(r"^Methods: (.*)$", re.M)
# A refactor's safety net and a guard are green at once: their RED exits 0.
GREEN_AT_ONCE = re.compile(r"^Kind: (?:refactor|guard)\b", re.M)


def contract_methods(cfg, prompt):
    """The `Methods` of the cycle the prompt's RED contract call names, or None; [] when it is a refactor or a
    guard (`Kind:` line), whose RED passes at once."""
    m = RED_CONTRACT.search(prompt or "")
    if not m:
        return None
    script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "sheet-cycles.py")
    try:
        p = subprocess.run([sys.executable, script, m.group(1).strip("`"), "--cycle", m.group(2).strip("`"), "--red"],
                           cwd=cfg.root, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if p.returncode == 0 and GREEN_AT_ONCE.search(p.stdout or ""):
        return []
    line = METHODS_LINE.search(p.stdout or "") if p.returncode == 0 else None
    return re.findall(r"`([^`]+)`", line.group(1)) if line else None


def contract_refusal(cfg, prompt, report):
    """What run-lot's RED check (checkRed) would refuse, run before a cycle agent goes on to its GREEN:
    a RED that passes at once, a contract method neither in the table, removed nor unreachable."""
    methods = contract_methods(cfg, prompt)
    if not methods or str(report.get("status", "")) != "RED":
        return None
    if report.get("exit") == 0:
        return ("RED not observed: the filtered command exits 0. Behaviour already on disk → report `ALREADY_GREEN`; "
                "otherwise the assertion does not observe the rule — strengthen it until red.")
    name = lambda t: str(t or "").replace("`", "").strip().split()[0] if str(t or "").strip() else ""
    same = lambda a, b: a == b or a.endswith(f".{b}") or b.endswith(f".{a}")
    table = [name(r.get("test")) for r in report.get("table") or [] if isinstance(r, dict)]
    gone = [str(x) for x in report.get("removed") or []]
    unreachable = [name(u.get("method")) for u in report.get("unreachable") or [] if isinstance(u, dict)]
    if not table and (gone or unreachable):
        return None
    missing = [m for m in methods if not any(same(t, name(m)) for t in table)
               and not any(name(m) in g for g in gone) and not any(same(u, name(m)) for u in unreachable)]
    if missing:
        return (f"contract methods missing from the table: {', '.join(missing)} — write each, or list it in `removed` "
                f"(already covered) or `unreachable` (site never reached), then run the checkpoint again.")
    return None


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
    verbs = _test_verbs(cfg)
    seg = next((s for s in reversed(_segments(cmds[-1])) if any(v in s for v in verbs)), "")
    seg = re.sub(r"^\s*rtk\s+(proxy\s+)?", "", seg)
    seg = re.sub(r"\s+[0-9]?>\s*\S+|\s+2>&1", "", seg).strip()
    if not seg:
        return None
    try:
        p = subprocess.run([shutil.which("bash") or "bash", "-c", seg], cwd=cfg.root, capture_output=True, text=True, timeout=RERUN_TIMEOUT)
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


def test_edits(cfg, agent_id, record):
    """[{file, removed, added}] of the test files changed since the snapshot (`.verified.txt` aside): the lines
    `tdd.assertion` matches on each side, every changed line without it, at most EDIT_LINES_MAX a side."""
    rx = (cfg.data.get("tdd", {}) or {}).get("assertion")
    rx = re.compile(rx) if rx else None
    out = []
    for f in changed(cfg, agent_id, record):
        if not cfg.under(f, cfg.test_roots) or f.endswith(".verified.txt"):
            continue
        try:
            with open(os.path.join(cfg.root, f), encoding="utf-8", errors="replace") as fh:
                after = fh.read().splitlines()
        except OSError:
            after = []
        before = text_before(cfg, record.get("snapshot", {}), copies_of(agent_id, record), f).splitlines()
        diff = [l for l in list(difflib.unified_diff(before, after, lineterm="", n=0))[2:] if not l.startswith("@@")]
        pick = lambda sign: [l[1:].strip()[:200] for l in diff
                             if l[:1] == sign and l[1:].strip() and (rx is None or rx.search(l[1:]))][:EDIT_LINES_MAX]
        out.append({"file": f, "removed": pick("-"), "added": pick("+")})
    return out


def record_test_edits(cfg, agent_id, record, transcript_path):
    """A GREEN changing a test file is not refused: one `test-edit` line per file goes to the run work file its
    prompt names (`evidence.jsonl` without one), for the audit to judge (`cctoolkit audit-capture`)."""
    edits = test_edits(cfg, agent_id, record)
    if not edits or record.get("testEdits") == edits:
        return
    prompt = prompt_of(transcript_path, agent_id)
    batch, work, cycle = BATCH.search(prompt), WORK_FILE.search(prompt), CYCLE_OF.search(prompt)
    base = {"kind": TEST_EDIT, "batch": batch.group(1) if batch else "", "agent": agent_id,
            "cycle": cycle.group(1).strip("`") if cycle else ""}
    for e in edits:
        if work:
            work_file.append(os.path.join(cfg.root, kit_config._native(work.group(1).strip("`"))), {**base, **e})
        else:
            evidence({**base, **e})
    record["testEdits"] = edits
    save_record(agent_id, record)


def red_refusal(cfg, agent_id, record, transcript_path, ti):
    """Why the tree refuses a RED report that is not BLOCKED — or None: a source file beyond `stubs`, an
    ALREADY_GREEN's `pendingRipple`, an exit the rerun contradicts, a method failing on the stub."""
    status = str(ti.get("status", ""))
    files = changed(cfg, agent_id, record)
    sources = [f for f in files if cfg.under(f, cfg.source_roots)]
    stubs = {_norm(cfg, s) for s in (ti.get("stubs") or [])}
    beyond = sources if status == "ALREADY_GREEN" else [f for f in sources if f not in stubs]
    if beyond:
        return (f"The tree shows source files changed since this RED started and absent from `stubs`: {', '.join(beyond)}. "
                f"A RED writes signature stubs only (common-rules.md §4.1): list each stub you wrote in `stubs`, or put back "
                f"a file you should not have touched — {_restore_hint(agent_id, beyond)}.")
    if status == "ALREADY_GREEN":
        expected = pending_ripple(cfg, prompt_of(transcript_path, agent_id))
        reported = sorted({_norm(cfg, p) for p in (ti.get("pendingRipple") or []) if _norm(cfg, p)})
        if expected is not None and reported != expected:
            return (f"ALREADY_GREEN: `pendingRipple` lists exactly the files of the cycle's ripple and creations the batch "
                    f"has not changed (`cctoolkit sheet-cycles <sheet> --cycle <id> --pending <work file>`): "
                    f"{', '.join(expected) or 'none, an empty list'}. Return the report again with that list.")
        return None
    logic_rx = (cfg.data.get("tdd", {}) or {}).get("stubLogic")
    if logic_rx:
        for f in sources:
            lines = [l.strip() for l in added(cfg, agent_id, record, f) if re.search(logic_rx, l)]
            if lines:
                evidence({"kind": "stub-logic", "agent": agent_id, "file": f, "lines": lines[:5]})
    if status != "RED" or not (cfg.data.get("tdd", {}) or {}).get("stubFailure"):
        return None
    ran = rerun(cfg, agent_id)
    if ran is None:
        return None
    seg, code, output = ran
    reported = ti.get("exit")
    if isinstance(reported, int) and (reported == 0) != (code == 0):
        return f"{EXIT_MISMATCH}{code} on `{seg}`, the report says exit {reported}. Report the exit the command gives."
    if code == 0:
        return None
    failed, on_stub = failures_on_stub(cfg, output)
    if not on_stub:
        return None
    marker = cfg.data["tdd"]["stubFailure"]
    reason = f"{RED_ON_STUB}{marker} in {', '.join(on_stub)}"
    return (f"Rerun of `{seg}`: {', '.join(on_stub)} fail on the stub, not on an assertion ({marker}). common-rules.md §4.1: "
            f"a RED fails on its assertion — the stub is too thin (return a default value, still no logic) or the "
            f"assertion comes too late. Fix that and run the command again. If it cannot be done, return `status: BLOCKED` "
            f"with `diagnostic` starting with exactly: {reason}")


def _canon(report):
    return json.dumps(report or {}, sort_keys=True, ensure_ascii=False)


def _nested(why, field):
    """A refusal worded for a flat report, pointed at the `red` or `green` field of a cycle agent's output."""
    return why.replace("`status: BLOCKED`", f"`{field}.status: BLOCKED`").replace("`diagnostic` starting", f"`{field}.diagnostic` starting")


def final(cfg, d, kind):
    agent_id = d.get("agent_id", "")
    record = load_record(agent_id)
    if record is None:
        return
    ti = d.get("tool_input") or {}
    transcript = d.get("transcript_path", "")
    if kind == CYCLE:
        red = ti.get("red") or {}
        if record.get("phase") != "green":
            if str(red.get("status", "")) != "BLOCKED":
                deny("No RED checkpoint yet: run `cctoolkit tdd-scope red` with your RED report as its heredoc body "
                     "(agents/tdd-cycle.md), then the GREEN, then this output. A RED you cannot complete goes out as "
                     "`red` with `status: BLOCKED`.")
            return
        if _canon(red) != _canon(record.get("red")):
            deny("`red` differs from the report the RED checkpoint accepted: return that report unchanged, field for field.")
            return
        record_test_edits(cfg, agent_id, record, transcript)
        return
    if kind == IMPLEMENTER:
        record_test_edits(cfg, agent_id, record, transcript)
        return
    why = None if str(ti.get("status", "")) == "BLOCKED" else red_refusal(cfg, agent_id, record, transcript, ti)
    if why:
        deny(why)


# --- checkpoint (cctoolkit tdd-scope red) -----------------------------------------------
def checkpoint(cfg, agent_id, transcript_path, report):
    """(accepted, message). The author's final checks on the RED report; accepted, the agent turns implementer:
    a new snapshot from now on, a test file changed after it recorded for the audit."""
    record = load_record(agent_id)
    if record is None or role(record.get("type")) != CYCLE:
        return False, f"no `{CYCLE}` agent `{agent_id}` known to the TDD scope hook: the checkpoint closes a cycle agent's RED"
    cfg = tree_config(cfg, record)
    if record.get("phase") == "green":
        return False, "RED checkpoint already passed: you are at GREEN"
    if not isinstance(report, dict) or str(report.get("status", "")) not in ("RED", "ALREADY_GREEN"):
        return False, "the checkpoint takes a RED report of status RED or ALREADY_GREEN; a BLOCKED RED goes out as `red` of your structured output"
    transcript = "" if transcript_path == "-" else transcript_path
    why = red_refusal(cfg, agent_id, record, transcript, report) or contract_refusal(cfg, prompt_of(transcript, agent_id), report)
    if why:
        return False, _nested(why, "red")
    copies = os.path.join(state_dir(), f"{agent_id}.green")
    record.update({"phase": "green", "red": report, "start": time.time(), "snapshot": snapshot(cfg, copies), "copies": copies})
    save_record(agent_id, record)
    return True, ("RED checkpoint passed. GREEN phase from now on: the tree is compared to its state at this point, "
                  "each test file you change recorded for the audit; your structured output carries this exact report as `red`.")


# --- restore (cctoolkit tdd-scope restore) ----------------------------------------------
def restore(cfg, agent_id, paths):
    record = load_record(agent_id)
    if record is None:
        print(f"no snapshot for agent {agent_id}", file=sys.stderr)
        return 2
    cfg = tree_config(cfg, record)
    allowed = set(changed(cfg, agent_id, record))
    for path in paths:
        rel = cfg.rel(path)
        if rel not in allowed:
            print(f"{rel}: not changed by agent {agent_id}, left as is")
            continue
        dst = os.path.join(cfg.root, rel)
        if rel in record.get("snapshot", {}):
            copy = os.path.join(copies_of(agent_id, record), rel)
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
        return 0
    record = load_record(d["agent_id"])
    cfg = follow(cfg, d, event, record)
    if event == "edit":
        edit(cfg, d)
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
