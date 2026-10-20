#!/usr/bin/env python3
"""The `## Cycles` block of a batch sheet (one fenced ```json block, fields in REQUIRED / OPTIONAL).

    cctoolkit sheet-cycles <sheet> --index [--root DIR]      validate, print the compact index as JSON
                                                             (`closing`: the run-lot closing level the block plans,
                                                             lib/closing_level.py; `files` per cycle: the code it writes)
    cctoolkit sheet-cycles <sheet> --cycle ID --red|--green  print the RED or GREEN contract of one cycle
    cctoolkit sheet-cycles <sheet> --cycle ID --pending WORK files of its `ripple` and `toCreate` absent from the batch
                                                             diff, one per line: an ALREADY_GREEN that leaves any is no GREEN
    cctoolkit sheet-cycles <sheet> --methods WORK            method names expected on disk, one per line
    cctoolkit sheet-cycles <sheet> --done WORK               every cycle reached its final state
    cctoolkit sheet-cycles <sheet> --summary WORK            one line per cycle: RED/GREEN exits (audit capture)
    cctoolkit sheet-cycles <sheet> --states WORK             every saved cycle state, one JSON array (run-lot resume)
    --batch FX                                               batch of the WORK lines (default: the FX of the sheet name)

WORK is the run work file `run/.work.jsonl`: one `cycle` line per state, the last line of a
behaviour slug wins. Code paths are those under the source or test roots of kit.config.json;
test files under `layout.tests.shared` never count against the per-cycle limits.

Exit 0 ok, 1 invalid or not done, 2 no `## Cycles` block (callers fall back to the old sheet).
"""
import fnmatch
import functools
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import work_file  # noqa: E402
BATCH = [""]

REQUIRED = {
    "id": str, "wave": int, "behaviour": str, "rmcu": str, "steps": list, "level": str,
    "skill": str, "testClass": str, "fixture": str, "methods": list, "full": list,
    "bounded": list, "scenarios": str, "observation": str, "outOfScope": str,
    "toCreate": list, "production": list, "ripple": list, "boundedGreen": list,
    "elements": str, "appliedIds": str, "invariants": str, "expectedCost": str,
}
OPTIONAL = {"refactor": bool, "guard": bool, "snapshot": str, "decisions": str, "models": list}
# Beside `cycles`: `"closing": "full"` forces the full closing of run-lot, `"light"` lifts its
# production cap and ripple, never its authorisation, migration or contract rules (lib/closing_level.py).
CLOSING_FORCED = ("full", "light")
INCOMPLETE_NAME = re.compile(r"…|\.\.\.|[<>{}*]|_$|_?When$")
TO_CREATE = re.compile(r"to create|\bnew\b|à créer|a creer|nouveau|nouvelle", re.I)
MAX_TEST_FILES = 4
MAX_PRODUCTION_FILES = 8
# Two cycles sharing a production file never share a wave: more than this serialises the batch.
MAX_CYCLES_PER_FILE = 3


class Layout:
    """Source, test and shared-test roots as segment globs, from kit.config.json."""

    def __init__(self, root):
        self.root = root
        self.sources, self.tests, self.shared = ["src"], ["tests"], []
        try:
            import kit_config
            c = kit_config.load(root)
            self.sources, self.tests = c.source_roots, c.test_roots
            self.shared = c._list(c.layout["tests"].get("shared", []))
        except Exception:
            pass

    @staticmethod
    def _under(path, patterns):
        parts = path.split("/")
        for p in patterns:
            segs = p.split("/")
            if len(parts) > len(segs) and all(fnmatch.fnmatchcase(a, b) for a, b in zip(parts, segs)):
                return p
        return None

    def is_code(self, path):
        return self._under(path, self.sources + self.tests) is not None

    def is_test(self, path):
        return self._under(path, self.tests) is not None and self._under(path, self.shared) is None

    def test_project(self, path):
        p = self._under(path, self.tests)
        parts = path.split("/")
        return parts[len(p.split("/"))] if p is not None else None


