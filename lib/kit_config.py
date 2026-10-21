#!/usr/bin/env python3
"""kit.config.json, resolved over its preset — the one reader every hook and script goes through.

`<repo>/.claude/presets/<name>/` wins over the kit's preset of the same name; `<repo>` is
`project_root()`: `$CLAUDE_PROJECT_DIR`, else the parent of the kit when it sits in a repo's
`.claude/`, else the git top level, else the working directory. A hook judging a file path loads
`root_of(path)` instead: the linked worktree of the project holding it, when it lies in one (a batch
run beside another, `cctoolkit batch-worktree`). `load()` raises `KitConfigError`:
a hook exits 0 on it, a script prints it and stops.

CLI (hooks, shell scripts, and the skills through `cctoolkit root`):
    kit_config.py root                     # the repo root, resolved as above
    kit_config.py validate                 # one `LEVEL name detail` line per finding (tools/doctor)
    kit_config.py shell <root>             # shell assignments for scripts/pre-audit.sh, audit-capture.sh
    kit_config.py command <name> [<suite>] # commands.<name>, {product} and {suite} expanded; empty = unset
    kit_config.py parallel-batches         # run.parallelBatches, 1 to 2 (1 when unset or malformed)
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
import unicodedata

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS = os.path.join(KIT, "presets")
DEFAULT_PRESET = "clean-architecture"
TOP_KEYS = {"language", "preset", "product", "layout", "testTag", "commands", "tdd", "knowledge", "closing", "run"}
# The knowledge base is stack-neutral: its defaults live here, not in a preset.
KNOWLEDGE_DEFAULTS = {"root": "docs/business", "contexts": {}, "overviewBudget": 1500, "syncBudget": 12000, "askBudget": 1500}
PREFIX_RE = re.compile(r"[A-Z][A-Z0-9]{1,5}")
# What a preset or the repo leaves unset of `closing` (lib/closing_level.py): no rule, no cap.
CLOSING_DEFAULTS = {"maxProductionFiles": 0, "full": []}
CLOSING_CHANGES = re.compile(r"[AMD]+")
# `run` is stack-neutral: its defaults live here. One batch at a time; two at most share a checkout, the
# second in a worktree of its own (`cctoolkit batch-worktree`), their long builds one at a time (`build-lock`).
RUN_DEFAULTS = {"parallelBatches": 1}
MAX_PARALLEL_BATCHES = 2
CONTEXT_RE = re.compile(r"[A-Z][A-Za-z0-9]*")


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
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return os.path.abspath(env).replace(os.sep, "/")
    if os.path.basename(KIT) == ".claude":
        return os.path.dirname(KIT)
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    except OSError:
        top = ""
    return top or os.getcwd()


def _native(path):
    """A Git Bash path `/c/x` as Python reads it on Windows, `C:/x`; unchanged elsewhere."""
    return re.sub(r"^/([A-Za-z])(?=/|$)", lambda m: m.group(1).upper() + ":", path) if os.name == "nt" else path


def _same(a, b):
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def main_worktree(root):
    """The main worktree of the repository `root` belongs to: `root` itself, unless `root` is a linked
    worktree — its `.git` a file `gitdir: <common dir>/worktrees/<name>`. Read off the files, no git call."""
    dot = os.path.join(root, ".git")
    if not os.path.isfile(dot):
        return root
    try:
        with open(dot, encoding="utf-8") as fh:
            line = fh.readline().strip()
    except OSError:
        return root
    if not line.startswith("gitdir:"):
        return root
    gitdir = os.path.normpath(os.path.join(root, _native(line[len("gitdir:"):].strip())))
    try:
        with open(os.path.join(gitdir, "commondir"), encoding="utf-8") as fh:
            common = os.path.normpath(os.path.join(gitdir, _native(fh.readline().strip())))
    except OSError:
        common = os.path.dirname(os.path.dirname(gitdir))
    return os.path.dirname(common).replace(os.sep, "/")


def worktree_of(path, project=None):
    """The top level of the linked worktree of the project's repository that holds `path`, `/`-separated — a
    batch run beside another one works there (`run.parallelBatches`) —, or None: a path of the project's own
    checkout, of another repository or of none gives None, and the hooks judge it as before."""
    if not path:
        return None
    project = project or project_root()
    p = os.path.abspath(_native(str(path)))
    while not os.path.exists(os.path.join(p, ".git")):
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent
    if not os.path.isfile(os.path.join(p, ".git")) or _same(p, project):
        return None
    return p.replace(os.sep, "/") if _same(main_worktree(p), main_worktree(project)) else None


def root_of(path):
    """The repo a hook judges `path` in: the project's linked worktree holding it, else project_root()."""
    return worktree_of(path) or project_root()


