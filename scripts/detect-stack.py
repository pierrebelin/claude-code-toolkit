#!/usr/bin/env python3
"""The model-free half of `/kit-init`: what the repo is made of, and how well each
preset's layout fits it. One JSON object on stdout; nothing written.

Usage:
    cctoolkit detect-stack            # the repo resolved by kit_config.project_root()
    cctoolkit detect-stack <root>

Stacks are read off their manifests (`*.sln`/`*.csproj`, `package.json`,
`pyproject.toml`/`requirements*.txt`, `pom.xml`/`build.gradle*`), up to four levels
deep, with the test framework their dependencies name and a product guess (the
solution, package or artifact name). Each preset — shipped, or the repo's own under
`.claude/presets/` — is then resolved against the real tree, the product guess and
the detected test framework applied: how many use-case folders its markers
recognise, which source and test roots exist. The preset recognising the most
use-case folders comes first; zero everywhere means none fits and `/kit-init`
drafts the layer rules from the code instead.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "lib"))
import kit_config  # noqa: E402

SKIP = {".git", "node_modules", "bin", "obj", "dist", "build", "target", ".venv", "venv", "__pycache__",
        ".claude", ".idea", ".vs", "coverage", ".next", "out", "graphify-out"}
MAX_DEPTH = 4
# testTag frameworks lib/kit_testtag.py carries; vitest shares Jest's `it`/`test` titles.
TAG_FOR = {"xunit": "xunit", "pytest": "pytest", "junit": "junit", "jest": "jest", "vitest": "jest"}


def scan(root):
    """Manifest files by kind, relative paths, depth-bounded."""
    found = {"sln": [], "csproj": [], "package.json": [], "tsconfig.json": [], "pyproject.toml": [],
             "requirements": [], "pom.xml": [], "gradle": []}
    for base, dirs, files in os.walk(root):
        depth = os.path.relpath(base, root).count(os.sep) + (base != root)
        dirs[:] = [] if depth >= MAX_DEPTH else sorted(d for d in dirs if d not in SKIP and not d.startswith("."))
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), root)
            if f.endswith((".sln", ".slnx")):
                found["sln"].append(rel)
            elif f.endswith(".csproj"):
                found["csproj"].append(rel)
            elif f in ("package.json", "tsconfig.json", "pyproject.toml", "pom.xml"):
                found[f].append(rel)
            elif re.fullmatch(r"requirements.*\.txt", f):
                found["requirements"].append(rel)
            elif f in ("build.gradle", "build.gradle.kts"):
                found["gradle"].append(rel)
    return found


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="ignore") as fh:
            return fh.read()
    except OSError:
        return ""


def stacks(root, m):
    out = []
    if m["sln"] or m["csproj"]:
        text = " ".join(read(root, p) for p in m["csproj"])
        fw = next((f for f, rx in (("xunit", r"xunit"), ("nunit", r"\bNUnit\b"), ("mstest", r"MSTest"))
                   if re.search(rx, text, re.I)), None)
        # Shallowest solutions first: one at the top level is the product, a vendored
        # `externals/Other.sln` below it is a candidate, never a tie.
        slns = sorted(m["sln"], key=lambda p: (p.count(os.sep), p))
        names = [os.path.splitext(os.path.basename(p))[0] for p in slns]
        top = [n for p, n in zip(slns, names) if p.count(os.sep) == slns[0].count(os.sep)] if slns else []
        if not names:
            stems = {re.sub(r"\.(Domain|Application|Infrastructure|WebApi|Api|UnitTests|Tests)$", "",
                            os.path.splitext(os.path.basename(p))[0]) for p in m["csproj"]}
            names = top = sorted(stems)
        out.append({"stack": "dotnet", "language": "C#", "evidence": (slns or m["csproj"])[:5],
                    "testFramework": fw, "product": top[0] if len(top) == 1 else None,
                    "productCandidates": names[:5]})
    if m["package.json"]:
        pkg = {}
        try:
            pkg = json.loads(read(root, "package.json") or read(root, m["package.json"][0]) or "{}")
        except ValueError:
            pass
        deps = " ".join(read(root, p) for p in m["package.json"])
        fw = next((f for f in ("vitest", "jest") if re.search(rf'"{f}"\s*:', deps)), None)
        name = pkg.get("name") if isinstance(pkg.get("name"), str) else None
        out.append({"stack": "node", "language": "TypeScript" if m["tsconfig.json"] else "JavaScript",
                    "evidence": m["package.json"][:5], "testFramework": fw,
                    "product": name.split("/")[-1] if name else None,
                    "productCandidates": [name] if name else []})
    if m["pyproject.toml"] or m["requirements"]:
        text = " ".join(read(root, p) for p in m["pyproject.toml"] + m["requirements"])
        name = None
        if m["pyproject.toml"]:
            hit = re.search(r'^\s*name\s*=\s*"([^"]+)"', read(root, m["pyproject.toml"][0]), re.M)
            name = hit.group(1) if hit else None
        out.append({"stack": "python", "language": "Python", "evidence": (m["pyproject.toml"] + m["requirements"])[:5],
                    "testFramework": "pytest" if re.search(r"\bpytest\b", text) else None,
                    "product": name, "productCandidates": [name] if name else []})
    if m["pom.xml"] or m["gradle"]:
        text = " ".join(read(root, p) for p in m["pom.xml"] + m["gradle"])
        name = None
        if m["pom.xml"]:
            hit = re.search(r"<artifactId>([^<]+)</artifactId>", re.sub(r"<parent>.*?</parent>", "", read(root, m["pom.xml"][0]), flags=re.S))
            name = hit.group(1) if hit else None
        out.append({"stack": "jvm", "language": "Kotlin" if any(p.endswith(".kts") for p in m["gradle"]) else "Java",
                    "evidence": (m["pom.xml"] + m["gradle"])[:5],
                    "testFramework": "junit" if re.search(r"junit", text, re.I) else None,
                    "product": name, "productCandidates": [name] if name else []})
    return out


def fit(root, name, product, framework):
    path = kit_config.preset_file(root, name)
    preset = kit_config._read_json(path, f"preset {name}")
    over = {}
    if product:
        over["product"] = product
    if framework:
        over["testTag"] = {"framework": framework}
    data = kit_config.merge({k: v for k, v in preset.items() if k != "description"}, over)
    data["preset"] = name
    c = kit_config.Config(data, root)
    found = [c.rel(b) for b, _ in c.walk(c.use_case_roots) if c.is_use_case_dir(b)]
    return {
        "preset": name,
        "description": preset.get("description", ""),
        "source": "repo" if path.startswith(os.path.join(root, ".claude")) else "kit",
        "useCaseFolders": len(found),
        "sample": found[:5],
        "sourceRoots": [c.rel(d) for d in c.dirs(c.source_roots)],
        "testRoots": [c.rel(d) for d in c.dirs(c.test_roots)],
        "rulePack": os.path.isdir(os.path.join(os.path.dirname(path), "rules")),
    }


def layers(root):
    """Top folders of the code: candidates for the layer rules when no preset fits."""
    out = []
    for top in ("src", "app", "lib", "packages", "tests", "test"):
        base = os.path.join(root, top)
        if not os.path.isdir(base):
            continue
        for d in sorted(os.listdir(base)):
            full = os.path.join(base, d)
            if not os.path.isdir(full) or d in SKIP or d.startswith("."):
                continue
            exts = {}
            for b, dirs, files in os.walk(full):
                dirs[:] = [x for x in dirs if x not in SKIP]
                for f in files:
                    e = os.path.splitext(f)[1]
                    if e:
                        exts[e] = exts.get(e, 0) + 1
            if exts:
                top_ext = sorted(exts.items(), key=lambda kv: -kv[1])[:3]
                out.append({"dir": f"{top}/{d}", "files": sum(exts.values()), "extensions": dict(top_ext)})
    return out


def main(argv):
    root = os.path.abspath(argv[1]) if len(argv) > 1 else kit_config.project_root()
    m = scan(root)
    st = stacks(root, m)
    main_stack = st[0] if st else None
    product = main_stack["product"] if main_stack else None
    framework = TAG_FOR.get((main_stack or {}).get("testFramework") or "")
    cl = os.path.join(root, ".claude")
    presets = []
    for name in kit_config.preset_names(root):
        try:
            presets.append(fit(root, name, product, framework))
        except (kit_config.KitConfigError, KeyError, TypeError, re.error) as e:
            presets.append({"preset": name, "error": str(e), "useCaseFolders": 0})
    presets.sort(key=lambda p: (-p["useCaseFolders"], p["preset"] != kit_config.DEFAULT_PRESET, p["preset"]))
    legacy = [d for d in ("hooks", "lib", "skills", "agents", "tools", "presets", "evals")
              if os.path.isdir(os.path.join(cl, d))]
    # Copies that moved the kit's scripts under .claude/, and the mods' own marketplace.
    if os.path.isfile(os.path.join(cl, "scripts", "pre-audit.sh")):
        legacy.append("scripts")
    if os.path.isfile(os.path.join(cl, "mods", ".claude-plugin", "marketplace.json")):
        legacy.append("mods")
    if os.path.isfile(os.path.join(root, "scripts", "pre-audit.sh")):
        legacy.append("../scripts")
    print(json.dumps({
        "root": root,
        "stacks": st,
        "product": product,
        "testTag": framework,
        "testTagUnsupported": (main_stack or {}).get("testFramework") if main_stack and not framework else None,
        "presets": presets,
        "fits": bool(presets and presets[0]["useCaseFolders"] > 0),
        "layers": layers(root),
        "existing": {
            "kitConfig": os.path.isfile(os.path.join(cl, "kit.config.json")),
            "rules": sorted(f for f in os.listdir(os.path.join(cl, "rules")) if f.endswith(".md"))
            if os.path.isdir(os.path.join(cl, "rules")) else [],
            "settings": os.path.isfile(os.path.join(cl, "settings.json")),
            "statusline": os.path.isfile(os.path.join(cl, "statusline-command.sh")),
            "legacyCopy": legacy,
        },
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
