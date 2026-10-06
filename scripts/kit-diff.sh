#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# kit-diff — the kit's core files against a manual copy of them in a repo
# ══════════════════════════════════════════════════════════════════════════════
# Since the plugin, the core never sits in a repo: what a repo needs of its own
# lives in `.claude/kit.config.json`, `.claude/rules/` and the files merged from
# `templates/`. A repo still holding a copy made before the plugin runs this
# before deleting it (README § Migrating): every DRIFT and ADDED file is a local
# change to bring back into the kit, or to lose knowingly.
#
#   MISSING  in the kit, not installed            ADDED   installed, not in the kit
#   DRIFT    both, contents differ (+added −removed lines, repo side)
#   MERGED   settings.json / .gitignore / statusline-command.sh differ from
#            templates/ — repo files merged from the kit, reviewed by hand
#
# `{{PRODUCT}}` in the kit's instruction files (skills, agents, docs) is replaced
# by the repo's `product` before comparing: that substitution is the installation,
# not a drift. Not compared: `kit.config.json` and `rules/` (the repo's own),
# runtime files (context-log, learn-state, settings.local.json, __pycache__).
#
# Then the anonymisation check, on what would flow back into the kit (DRIFT and
# ADDED files, repo side, added lines only): the repo's product name in any case,
# and the repo's own vocabulary — use-case folders, their parents, aggregate and
# value-object file names read through its layout — outside the kit's fictional
# domain (Product, ModuleDiagram, ProductItem, DiagramNode, Catalog, Studio).
#
# Usage (from the toolkit checkout):
#   bash scripts/kit-diff.sh <repo>            # report
#   bash scripts/kit-diff.sh <repo> --diff     # also print each drift's unified diff
#
# Exit 0 = identical and clean. 1 = drift or anonymisation alert. 2 = usage error.
# ══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -lt 1 || ! -d "$1" ]]; then
    echo "usage: $0 <repo> [--diff]" >&2
    exit 2
fi
REPO="$(cd "$1" && pwd)"
if [[ -d "$KIT/.claude" && ! -d "$KIT/hooks" ]]; then
    echo "kit-diff: run it from the toolkit checkout, not from an installed copy ($KIT)" >&2
    exit 2
fi
if [[ ! -d "$REPO/.claude" ]]; then
    echo "kit-diff: $REPO/.claude not found — no kit installed there" >&2
    exit 2
fi

KIT="$KIT" REPO="$REPO" SHOW_DIFF="${2:-}" python3 - <<'PYEOF'
import difflib, fnmatch, json, os, re, sys

KIT, REPO = os.environ["KIT"], os.environ["REPO"]
SHOW = os.environ["SHOW_DIFF"] == "--diff"
CL = os.path.join(REPO, ".claude")

# kit path -> installed path. scripts/ is the one folder installed outside .claude/ —
# or under it, in a copy that moved them to .claude/scripts/: there a file the kit lacks
# is ADDED — the repo's own script or a local one, kit-init keeps it.
LEGACY_SCRIPTS = os.path.isfile(os.path.join(CL, "scripts", "pre-audit.sh"))
SCRIPTS_HOME = os.path.join(CL if LEGACY_SCRIPTS else REPO, "scripts")
CORE = ["agents", "hooks", "lib", "presets", "skills", "tools", "docs", "evals/run.sh", "evals/cases"]
# Optional bricks: compared only when the repo installed them.
OPTIONAL = ["mods"]
# kit template -> repo file under .claude/
MERGED = [("templates/settings.json", "settings.json"), ("templates/claude.gitignore", ".gitignore"),
          ("templates/statusline-command.sh", "statusline-command.sh")]
IGNORE_DIRS = {"__pycache__", ".fixtures", "node_modules"}
IGNORE_FILES = {"context-log.tsv", "context-log.raw.json", "settings.local.json", "learn-state.json",
                "learn-state.json.tmp", ".DS_Store"}
# The kit's fictional domain: a repo name built on one of these (CreateProduct) is the kit's own.
FICTIONAL = ("Product", "ModuleDiagram", "DiagramNode", "Catalog", "Studio")
GENERIC = {"Core", "Shared", "Common", "Features", "features", "Application", "application", "Domain", "domain",
           "Abstractions", "Aggregates", "ValueObjects"}


def installed(rel):
    if rel.startswith("scripts/"):
        return os.path.join(SCRIPTS_HOME, rel[len("scripts/"):])
    return os.path.join(CL, rel)


def files_under(base, rel):
    root = os.path.join(base, rel)
    if os.path.isfile(root):
        return {rel}
    out = set()
    for b, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            if f in IGNORE_FILES or f.endswith(".pyc"):
                continue
            out.add(os.path.relpath(os.path.join(b, f), base))
    return out