def fold(s):
    """Case, accents, outer spaces and the typographic apostrophe folded: how a parser compares titles."""
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower().replace("’", "'")) if unicodedata.category(c) != "Mn")


def git(root, *args, check=True):
    """stdout of a git command in root, paths unquoted; a failure exits naming it unless check is off."""
    r = subprocess.run(["git", "-C", root, "-c", "core.quotePath=false", *args],
                       capture_output=True, text=True, errors="replace")
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def git_blobs(root, ref, paths):
    """{path: text} at ref, through one `git cat-file --batch`."""
    stdin = "".join(f"{ref}:{p}\n" for p in paths).encode()
    out = subprocess.run(["git", "-C", root, "cat-file", "--batch"], input=stdin, capture_output=True).stdout
    texts, i = {}, 0
    for p in paths:
        nl = out.index(b"\n", i)
        header = out[i:nl].split()
        i = nl + 1
        if len(header) == 3 and header[1] == b"blob":
            size = int(header[2])
            texts[p] = out[i:i + size].decode("utf-8", errors="replace")
            i += size + 1
    return texts


def porcelain_paths(raw, sources=True):
    """Paths of `git status --porcelain -z`; a rename's source too with sources."""
    paths, entries, i = [], raw.split("\0"), 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        paths.append(entry[3:])
        if entry[0] in "RC":
            if sources:
                paths.append(entries[i])
            i += 1
    return paths


