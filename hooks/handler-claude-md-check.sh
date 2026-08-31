#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write) : vérifie la traçabilité règles métier <-> tests unitaires.
#
# Chaque CLAUDE.md de handler (src/{{PRODUCT}}.Application/**/<Handler>/CLAUDE.md)
# porte un tableau "## Règles métier" dont la colonne Tests cite des `ClasseDeTest.Méthode`.
# Le hook construit deux index globaux (références citées / tests réellement présents dans
# tests/{{PRODUCT}}.UnitTests et tests/{{PRODUCT}}.ContractTests) et signale
# les écarts. Les ContractTests comptent : une règle de forme de réponse (payload, code
# HTTP) ne se vérifie que par snapshot de contrat.
#
# Avertissement seul : sortie 0 dans tous les cas, jamais de blocage.

INPUT=$(cat)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',d).get('file_path',''))" 2>/dev/null || true)
[ -z "$FILE_PATH" ] && exit 0

REPO_ROOT="$REPO_ROOT" FILE_PATH="$FILE_PATH" python3 <<'PYEOF'
import os, re, sys, unicodedata

ROOT = os.environ["REPO_ROOT"]
APP = os.path.join(ROOT, "src", "{{PRODUCT}}.Application")
UT = os.path.join(ROOT, "tests", "{{PRODUCT}}.UnitTests")
CT = os.path.join(ROOT, "tests", "{{PRODUCT}}.ContractTests")
SUITES = [UT, CT]
SKIP_DIRS = {"bin", "obj", "bin-linux", "obj-linux", "Properties"}

raw = os.environ["FILE_PATH"]
target = raw if os.path.isabs(raw) else os.path.join(ROOT, raw)
target = os.path.normpath(target)

in_app = target.startswith(APP + os.sep)
in_ut = any(target.startswith(s + os.sep) for s in SUITES)
if not (in_app or in_ut):
    sys.exit(0)
if not (target.endswith(".cs") or os.path.basename(target) == "CLAUDE.md"):
    sys.exit(0)


def fold(s):
    """Compare les titres de section sans dependre des accents : le repo melange
    « Regles metier » et « Règles métier »."""
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower())
                   if unicodedata.category(c) != "Mn")


def walk_cs(root):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".cs"):
                yield os.path.join(base, f)


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


HANDLER_CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+\w*Handler\b", re.M)


def is_handler_file(path):
    """Une classe, pas une interface. Tester `not f.startswith("I")` ferait passer
    `IFooCommandHandler.cs` pour une interface, mais exclurait aussi
    `ImportGraphsCommandHandler.cs` — tout handler dont le nom commence par I."""
    try:
        return bool(HANDLER_CLASS.search(read(path)))
    except OSError:
        return False


def is_handler_dir(d):
    """Un dossier de handler porte son handler. L'arborescence Application melange
    des profondeurs (Studio/X/Y/, Catalog/X/Y/Z/) : la profondeur ne discrimine pas."""
    try:
        names = os.listdir(d)
    except OSError:
        return False
    return any(f.endswith("Handler.cs") and is_handler_file(os.path.join(d, f)) for f in names)


# --- Index 1 : règles déclarées dans les CLAUDE.md de handler -----------------
# rules[claude_md] = [(rule_id, label, [Classe.Méthode, ...]), ...]
RULE_ROW = re.compile(r"^\|\s*(R[ML]-\d+)\s*\|(.*)$")
SECTION = re.compile(r"^##\s+R[eè]gles?\s+m[eé]tier", re.I)

rules = {}
all_md = set()
for base, dirs, files in os.walk(APP):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    if "CLAUDE.md" not in files:
        continue
    md = os.path.join(base, "CLAUDE.md")
    rows, in_section, empty_ok = [], False, False
    for line in read(md).splitlines():
        if line.startswith("## "):
            in_section = bool(SECTION.match(line))
            continue
        if not in_section:
            continue
        if line.strip().lower().startswith("aucun"):
            empty_ok = True
        m = RULE_ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        label = cells[0] if cells else ""
        tests_cell = cells[2] if len(cells) > 2 else ""
        refs = [r.strip(" `") for r in tests_cell.split(",") if r.strip(" `")]
        rows.append((m.group(1), label, refs))
    if rows:
        rules[md] = rows
    elif empty_ok:
        rules[md] = []
    # Un CLAUDE.md de feature ou de racine est un index : pas de structure figée à contrôler.
    # On garde le dossier qui porte un handler, et tout fichier qui déclare des règles
    # (Core/GroupAccess documente les siennes sans être un handler).
    if md in rules or is_handler_dir(base):
        all_md.add(md)

# --- Index 2 : tests réellement présents -------------------------------------
# present[Classe.Méthode] = chemin
CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)")
ATTR = re.compile(r"^\s*\[(?:Fact|Theory)[\](]")
METHOD = re.compile(r"^\s*(?:public|internal)\s+(?:async\s+)?(?:Task|void|ValueTask)\s+(\w+)\s*\(")

