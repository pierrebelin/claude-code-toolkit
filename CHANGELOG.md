# Changelog

One section per release, newest first, headed `## <plugin> <version> — <date>`: `cctoolkit` and each mod are versioned on their own.

A release that changes a file under `rules/` or `presets/*/rules/` lists it under **Rules changed**: those files are copied into your repo, so you pull them by re-running `/cctoolkit:kit-init`, which shows each difference and asks.

## cctoolkit 1.1.0 — unreleased

- `examples/`: one fictional feature from spec to batch report, with a glossary.
- `INSTALL.md` holds the installation; the README is a short introduction.
- `/cctoolkit:run-lot` is the default path for a batch; `cctoolkit audit-capture` trims its capture.

## cctoolkit 1.0.0 — 2026-10-10

- `/cctoolkit:run-lot`: a batch runs end to end as a Workflow script — design, RED/GREEN, audit, report.
- The `tdd-batch` mod is replaced by two mods: `run-lot-pane` and `spec-pane`.
- `/cctoolkit:quality-report` adds a code size snapshot.
- `/cctoolkit:kit-init` removes a manual copy of the kit (`cctoolkit remove-copy`); new `doctor` checks.
- The `bulk-read` skill and the `delegation-nudge` / `caveman-skill-ultra` hooks are removed.

**Rules changed** — re-run `/cctoolkit:kit-init`:
`rules/context-discipline.md`, `rules/markdown-output.md`, `presets/clean-architecture/rules/` — `application-cqrs.md`, `domain.md`, `infrastructure-ef.md`, `tests.md`, `webapi-endpoints.md`.

## context-band 1.0.0, run-lot-pane 1.0.0, spec-pane 1.0.0 — 2026-10-10

First releases from the `cctoolkit` marketplace.
