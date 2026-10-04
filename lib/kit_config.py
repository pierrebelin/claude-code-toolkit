#!/usr/bin/env python3
"""kit.config.json, resolved — the one reader every hook and script goes through.

Resolution: the preset named by `preset` (default `clean-architecture`) supplies a
full `layout`, `testTag` and `commands`; the repo's `kit.config.json` overrides it
key by key — objects merge recursively, a list or a scalar replaces the preset's.
`{product}` in a path or a command expands to `product`, or to `*` when the key is
unset: the glob then finds the one `src/*.Application` a repo usually has.

Files: `<repo>/.claude/kit.config.json`, and `<repo>/.claude/presets/<name>/preset.json`
before `<kit>/presets/<name>/preset.json` — a repo's own preset wins over a shipped one
of the same name. `<kit>` is the parent of this `lib/`: the plugin's cache directory
once installed, the toolkit root here. `<repo>` is `project_root()`: the parent of
`<kit>` when the kit sits in a repo's `.claude/` (eval fixtures, a manual copy), else
`$CLAUDE_PROJECT_DIR`, else the git top level of the working directory, else the
working directory. Missing config file = the preset's defaults. Every path pattern is a segment glob
relative to the repo root (`tests/*.UnitTests`: `*` stays inside one segment),
except `layout.aggregate`, matched like a shell `case` against the full path.

Callers never handle a broken setup themselves: `load()` raises `KitConfigError`,
a hook catches it and exits 0, a script prints it and stops.

CLI (hooks and shell scripts):
    kit_config.py root                     # the repo root, resolved as above
    kit_config.py validate                 # one `LEVEL name detail` line per finding (tools/doctor)
    kit_config.py shell <root>             # shell assignments for scripts/pre-audit.sh, audit-capture.sh
    kit_config.py match aggregate <path>   # exit 0 when <path> is an aggregate or value object
    kit_config.py diff-comments <root>     # added comment lines under the source roots (diff on stdin)
    kit_config.py diff-interaction <root>  # added lines of the interaction suites (diff on stdin)
    kit_config.py diff-tags <root>         # tag values on added lines (diff on stdin)
    kit_config.py diff-test-classes <root> # classes of the test files the diff touches (diff on stdin)
"""
import fnmatch
import glob
import json
import os
import re
import shlex
import subprocess
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS = os.path.join(KIT, "presets")
DEFAULT_PRESET = "clean-architecture"
TOP_KEYS = {"language", "preset", "product", "layout", "testTag", "commands"}


class KitConfigError(Exception):
    pass


