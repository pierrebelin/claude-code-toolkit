# Why the rules of `/implement-tdd` are what they are

Measurements and reasons behind `SKILL.md`, keyed by its headings. **Never load during a batch**: explains, doesn't instruct, and every byte opened here is carried by every later turn. Open it when a rule looks arbitrary, or before changing one.

## Mandatory orchestration

- **RED parallelises, GREEN never.** 2026-09-08: 50 subagent runs over three batches, disjoint test files, **zero overlap**, ~half the wall-clock per session. GREEN writes production code; two implementers on one layer collide.

## 1. Analysis

- **One batch, one session.** Second batch without `/clear` pays first's accumulated context every turn. 2026-09-08, three batches: equal request count, session's second half costs **1.9×** first's input, 55 % of its requests past 200 k prompt (premium rate). Chaining also drags into `/compact`, summary carried to the end. Grouping saves one `(startup)`, ~$4.50; costs whole tail at 1.9×.
- **Phase reads in one message.** 2026-09-08, four batches: 611 tool turns, **not one carrying two calls**. A turn = one billed round trip resending whole accumulated context.
- **Global plan by section.** Plan read whole = 12 k tokens carried by every later turn, second heaviest line after startup.
- **Plan path as text, never `@`.** Eight sessions, 2026-09-07 to 09-10: `lot4 de @todo/…-PLAN.md` attached whole plan (20 to 28 kB) at turn 0 — first-request `cache_creation` 31 to 37 k tokens against 16 to 17 k plain — and the skill read it again by section.
- **`common-rules.md` not read by orchestrator.** 9.4 kB, ~2.3 k tokens every turn of a 100 to 300-turn batch, for an agent writing only declarative artefacts; its two applicable rules restated in the skill. `conventions.md` same, on demand.
- **Paths copied from sheet's `## Ancrages`.** Session `7df05023` (lot F4, 2026-09-10): 19 `rtk proxy grep`, 16 `sed`, 7 `cat` over `tests/` in the Opus chain, 73 kB, rebuilding fixture/builder/snapshot paths for the contracts — ≈ $4 of the session's $26.8, once per batch. A haiku inventory pays it once at plan time.
- **No source file outside target handler folder.** Every `Read` under `src/`/`tests/` attaches that folder's `CLAUDE.md` + layer rules to the end of the batch, for an orchestrator that never writes the code they govern. {{PRODUCT}}, session 1a39aeca: six `Read` on a neighbouring feature at turn 6 pulled its `CLAUDE.md` (14.8 kB) + four `rules/*.md`, 60 kB carried by 127 turns — **$3.1 of the session's $25** — and the subagent that needed it loaded the same file again. Attachments cost $0.049/kB in the orchestrator against $0.0015/kB in a subagent: 32× cheaper where it's used.

## 2. Red-Green-Refactor loop

