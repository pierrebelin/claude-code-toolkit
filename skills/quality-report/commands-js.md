# JS/TS commands — quality report

Commands specific to JS/TS projects (Jest, StrykerJS, sonar-scanner, @swc/jest).
Referenced by `SKILL.md` for steps 1 to 5.

The SonarQube project key is read from `package.json`:

```bash
PROJECT_KEY=$(python3 -c "import json; print(json.load(open('package.json'))['name'])")
```

---

## Step 1 — Docker

Docker is **not needed** unless the integration tests use Testcontainers JS:

```bash
grep -r "testcontainers\|docker" tests/integration --include="*.ts" -l 2>/dev/null
```

If there is no result, **skip this step**.

If Docker is needed and the session is a container without a daemon of its own:

```bash
sudo containerd > /tmp/containerd.log 2>&1 &
sleep 3
sudo dockerd > /tmp/dockerd.log 2>&1 &
sleep 6
sudo docker ps
```

> `dockerd` requires root privileges (`sudo`). On a workstation with Docker Desktop, start the application instead.

---

## Step 2 — Build + tests

### 2a — Measure the build time

```bash
START=$(date +%s)
npm run build 2>&1 | tail -10
END=$(date +%s)
BUILD_SECONDS=$((END - START))
echo "Build duration: ${BUILD_SECONDS}s"
```

> Adapt if the `build` script differs in `package.json`.

### 2b — Tests with coverage

Unit and integration tests **sequentially** (Jest does not handle two parallel instances well).

```bash
rm -rf tests/reports /tmp/test-*.log

# Phase 1 — unit tests with coverage
echo "=== UnitTests ==="
npx jest --config tests/jest.config.js --coverage --verbose \
  > /tmp/test-UnitTests.log 2>&1
cat /tmp/test-UnitTests.log | grep -E "Tests:|Test Suites:|Time:|Snapshots:"

# Phase 2 — integration tests with coverage
echo "=== IntegrationTests ==="
npx jest --config tests/integration/jest.config.js --coverage --verbose \
  > /tmp/test-IntegrationTests.log 2>&1
cat /tmp/test-IntegrationTests.log | grep -E "Tests:|Test Suites:|Time:|Snapshots:"
```

> Jest natively produces `lcov`, `text`, `cobertura` and `html` depending on the `coverageReporters` config. SonarQube uses the `lcov` format. No need for ReportGenerator.

---

## Step 3 — SonarQube + aggregated coverage

### SonarQube (background)

The analysis uses `sonar-scanner` (the JS CLI) and the `lcov.info` files Jest generated.

```bash
source ~/.sonar-token

which sonar-scanner || npm install -g sonarqube-scanner

sonar-scanner \
  -Dsonar.projectKey=$PROJECT_KEY \
  -Dsonar.projectName="$PROJECT_KEY" \
  -Dsonar.sources=src \
  -Dsonar.tests=tests \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.javascript.lcov.reportPaths=tests/reports/unit/lcov.info,tests/reports/integration/lcov.info \
  -Dsonar.exclusions="**/node_modules/**,**/build/**,**/dist/**,**/public/**,docs/**,**/*.test.ts,**/*.test.tsx,**/*.spec.ts" \
  -Dsonar.test.inclusions="**/*.test.ts,**/*.test.tsx,**/*.spec.ts" \
  -Dsonar.sourceEncoding=UTF-8
```

`~/.sonar-token` is a file exporting the token: `export SONAR_TOKEN=<token>`. If it does not exist, create it (`chmod 600`) from a SonarQube user token.

### Aggregated coverage (immediate, in parallel with SonarQube)

Merge the lcov reports:

```bash
which lcov-result-merger || npm install -g lcov-result-merger

lcov-result-merger \
  'tests/reports/unit/lcov.info' \
  'tests/reports/integration/lcov.info' \
  > tests/reports/merged-lcov.info 2>/dev/null

# Fallback: plain concatenation
if [ ! -f tests/reports/merged-lcov.info ]; then
  cat tests/reports/unit/lcov.info tests/reports/integration/lcov.info \
    > tests/reports/merged-lcov.info 2>/dev/null
fi

# Coverage summary
echo "=== Unit test coverage ==="
cat /tmp/test-UnitTests.log | sed -n '/^-.*-$/,/^-.*-$/p' | head -40
```

### Coverage metrics to extract

