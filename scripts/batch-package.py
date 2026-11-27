#!/usr/bin/env python3
"""A plan's batch consumed by another repository's batch as a package (`F1(package)` in `Depends on`) — run-plan.

The repository is the project root (`kit_config.project_root()`: run-plan opens each call with
`cd '<repo>' && export CLAUDE_PROJECT_DIR='<repo>' &&`).

    cctoolkit batch-package version FX --stamp <run stamp>
        the prerelease run-plan packs FX under: `<base>-kit.<stamp digits>.<n of FX>`, `<base>` = the latest
        `vX.Y.Z` / `X.Y.Z` tag reachable from HEAD with its patch + 1 (`0.0.1` without one) — above the
        published version it follows, unique per run and batch, so no restore cache ever serves an older build.
    cctoolkit batch-package check [--pack] [--use] [--feed <dir>]
        the repository can pack (`commands.pack`) / pin a package (`commands.usePackage`, and
        `packages.versionProperty` when it reads `{property}`), the feed folder exists: `ok`, else one
        `missing: …` line each, exit 1. Run by run-plan's preflight on every repository the plan packs or pins in.
    cctoolkit batch-package nuget --property <P> --version <V> --feed <dir>
        the `clean-architecture` default of `commands.usePackage`: every definition `<P>…</P>` of the build
        property in the tracked `.props`, `.targets` and project files set to V, and the local feed added to the
        root `nuget.config` as the source `cctoolkit-local` (created when absent; mapped `*` when the file maps
        its sources). One line per file written; exit 1 when no tracked file defines P.
    cctoolkit batch-package note <sheet> --work <work> --batch FX --from FY --version <V> --feed <dir>
        the files the pin changed (modified since the batch's snapshot, the plan folder aside) written as one
        `## Assumptions` row of the sheet, marked `user decision to validate`: the pre-audit reads them as
        declared, the run report lists them to switch back. Prints those files, one per line.

Exit 0, 1 refused or missing, 2 usage.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import kit_config  # noqa: E402
import work_file  # noqa: E402

SOURCE = "cctoolkit-local"
PROJECT_FILES = (".props", ".targets", ".csproj", ".fsproj", ".vbproj")
TAG = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
TO_REVIEW = "user decision to validate"
ASSUMPTIONS = re.compile(r"^## (?:Assumptions|Hypotheses|Hypothèses)\b.*$|^## .*<!-- kit:assumptions -->.*$", re.M)


def git(root, *args):
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def opts(argv, *names):
    return {k: argv[argv.index(k) + 1] for k in names if k in argv[:-1]}


def version(root, batch, stamp):
    base = (0, 0, 0)
    for tag in git(root, "tag", "--merged", "HEAD").split():
        m = TAG.match(tag)
        if m:
            base = max(base, tuple(int(x) for x in m.groups()))
    digits = re.sub(r"\D", "", stamp).lstrip("0") or "0"
    return f"{base[0]}.{base[1]}.{base[2] + 1}-kit.{digits}.{int(batch[1:])}"


def check(root, argv):
    try:
        c = kit_config.load(str(root))
    except kit_config.KitConfigError as e:
        print(f"missing: kit.config.json — {e}")
        return 1
    missing = []
    if "--pack" in argv and not c.command("pack"):
        missing.append("commands.pack unset — a batch of this repository feeds another one as a package")
    if "--use" in argv:
        use = c.commands.get("usePackage", "")
        if not c.command("usePackage"):
            missing.append("commands.usePackage unset — a batch of this repository consumes another one's package")
        elif isinstance(use, str) and "{property}" in use and not c.packages.get("versionProperty"):
            missing.append("packages.versionProperty unset — commands.usePackage reads {property}")
    if "--feed" in argv:
        feed = opts(argv, "--feed").get("--feed", "")
        if not feed:
            missing.append("packages.feed unset in the checkout's kit.config.json — the local feed packages go through")
        elif not os.path.isdir(kit_config._native(os.path.expanduser(feed))):
            missing.append(f"packages.feed {feed} is not a folder")
    for m in missing:
        print(f"missing: {m}")
    if not missing:
        print("ok")
    return 1 if missing else 0


def read(path):
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    return raw[3 if bom else 0:].decode("utf-8"), bom


def write(path, text, bom):
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))


def nuget(root, prop, ver, feed):
    if not re.fullmatch(r"[A-Za-z_][\w.-]*", prop or ""):
        print(f"refused: --property expects an MSBuild property name, got {prop!r} — packages.versionProperty", file=sys.stderr)
        return 1
    element = re.compile(rf"(<{re.escape(prop)}(?:\s[^>]*)?>)([^<]*)(</{re.escape(prop)}>)")
    written = []
    for rel in git(root, "ls-files").splitlines():
        if not rel.endswith(PROJECT_FILES):
            continue
        path = root / rel
        if not path.is_file():
            continue
        text, bom = read(path)
        new, n = element.subn(lambda m: m.group(1) + ver + m.group(3), text)
        if n:
            if new != text:
                write(path, new, bom)
            written.append(f"{rel}: {prop} = {ver}")
    if not written:
        print(f"refused: no tracked .props, .targets or project file defines <{prop}>", file=sys.stderr)
        return 1
    tops = [p for p in os.listdir(root) if p.lower() == "nuget.config" and (root / p).is_file()]
    config = root / (tops[0] if tops else "nuget.config")
    add = f'<add key="{SOURCE}" value="{feed}" />'
    if not config.is_file():
        write(config, f'<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    {add}\n  </packageSources>\n</configuration>\n', False)
    else:
        text, bom = read(config)
        nl = "\r\n" if "\r\n" in text else "\n"
        new = re.sub(rf'<add\s+key="{SOURCE}"\s+value="[^"]*"\s*/>', add, text)
        if SOURCE not in new:
            if "</packageSources>" in new:
                new = new.replace("</packageSources>", f"  {add}{nl}  </packageSources>", 1)
            else:
                new = re.sub(r"(<configuration[^>]*>)", rf"\1{nl}  <packageSources>{nl}    {add}{nl}  </packageSources>", new, count=1)
        if "</packageSourceMapping>" in new and f'<packageSource key="{SOURCE}"' not in new:
            new = new.replace("</packageSourceMapping>", f'  <packageSource key="{SOURCE}">{nl}      <package pattern="*" />{nl}    </packageSource>{nl}  </packageSourceMapping>', 1)
        if new != text:
            write(config, new, bom)
    written.append(f"{config.name}: source {SOURCE} = {feed}")
    print("\n".join(written))
    return 0


def changed(root, work, batch, plan_dir):
    """Files modified since the batch's snapshot: new, or changed since their preexisting hash."""
    before = work_file.preexisting(work_file.read(work), batch) or {}
    out = subprocess.run(["git", "-C", str(root), "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                         capture_output=True).stdout.decode("utf-8", errors="replace")
    paths = sorted(set(kit_config.porcelain_paths(out)))
    keep = [p for p in paths if not (plan_dir and (p + "/").startswith(plan_dir + "/"))]
    present = [p for p in keep if p in before and (root / p).is_file()]
    now = dict(zip(present, git(root, "hash-object", "--no-filters", *present).split())) if present else {}
    return [p for p in keep if p not in before or now.get(p, "") != before[p]]


def note(root, sheet, work, batch, source, ver, feed):
    try:
        plan_dir = Path(os.path.relpath(sheet.parent.resolve(), root.resolve())).as_posix()
    except ValueError:
        plan_dir = ""
    files = changed(root, work, batch, "" if plan_dir.startswith("..") else plan_dir)
    text = sheet.read_text(encoding="utf-8")
    numbers = [int(n) for n in re.findall(r"^\|\s*H(\d+)\s*\|", text, re.M)]
    hn = f"H{max(numbers, default=0) + 1}"
    named = ", ".join(f"`{f}`" for f in files) or "none"
    row = (f"| {hn} | Package pin from {source}: {named} point at {ver} on the local feed `{feed}` — switch back to the "
           f"published version once its CI passes | {TO_REVIEW} |")
    m = ASSUMPTIONS.search(text)
    if not m:
        text = text.rstrip("\n") + f"\n\n## Assumptions <!-- kit:assumptions -->\n\n| # | Assumption | To be validated by |\n|---|------------|--------------------|\n{row}\n"
    else:
        nxt = re.search(r"^## ", text[m.end():], re.M)
        end = m.end() + (nxt.start() if nxt else len(text) - m.end())
        rows = list(re.finditer(r"^\|.*\|[ \t]*$", text[m.end():end], re.M))
        at = m.end() + rows[-1].end() if rows else m.end()
        text = text[:at] + ("\n" + row if rows else f"\n\n| # | Assumption | To be validated by |\n|---|------------|--------------------|\n{row}\n") + text[at:]
    sheet.write_text(text, encoding="utf-8")
    print("\n".join(files))
    return 0


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    root = Path(kit_config._native(kit_config.project_root()))
    o = opts(argv, "--stamp", "--property", "--version", "--feed", "--work", "--batch", "--from")
    if cmd == "version" and len(argv) > 2 and re.fullmatch(r"F\d+", argv[2]) and "--stamp" in o:
        print(version(root, argv[2], o["--stamp"]))
        return 0
    if cmd == "check":
        return check(root, argv)
    if cmd == "nuget" and {"--property", "--version", "--feed"} <= o.keys():
        return nuget(root, o["--property"], o["--version"], o["--feed"])
    if cmd == "note" and len(argv) > 2 and {"--work", "--batch", "--from", "--version", "--feed"} <= o.keys():
        sheet = Path(kit_config._native(argv[2]))
        if not sheet.is_file():
            print(f"refused: sheet not found {argv[2]}", file=sys.stderr)
            return 1
        return note(root, sheet, Path(kit_config._native(o["--work"])), o["--batch"], o["--from"], o["--version"], o["--feed"])
    print(__doc__.split("\n\n")[2], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
