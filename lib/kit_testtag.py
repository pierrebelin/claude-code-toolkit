#!/usr/bin/env python3
"""testTag adapters — how a test declares the business rule it covers.

The value is the contract and never moves: `<RuleSheetFolder>/<RM|RL-xx>`. Only its
carrier changes with the test framework, chosen by `testTag.framework`:

    xunit   [Trait("RM", "CreateProduct/RM-01")]          on the line after [Fact]/[Theory]
    pytest  @pytest.mark.rm("CreateProduct/RM-01")         decorator of a test_* function
    junit   @Tag("RM:CreateProduct/RM-01")                 annotation next to @Test
    jest    it("[RM CreateProduct/RM-01] rejects …")       in the title of the test or of
                                                           an enclosing describe

`testTag.regex` overrides the carrier regex (one capture group: the value);
`testTag.files` overrides the test file globs. Every scanner, the traceability hook
and the four scripts read tests through `adapter(config).scan(path)` — one copy of
the parsing, never one per caller.

A scanned test: `Test(path, cls, method, line, tags, anchor, indent)` — `line` is the
1-based line of the method or call, `anchor` the 0-based line a new tag is written
relative to (scripts/migrate-rm-traits.py).
"""
import fnmatch
import os
import re


class TestTagError(Exception):
    pass


class Test:
    __slots__ = ("path", "cls", "method", "line", "tags", "anchor", "indent")

    def __init__(self, path, cls, method, line, tags, anchor, indent):
        self.path, self.cls, self.method, self.line = path, cls, method, line
        self.tags, self.anchor, self.indent = tags, anchor, indent

    @property
    def key(self):
        return f"{self.cls}.{self.method}"


