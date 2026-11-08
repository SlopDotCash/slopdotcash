# Project work discovery state review

`formal/models/ui_project_work.qnt` models the read-only panel in `src/ProjectWork.tsx`, its
`ProjectPage` call in `src/App.tsx`, and the public data state supplied by
`src/lib/use-snapshot.ts`. It models loading, valid empty/nonempty results,
errors, retries, retained data after refresh failure, stale timestamps, and
active/paused project changes. Counts range from zero to four for each list;
the panel shows at most three of each kind.

The panel filters the validated snapshot by the project's repository IDs and
selects only entries whose selection status is `candidate`. It does not use the
reward-cycle view because a future pool start can leave that view absent while
current work remains available. The browser
suite `tests/e2e/project-work.spec.ts` checks blocked and foreign-project
exclusion, the list bounds, loading/error/retry, empty/stale states, paused
projects, future reward-cycle starts, keyboard links, accessibility, and text reflow.

The model assumes the existing snapshot loader supplies only a complete valid
snapshot and rejects superseded requests. It abstracts network payloads,
GitHub authority and immutable source identity. The panel adds no requests,
mutable storage, scoring or money actions. The snapshot date is a freshness
notice, not proof that GitHub work remains unclaimed. Contributor skills still
recheck live GitHub before work. These finite checks do not establish source
refinement, live provider availability or absence of all UI errors.

Use pinned Quint 0.33.1. Run typecheck, named tests, and 500 simulation traces
with at most 60 steps and seed 20261108. Run `quint verify` with the TLC backend
and `--invariant=invariant` for the finite state model. Record results outside
the repository. Re-run after a state change or final integration rebase.

Initial finite TLC result: 408 distinct states, 56,101 generated states, maximum
depth nine, no invariant violation. Deadlock checking is disabled by the Quint
TLC driver; no liveness property is claimed.