- **Regroup sheet steps into behaviours.** 2026-09-09: a batch split into 5 rule-steps for 2 handlers merged one pair after the fact and widened one step mid-cycle — 3 subagent launches, 3 solution builds, no extra code.
- **Waves.** 2026-09-09: 4 REDs launched one by one where 2 waves covered the batch.
- **RED(n+1) beside GREEN(n).** 2026-09-09 to 09-11, 22 runs: `tdd-test-author` averages 224 s, 93 % model latency. Beside GREEN(n) that time leaves the critical path. Only shared resource = solution build on same `obj/`, hence the `CS2012` rule.
- **Exact paths in the contract.** 2026-09-08: 23 `tdd-test-author` runs for 445 turns, **19 turns to write one test**, mostly rebuilding what the contract already knew.
- **Name class, fixture, methods.** 2026-09-09 to 09-11: 13 round trips and 224 s per test, 15.8 s per round trip against 6.3 s for `tdd-implementer`. Difference is design — choosing class, fixture, method names — done by a Sonnet agent under full rules load. Agent runs at `effort: low` since 2026-09-12 on that basis.
- **Two path lines, not one.** A file the agent rewrites must be read whole: it needs the exact strings an `Edit` matches on, which an outline doesn't carry. A file only consulted is read around one declaration. Wrong line = a denied read and a turn; missing path = the exploration the contract exists to remove.
- **Relay the `## RED` table.** A subagent's report is never shown to the user: unrelayed table = table nobody reads. Keeping the rows also removes the rebuild-from-diff at closing.
- **`Diff production` / `Diff tests` lines.** Before 2026-09-12 the orchestrator opened the diff after every RED and GREEN for test-first integrity — one Opus turn per phase, 10 to 12 per batch, for a fact `git diff --stat` states in one line.
- **Contract carries only what the agent can't know.** Each restatement of the agent's charter is paid on every delegation and becomes a second source that drifts.
- **Signature means declaration.** A dictated body makes the orchestrator's own mistake read as the spec, and no review catches it: the code matches the contract.
- **Name the ripple.** 2026-09-10: one `tdd-implementer` run opened `ConfigurationMapper.cs`, `ConfigurationRepository.cs` (550 lines), `MockConfigurationRepository.cs` and `SaveFixture.cs` (700 lines) unbounded, none named by the contract.
- **Two stub lists.** A file `tdd-test-author` already created, announced "to create", sends the implementer looking for work that is done.
- **GREEN contract carries current behaviour only.** 2026-09-09: two guards written ahead in behaviour 1's GREEN cost the removal, re-observation and restoration of the same code, plus a user interruption.
- **COUT validated on a line, not a file.** 12 batch sessions (2026-09-07 to 09-12): 36 `## GREEN`, 34 orchestrator `Read` under `src/` right after them, 117 kB (~29 k tokens) carried to the end of each batch, each attaching the folder `CLAUDE.md` and the layer rules — to check a number the agent had stated from memory. `scripts/access-cost.py` states it from the syntax tree in 40 ms; the orchestrator reads its last line.
- **`SendMessage` under 3 turns, fresh `Agent` beyond.** `SendMessage` resumes the agent with its whole transcript, re-sent every further turn: an agent stopped at 49 turns carries ~80 k of context, every correction turn pays it. A fresh `Agent` restarts at ~17 k preamble + ~11 k reloaded rules and files. 2026-09-09: a 10-turn correction costs ~850 k in continuation against ~350 k fresh.

## 3. Global green loop

- **Ticks located with `grep -n`.** Sheet `cat` twice per batch on 2026-09-10, 28 kB each time, to find lines to tick — second copy of a file already read in §1.

- **Whole suites once per batch.** A whole unit, contract or architecture suite run mid-loop proves nothing the filtered test didn't, and pays minutes per behaviour. Fewer cycles = fewer solution builds — what §2's regrouping buys.
- **Suite output to a file.** 2026-09-08: `Bash` alone weighs $22.76 across the day, on 21 to 33 `rtk` calls per orchestrator session — a green suite's log carried to the end.
- **One `Edit` per behaviour for the ticks.** 7 sessions (2026-09-09 to 09-11): 301 `Edit` in the orchestrator, 43 per batch, each an Opus round trip. Ticking RED, GREEN, COUT separately was ~10 of those per batch.

## 4. Documentation, gate, audit

- **Documentation before the audit.** 30 verdicts (2026-09-09 to 09-11): 27 ECARTS, 2.2 audits per batch at 5 min of Opus each. Recurring first-round causes — "N identifiants jamais classés" (8, Bloquant), `///` rewritten in production (5), `.claude/` hunks outside the batch (4), a trait citing a rule absent from the handler table, an unclosed sheet, a stale index — were all produced *after* the audit by the old closing order.
- **The capture.** Handing it over keeps the audit from spending thirty turns collecting what one script produces in five seconds — 2026-09-08: five audits, 259 turns, not one carrying two tool calls.
- **No hunk-by-hunk re-read at closing.** The auditor walks the diff with the same rules from an isolated context; doing it again in the orchestrator, which carries the whole batch, was the skill's most expensive duplicate.

## Wall-clock

Baseline of 2026-09-12 and the list of changes to measure against it in
`.claude/docs/CONTEXT-COST.md`, "Wall-clock of a batch". Measured from the transcripts'
timestamps; the one-off script that did it was removed the same day.
