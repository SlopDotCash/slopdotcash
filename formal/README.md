# Application state review

This review implements [PRD section 12](../docs/slop-product-requirements.md#12-state-correctness-and-quint-verification)
on `origin/development`, starting at `e3d7dea64f1171f5761033069b98de4fd5cc1e77`.
The separate older dirty checkout at `/Users/shawwalters/slopdotcash` is preserved
but is not the target application. Its models and results do not establish
coverage of this revision.

The review is now integrated with development commit
`ccc37c36e3f557e7bddf32a95830f29f4876ff9c` (PR 2403). Its four existing
Quint models are retained as `formal/models/pr_review_*.qnt` and run through
the same source-bound checker. Earlier validation from the `b92ed9303`
checkpoint remains historical evidence, not a substitute for final integrated
verification. The later development update `3223535c6fa91d8ce5159bf4fce278acf18e286d`
(PR 2404) is also included; its bounded-scan regression is retained.

```sh
bun install --frozen-lockfile
bun run formal:check
bun run formal:verify
node scripts/check-formal.mjs --model=MODEL_NAME
node scripts/check-formal.mjs --verify --model=MODEL_NAME
```

Every model exports `init`, `step`, `invariant` and named `*Test` scenarios.
The check command typechecks, runs scenarios, and samples 500 seeded traces of
up to 60 steps. Verification explores finite state graphs with TLC through the
lockfile-pinned Quint tool. Java 21 and the pinned Apalache distribution are
needed for translation. Commands fail on violations, errors or timeouts.
The TLC backend disables deadlock detection: reachable scenarios and explicit
progress properties must cover terminal and stalled behavior separately.
Temporal properties named `*Property` are also checked by the TLC runner.
State the scheduler or external-service fairness assumptions with each progress
property. A timeout or retry bound must settle visibly; fairness must not assume
that a payment, provider request or human approval succeeds.

Results, exact commands, source/model hashes and tool versions belong under
ignored `evidence/formal/`. Source mappings and review findings belong in this
directory. A mapped file is a review index, not proof that every source branch
refines the model. Track remaining work explicitly; do not count partial
coverage as complete.

The runner binds each result to its model and every `@source` file. A source or
model change during a stage or the overall selected run makes that run fail.
`formal:check` also requires zero unmapped sources; refreshing the inventory
alone cannot turn an unreviewed source into accepted coverage.

`state-catalog.json` separately lists declared lifecycle string unions and SQL
state constraints. Its unmentioned literals are review leads, not proof of a
missing transition, and a matching literal is not proof of coverage. Boolean,
numeric, cross-process and implicit state still require manual review. Refresh
both indexes with `bun run formal:inventory:update` after reviewing changes.

The review includes frontend routes, account and wallet sessions, project
admission and revisions, private reports and awards, notifications, Points and
disputes, Slopbot review/scoring, vetting and evidence, payment contracts and
workers, fee handling, referral code, contributor tools, snapshots and release.
External provider and chain behavior remain separate trust boundaries.

## Method and sources

The [Quint language guide](https://quint.sh/docs/language-basics) defines actions
and nondeterministic transitions. Its
[property guide](https://quint.sh/docs/checking-properties) distinguishes
simulation, witnesses, invariants and model checking. The
[temporal operator reference](https://github.com/quint-co/quint/blob/main/docs/content/docs/builtin.md)
defines fairness and eventual progress. The
[Quint repository](https://github.com/quint-co/quint) documents the executable
specification workflow. We use finite independently checkable model families
with explicit cross-family assumptions, followed by implementation conformance
through actual workflow entry points. Test counts are not evidence of full
refinement or absence of all bugs.