def block_of(sheet):
    text = open(sheet, encoding="utf-8").read()
    m = re.search(r"^## Cycles[ \t]*(?:<!--.*?-->)?[ \t]*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return None
    fence = re.search(r"```json\s*\n(.*?)\n```", m.group(1), re.S)
    return fence.group(1) if fence else ""


def path_of(entry):
    head = re.split(r"\s+—\s+|\s+\(", str(entry).strip(), maxsplit=1)[0]
    return head.strip().strip("`").strip()


slug = work_file.slug


def load(sheet):
    raw = block_of(sheet)
    if raw is None:
        return None, ["no `## Cycles` block"]
    if not raw.strip():
        return None, ["`## Cycles` has no ```json block"]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, [f"`## Cycles` JSON invalid: {e}"]
    if not isinstance(data, dict) or not isinstance(data.get("cycles"), list) or not data["cycles"]:
        return None, ["`## Cycles` needs a non-empty `cycles` array"]
    return data, []


def validate(data, layout):
    errors = []
    seen_ids, seen_behaviours = set(), set()
    by_wave = {}
    for i, c in enumerate(data["cycles"]):
        if not isinstance(c, dict):
            errors.append(f"cycle {i + 1}: not an object")
            continue
        where = f"cycle {c.get('id', i + 1)}"
        for k, t in REQUIRED.items():
            if k not in c:
                errors.append(f"{where}: `{k}` missing")
            elif not isinstance(c[k], t) or (t is int and isinstance(c[k], bool)):
                errors.append(f"{where}: `{k}` must be {t.__name__}")
        for k, t in OPTIONAL.items():
            if k in c and not isinstance(c[k], t):
                errors.append(f"{where}: `{k}` must be {t.__name__}")
        if any(k not in c or not isinstance(c[k], REQUIRED[k]) for k in REQUIRED):
            continue
        if c["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        if c["behaviour"] in seen_behaviours:
            errors.append(f"{where}: duplicate behaviour")
        seen_ids.add(c["id"])
        seen_behaviours.add(c["behaviour"])
        if c["wave"] < 1:
            errors.append(f"{where}: `wave` starts at 1")
        if not c["methods"]:
            errors.append(f"{where}: `methods` empty")
        for m in c["methods"]:
            name = str(m).strip()
            if not name or "." not in name or INCOMPLETE_NAME.search(name):
                errors.append(f"{where}: incomplete method name `{m}` — final `Class.Method`, never an ellipsis, placeholder nor open `When`")
        created = {path_of(p) for p in c["toCreate"]}
        for m in c.get("models", []) if isinstance(c.get("models"), list) else []:
            p = path_of(m)
            if layout.is_code(p) and not os.path.exists(os.path.join(layout.root, p)):
                errors.append(f"{where}: `models` path absent: {p} — a model is an existing file to imitate")
        for key in ("full", "bounded", "production", "ripple", "boundedGreen"):
            for entry in c[key]:
                p = path_of(entry)
                if not layout.is_code(p):
                    continue
                if p in created or TO_CREATE.search(str(entry)) or os.path.exists(os.path.join(layout.root, p)):
                    continue
                errors.append(f"{where}: `{key}` path absent and not to create: {p}")
        tests = [path_of(p) for p in c["full"] if layout.is_test(path_of(p))]
        projects = sorted({layout.test_project(p) for p in tests})
        if len(projects) > 1:
            errors.append(f"{where}: one test project per cycle, found {', '.join(projects)} — split the cycle")
        if len(tests) > MAX_TEST_FILES:
            errors.append(f"{where}: {len(tests)} test files rewritten, at most {MAX_TEST_FILES} — split the cycle")
        production = {path_of(p) for p in c["production"]}
        if len(production) > MAX_PRODUCTION_FILES:
            errors.append(f"{where}: {len(production)} production files, at most {MAX_PRODUCTION_FILES} — split the cycle")
        by_wave.setdefault(c["wave"], []).append((c["id"], set(tests), production))
    per_file = {}
    for members in by_wave.values():
        for cid, _, production in members:
            for p in production:
                per_file.setdefault(p, []).append(cid)
    for p, ids in sorted(per_file.items()):
        if len(ids) > MAX_CYCLES_PER_FILE:
            errors.append(f"{p}: in the `production` of {len(ids)} cycles ({', '.join(ids)}), at most {MAX_CYCLES_PER_FILE} — it serialises them into successive waves. Registry entries (code constant, catalogue entry, enum member) go in `declaratives`, written once before the first RED, and leave `production`; a real change shared by these cycles groups them")
    for wave, members in sorted(by_wave.items()):
        for a in range(len(members)):
            for b in range(a + 1, len(members)):
                shared = (members[a][1] & members[b][1]) | (members[a][2] & members[b][2])
                if shared:
                    errors.append(f"wave {wave}: {members[a][0]} and {members[b][0]} share {', '.join(sorted(shared))} — successive waves, or registry entries moved to `declaratives`")
    if "declaratives" in data and not isinstance(data["declaratives"], list):
        errors.append("`declaratives` must be a list")
    if "closing" in data and data["closing"] not in CLOSING_FORCED:
        errors.append("`closing` is \"full\", \"light\" or absent")
    return errors


def files_of(c, layout):
    """Code paths a cycle writes: its RED's (`full`), its GREEN's (`production`, `toCreate`, `ripple`)."""
    paths = (path_of(e) for k in ("full", "toCreate", "production", "ripple") for e in c.get(k, []))
    return sorted({p for p in paths if p and layout.is_code(p)})


def planned_closing(data, root):
    """Closing level of run-lot read off the block: the files it plans, its ripples, its `closing`."""
    try:
        import closing_level
        import kit_config
        cfg = kit_config.load(root)
    except Exception:
        return {"level": "full", "reasons": ["kit.config.json unreadable"], "production": 0}
    return closing_level.decide(cfg, closing_level.planned_files(cfg, data["cycles"], path_of), data["cycles"],
                                data.get("closing", ""))


def index(data, layout):
    return {
        "ok": True,
        "missing": False,
        "errors": [],
        "declaratives": data.get("declaratives", []),
        "closing": planned_closing(data, layout.root),
        "cycles": [
            {**{k: c.get(k, False if k in ("refactor", "guard") else "") for k in
                ("id", "wave", "behaviour", "rmcu", "steps", "refactor", "guard", "methods", "decisions")},
             "files": files_of(c, layout)}
            for c in sorted(data["cycles"], key=lambda c: (c["wave"], data["cycles"].index(c)))
        ],
    }


def listed(xs):
    return ", ".join(f"`{x}`" for x in xs) if xs else "none"


def contract(c, phase):
    lines = [f"RM/CU: {c['rmcu']}", f"Behaviour: {c['behaviour']}"]
    if c.get("models"):
        lines.append(f"Model on (existing analogues — read first, copy their shape, never search for others): {' ; '.join(c['models'])}")
    if phase == "--red":
        lines += [
            f"Level / skill: {c['level']} / {c['skill']}",
            f"Test class / fixture: `{c['testClass']}` / `{c['fixture']}`",
            f"Methods: {listed(c['methods'])}",
            f"Rewritten by you (read in full): {listed(c['full'])}",
            f"Read bounded (context only): {listed(c['bounded'])}",
            f"Scenarios: {c['scenarios']}",
            f"Expected observation: {c['observation']}",
        ]
    else:
        lines += [
            f"Out of scope — next behaviour: {c['outOfScope'] or 'none'}",
            f"To create from scratch: {listed(c['toCreate'])}",
            f"Production you may fill (with the RED stubs, nothing else under the source roots): {listed(c['production'])}",
            f"Signature ripple — also touched (read in full): {' ; '.join(c['ripple']) if c['ripple'] else 'none'}",
            f"Read bounded (context only): {listed(c['boundedGreen'])}",
            f"Elements: {c['elements']}",
            f"Applied DDD/APP ids: {c['appliedIds']}",
            f"Exploitable invariants — what they remove: {c['invariants']}",
            f"Expected access cost: {c['expectedCost']}",
        ]
        if c.get("snapshot"):
            lines.append(f"Snapshot (contract tests only): {c['snapshot']}")
    if c.get("decisions"):
        lines.append(f"User decisions (override the sheet): {c['decisions']}")
    return "\n".join(lines)


@functools.lru_cache(maxsize=None)
def states(work, batch):
    return work_file.cycle_states(work_file.read(work), batch)


def state_of(work, c):
    return states(work, BATCH[0]).get(slug(c["behaviour"]))


def skipped(red):
    names = set()
    for x in (red or {}).get("unreachable", []) or []:
        names.add(str(x.get("method", "") if isinstance(x, dict) else x))
    for x in (red or {}).get("removed", []) or []:
        names.add(str(x))
    return names


def finished(c, state):
    if not state or not isinstance(state.get("red"), dict):
        return False
    red, green = state["red"], state.get("green")
    if (red.get("status") == "ALREADY_GREEN" and not red.get("pendingRipple")) or c.get("guard") or not red.get("table"):
        return True
    return isinstance(green, dict) and green.get("status") == "GREEN" and green.get("exit") == 0


def pending(c, root, work):
    """Paths the cycle's GREEN must write (`ripple`, `toCreate`) the batch has not changed: dirty against HEAD,
    and changed since the batch start when the file was already dirty then (`preexisting` line of WORK)."""
    must = list(dict.fromkeys(path_of(e) for e in [*c["ripple"], *c["toCreate"]] if path_of(e)))
    if not must:
        return []
    import kit_config
    raw = subprocess.run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", *must],
                         capture_output=True, cwd=root).stdout.decode("utf-8", errors="replace")
    dirty = set(kit_config.porcelain_paths(raw))
    before = work_file.preexisting(work_file.read(work), BATCH[0]) or {}

    def moved(path):
        if path not in dirty:
            return False
        if path not in before:
            return True
        full = os.path.join(root, path)
        now = subprocess.run(["git", "hash-object", "--no-filters", path], capture_output=True, text=True,
                             cwd=root).stdout.strip() if os.path.isfile(full) else ""
        return now != before[path]

    return [p for p in must if not moved(p)]


def repo_root(sheet):
    """Git top level of the sheet's folder: sheet paths are relative to its repo."""
    try:
        return subprocess.run(["git", "-C", os.path.dirname(os.path.abspath(sheet)), "rev-parse", "--show-toplevel"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    try:
        import kit_config
        return kit_config.project_root()
    except Exception:
        return os.getcwd()


def main(argv):
    if len(argv) < 3:
        print(next(b for b in __doc__.split("\n\n") if b.lstrip().startswith("cctoolkit sheet-cycles")), file=sys.stderr)
        return 1
    sheet, mode = argv[1], argv[2]
    arg = argv[3] if len(argv) > 3 else None
    root = argv[argv.index("--root") + 1] if "--root" in argv and argv.index("--root") + 1 < len(argv) else repo_root(sheet)
    if not os.path.isfile(sheet):
        print(f"sheet not found: {sheet}", file=sys.stderr)
        return 1
    named = re.search(r"-(F\d+)\.md$", sheet)
    BATCH[0] = argv[argv.index("--batch") + 1] if "--batch" in argv and argv.index("--batch") + 1 < len(argv) else named.group(1) if named else ""
    if mode == "--states":
        if not arg:
            print("--states needs WORK", file=sys.stderr)
            return 1
        found = states(arg, BATCH[0])
        print(json.dumps([found[name] for name in sorted(found)], ensure_ascii=False))
        return 0
    data, errors = load(sheet)
    if data is None:
        missing = errors == ["no `## Cycles` block"]
        if mode == "--index":
            print(json.dumps({"ok": False, "missing": missing, "errors": errors, "declaratives": [], "cycles": []}, ensure_ascii=False))
        else:
            print(errors[0], file=sys.stderr)
        return 2 if missing else 1
    if mode == "--index":
        errors = validate(data, Layout(root))
        if errors:
            print(json.dumps({"ok": False, "missing": False, "errors": errors, "declaratives": [], "cycles": []}, ensure_ascii=False))
            return 1
        print(json.dumps(index(data, Layout(root)), ensure_ascii=False))
        return 0
    if mode == "--cycle":
        c = next((c for c in data["cycles"] if isinstance(c, dict) and c.get("id") == arg), None)
        if c is None:
            print(f"cycle {arg} absent from `## Cycles`", file=sys.stderr)
            return 1
        phase = argv[4] if len(argv) > 4 else "--red"
        if phase not in ("--red", "--green", "--pending"):
            print("--cycle ID needs --red, --green or --pending WORK", file=sys.stderr)
            return 1
        missing = [k for k in REQUIRED if k not in c]
        if missing:
            print(f"cycle {arg}: {', '.join(missing)} missing — run --index", file=sys.stderr)
            return 1
        if phase == "--pending":
            if len(argv) < 6:
                print("--pending needs WORK", file=sys.stderr)
                return 1
            for path in pending(c, root, argv[5]):
                print(path)
            return 0
        print(contract(c, phase))
        return 0
    if mode in ("--methods", "--done", "--summary") and not arg:
        print(f"{mode} needs WORK", file=sys.stderr)
        return 1
    cycles = [c for c in data["cycles"] if isinstance(c, dict) and isinstance(c.get("behaviour"), str)]
    if mode == "--methods":
        for c in cycles:
            gone = skipped((state_of(arg, c) or {}).get("red"))
            last = {g.split(".")[-1] for g in gone}
            for m in c.get("methods", []):
                if m not in gone and m.split(".")[-1] not in last:
                    print(m.split(".")[-1])
        return 0
    if mode == "--done":
        open_cycles = [f"{c.get('id', '?')} {c['behaviour']}" for c in cycles if not finished(c, state_of(arg, c))]
        for x in open_cycles:
            print(x)
        return 1 if open_cycles else 0
    if mode == "--summary":
        for c in cycles:
            s = state_of(arg, c)
            red = (s or {}).get("red") or {}
            green = (s or {}).get("green") or {}
            gone = sorted(skipped(red))
            print(f"{c.get('id')} — RED {red.get('status', 'absent')} exit {red.get('exit', '—')} — "
                  f"GREEN {green.get('status', '—')} exit {green.get('exit', '—')}"
                  + (f" — not written: {', '.join(gone)}" if gone else ""))
        return 0
    print(f"unknown mode {mode}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