def _read_json(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except OSError as e:
        raise KitConfigError(f"{what} unreadable: {path} ({e.strerror})")
    except ValueError as e:
        raise KitConfigError(f"{what} is not valid JSON: {path} ({e})")


def merge(base, over):
    """Objects merge recursively; anything else in `over` replaces `base`."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = merge(base.get(k), v) if k in base else v
        return out
    return over


def project_root():
    """The repo the kit serves — same order as lib/project-root.sh."""
    if os.path.basename(KIT) == ".claude":
        return os.path.dirname(KIT)
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return os.path.abspath(env)
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    except OSError:
        top = ""
    return top or os.getcwd()


def config_path(root):
    return os.path.join(root, ".claude", "kit.config.json")


def preset_dirs(root):
    return [os.path.join(root, ".claude", "presets"), PRESETS]


def raw_config(root):
    path = config_path(root)
    if not os.path.isfile(path):
        return {}
    data = _read_json(path, "kit.config.json")
    if not isinstance(data, dict):
        raise KitConfigError("kit.config.json must hold a JSON object")
    return data


def preset_names(root):
    names = set()
    for base in preset_dirs(root):
        try:
            names.update(d for d in os.listdir(base) if os.path.isfile(os.path.join(base, d, "preset.json")))
        except OSError:
            pass
    return sorted(names)


def preset_file(root, name):
    for base in preset_dirs(root):
        path = os.path.join(base, name, "preset.json")
        if os.path.isfile(path):
            return path
    return None


class Config:
    def __init__(self, data, root):
        self.data = data
        self.root = os.path.abspath(root)
        self.product = data.get("product") or None
        layout = data["layout"]
        self.layout = layout
        self.skip = set(layout.get("skipDirs", []))
        self.rule_sheet = layout.get("ruleSheet", "CLAUDE.md")
        self.source_roots = self._list(layout["sources"]["roots"])
        self.source_ext = list(layout["sources"].get("extensions", []))
        self.comment = layout["sources"].get("comment", "//")
        uc = layout["useCase"]
        self.use_case_roots = self._list(uc["roots"])
        self.use_case_label = uc.get("label", "the use cases")
        self.markers = [(m["file"], re.compile(m["contains"], re.M) if m.get("contains") else None)
                        for m in uc.get("marker", [])]
        t = layout["tests"]
        self.test_roots = self._list(t["roots"])
        self.bound = self._list(t.get("bound", []))
        self.interaction = self._list(t.get("interaction", []))
        self.aggregate = [self.expand(p) for p in layout.get("aggregate", [])]
        self.commands = data.get("commands", {})
        self.test_tag = data.get("testTag", {})

    # --- paths ------------------------------------------------------------------
    def expand(self, s):
        return s.replace("{product}", self.product if self.product else "*")

    def _list(self, patterns):
        """Expanded segment globs, deduplicated, order kept."""
        out = []
        for p in patterns:
            p = self.expand(p).strip("/")
            if p and p not in out:
                out.append(p)
        return out

    def dirs(self, patterns):
        """Existing absolute directories matching the segment globs, each once — by
        inode, so `src/Features` and `src/features` on a case-insensitive disk are one."""
        found, seen = [], set()
        for p in patterns:
            for d in sorted(glob.glob(os.path.join(self.root, p))):
                try:
                    st = os.stat(d)
                except OSError:
                    continue
                if os.path.isdir(d) and (st.st_dev, st.st_ino) not in seen:
                    seen.add((st.st_dev, st.st_ino))
                    found.append(os.path.normpath(d))
        return found

    def rel(self, path):
        path = path if os.path.isabs(path) else os.path.join(self.root, path)
        return os.path.relpath(os.path.normpath(path), self.root)

    def under(self, path, patterns):
        """The pattern `path` sits under (segment match), or None."""
        parts = self.rel(path).split(os.sep)
        for p in patterns:
            segs = p.split("/")
            if len(parts) > len(segs) and all(fnmatch.fnmatchcase(a, b) for a, b in zip(parts, segs)):
                return p
        return None

    def root_of(self, path, patterns):
        """Absolute directory of the pattern `path` sits under, or None."""
        p = self.under(path, patterns)
        if p is None:
            return None
        n = len(p.split("/"))
        return os.path.join(self.root, *self.rel(path).split(os.sep)[:n])

    def walk(self, patterns):
        """(base, files) under every matching directory, skipDirs pruned, each visited once."""
        seen = set()
        for top in self.dirs(patterns):
            for base, dirs, files in os.walk(top):
                dirs[:] = [d for d in dirs if d not in self.skip]
                st = os.stat(base)
                if (st.st_dev, st.st_ino) in seen:
                    dirs[:] = []
                    continue
                seen.add((st.st_dev, st.st_ino))
                yield base, files

    # --- use cases ----------------------------------------------------------------
    def is_use_case_dir(self, d):
        """A use-case folder carries its handler: a file matching a marker glob whose
        content matches the marker regex. Depth does not discriminate."""
        try:
            names = os.listdir(d)
        except OSError:
            return False
        for f in names:
            for glob_, rx in self.markers:
                if fnmatch.fnmatchcase(f, glob_):
                    if rx is None:
                        return True
                    try:
                        with open(os.path.join(d, f), encoding="utf-8", errors="ignore") as fh:
                            if rx.search(fh.read()):
                                return True
                    except OSError:
                        pass
        return False

    def is_source(self, path):
        return os.path.splitext(path)[1] in self.source_ext

    def comment_of(self, path):
        if isinstance(self.comment, dict):
            return self.comment.get(os.path.splitext(path)[1])
        return self.comment

    def suite_of(self, path):
        """First segment under the test root holding `path`, the product prefix dropped."""
        p = self.under(path, self.test_roots)
        parts = self.rel(path).split(os.sep)
        seg = parts[len(p.split("/"))] if p is not None and len(parts) > len(p.split("/")) else parts[0]
        if self.product:
            return seg.replace(self.product + ".", "")
        return seg.rsplit(".", 1)[-1]

    def command(self, name):
        c = self.commands.get(name, "")
        if isinstance(c, dict):
            c = c.get("run", "")
        return self.expand(c or "")


def load(root=None):
    """The resolved Config. `root` defaults to project_root()."""
    if root is None:
        root = project_root()
    cfg = raw_config(root)
    name = cfg.get("preset") or DEFAULT_PRESET
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        raise KitConfigError(f"preset must be a preset name, got {name!r}")
    path = preset_file(root, name)
    if not path:
        raise KitConfigError(f"unknown preset '{name}' — available: {', '.join(preset_names(root)) or 'none'}")
    preset = _read_json(path, f"preset {name}")
    data = merge({k: v for k, v in preset.items() if k != "description"}, cfg)
    data["preset"] = name
    try:
        return Config(data, root)
    except (KeyError, TypeError, AttributeError, re.error) as e:
        raise KitConfigError(f"layout incomplete or malformed after merging preset {name}: {e!r}")


# --- validation (tools/doctor) ---------------------------------------------------
def validate(root):
    """[(level, name, detail)]; level in ok / NOTE / WARN / FAIL."""
    out = []
    try:
        cfg = raw_config(root)
    except KitConfigError as e:
        return [("FAIL", "kit.config.json", str(e))]
    if not os.path.isfile(config_path(root)):
        out.append(("ok", "kit.config.json", f"absent — preset {DEFAULT_PRESET} defaults (/cctoolkit:kit-init writes one)"))
    for k in sorted(set(cfg) - TOP_KEYS):
        out.append(("WARN", "kit.config.json", f"unknown key '{k}' — ignored (typo?); known: {', '.join(sorted(TOP_KEYS))}"))
    lang = cfg.get("language", {})
    if not isinstance(lang, dict) or any(not isinstance(lang.get(k, "en"), str) for k in ("docs", "code")):
        out.append(("FAIL", "kit.config.json language", "expects {\"docs\": \"<code>\", \"code\": \"<code>\"}"))
    if "product" in cfg and not (isinstance(cfg["product"], str) and cfg["product"] and "/" not in cfg["product"]):
        out.append(("FAIL", "kit.config.json product", "expects a non-empty name without '/'"))
    try:
        c = load(root)
    except KitConfigError as e:
        return out + [("FAIL", "kit.config.json", str(e))]
    for key in ("roots",):
        for sect, pats in (("sources", c.layout["sources"].get(key)), ("useCase", c.layout["useCase"].get(key)),
                           ("tests", c.layout["tests"].get(key))):
            if not (isinstance(pats, list) and pats and all(isinstance(p, str) for p in pats)):
                out.append(("FAIL", f"layout.{sect}.{key}", "expects a non-empty list of path globs"))
    for i, m in enumerate(c.layout["useCase"].get("marker", [])):
        if not isinstance(m, dict) or not isinstance(m.get("file"), str):
            out.append(("FAIL", f"layout.useCase.marker[{i}]", "expects {\"file\": \"<glob>\", \"contains\": \"<regex>\"}"))
    if not c.markers:
        out.append(("FAIL", "layout.useCase.marker", "empty — no use-case folder can be recognised"))
    try:
        import kit_testtag
        a = kit_testtag.adapter(c)
        out.append(("ok", "testTag", f"{a.name} — {a.example}"))
    except kit_testtag.TestTagError as e:
        out.append(("FAIL", "testTag", str(e)))
    for name in ("build", "test"):
        v = c.commands.get(name, "")
        if not isinstance(v, str):
            out.append(("FAIL", f"commands.{name}", "expects a string"))
    at = c.commands.get("architectureTest", {})
    if not isinstance(at, (dict, str)):
        out.append(("FAIL", "commands.architectureTest", "expects {\"run\": \"…\", \"when\": \"<path regex>\"}"))
    elif isinstance(at, dict) and at.get("when"):
        try:
            re.compile(at["when"])
        except re.error as e:
            out.append(("FAIL", "commands.architectureTest.when", f"invalid regex: {e}"))
    # The layout against the repo: a root that matches nothing makes the traceability silent.
    uc = c.dirs(c.use_case_roots)
    if not uc:
        out.append(("WARN", "layout.useCase.roots", f"{', '.join(c.use_case_roots)} matches no directory — the traceability hook and rules-coverage see nothing"))
    elif not c.product and any("{product}" in p for p in c.layout["useCase"]["roots"]) and len(uc) > 1:
        out.append(("WARN", "product", f"unset and {{product}} matches {len(uc)} directories — set \"product\""))
    else:
        out.append(("ok", "layout.useCase.roots", ", ".join(c.rel(d) for d in uc)))
    if not c.dirs(c.test_roots):
        out.append(("WARN", "layout.tests.roots", f"{', '.join(c.test_roots)} matches no directory"))
    if not c.product:
        out.append(("ok", "product", "unset — {product} expands to * (one match expected)"))
    return out


# --- unified diff helpers ------------------------------------------------------------
def added_lines(diff):
    """(file, line number, text) of every added line. The file is reset on `+++ b/`
    only, like the awk it replaces: a deletion's `+++ /dev/null` keeps the last one."""
    file, line = None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            file = raw[6:]
            continue
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            line = int(m.group(1)) - 1 if m else 0
            continue
        if file is None:
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            line += 1
            yield file, line, raw[1:]
        elif raw.startswith("-") and not raw.startswith("---"):
            continue
        elif raw.startswith(" "):
            line += 1


def _cli(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd = argv[1]
    if cmd == "root":
        print(project_root())
        return 0
    if cmd == "validate":
        root = argv[2] if len(argv) > 2 else None
        for level, name, detail in validate(root or project_root()):
            print(f"{level}\t{name}\t{detail}")
        return 0
    try:
        if cmd == "match":
            c = load()
            path = argv[3]
            pats = c.aggregate if argv[2] == "aggregate" else []
            return 0 if any(fnmatch.fnmatchcase(path, p) for p in pats) else 1
        c = load(argv[2])
    except KitConfigError as e:
        print(f"kit.config.json: {e}", file=sys.stderr)
        return 3
    except IndexError:
        sys.exit(__doc__)
    if cmd == "shell":
        at = c.commands.get("architectureTest", {})
        when = at.get("when", "") if isinstance(at, dict) else ""
        exts = " ".join(f"--include=*{e}" for e in c.source_ext)
        vals = {
            "KIT_SOURCE_DIRS": " ".join(c.source_roots),
            "KIT_TEST_DIRS": " ".join(c.test_roots),
            "KIT_SCOPE_LABEL": ", ".join(r + "/" for r in c.source_roots + [t for t in c.test_roots if t not in c.source_roots]),
            "KIT_NEITHER_LABEL": " nor ".join(r + "/" for r in c.source_roots + [t for t in c.test_roots if t not in c.source_roots]),
            "KIT_SOURCE_INCLUDES": exts,
            "KIT_CODE_RE": "(" + "|".join(glob_to_ere(r) for r in c.source_roots + c.test_roots) + ")/",
            "KIT_BUILD": c.command("build"),
            "KIT_ARCH_RUN": c.command("architectureTest"),
            "KIT_ARCH_WHEN": when,
        }
        for k, v in vals.items():
            print(f"{k}={shlex.quote(v)}")
        return 0
    diff = sys.stdin.read()
    if cmd == "diff-comments":
        for f, n, text in added_lines(diff):
            mark = c.comment_of(f)
            if mark and c.under(f, c.source_roots) and text.lstrip().startswith(mark):
                print(f"{f}:{n}: {text}")
        return 0
    if cmd == "diff-interaction":
        for f, n, text in added_lines(diff):
            if c.under(f, c.interaction):
                print(f"{f}:{n}: {text}")
        return 0
    import kit_testtag
    try:
        a = kit_testtag.adapter(c)
    except kit_testtag.TestTagError as e:
        print(f"kit.config.json: {e}", file=sys.stderr)
        return 3
    if cmd == "diff-tags":
        found = set()
        for raw in diff.splitlines():
            if raw.startswith("+") and not raw.startswith("+++"):
                found.update(a.values_in(raw[1:]))
        for v in sorted(found):
            print(v)
        return 0
    if cmd == "diff-test-classes":
        found = set()
        for raw in diff.splitlines():
            if not raw.startswith("+++ b/"):
                continue
            f = raw[6:]
            if c.under(f, c.test_roots) and a.is_test_file(f):
                found.update(a.classes_of(os.path.join(c.root, f)))
        for v in sorted(found):
            print(v)
        return 0
    sys.exit(__doc__)


def glob_to_ere(pattern):
    """Segment glob -> POSIX ERE fragment (`*` stays inside one segment)."""
    out = []
    for ch in pattern:
        if ch == "*":
            out.append("[^/]*")
        elif ch == "?":
            out.append("[^/]")
        elif ch in ".^$+()[]{}|\\":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    sys.exit(_cli(sys.argv))