- **Statements (Stmts)**: proportion of instructions executed at least once.
- **Branches**: proportion of conditional paths taken (`if`/`else`, `switch`, `? :`, `&&`, `||`, `??`).
- **Functions (Funcs)**: proportion of functions/methods called at least once.
- **Lines**: proportion of source lines covered.

> **IMPORTANT — Jest vs SonarQube coverage.** Jest reports coverage only on the files **imported** by the tests. If 29 files out of 393 are imported, Jest will show 99% — but that is 99% of 29 files, not of the project.
> SonarQube computes coverage over **every source file**. The SonarQube figure is the **real project figure** and must be used as the reference in §1 and §9.
> The report must distinguish the two:
> - **Project coverage** (SonarQube, all files) → the reference figure in §1
> - **Coverage of the tested files** (Jest, imported files) → detail in §3

### Fetch the project coverage figures (SonarQube)

**Always** fetch the real coverage figures from the SonarQube API after the analysis (step 5). Those figures feed the JSON (`coverage.lines`, `coverage.branches`, …):

```bash
source ~/.sonar-token

# Whole-project coverage (every source file)
curl -s -u "$SONAR_TOKEN:" \
  "http://localhost:9000/api/measures/component?component=$PROJECT_KEY&metricKeys=coverage,line_coverage,branch_coverage,lines_to_cover,conditions_to_cover,uncovered_lines,uncovered_conditions" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('component', {}).get('measures', []):
    print(f\"{m['metric']}: {m['value']}\")
"
```

Expected result:
- `coverage` → `sonarqube_coverage_pct` (lines + branches combined, the reference figure)
- `line_coverage` → `coverage.lines.pct`
- `lines_to_cover` → `coverage.lines.total`
- `uncovered_lines` → lets you compute `coverage.lines.covered = lines_to_cover - uncovered_lines`
- `branch_coverage` → `coverage.branches.pct`
- `conditions_to_cover` → `coverage.branches.total`
- `uncovered_conditions` → lets you compute `coverage.branches.covered = conditions_to_cover - uncovered_conditions`

> **Never put the Jest figures into the JSON's `coverage.lines.pct`.** Jest only sees the imported files. Example: Jest says 99.2% (855/862 lines) while SonarQube says 16.9% (899/5,333 lines). The 99.2% is a mirage — it ignores 4,471 untested lines.

---

## Step 4 — Supplementary data + Stryker

### Git activity (30 days)

```bash
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
MAIN_BRANCH=${MAIN_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
git log $MAIN_BRANCH --since="30 days ago" --no-merges --oneline -- . ':(exclude)docs' | wc -l
BASE_COMMIT=$(git rev-list -1 --before="30 days ago" $MAIN_BRANCH)
git diff "$BASE_COMMIT" $MAIN_BRANCH --name-only -- . ':(exclude)docs' | wc -l
git diff "$BASE_COMMIT" $MAIN_BRANCH --shortstat -- . ':(exclude)docs'
```

`docs/` is excluded everywhere — the monthly reports and their JSON live there and would otherwise dominate the churn figures.

> If the project is **not a git repository**, skip this step and put `null` in the JSON.

### Test inventory

```bash
# Test files (excluding E2E)
find tests -name "*.test.ts" -o -name "*.test.tsx" | grep -v "e2e\|E2E\|cypress" | wc -l

# By type
find tests/unit -name "*.test.*" 2>/dev/null | wc -l
find tests/integration -name "*.test.*" 2>/dev/null | wc -l

# Number of test cases
grep -rc "^\s*\(it\|test\)\s*(" tests --include="*.test.ts" --include="*.test.tsx" \
  | grep -v ":0" | awk -F: '{sum+=$2} END{print sum}'
```

### Page coverage

```bash
# List the pages
find src/pages -name "*.tsx" -not -name "index.*" -not -name "*.test.*" | sort

# For each page, check whether a test exists
for page in $(find src/pages -name "*.tsx" -not -name "index.*" -not -name "*.test.*" -exec basename {} .tsx \;); do
  test_found=$(find tests -name "*${page}*" 2>/dev/null | head -1)
  if [ -n "$test_found" ]; then
    echo "$page | ✅ $test_found"
  else
    echo "$page | 🔴 Missing"
  fi
done
```

> On a frontend, the emphasis belongs on the coverage of **business hooks**, **utilities** and **state-management logic** rather than on page rendering.

### Codebase health

