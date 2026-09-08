# .NET commands — quality report

Commands for .NET projects (xUnit v3, Stryker .NET, dotnet sonarscanner, ReportGenerator).

Every path assumes the kit's repo shape: `src/{{PRODUCT}}.<Layer>/` and `tests/{{PRODUCT}}.<Suite>/`. Substitute `{{PRODUCT}}` and drop or add the suites the target repo actually has.

**xUnit v3**: test projects are `<OutputType>Exe</OutputType>` (self-hosted runners). Always use `dotnet test --project <path to .csproj>`. Never `dotnet test <folder>` (it fails silently, or reports 0 tests).

---

## Step 1 — Docker

```bash
docker ps 2>/dev/null && echo "already running"
```

If Docker does not answer and the session is a container without a daemon of its own:

```bash
sudo containerd > /tmp/containerd.log 2>&1 &
sleep 3
sudo dockerd > /tmp/dockerd.log 2>&1 &
sleep 6
sudo docker ps
```

On a workstation with Docker Desktop, start the application instead.

---

## Step 2 — Build + tests

### 2a — Build

```bash
START=$(date +%s)
dotnet build --no-restore 2>&1 | tail -5
END=$(date +%s)
echo "Build duration: $((END - START))s"
```

### 2b — Tests with coverage (xUnit v3)

**xUnit v3 + dotnet-coverage**: use `dotnet-coverage collect` as a wrapper around `dotnet test --project`. The `--collect:"XPlat Code Coverage"` syntax does not work with the xUnit v3 runner.

Prerequisite: `dotnet tool install -g dotnet-coverage` + `export PATH="$HOME/.dotnet/tools:$PATH"`.

Output format: `cobertura` (the files are named `coverage.opencover.xml` by convention but hold cobertura — ReportGenerator accepts both).

```bash
export PATH="$HOME/.dotnet/tools:$PATH"
rm -rf ./TestResults /tmp/test-*.log

# Phase 1 — the non-Docker suites in parallel
dotnet-coverage collect \
  --output ./TestResults/UnitTests/coverage.opencover.xml \
  --output-format cobertura \
  "dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-restore" \
  > /tmp/test-UnitTests.log 2>&1 &
PID_UNIT=$!

dotnet-coverage collect \
  --output ./TestResults/ContractTests/coverage.opencover.xml \
  --output-format cobertura \
  "dotnet test --project tests/{{PRODUCT}}.ContractTests/{{PRODUCT}}.ContractTests.csproj --no-restore" \
  > /tmp/test-ContractTests.log 2>&1 &
PID_CONTRACT=$!

dotnet test --project tests/{{PRODUCT}}.ArchitectureTests/{{PRODUCT}}.ArchitectureTests.csproj --no-restore \
  > /tmp/test-ArchitectureTests.log 2>&1 &
PID_ARCH=$!

wait $PID_UNIT $PID_CONTRACT $PID_ARCH

for proj in UnitTests ContractTests ArchitectureTests; do
  echo "=== $proj ==="
  tail -10 /tmp/test-$proj.log
done

# Phase 2 — IntegrationTests alone (Testcontainers + Docker)
dotnet-coverage collect \
  --output ./TestResults/IntegrationTests/coverage.opencover.xml \
  --output-format cobertura \
  "dotnet test --project tests/{{PRODUCT}}.IntegrationTests/{{PRODUCT}}.IntegrationTests.csproj --no-restore" \
  2>&1 | tail -20
```

### Test filtering (xUnit v3)

xUnit v3 uses `--filter-class` and `--filter-method`, not `--filter`:

```bash
dotnet test --project tests/{{PRODUCT}}.UnitTests/{{PRODUCT}}.UnitTests.csproj --no-restore --no-build \
  --filter-class "Namespace.TestClass" --filter-method "TestMethod"
```

---

## Step 3 — SonarQube + ReportGenerator

Do not modify the code between steps 2 and 3 (otherwise: `Line out of range` error).

### 3a — Pre-generate the coverage in SonarQube generic format

**Never hand raw opencover files to SonarQube** (`sonar.cs.opencover.reportsPaths`) — the scanner freezes on large projects (86MB+ of XML). Always convert through ReportGenerator into the `SonarQube` (generic coverage) format.

```bash
export PATH="$HOME/.dotnet/tools:$PATH"

# Merge + convert to SonarQube generic format (~2.5MB instead of 86MB)
~/.dotnet/tools/reportgenerator \
  "-reports:TestResults/UnitTests/**/coverage.opencover.xml;TestResults/ContractTests/**/coverage.opencover.xml;TestResults/IntegrationTests/**/coverage.opencover.xml" \
  "-targetdir:TestResults/MergedCoverage" \
  "-reporttypes:SonarQube" \
  "-assemblyfilters:+{{PRODUCT}}.*;-*Tests*"
```