def script_config(testtag=False):
    """(root, config), plus the test-tag adapter with testtag: a script's start. A broken config exits, naming the doctor."""
    root = project_root()
    try:
        c = load(root)
        if not testtag:
            return root, c
        import kit_testtag
        try:
            return root, c, kit_testtag.adapter(c)
        except kit_testtag.TestTagError as e:
            raise KitConfigError(str(e)) from e
    except KitConfigError as e:
        sys.exit(f"kit.config.json: {e} — cctoolkit doctor")


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
        self.imports = layout["sources"].get("imports", "")
        uc = layout["useCase"]
        self.use_case_roots = self._list(uc["roots"])
        self.use_case_label = uc.get("label", "the use cases")
        self.context_depth = uc.get("contextDepth", 1)
        self.markers = [(m["file"], re.compile(m["contains"], re.M) if m.get("contains") else None)
                        for m in uc.get("marker", [])]
        t = layout["tests"]
        self.test_roots = self._list(t["roots"])
        self.bound = self._list(t.get("bound", []))
        self.interaction = self._list(t.get("interaction", []))
        self.aggregate = [self.expand(p) for p in layout.get("aggregate", [])]
        self.commands = data.get("commands", {})
        cl = data.get("closing")
        self.closing = merge(CLOSING_DEFAULTS, cl if isinstance(cl, dict) else {})
        r = data.get("run")
        self.run = merge(RUN_DEFAULTS, r if isinstance(r, dict) else {})
        self.test_tag = data.get("testTag", {})
        # Kept malformed for validate_knowledge(): a hook must not die over a key it does not read.
        k = data.get("knowledge")
        k = merge(KNOWLEDGE_DEFAULTS, k if isinstance(k, dict) else {})
        self.knowledge_root = self.expand(k["root"]).strip("/") if isinstance(k["root"], str) else k["root"]
        self.contexts = dict(k["contexts"]) if isinstance(k["contexts"], dict) else k["contexts"]
        self.overview_budget = k["overviewBudget"]
        self.sync_budget = k["syncBudget"]
        self.ask_budget = k["askBudget"]

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
        """Existing absolute directories matching the segment globs, each once by inode (case-insensitive disks)."""
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
        """Relative to the root, always with `/`, on Windows too."""
        path = path if os.path.isabs(path) else os.path.join(self.root, path)
        return os.path.relpath(os.path.normpath(path), self.root).replace(os.sep, "/")

    def under(self, path, patterns):
        """The pattern `path` sits under (segment match), or None."""
        parts = self.rel(path).split("/")
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
        return os.path.join(self.root, *self.rel(path).split("/")[:n])

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
        """A use-case folder holds a file matching a marker glob whose content matches the marker regex."""
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

    def imports_of(self, path):
        """The import-line regex of the file's extension, compiled, or None."""
        rx = self.imports.get(os.path.splitext(path)[1], "") if isinstance(self.imports, dict) else self.imports
        try:
            return re.compile(rx) if rx else None
        except (re.error, TypeError):
            return None

    def suite_of(self, path):
        """First segment under the test root holding `path`, the product prefix dropped."""
        p = self.under(path, self.test_roots)
        parts = self.rel(path).split("/")
        seg = parts[len(p.split("/"))] if p is not None and len(parts) > len(p.split("/")) else parts[0]
        if self.product:
            return seg.replace(self.product + ".", "")
        return seg.rsplit(".", 1)[-1]

    # --- knowledge base ---------------------------------------------------------------
    def prefix_of(self, name):
        """The id prefix of a context given by name or by prefix, or None."""
        if name in self.contexts:
            return self.contexts[name]
        return name if name in self.contexts.values() else None

    @property
    def parallel_batches(self):
        """`run.parallelBatches` within 1..MAX_PARALLEL_BATCHES; 1 when malformed."""
        n = self.run.get("parallelBatches", 1)
        return min(max(n, 1), MAX_PARALLEL_BATCHES) if isinstance(n, int) and not isinstance(n, bool) else 1

    def command(self, name, suite=None):
        if name == "testFast" and not self.commands.get("testFast"):
            # Unset: the solution build then the suite command, the run it stands for.
            parts = [self.command("build"), self.command("test", suite)]
            return " && ".join(p for p in parts if p) if parts[1] else ""
        c = self.commands.get(name, "")
        if isinstance(c, dict):
            c = c.get("run", "")
        c = self.expand(c or "")
        return c.replace("{suite}", suite) if suite else c


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
    for name in ("build", "test", "testFast", "worktreeSetup"):
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
    suites = c.commands.get("suites", [])
    if not isinstance(suites, list) or not all(isinstance(s, dict) and isinstance(s.get("name"), str) and s["name"] for s in suites):
        out.append(("FAIL", "commands.suites", "expects [{\"name\": \"<suite>\", \"when\": \"<path regex>\", \"filter\": \"…{namespace}…\", \"project\": \"<test project>\", \"env\": \"VAR=value\"}]"))
    else:
        for s in suites:
            try:
                re.compile(c.expand(s.get("when") or ""))
            except re.error as e:
                out.append(("FAIL", f"commands.suites.{s['name']}.when", f"invalid regex: {e}"))
            if s.get("filter") and not s.get("project"):
                out.append(("FAIL", f"commands.suites.{s['name']}", "a filtered suite needs `project`, the test project its namespaces are read from"))
    out += validate_test_fast(c)
    out += validate_closing(c.data.get("closing"))
    out += validate_run(c.data.get("run"))
    tdd = c.data.get("tdd", {})
    if not isinstance(tdd, dict):
        out.append(("FAIL", "tdd", "expects {\"failedTest\": \"<regex>\", \"stubFailure\": \"<regex>\", \"stubLogic\": \"<regex>\", \"assertion\": \"<regex>\"}"))
    else:
        for k in ("failedTest", "stubFailure", "stubLogic", "assertion"):
            if tdd.get(k):
                try:
                    re.compile(tdd[k])
                except (re.error, TypeError) as e:
                    out.append(("FAIL", f"tdd.{k}", f"invalid regex: {e}"))
    imp = c.imports
    for ext, rx in (imp.items() if isinstance(imp, dict) else [("", imp)]):
        try:
            re.compile(rx)
        except (re.error, TypeError) as e:
            out.append(("FAIL", f"layout.sources.imports{' ' + ext if ext else ''}", f"invalid regex: {e}"))
    cd = c.context_depth
    if not isinstance(cd, int) or isinstance(cd, bool) or cd < 0:
        out.append(("FAIL", "layout.useCase.contextDepth", "expects 0 (one context) or the depth of the context folder under a use-case root"))
    ig = c.layout.get("integrationGuard")
    if ig is not None and not (isinstance(ig, dict) and all(
            isinstance(ig.get(k), list) and ig[k] and all(isinstance(p, str) for p in ig[k]) for k in ("sources", "tests"))):
        out.append(("FAIL", "layout.integrationGuard", "expects {\"sources\": [\"<glob>\"], \"tests\": [\"<glob>\"]}"))
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
    return out + validate_knowledge(c, cfg.get("knowledge"))