```bash
# Source files (excluding tests and type defs)
find src -name "*.ts" -o -name "*.tsx" | grep -v "\.d\.ts$" | grep -v "\.test\." | grep -v "\.spec\." | wc -l

# Source files + tests
find src tests -name "*.ts" -o -name "*.tsx" | grep -v "\.d\.ts$" | wc -l

# TODO/HACK/FIXME
grep -rn "TODO\|HACK\|FIXME" src --include="*.ts" --include="*.tsx" | wc -l

# Skipped tests
grep -rn "\.skip\s*(\|^\s*xit\s*(\|^\s*xtest\s*(\|^\s*xdescribe\s*(" tests --include="*.ts" --include="*.tsx" | wc -l

# ESLint (if available)
npx eslint src --format json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
errors = sum(r['errorCount'] for r in data)
warnings = sum(r['warningCount'] for r in data)
print(f'ESLint: {errors} errors, {warnings} warnings')
" 2>/dev/null || echo "ESLint: not available"
```

### StrykerJS (background)

**Check whether StrykerJS is configured:**

```bash
ls stryker.config.json 2>/dev/null
cat package.json | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('devDependencies',{}),**d.get('dependencies',{})}; matches=[k for k in deps if 'stryker' in k.lower()]; print('\n'.join(matches) if matches else 'NOT_INSTALLED')"
```
**If it is installed and configured** (`stryker.config.json` exists), delegate to a **background** subagent:

```
Run StrykerJS on the project using the existing configuration file:

npx stryker run stryker.config.json > /tmp/stryker-output.log 2>&1

IMPORTANT: do NOT use a pipe (| tail) — it hides the progress.
Redirect to a log file instead.

Timeout: 2,400,000 ms (40 min)

Return: the full per-file score table, killed/survived/NoCoverage counters,
the global score, and the total duration.
```

Watch the progress:

```bash
# The progress bar rewrites the last line (\r)
tail -1 /tmp/stryker-output.log
```

**If StrykerJS is NOT installed**, install it:

```bash
npm install --no-package-lock --legacy-peer-deps --force --save-dev \
  @stryker-mutator/core @stryker-mutator/jest-runner @stryker-mutator/typescript-checker
```

Then create `stryker.config.json` targeting **only the files covered by tests** (extracted from `lcov.info`):

```bash
grep "^SF:" tests/reports/unit/lcov.info | sed 's|^SF:||' | sort
```

### Stryker performance optimisations

The `stryker.config.json` config must include these optimisations:

```json
{
  "ignoreStatic": true,
  "concurrency": 4,
  "coverageAnalysis": "perTest",
  "incremental": true,
  "incrementalFile": "reports/mutation/stryker-incremental.json"
}
```

- `ignoreStatic` — skip mutants in static code (initialisations)
- `concurrency: 4` — 4 parallel workers
- `coverageAnalysis: "perTest"` — only re-runs the tests covering the mutant
- `incremental` — reuses the previous run's results

**`mutate` scope**: mutate only the files appearing in the `lcov.info` reports. Mutating a file with no test produces useless NoCoverage entries.

### Performance prerequisite: @swc/jest

The project must use `@swc/jest` instead of `ts-jest` in the Jest configs. SWC transpiles ~20x faster, which drastically reduces each Stryker worker's overhead.

**Migration:**
1. Install: `npm install --save-dev @swc/core @swc/jest`
2. Replace in each `jest.config.js`:
   ```js
   // Before
   transform: { '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }] }
   // After
   transform: { '^.+\\.(ts|tsx)$': ['@swc/jest'] }
   ```
3. Create `.swcrc` at the root:
   ```json
   {
     "jsc": {
       "parser": { "syntax": "typescript", "tsx": true, "decorators": false },
       "transform": { "react": { "runtime": "automatic", "importSource": "react" } },
       "target": "es2020"
     },
     "module": { "type": "commonjs" }
   }
   ```

> **Careful with `jest.mock` hoisting**: `jest.mock()` calls with variables declared before the mock (`const mock = jest.fn(); jest.mock(...)`) fail with SWC.
> Fix: use `jest.fn()` inline in the factory, then get the reference through the import:
> ```js
> // Before (ts-jest) — automatic hoisting
> const mockFn = jest.fn();
> jest.mock("module", () => ({ default: mockFn }));
>
> // After (SWC) — no hoisting
> jest.mock("module", () => ({ __esModule: true, default: jest.fn() }));
> import myModule from "module";
> const mockFn = myModule as jest.Mock;
> ```