def _read_lines(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read().splitlines()


def stem(path):
    return os.path.basename(path).split(".")[0]


class Adapter:
    name = ""
    default_regex = ""
    default_files = []
    test_label = ""
    tag_label = ""
    example = ""

    def __init__(self, regex=None, files=None):
        try:
            self.regex = re.compile(regex or self.default_regex)
        except re.error as e:
            raise TestTagError(f"testTag.regex does not compile: {e}")
        if self.regex.groups != 1:
            raise TestTagError("testTag.regex needs exactly one capture group — the `folder/id` value")
        self.files = files or self.default_files

    def is_test_file(self, path):
        b = os.path.basename(path)
        return any(fnmatch.fnmatchcase(b, g) for g in self.files)

    def values_in(self, text):
        return [m.group(1) for m in self.regex.finditer(text)]

    def classes_of(self, path):
        """Classes a touched test file stands for in the UNBOUND TEST lines."""
        found = {stem(path)}
        try:
            found.update(t.cls for t in self.scan(path))
        except OSError:
            pass
        return found

    def scan(self, path):
        raise NotImplementedError

    def apply(self, lines, test, values):
        """Writes `values` onto `test` in `lines` (read with keepends)."""
        raise NotImplementedError


class XUnit(Adapter):
    name = "xunit"
    default_regex = r'\[Trait\("RM",\s*"([^"]+)"\)\]'
    default_files = ["*.cs"]
    test_label = "`[Fact]`/`[Theory]` methods"
    tag_label = '`[Trait("RM", …)]`'
    example = '[Trait("RM", "CreateProduct/RM-01")]'
    CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
    ATTR = re.compile(r"^(\s*)\[(?:Fact|Theory)[\](]")
    METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")

    def __init__(self, regex=None, files=None):
        super().__init__(regex, files)
        self.line_tag = re.compile(r"\s*(?:" + self.regex.pattern + ")")

    def classes_of(self, path):
        # The test file is named after its class: the stem alone, as before the adapters.
        return {stem(path)}

    def scan(self, path):
        out = []
        cls, anchor, indent, carried = None, None, "", []
        for i, line in enumerate(_read_lines(path)):
            cm = self.CLASS.match(line)
            if cm:
                cls, anchor, carried = cm.group(1), None, []
                continue
            am = self.ATTR.match(line)
            if am:
                anchor, indent, carried = i, am.group(1), []
                continue
            if anchor is None:
                continue
            tm = self.line_tag.match(line)
            if tm:
                carried.append(tm.group(1))
                continue
            mm = self.METHOD.match(line)
            if mm and cls:
                out.append(Test(path, cls, mm.group(1), i + 1, carried, anchor, indent))
                anchor = None
        return out

    def apply(self, lines, test, values):
        lines.insert(test.anchor + 1, "".join(f'{test.indent}[Trait("RM", "{v}")]\n' for v in values))


class Pytest(Adapter):
    name = "pytest"
    default_regex = r"""@pytest\.mark\.rm\(\s*["']([^"']+)["']\s*\)"""
    default_files = ["test_*.py", "*_test.py"]
    test_label = "`test_*` functions"
    tag_label = "`@pytest.mark.rm(…)`"
    example = '@pytest.mark.rm("CreateProduct/RM-01")'
    CLASS = re.compile(r"^(\s*)class\s+(\w+)")
    DEF = re.compile(r"^(\s*)(?:async\s+)?def\s+(\w+)\s*\(")

    def scan(self, path):
        out, classes, pending = [], [], []
        module = stem(path)
        for i, line in enumerate(_read_lines(path)):
            cm = self.CLASS.match(line)
            if cm:
                ind = len(cm.group(1))
                classes = [c for c in classes if c[0] < ind] + [(ind, cm.group(2))]
                pending = []
                continue
            if line.lstrip().startswith("@"):
                pending.extend(self.values_in(line))
                continue
            dm = self.DEF.match(line)
            if dm:
                ind = len(dm.group(1))
                classes = [c for c in classes if c[0] < ind]
                if dm.group(2).startswith("test"):
                    cls = classes[-1][1] if classes else module
                    out.append(Test(path, cls, dm.group(2), i + 1, pending, i, dm.group(1)))
                pending = []
        return out

    def apply(self, lines, test, values):
        lines.insert(test.anchor, "".join(f'{test.indent}@pytest.mark.rm("{v}")\n' for v in values))


class JUnit(Adapter):
    name = "junit"
    default_regex = r'@Tag\(\s*"RM:([^"]+)"\s*\)'
    default_files = ["*Test.java", "*Tests.java", "*IT.java", "*Test.kt", "*Tests.kt"]
    test_label = "`@Test` methods"
    tag_label = '`@Tag("RM:…")`'
    example = '@Tag("RM:CreateProduct/RM-01")'
    CLASS = re.compile(r"^\s*(?:(?:public|protected|private|abstract|final|static|sealed|open|internal|data|inner)\s+)*(?:class|object)\s+(\w+)")
    MARKER = re.compile(r"^(\s*)@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b")
    NAME = re.compile(r"(`[^`]+`|[A-Za-z_]\w*)\s*\(")

    def scan(self, path):
        out = []
        cls, armed, indent, pending = None, None, "", []
        for i, line in enumerate(_read_lines(path)):
            s = line.strip()
            cm = self.CLASS.match(line)
            if cm and not s.startswith("@"):
                cls, armed, pending = cm.group(1), None, []
                continue
            if s.startswith("@"):
                pending.extend(self.values_in(line))
                mm = self.MARKER.match(line)
                if mm:
                    armed, indent = i, mm.group(1)
                continue
            if not s or s.startswith("//") or s.startswith("*") or s.startswith("/*"):
                continue
            if armed is not None and cls:
                nm = self.NAME.search(line)
                if nm:
                    out.append(Test(path, cls, nm.group(1).strip("`"), i + 1, pending, armed, indent))
            armed, pending = None, []
        return out

    def apply(self, lines, test, values):
        lines.insert(test.anchor + 1, "".join(f'{test.indent}@Tag("RM:{v}")\n' for v in values))


class Jest(Adapter):
    name = "jest"
    default_regex = r"\[RM ([^\]\s]+)\]"
    default_files = ["*.test.ts", "*.test.tsx", "*.test.js", "*.test.jsx", "*.spec.ts", "*.spec.tsx", "*.spec.js", "*.spec.jsx"]
    test_label = "`it`/`test` cases"
    tag_label = "`[RM …]` title tags"
    example = 'it("[RM CreateProduct/RM-01] rejects a name already used", …)'
    CALL = re.compile(r"""^(\s*)(describe|it|test)(?:\.(?:only|skip|concurrent|failing))*\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3""")

    def scan(self, path):
        out, stack = [], []
        cls = stem(path)
        for i, line in enumerate(_read_lines(path)):
            m = self.CALL.match(line)
            if not m:
                continue
            ind = len(m.group(1))
            stack = [d for d in stack if d[0] < ind]
            title = m.group(4)
            if m.group(2) == "describe":
                stack.append((ind, title))
                continue
            tags = [v for _, t in stack for v in self.values_in(t)] + self.values_in(title)
            name = " > ".join([t for _, t in stack] + [title])
            out.append(Test(path, cls, name, i + 1, tags, i, m.group(1)))
        return out

    def apply(self, lines, test, values):
        line = lines[test.anchor]
        m = self.CALL.match(line)
        if not m:
            return
        prefix = "".join(f"[RM {v}] " for v in values)
        at = m.start(4)
        lines[test.anchor] = line[:at] + prefix + line[at:]


ADAPTERS = {a.name: a for a in (XUnit, Pytest, JUnit, Jest)}


def adapter(config):
    """The adapter `config.test_tag` selects (a kit_config.Config)."""
    t = config.test_tag or {}
    if not isinstance(t, dict):
        raise TestTagError("testTag expects {\"framework\": \"xunit|pytest|junit|jest\"}")
    name = t.get("framework", "xunit")
    if name not in ADAPTERS:
        raise TestTagError(f"unknown testTag.framework '{name}' — {', '.join(sorted(ADAPTERS))}")
    files = t.get("files")
    if files is not None and not (isinstance(files, list) and all(isinstance(f, str) for f in files)):
        raise TestTagError("testTag.files expects a list of file globs")
    return ADAPTERS[name](t.get("regex"), files)


def scan_tree(config, ad):
    """Every test under the test roots: [(Test, bound)] in walk order."""
    out = []
    for base, files in config.walk(config.test_roots):
        # Strictly below a bound suite root: a file at the suite root itself never was.
        bound = config.under(base, config.bound) is not None
        for f in sorted(files):
            if not ad.is_test_file(f):
                continue
            for t in ad.scan(os.path.join(base, f)):
                out.append((t, bound))
    return out