def read(path):
    try:
        with open(path, encoding="utf-8", errors="surrogateescape") as fh:
            return fh.read()
    except OSError:
        return None


cfg = {}
try:
    with open(os.path.join(CL, "kit.config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
except (OSError, ValueError):
    pass
product = cfg.get("product") if isinstance(cfg.get("product"), str) else None

compared = CORE + [rel for rel in OPTIONAL if os.path.exists(os.path.join(CL, rel))]
kit_files, repo_files = set(), set()
for rel in compared:
    if os.path.exists(os.path.join(KIT, rel)):
        kit_files |= files_under(KIT, rel)
    if os.path.exists(os.path.join(CL, rel)):
        repo_files |= files_under(CL, rel)
# The kit's scripts only: the repo's scripts/ holds its own tooling too, never ADDED.
kit_files |= files_under(KIT, "scripts")
if LEGACY_SCRIPTS:
    repo_files |= files_under(CL, "scripts")


def normalised_kit(rel):
    text = read(os.path.join(KIT, rel))
    if text is not None and product:
        text = text.replace("{{PRODUCT}}", product)
    return text


missing, added, drift, merged = [], [], [], []
flow_back = {}  # installed rel -> added lines (repo side)
for rel in sorted(kit_files):
    mine = read(installed(rel))
    if mine is None:
        missing.append(rel)
        continue
    theirs = normalised_kit(rel)
    if mine != theirs and mine == read(os.path.join(KIT, rel)):
        continue  # installed without the {{PRODUCT}} substitution: same file
    if mine != theirs:
        a, b = theirs.splitlines(), mine.splitlines()
        plus = [l[1:] for l in difflib.unified_diff(a, b, lineterm="", n=0) if l.startswith("+") and not l.startswith("+++")]
        minus = sum(1 for l in difflib.unified_diff(a, b, lineterm="", n=0) if l.startswith("-") and not l.startswith("---"))
        drift.append((rel, len(plus), minus, a, b))
        flow_back[rel] = plus
for rel in sorted(repo_files - kit_files):
    added.append(rel)
    flow_back[rel] = (read(installed(rel)) or "").splitlines()
for src, rel in MERGED:
    k, r = normalised_kit(src), read(os.path.join(CL, rel))
    if k is not None and r is not None and k != r:
        merged.append(rel)

# --- anonymisation -------------------------------------------------------------------
names = set()
if product:
    names.add(product)
sys.path.insert(0, os.path.join(KIT, "lib"))
try:
    import kit_config
    C = kit_config.load(REPO)
    for base, files in C.walk(C.use_case_roots):
        if C.is_use_case_dir(base):
            rel = os.path.relpath(base, C.root_of(base, C.use_case_roots))
            names.update(p for p in rel.split(os.sep) if p and p != ".")
    for base, files in C.walk(C.source_roots):
        for f in files:
            full = os.path.join(base, f)
            if any(fnmatch.fnmatchcase(full, p) for p in C.aggregate):
                names.add(f.split(".")[0])
except Exception as e:  # no lib, broken config: product name only
    print(f"note: repo vocabulary not read ({e.__class__.__name__}: {e}) — product name only")
names = {n for n in names if len(n) >= 4 and n not in GENERIC and not any(w in n for w in FICTIONAL)}
alerts = []
if names:
    pats = [(n, re.compile(r"(?<![A-Za-z])" + re.escape(n) + r"(?![a-z])", re.I if n == product else 0)) for n in sorted(names)]
    for rel in sorted(flow_back):
        for line in flow_back[rel]:
            for n, rx in pats:
                if rx.search(line):
                    alerts.append((rel, n, line.strip()[:100]))
                    break

# --- report --------------------------------------------------------------------------
print(f"kit-diff — {KIT} vs {REPO}" + (f" (product: {product})" if product else " (no product in kit.config.json)"))
for rel in missing:
    print(f"MISSING  {rel}")
for rel in added:
    print(f"ADDED    {rel}")
for rel, p, m, a, b in drift:
    print(f"DRIFT    {rel}  (+{p} −{m})")
    if SHOW:
        for l in difflib.unified_diff(a, b, f"kit/{rel}", f"repo/{rel}", lineterm=""):
            print(f"    {l}")
for rel in merged:
    print(f"MERGED   {rel}  differs — merge file, review by hand")
for rel, n, line in alerts:
    print(f"ANONYMISATION  {rel}: '{n}' — {line}")
print(f"summary: {len(missing)} missing, {len(added)} added, {len(drift)} drifted, {len(merged)} merge files differ; "
      f"{len(alerts)} anonymisation alerts")
sys.exit(1 if (missing or added or drift or alerts) else 0)
PYEOF