def validate_test_fast(c):
    """commands.testFast: its project and, once built, exactly one test assembly per glob."""
    fast = c.commands.get("testFast", "")
    if not isinstance(fast, str):
        return []
    if not fast:
        return [("ok", "commands.testFast", "unset — RED and GREEN run commands.build then commands.test")]
    if not c.dirs(c.test_roots):
        return [("ok", "commands.testFast", "not checked — no test root yet")]
    run = c.command("testFast", "UnitTests")
    out = []
    for token in shlex.split(run.replace("&&", " ")):
        if not re.search(r"\.(csproj|dll|exe)$", token) or token.startswith("-"):
            continue
        found = glob.glob(os.path.join(c.root, token))
        if token.endswith(".csproj") and not found:
            out.append(("WARN", "commands.testFast", f"{token} absent — every RED and GREEN run fails on it: fix the path or unset testFast"))
        elif not token.endswith(".csproj") and len(found) > 1:
            out.append(("WARN", "commands.testFast", f"{token} matches {len(found)} files (several target frameworks or configurations) — narrow the glob"))
    return out or [("ok", "commands.testFast", run)]


def validate_run(raw):
    if raw is None:
        return []
    if not isinstance(raw, dict):
        return [("FAIL", "run", "expects {\"parallelBatches\": <n>}")]
    n = raw.get("parallelBatches", 1)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        return [("FAIL", "run.parallelBatches", "expects a count, 1 for one batch at a time")]
    if n > MAX_PARALLEL_BATCHES:
        return [("WARN", "run.parallelBatches", f"{n} capped at {MAX_PARALLEL_BATCHES}: two batches per checkout at most")]
    return []


def validate_closing(raw):
    if raw is None:
        return []
    bad = ("FAIL", "closing", "expects {\"maxProductionFiles\": <n>, \"full\": [{\"name\": \"…\", \"path\": \"<regex>\", \"changes\": \"AMD\", \"scope\": \"sources|all\"}]}")
    if not isinstance(raw, dict):
        return [bad]
    out = []
    n = raw.get("maxProductionFiles", 0)
    if not isinstance(n, int) or isinstance(n, bool) or n < 0:
        out.append(("FAIL", "closing.maxProductionFiles", "expects a count, 0 for no cap"))
    rules = raw.get("full", [])
    if not isinstance(rules, list):
        return out + [bad]
    for i, r in enumerate(rules):
        if not (isinstance(r, dict) and isinstance(r.get("name"), str) and isinstance(r.get("path"), str)):
            out.append(("FAIL", f"closing.full[{i}]", "expects {\"name\": \"…\", \"path\": \"<regex>\"}"))
            continue
        try:
            re.compile(r["path"])
        except re.error as e:
            out.append(("FAIL", f"closing.full[{i}].path", f"invalid regex: {e}"))
        if not CLOSING_CHANGES.fullmatch(str(r.get("changes", "AMD"))):
            out.append(("FAIL", f"closing.full[{i}].changes", "expects letters among A (added), M (modified), D (deleted)"))
        if r.get("scope", "sources") not in ("sources", "all"):
            out.append(("FAIL", f"closing.full[{i}].scope", "expects sources (production files) or all"))
    return out