### 3b — ReportGenerator TextSummary (in parallel)

For per-assembly detail and partial/full methods (data unavailable in SonarQube).

```bash
~/.dotnet/tools/reportgenerator \
  "-reports:TestResults/UnitTests/**/coverage.opencover.xml;TestResults/ContractTests/**/coverage.opencover.xml;TestResults/IntegrationTests/**/coverage.opencover.xml" \
  "-targetdir:TestResults/CoverageReport" \
  "-reporttypes:TextSummary" \
  "-assemblyfilters:+{{PRODUCT}}.*;-*Tests*"

cat TestResults/CoverageReport/Summary.txt
```

### 3c — Run the SonarQube scan

`sonar.projectBaseDir=src/` limits the scan to `src/`. The `tests/` projects are analysed through MSBuild. Exclude a vendored folder with `<SonarQubeExclude>true</SonarQubeExclude>` in its `.csproj`.

Use `sonar.coverageReportPaths` (generic coverage) — **not** `sonar.cs.opencover.reportsPaths`.

```bash
REPO=$(git rev-parse --show-toplevel)

cat > /tmp/run-sonar.sh << SCRIPT
#!/bin/bash
source ~/.sonar-token
export PATH="\$HOME/.dotnet/tools:\$PATH"
LOG=/tmp/sonar-live.log
> \$LOG

pkill -f "dotnet-sonarscanner" 2>/dev/null || true
pkill -f "dotnet sonarscanner" 2>/dev/null || true
sleep 2
rm -rf $REPO/.sonarqube $REPO/src/.scannerwork 2>/dev/null

echo "[\$(date +%H:%M:%S)] BEGIN sonarscanner" | tee -a \$LOG
dotnet sonarscanner begin \\
  /k:"{{PRODUCT}}" \\
  /d:sonar.host.url="http://localhost:9000" \\
  /d:sonar.token="\$SONAR_TOKEN" \\
  /d:sonar.coverageReportPaths="$REPO/TestResults/MergedCoverage/SonarQube.xml" \\
  /d:sonar.projectBaseDir="$REPO/src" \\
  /d:sonar.exclusions="**/bin/**,**/obj/**,**/Migrations/**,docs/**" 2>&1 | tee -a \$LOG

echo "[\$(date +%H:%M:%S)] BUILD start" | tee -a \$LOG
dotnet build --no-restore 2>&1 | tail -3 | tee -a \$LOG
echo "[\$(date +%H:%M:%S)] BUILD done" | tee -a \$LOG

echo "[\$(date +%H:%M:%S)] END sonarscanner start" | tee -a \$LOG
dotnet sonarscanner end /d:sonar.token="\$SONAR_TOKEN" 2>&1 | tee -a \$LOG
EXIT_CODE=\$?
echo "[\$(date +%H:%M:%S)] SONAR FINISHED (exit=\$EXIT_CODE)" | tee -a \$LOG
SCRIPT
chmod +x /tmp/run-sonar.sh
```

Run it in the background + Monitor:

```bash
nohup bash /tmp/run-sonar.sh > /dev/null 2>&1 &
echo "PID: $!"
```

```
Monitor(
  description="SonarQube scan progress",
  timeout_ms=600000,
  persistent=false,
  command='tail -f /tmp/sonar-live.log | grep -E --line-buffered "\\[|Coverage|coverage|Upload|EXECUTION|FINISHED|ERROR|exit="'
)
```

> `nohup` + Monitor because `run_in_background` can time out (exit 144). ~5 min in total.

`~/.sonar-token` is a file exporting the token: `export SONAR_TOKEN=<token>`. If it does not exist, create it (`chmod 600`) from a SonarQube user token.
If `dotnet-sonarscanner` is missing → `dotnet tool install -g dotnet-sonarscanner`.

### 3d — Fetch the SonarQube metrics (after the analysis)

Wait for the server-side CE task to finish (~30s after FINISHED), then query the API.

```bash
source ~/.sonar-token
curl -s -u "$SONAR_TOKEN:" \
  "http://localhost:9000/api/measures/component?component={{PRODUCT}}&metricKeys=coverage,line_coverage,branch_coverage,lines_to_cover,conditions_to_cover,uncovered_lines,uncovered_conditions,ncloc,bugs,vulnerabilities,code_smells,security_hotspots,duplicated_lines_density,sqale_index,sqale_debt_ratio,cognitive_complexity" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('component', {}).get('measures', []):
    print(f\"{m['metric']}: {m['value']}\")"
```

Quality Gate + issues by severity:

> 🔴 **ABSOLUTE RULE — always `&resolved=false` on `api/issues/search`.** Without that filter the API returns **open + already fixed (FIXED)** issues: on a repo with history that can triple the total (e.g. ~5,990 reported against ~1,850 really open, 4,146 FIXED in the history). Every issue count in the report (`issues_by_severity`, per-rule breakdown, green-coding rules, MAJOR/CRITICAL) **must** carry `resolved=false`. The *measures* (`code_smells`, `bugs` through `api/measures`) are already open-only — do not confuse them with `issues/search`.