present = {}
for suite in SUITES:
    if not os.path.isdir(suite):
        continue
    for path in walk_cs(suite):
        cls, armed = None, False
        for line in read(path).splitlines():
            cm = CLASS.match(line)
            if cm:
                cls, armed = cm.group(1), False
                continue
            if ATTR.match(line):
                armed = True
                continue
            if armed:
                mm = METHOD.match(line)
                if mm and cls:
                    present[f"{cls}.{mm.group(1)}"] = path
                    armed = False

# --- Périmètre du rapport ----------------------------------------------------
all_referenced = {r for rows in rules.values() for _, _, refs in rows for r in refs}
cited_classes = {r.split(".")[0] for r in all_referenced}


focus = set()
if os.path.basename(target) == "CLAUDE.md":
    if target in all_md:
        focus.add(target)
elif in_app:
    d = os.path.dirname(target)
    md = os.path.join(d, "CLAUDE.md")
    if md in all_md:
        focus.add(md)
    elif is_handler_dir(d):
        rel = os.path.relpath(d, APP)
        print(f"Rappel : pas de CLAUDE.md dans {rel} — en créer un (tableau Règles métier, Flux, Événements émis).")
        sys.exit(0)
    else:
        sys.exit(0)
else:
    # fichier de tests : on remonte aux CLAUDE.md qui citent une de ses classes
    classes = {k.split(".")[0] for k, p in present.items() if p == target}
    for md, rows in rules.items():
        if any(r.split(".")[0] in classes for _, _, refs in rows for r in refs):
            focus.add(md)
    if not focus:
        orphans = sorted(k for k, p in present.items() if p == target and k.split(".")[0] in cited_classes)
        if orphans:
            print("Tests non rattachés à une règle : " + ", ".join(orphans[:5]))
        sys.exit(0)

if not focus:
    sys.exit(0)

# --- Forme figée -------------------------------------------------------------
ALLOWED = ["Règles métier", "Flux", "Événements émis"]
ALLOWED_FOLDED = {fold(s): s for s in ALLOWED}


def shape_issues(md):
    secs = [l[3:].strip() for l in read(md).splitlines() if l.startswith("## ")]
    issues = []
    extra = [s for s in secs if fold(s) not in ALLOWED_FOLDED]
    if extra:
        issues.append("sections interdites : " + ", ".join(f"'{s}'" for s in extra))
    seen = {fold(s) for s in secs}
    missing = [s for s in ALLOWED if fold(s) not in seen]
    if missing:
        issues.append("sections manquantes : " + ", ".join(missing))
    kept = [ALLOWED_FOLDED[fold(s)] for s in secs if fold(s) in ALLOWED_FOLDED]
    if kept != [s for s in ALLOWED if s in kept]:
        issues.append("ordre attendu : Règles métier, Flux, Événements émis")
    return issues


# --- Rapport -----------------------------------------------------------------
out = []
for md in sorted(focus):
    rel_md = os.path.relpath(md, ROOT)
    if md not in rules:
        issues = shape_issues(md)
        detail = (" — " + " ; ".join(issues)) if issues else ""
        out.append(f"{rel_md} : pas de tableau '## Règles métier' — structure figée : titre + description, Règles métier, Flux, Événements émis{detail}.")
        continue
    untested = [rid for rid, _, refs in rules[md] if not refs]
    stale = sorted({r for _, _, refs in rules[md] for r in refs if r not in present})

    dup = {}
    for rid, _, refs in rules[md]:
        for r in refs:
            dup.setdefault(r, []).append(rid)
    shared = sorted(f"{r} ({', '.join(ids)})" for r, ids in dup.items() if len(ids) > 1)

    md_classes = {r.split(".")[0] for _, _, refs in rules[md] for r in refs}
    # Une classe transverse (StoredFileModificationServiceTests) repartit ses tests sur plusieurs
    # handlers : un test rattache dans un autre CLAUDE.md n'est pas orphelin ici.
    orphans = sorted(k for k in present if k.split(".")[0] in md_classes and k not in all_referenced)

    # La structure figée ne vaut que pour un dossier de handler. Core/GroupAccess declare
    # des règles partagées sans en être un : on garde sa traçabilité, pas sa forme.
    lines = shape_issues(md) if is_handler_dir(os.path.dirname(md)) else []
    lines = [f"  {i}" for i in lines]
    if untested:
        lines.append(f"  règles sans test : {', '.join(untested)}")
    if stale:
        lines.append(f"  tests référencés introuvables : {', '.join(stale[:5])}")
    if orphans:
        lines.append(f"  tests non rattachés à une règle : {', '.join(orphans[:5])}" + (f" (+{len(orphans)-5})" if len(orphans) > 5 else ""))
    if shared:
        lines.append(f"  test partagé par plusieurs règles : {'; '.join(shared[:3])}")
    if lines:
        out.append(f"{rel_md}\n" + "\n".join(lines))
    elif os.path.basename(target) != "CLAUDE.md":
        out.append(f"{rel_md} : traçabilité règles/tests à jour.")

if out:
    print("Traçabilité règles métier ↔ tests")
    print("\n".join(out))
    total_untested = sum(1 for rows in rules.values() for _, _, refs in rows if not refs)
    if total_untested:
        print(f"({total_untested} règles sans test sur l'ensemble de Application/)")
PYEOF

exit 0