def validate_knowledge(c, raw):
    if raw is not None and not isinstance(raw, dict):
        return [("FAIL", "knowledge", "expects {\"root\": \"<path>\", \"contexts\": {\"<Context>\": \"<PREFIX>\"}, \"overviewBudget\": <tokens>, \"syncBudget\": <tokens>, \"askBudget\": <tokens>}")]
    out = []
    root = c.knowledge_root
    if not isinstance(root, str) or not root or root.startswith("..") or os.path.isabs(root):
        out.append(("FAIL", "knowledge.root", "expects a path relative to the repo root"))
        root = None
    contexts = c.contexts
    if not isinstance(contexts, dict):
        return out + [("FAIL", "knowledge.contexts", "expects {\"<Context>\": \"<PREFIX>\"}")]
    for name, prefix in contexts.items():
        if not CONTEXT_RE.fullmatch(name):
            out.append(("FAIL", "knowledge.contexts", f"context '{name}': a folder name, PascalCase (Catalog)"))
        if not isinstance(prefix, str) or not PREFIX_RE.fullmatch(prefix) or prefix == "ADR":
            out.append(("FAIL", "knowledge.contexts", f"{name}: prefix {prefix!r} — 2 to 6 capitals or digits, not ADR"))
    taken = [p for p in contexts.values() if isinstance(p, str)]
    for p in sorted({p for p in taken if taken.count(p) > 1}):
        out.append(("FAIL", "knowledge.contexts", f"prefix {p} given to several contexts"))
    for key, b in (("overviewBudget", c.overview_budget), ("syncBudget", c.sync_budget), ("askBudget", c.ask_budget)):
        if not isinstance(b, int) or isinstance(b, bool) or b <= 0:
            out.append(("FAIL", f"knowledge.{key}", "expects a positive number of tokens"))
    if out or root is None:
        return out
    base = os.path.join(c.root, root)
    if not os.path.isdir(base):
        return [("ok", "knowledge.root", f"{root} absent — no knowledge base yet")]
    folders = sorted(d for d in os.listdir(base)
                     if os.path.isdir(os.path.join(base, d)) and not d.startswith(".") and d != "adr")
    for d in folders:
        if d not in contexts:
            out.append(("WARN", "knowledge.contexts", f"{root}/{d} has no prefix — add \"{d}\": \"<PREFIX>\""))
    out.append(("ok", "knowledge.root", f"{root} — {len(folders)} context{'s' if len(folders) != 1 else ''}"))
    return out


# --- unified diff helpers ------------------------------------------------------------
def added_lines(diff):
    """(file, line number, text) of every added line; the file resets on `+++ b/` only."""
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
    if cmd == "parallel-batches":
        try:
            print(load().parallel_batches)
        except KitConfigError:
            print(1)
        return 0
    if cmd == "validate":
        root = argv[2] if len(argv) > 2 else None
        for level, name, detail in validate(root or project_root()):
            print(f"{level}\t{name}\t{detail}")
        return 0
    try:
        if cmd == "command":
            run = load().command(argv[2], argv[3] if len(argv) > 3 else None)
            if run:
                print(run)
            return 0
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
            "KIT_RULE_SHEET": c.rule_sheet,
        }
        for k, v in vals.items():
            print(f"{k}={shlex.quote(v)}")
        return 0
    diff = sys.stdin.buffer.read().decode("utf-8", errors="replace")
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