```bash
curl -s -u "$SONAR_TOKEN:" "http://localhost:9000/api/qualitygates/project_status?projectKey={{PRODUCT}}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['projectStatus']['status'])"

# OPEN issues by severity (real backlog — note the resolved=false)
curl -s -u "$SONAR_TOKEN:" "http://localhost:9000/api/issues/search?componentKeys={{PRODUCT}}&resolved=false&facets=severities&ps=1" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f\"OPEN total: {d['total']}\")
for f in d.get('facets', []):
    if f['property'] == 'severities':
        for v in f['values']:
            print(f\"{v['val']}: {v['count']}\")"

# Cumulative fixes (FIXED) — to show improvement (JSON field issues_resolved_total)
curl -s -u "$SONAR_TOKEN:" "http://localhost:9000/api/issues/search?componentKeys={{PRODUCT}}&resolved=true&ps=1" \
  | python3 -c "import json,sys; print(f\"FIXED total: {json.load(sys.stdin)['total']}\")"
```

JSON mapping: `coverage` → `sonarqube_coverage_pct`, `line_coverage` → lines, `branch_coverage` → branches, `lines_to_cover` → total, `uncovered_lines` → covered = total − uncovered. Same for conditions/branches. Open total → `issues_open_total`, FIXED → `issues_resolved_total`, the `resolved=false` breakdown → `issues_by_severity`.

### 3e — Green-coding rules (optional, always `resolved=false`)

If the SonarQube instance runs the Creedengo (eco-design) rules, count them separately. Skip this step when the plugin is absent — `sonarqube.creedengo` stays `null`.

```bash
GCI="roslyn.creedengo.cs:GCI85,roslyn.creedengo.cs:GCI82,roslyn.creedengo.cs:GCI93,roslyn.creedengo.cs:GCI87,roslyn.creedengo.cs:GCI69,roslyn.creedengo.cs:GCI88,roslyn.creedengo.cs:GCI86,roslyn.creedengo.cs:GCI81"
curl -s -u "$SONAR_TOKEN:" "http://localhost:9000/api/issues/search?componentKeys={{PRODUCT}}&resolved=false&rules=$GCI&facets=rules,severities&ps=1" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin); print('creedengo OPEN total:', d['total'], '| effort(min):', d.get('effortTotal'))
for f in d['facets']:
    if f['property']=='severities':
        for v in f['values']:
            if v['count']: print(f\"  {v['val']}: {v['count']}\")"
```
Note: the `rules` facet ignores the `rules=` filter (Sonar behaviour) — rely on `total` and on the `severities` facet, or query each GCIxx rule individually for per-rule counts. → `sonarqube.creedengo` (total_issues, effort_minutes, issues_by_severity, issues_by_rule, top_directories through `&facets=files`/`directories`).

---

## Step 4 — Supplementary data + Stryker

### Git activity (30 days)

`docs/` is excluded everywhere — the monthly reports and their JSON live there and would otherwise dominate the churn figures.

```bash
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
MAIN_BRANCH=${MAIN_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}

git log $MAIN_BRANCH --since="30 days ago" --no-merges --oneline -- . ':(exclude)docs' | wc -l
BASE_COMMIT=$(git rev-list -1 --before="30 days ago" $MAIN_BRANCH)
git diff "$BASE_COMMIT" $MAIN_BRANCH --name-only -- . ':(exclude)docs' | wc -l
git diff "$BASE_COMMIT" $MAIN_BRANCH --shortstat -- . ':(exclude)docs'
git diff "$BASE_COMMIT" $MAIN_BRANCH --numstat -- "*.cs" ':(exclude)docs' | awk '{add+=$1; del+=$2; n++} END{print "CS files: " n ", +" add " -" del " = " add-del}'
```

Always collect the C# figures separately (excludes Verify snapshots, migrations, generated files).

### Change rate per period (src `.cs`, 7 / 14 / 30 / 90 days)

Feeds `activity.cs_periods`. The scope must be **identical to the denominator** — `src/**/*.cs` minus `Migrations/`, `*.g.cs`, `*.Designer.cs`, the same set `codebase.source_files` counts. Widening the numerator to `tests/` while dividing by src files inflates every ratio past 100%.

`--no-renames` keeps `--name-status` and `--numstat` aligned one line per file, so A (new file) and M (edited file) stay separable.

