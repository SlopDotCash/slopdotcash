# Eliza contribution mission

The contribution program exists to make the primary Eliza product work better,
not to maximize issue, pull-request, commit, line, test, or token counts. Use
this gate before claiming, implementing, reviewing, or validating work.

## Pass all three gates

Apply the gates inside the queue-first order in `SKILL.md`. PRs without a
substantive review of their exact current head come first, then existing
authorized issues without PRs. Only after the old queue is reconciled may
self-directed inspection move through security, bugs, incorrect or stale
documentation and code comments, and missing real-system verification, in that
order.

### 1. Authorized demand

Proceed only when at least one source authorizes the outcome:

- the operator explicitly requests it;
- an open issue carries the exact `mission-ready` repository label; or
- the operator explicitly identifies a maintainer-owned release or verification
  gate and the failing behavior to address; or
- the operator requests a queue-cleared repository audit in the fallback order
  above and the agent locally reproduces a concrete material defect before any
  branch or public write.

An unlabeled issue, Project card, other label, PR-title mirror, agent-generated
backlog item, speculative idea, or self-authored issue is not authorization by
itself. Typing `mission-ready` in a title, body, comment, pull request, or
Discussion has no effect. Do not apply, request, or automate the label, and do
not manufacture demand by opening an issue. If the need is real but not
authorized, reproduce it locally and ask the operator or maintainer before any
GitHub write.

### 2. Primary mission

The outcome must materially advance at least one surface, in this order:

1. **Eliza app**: make the shipped web, desktop, or mobile experience usable,
   reliable, understandable, accessible, and complete from onboarding through
   running and managing an agent.
2. **Eliza Cloud**: make authentication, deployment, model routing, storage,
   billing boundaries, observability, and app-to-cloud flows reliable for the
   shipped product.
3. **Core agent runtime**: make the agent loop, model layer, memory and state,
   tools, actions, providers, services, evaluators, permissions, error
   propagation, and plugin loading work correctly end to end.
4. **Primary capabilities**: repair an existing model, connector, storage,
   browser, coding, document, media, voice, or automation integration only when
   it is already part of a shipped/default product path or a maintainer-approved
   launch path.
5. **Release infrastructure**: repair CI, build, packaging, deployment, or test
   infrastructure only when its failure blocks one of the surfaces above or
   makes their verification falsely pass or fail.

New niche plugins, toy agents, isolated examples, experimental connectors, and
capabilities with no approved product consumer are outside the mission. Do not
add a new plugin merely because an API exists. A leaf-package bug qualifies
only when its issue identifies the primary user path or maintainer-approved
release path it breaks.

### 3. Material outcome

The contribution must fix a reproduced failure, complete a user-visible flow,
restore a required capability, remove a demonstrated reliability or security
risk, or produce evidence that changes a concrete engineering decision. It
must have observable acceptance criteria and a real verification path.

Reject work whose primary value is any of the following:

- formatting, renaming, comment churn, generic cleanup, or style-only changes;
- documentation or comments that are merely old rather than demonstrably
  wrong, misleading, or harmful to a real user, contributor, or operator path;
- unit tests, mocks, snapshots, or coverage additions that can pass while the
  real product path is broken, only increase counts, or restate implementation
  details;
- one-PR-per-file coverage farming, “no same-named test” tasks, and
  barrel/type/schema/constant inventory suites;
- shape-only assertions for existence, type, finiteness, array length, literal
  metadata, mock calls, or export identity;
- copied or mismatched PR narratives and evidence that describe another diff
  or use counts and boilerplate instead of a causal product need;
- exhaustive helper/default/boundary tests, mutation exercises, and
  adversarial cases without a reproduced reachable failure and material
  consequence;
- speculative guards, sanitizers, clamps, coercions, or fallbacks on internal
  typed data, especially fabricated zero/empty/success values;
- lossy truncation, compaction, output or item caps, bounded reads, or arbitrary
  short timeouts/deadlines that are not required by a proven external contract;
- shotgun replication of NaN-sort fallbacks, CE year 0–99 handling,
  placeholder-key/config-shape guards, Unicode truncation refinements, or other
  defensive patches across unrelated modules instead of one canonical boundary;
- coverage-generated parser, lookup, regex-state, word-boundary, or fallback
  micro-fixes split under an “independent module, independent fix” rationale;
- speculative refactors, abstractions, migrations, or performance work without
  a reproduced problem and measurable target;
- routine dependency bumps, generated-file churn, or CI edits unrelated to a
  primary mission failure;
- duplicate fixes, already-owned work, broad epics, or work requiring an
  unavailable human/product decision;
- splitting one outcome into multiple issues or pull requests;
- any work selected because it is quick, scoreable, token-heavy, or likely to
  increase leaderboard position.

## Selection note

Record this privately before starting:

```text
Authorized demand: <operator request, triaged issue/card, or release gate>
Primary user path: <who is blocked and what they are trying to do>
Observed need: <reproduction, missing capability, or decision to validate>
Mission surface: <app, cloud, runtime, primary capability, or blocking infra>
Acceptance proof: <real behavior and artifacts that will prove completion>
Duplication check: <active issue/PR/owner search and why this is not duplicate>
```

If any line is vague, stop and clarify. Do not post a claim to buy time. Keep one
active contribution at a time and consolidate all work required for its outcome.

## Review application

Apply the same gates to reviews. Do not review a low-value PR merely because it
is open. For a mission-relevant PR, determine whether it solves the authorized
need completely, adds unrelated scope, or creates activity without product
value. Recommend closure rather than repairs when the premise fails the mission
gate. These PRs earn no accepted-outcome score and may be excluded or penalized
in contribution-quality and reward review. Reviews that reward test count,
diff size, exhaustive speculative hardening, or green checks without material
product value are subject to the same judgment.

## Queue-cleared audit order

Do not use discovery to manufacture backlog. After the live issue and PR queue
is reconciled, inspect exactly one tier at a time:

1. **Security**: authorization, secret handling, injection, unsafe execution,
   supply chain, privacy, tenant isolation, and trust-boundary failures. Follow
   `SECURITY.md`; keep exploit detail private.
2. **Bugs**: reproduce incorrect runtime, app, cloud, integration, build, or
   release behavior on a primary path before changing code.
3. **Wrong documentation or comments**: prove that instructions, contracts,
   examples, links, names, or code comments contradict current behavior or
   preserve obsolete migration/history narration that misdirects present work.
   Remove or correct the smallest coherent surface; do not perform prose churn.
4. **Missing real-system verification**: identify material behavior whose
   regression would escape end-to-end, scenario, or benchmark evidence. Start
   from the actual user or operator entry point on a real operating system and
   exercise the production path across its real boundaries. Do not create a
   unit-test task merely because coverage is absent. A unit test is acceptable
   only as a supplemental regression guard after the material failure is
   reproduced and the fixed behavior is proved in the real system; never mock
   away the system under test or add coverage solely to raise a number.

If a concrete higher-tier finding exists, finish it before moving down. If no
finding survives reproduction and duplication checks, record that privately
and continue to the next tier without opening an issue.
