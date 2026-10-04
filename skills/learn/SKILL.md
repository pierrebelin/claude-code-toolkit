---
name: learn
description: "Use when doctor prints `NOTE learn`, or the user asks to learn from past /verify-ddd-tdd verdicts: turns gaps recurring across batches into a rule, an audit criterion or a mechanical check, and retires the lines they make useless, after confirmation. With `memory`, audits the project auto-memory for stale, duplicated or contradictory entries instead."
argument-hint: "[optional axis, e.g. Plan | memory]"
---

# Learn from audit verdicts

Gap fixed inside its batch leaves no trace: next batch repeats it, auditor finds it again. Turn **recurring** gaps into what prevents them. Writes only what user confirms, only in repo — never memory, except in memory mode, which writes memory only.

Argument `memory` → skip §1-6, follow **Memory mode** below.

Few motifs, each proven, and destinations that do not only grow: a line no one can check is read by every later agent for nothing.

$ARGUMENTS

Run after `/clear`, never during a batch: one axis at a time keeps context small.

## 1. Backlog

`cctoolkit learn-candidates` — pending gaps per axis, batch count, already refused motifs. Argument names an axis → that one only. Otherwise take axes with ≥ 3 batches, most batches first. The end-of-batch nudge (`--count`) fires at 2 batches, one early: an axis it names may still hold no motif — say so, stop.

## 2. One axis

`cctoolkit learn-candidates --axis <Axis>` — pending rows, oldest first.

Group rows into **motifs**: same root cause, whatever wording. Keep a motif only if it passes all three filters; otherwise drop it, say which filter in one line:

- **Recurrence** — spans **≥ 3 distinct batches** (session ids).
- **Prevention** — the line you would write names something an agent or a check can apply, and would have flagged each row of the motif before audit. Generic advice ("handle null", "check the boundary") prevents nothing: `Correctness` rows are bugs, each its own, and rarely form a motif.
- **New** — not listed as refused, not already prevented by an existing rule, gate or test.

**At most 3 motifs per axis**, most batches first. Beyond: drop for this run — a real motif comes back with the next batches.

## 3. Destination

Pick the narrowest owner. One motif → one destination.

| Motif | Destination |
|---|---|
| Layer convention (naming, placement, base class, pitfall) | `.claude/rules/<layer>.md` — `domain`, `application-cqrs`, `infrastructure-ef`, `webapi-endpoints`, `tests` |
| Sheet written incomplete (ids unclassified, anchors missing, assumptions untraced) | kit: `skills/plan-implementation/` template or checklist |
| Mistake the coding agents keep making | kit: `skills/implement-tdd/references/common-rules.md` |
| Auditor misses or misjudges it | kit: axis table of `skills/verify-ddd-tdd/SKILL.md` |
| Checkable without judgement | `ArchitectureTests`, or kit: `scripts/pre-audit.sh` gate, hook + case under `evals/cases/` |

Mechanical check beats prose whenever both fit: prose is read, a check fails.

**Kit destinations are never edited in place.** `cctoolkit root` is the plugin cache, replaced on every update. A kit change is written in a checkout of the toolkit repo — its path asked once with AskUserQuestion — then flows back through the plugin update (`README` § Updating). No checkout → hand the user the exact patch (file, old line, new line) instead of writing.

## 4. Reconcile

Read where the motif lands: `grep -n` the key term in the destination, then bounded `Read` of that section. One status per motif:

| Status | When | Write |
|---|---|---|
| `covered` | Destination already says it | Line read, not applied: mechanical check if one fits, else drop |
| `refines` | A close line exists | Rewrite that line, never add a second |
| `replaces` | An existing line caused the gaps, or contradicts the motif | Replace that line |
| `new` | Nothing close | Add one line |

**Every kept motif also retires what it makes useless.** In the section just read, flag as `retire`:

- prose line a check now enforces — the motif's own check, or an existing one (`scripts/pre-audit.sh`, hook, `ArchitectureTests`);
- line the motif's `refines` or `replaces` leaves duplicated or contradicted.

Quote the exact line. No other source of `retire`: never sweep a file for lines that merely look old.

## 5. Confirm

One `AskUserQuestion` per axis, `multiSelect: true`, one option per motif and per `retire`: label ≤ 5 words; description = batch count + status + destination + exact line added, and exact line removed for `replaces` / `retire`. Unselected option = refused.

Never write before the answer.

## 6. Write and mark

1. Accepted options: apply the status — add, rewrite, replace or delete the line. Frozen literals verbatim (`.claude/rules/markdown-output.md`). Hook or tool touched → add its eval case, run `cctoolkit evals`.
2. Each refused motif: `cctoolkit learn-candidates --refuse "<motif>"`. Refused `retire`: `--refuse "keep: <line>"`.
3. Axis done: `cctoolkit learn-candidates --treat-axis <Axis>` — every pending row of the axis, kept, refused or dropped.

Independent commands of steps 2-3 go in one message.

## Output

Per axis, one table, nothing else:

```markdown
| Motif | Batches | Status | Decision | Destination | Δ lines |
|-------|---------|--------|----------|-------------|---------|
| DDD ids left unclassified in the sheet | 9 | new | added | `scripts/pre-audit.sh` | +1 |
| Classify the DDD ids (prose) | — | retire | deleted | `skills/plan-implementation/SKILL.md` | −1 |
| … | 3 | refines | refused | — | 0 |
```

End with net `Δ lines` of the axis, then remaining backlog line from `--count`, or `Backlog empty.`

## Memory mode

A stale entry is worse than none: recalled, then followed. Only the `description` and the index line are read at recall — those are what must stay true.

1. **Mechanical** — `cctoolkit learn-candidates --memory`: memory folder path, file indexed twice, not indexed, indexed but gone, frontmatter incomplete, cited repo path missing. Each line is a lead, not a verdict: a path from another repository, or a plan removed once its feature shipped, can leave a still-true decision.
2. **Judgement** — `MEMORY.md` is already in context: compare index lines for entries on one subject stating different states (frozen then unfrozen, rule then reversal). Read whole only the entries a step-1 line or such a pair names. Symbol or decision cited → `graphify explain` or one `grep -n`, never a sweep. `user` and `feedback` entries are preferences: retire one only on contradiction with a later entry, never because code moved.
3. **Status per entry**, same spirit as §4: `refines` (description or index line no longer matches the body or the code), `merges` (two entries, one subject — keep the later state), `retire` (decision reversed, subject gone), `index` (mechanical fix: index line added, doubled or dead one removed). Untouched entries: not listed.
4. **Confirm** — one `AskUserQuestion`, `multiSelect: true`, one option per entry; description = defect + evidence (`path:line`, command output) + exact new description or `deleted`. Mechanical `index` fixes grouped in one option. Never write before the answer.
5. **Write** — memory folder only: edit or delete the file, then its `MEMORY.md` line in the same message. Refused option: `cctoolkit learn-candidates --refuse "keep: <file>"`, and never propose it again while the refusal stands.

Output, one table:

```markdown
| Entry | Defect | Status | Decision |
|-------|--------|--------|----------|
| `project_sdk_no_key_value_read.md` | indexed twice, description on the frozen state | refines | applied |
```