```bash
scope() { grep -E '^src/.*\.cs$' | grep -vE '/Migrations/|\.g\.cs$|\.Designer\.cs$'; }

# denominators, same scope
git ls-tree -r --name-only $MAIN_BRANCH -- src | scope | wc -l                    # cs_files_total
git grep -I -c '' $MAIN_BRANCH -- src | sed "s/^$MAIN_BRANCH://" |                # cs_lines_total (physical lines)
  awk -F: '{ c=$NF; sub(/:[^:]*$/, "", $0); print $0"\t"c }' |
  awk -F'\t' '$1 ~ /^src\/.*\.cs$/ && $1 !~ /\/Migrations\/|\.g\.cs$|\.Designer\.cs$/ { n+=$2 } END { print n }'

for D in 7 14 30 90; do
  BASE=$(git rev-list -1 --before="$D days ago" $MAIN_BRANCH)
  paste \
    <(git diff --no-renames --name-status "$BASE" $MAIN_BRANCH -- src) \
    <(git diff --no-renames --numstat    "$BASE" $MAIN_BRANCH -- src) |
  awk -F'\t' '$2 ~ /^src\/.*\.cs$/ && $2 !~ /\/Migrations\/|\.g\.cs$|\.Designer\.cs$/ {
    if ($1=="A") { fa++; la+=$3 }
    else if ($1=="D") { fd++ }
    else { fm++; lm+=$3+$4 }
  } END { printf "files_modified=%d files_added=%d files_deleted=%d lines_modified=%d lines_added=%d\n", fm, fa, fd, lm, la }'
  echo "  commits=$(git log --no-merges --oneline "$BASE"..$MAIN_BRANCH | wc -l)"
done
```

`lines_modified` = additions + deletions inside pre-existing files (churn). `lines_added` = lines of brand-new files only.

Per-layer churn for the same window (feeds `cs_periods[].by_layer`, keys identical to `coverage.by_layer` / `sonarqube.issues_by_layer` so the three read side by side):

```bash
PREFIX="{{PRODUCT}}."

git diff --no-renames --numstat "$BASE" $MAIN_BRANCH -- src |
  awk -F'\t' -v prefix="$PREFIX" '$3 ~ /^src\/.*\.cs$/ && $3 !~ /\/Migrations\/|\.g\.cs$|\.Designer\.cs$/ {
    split($3, p, "/"); l = p[2]; sub("^" prefix, "", l);
    lines[l] += $1 + $2; files[l]++
  } END { for (k in lines) printf "%-24s %3d files %6d lines\n", k, files[k], lines[k] }' | sort -k3 -rn
```

`by_layer` counts every touched file (A, M and D) and `lines` = additions + deletions — a churn figure, deliberately not the `lines_modified` / `lines_added` split. Store the two denominators as `activity.cs_files_total` / `activity.cs_lines_total`: `sonarqube.lines_of_code` is **not** usable here (it spans `tests/` too and drops blank/comment lines, while `--numstat` counts physical lines).

### Test inventory

```bash
find tests -name "*.cs" -not -path "*/E2ETests/*" | wc -l
grep -r "\[Fact\]\|\[Theory\]" tests --include="*.cs" -l | wc -l
grep -rc "\[Fact\]\|\[Theory\]" tests --include="*.cs" | grep -v ":0" | awk -F: '{sum+=$2} END{print sum}'
```

### API endpoint coverage

```bash
grep -rh "yield return app\.Map" src/{{PRODUCT}}.WebAPI/Endpoints --include="*.cs" | wc -l
find src/{{PRODUCT}}.WebAPI/Endpoints -name "*.cs" -not -name "*.g.cs" \
  | xargs -I{} basename {} .cs | sort
```

### Codebase health

```bash
find src -name "*.cs" -not -name "*.g.cs" -not -name "*.Designer.cs" | wc -l
find src tests -name "*.cs" -not -name "*.g.cs" -not -name "*.Designer.cs" | wc -l
grep -rn "TODO\|HACK\|FIXME" src --include="*.cs" | wc -l
grep -rn "Skip\s*=" tests --include="*.cs" | wc -l
```

### Stryker .NET (background)

Only one instance is allowed — two instances corrupt the sources. Always through `nohup` (full runs take ~2h, beyond the bash timeout).

```bash
pkill -f "dotnet-stryker" 2>/dev/null || true
pkill -f "dotnet stryker" 2>/dev/null || true
sleep 2

REPO=$(git rev-parse --show-toplevel)
nohup bash -c "
cd $REPO/tests
echo '=== DOMAIN START \$(date) ==='
dotnet stryker --config-file stryker-config.domain.json
echo '=== DOMAIN END \$(date) ==='
echo '=== APPLICATION START \$(date) ==='
dotnet stryker --config-file stryker-config.application.json
echo '=== APPLICATION END \$(date) ==='
echo '=== ALL COMPLETE \$(date) ==='
" > /tmp/stryker-full.log 2>&1 &
echo "Stryker PID: $!"
```

Watch it: `tail -5 /tmp/stryker-full.log`
