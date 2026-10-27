#!/usr/bin/env python3
"""Detached jobs a Workflow agent starts and waits for in bounded calls — a run longer than a Bash call.

    cctoolkit bg start <name> -- <command>     # detached; refused while <name> runs
    cctoolkit bg wait <name> [--seconds 540] [--silent N]   # 0 done, 1 failed, 3 still running, 4 log silent N s
    cctoolkit bg status <name>                 # same exit codes, no wait
    cctoolkit bg stop <name>...                # SIGTERM to the job's process group
    cctoolkit bg log <name> [--lines 20]       # last lines of the log

`<command>` is one shell string run by `bash -c` (several words are joined). The job's
folder is `<temp>/cctoolkit-bg/<name>/`: `pid`, `exit`, `log`. `wait` prints one line,
`DONE exit=0`, `FAILED exit=<n>`, `RUNNING <seconds>s` or, under `--silent N`, `STALLED <seconds>s`
as soon as a running job's log has not grown for N seconds — a hung suite told apart from a slow
one — then the last log lines.
Exit 2: unknown job or bad arguments.
"""
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
POLL = 5
TAIL = 3


def folder(name):
    return os.path.join(tempfile.gettempdir(), "cctoolkit-bg", name)


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return None


def alive(pid):
    if os.name == "nt":
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        try:
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def state(name):
    """('done'|'failed'|'running'|'unknown', exit code or None, started epoch or None)."""
    d = folder(name)
    pid = read(os.path.join(d, "pid"))
    if pid is None:
        return "unknown", None, None
    code = read(os.path.join(d, "exit"))
    started = os.path.getmtime(os.path.join(d, "pid"))
    if code not in (None, ""):
        n = int(code) if code.lstrip("-").isdigit() else 1
        return ("done" if n == 0 else "failed"), n, started
    if alive(int(pid)):
        return "running", None, started
    return "failed", None, started


def tail(name, lines):
    text = read(os.path.join(folder(name), "log")) or ""
    return [l.rstrip() for l in text.replace("\r", "\n").splitlines() if l.strip()][-lines:]


def silence(name):
    """Seconds since the job's log last grew."""
    try:
        return time.time() - os.path.getmtime(os.path.join(folder(name), "log"))
    except OSError:
        return 0


def report(name, verbose=True, silent=None):
    s, code, started = state(name)
    if s == "unknown":
        print(f"UNKNOWN {name}")
        return 2
    stalled = s == "running" and silent is not None and silence(name) >= silent
    if stalled:
        print(f"STALLED {int(time.time() - started)}s, log silent {int(silence(name))}s")
    elif s == "running":
        print(f"RUNNING {int(time.time() - started)}s")
    else:
        print(f"{'DONE' if s == 'done' else 'FAILED'} exit={'none (process gone without an exit code)' if code is None else code}")
    if verbose:
        for line in tail(name, TAIL):
            print(f"  {line[:300]}")
    return 4 if stalled else {"done": 0, "failed": 1, "running": 3}[s]


def start(name, words):
    if not words:
        print("bg start: no command after --", file=sys.stderr)
        return 2
    if state(name)[0] == "running":
        print(f"bg start: {name} is already running — cctoolkit bg stop {name} first", file=sys.stderr)
        return 2
    d = folder(name)
    os.makedirs(d, exist_ok=True)
    for f in ("pid", "exit", "log"):
        try:
            os.remove(os.path.join(d, f))
        except (FileNotFoundError, PermissionError):
            pass
    command = words[0] if len(words) == 1 else shlex.join(words)
    exit_file = shlex.quote(os.path.join(d, "exit").replace(os.sep, "/"))
    wrapped = f"( {command} ); echo $? > {exit_file}"
    detach = {"start_new_session": True}
    if os.name == "nt":
        detach = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
    with open(os.path.join(d, "log"), "w") as log:
        # bash from PATH: on Windows CreateProcess would find WSL's bash.exe in System32 first
        proc = subprocess.Popen([shutil.which("bash") or "bash", "-c", wrapped], stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, cwd=os.getcwd(), **detach)
    with open(os.path.join(d, "pid"), "w") as f:
        f.write(str(proc.pid))
    print(f"STARTED {name} pid={proc.pid} log={os.path.join(d, 'log')}")
    return 0


def wait(name, seconds, silent=None):
    deadline = time.time() + seconds
    while True:
        s = state(name)[0]
        if s != "running" or time.time() >= deadline or (silent is not None and silence(name) >= silent):
            return report(name, silent=silent)
        time.sleep(min(POLL, max(0.2, deadline - time.time())))


def stop(names):
    for name in names:
        pid = read(os.path.join(folder(name), "pid"))
        if pid is None or state(name)[0] != "running":
            print(f"{name}: not running")
            continue
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
            else:
                os.killpg(int(pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        print(f"{name}: stopped")
    return 0


def main(argv):
    if len(argv) < 2 or argv[0] not in ("start", "wait", "status", "stop", "log"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    names = rest[: rest.index("--")] if "--" in rest else rest
    names = [n for n in names if not n.startswith("--") and not n.isdigit()]
    if not names or not all(NAME.match(n) for n in names):
        print(f"bg {cmd}: invalid job name(s): {' '.join(names) or 'none'}", file=sys.stderr)
        return 2
    if cmd == "start":
        return start(names[0], rest[rest.index("--") + 1:] if "--" in rest else [])
    if cmd == "stop":
        return stop(names)
    if cmd == "log":
        n = int(rest[rest.index("--lines") + 1]) if "--lines" in rest else 20
        print("\n".join(tail(names[0], n)))
        return 0 if state(names[0])[0] != "unknown" else 2
    if cmd == "status":
        return report(names[0])
    seconds = float(rest[rest.index("--seconds") + 1]) if "--seconds" in rest else 540
    silent = float(rest[rest.index("--silent") + 1]) if "--silent" in rest else None
    return wait(names[0], seconds, silent)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
