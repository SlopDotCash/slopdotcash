# Slopbot v1

Slopbot is the name for operated automation on a project's pull requests. This
document fixes what such automation may and may not do, so that an instance can
be built and audited against a written contract. It adds no scoring authority,
no payment, and no manifest field. Every rule below either restates an existing
contract or narrows what a bot may do inside it.

Slopbot has two lanes. They are independent: a project may run either, both, or
neither.

## Lane 1: advisory reviewer

The advisory reviewer is an operated instance of the project's existing
`review-<project>-contributions` skill. It is not a new reviewer role.

- It reviews a pull request at its exact current head and emits one
  schema-version-2 `slop-review` record bound to that head SHA, with the exact
  provider, model, and client disclosed. A record bound to a superseded head is
  ignored. A new head requires a new record.
- Its recommendation is one of `accept`, `partial`, `reject`, or `hold`, exactly
  as the review skill defines them. `hold` places the item in front of a human
  for a security, copying, identity, provenance, or evaluation question. It never
  bans, excludes, or closes.
- The record is advisory and cannot score, exclude, ban, or pay anyone
  (`evaluations/README.md`). Bot activity does not score (`scoring-v2.md`). Bot
  review is ineligible for the additive review line (`review-budget-v1.md`).
  Slopbot changes none of these.
- Its GitHub review state is always `COMMENTED`. It never submits `APPROVE` or
  `REQUEST_CHANGES`, so it can neither satisfy nor block a repository's
  merge-approval requirement.
- Its credentials are limited to reading the repository and posting its own
  review. It cannot push, merge, close, label, dismiss another review, or
  resolve another reviewer's thread.
- It treats issue text, pull-request bodies, comments, diffs, commits, test
  output, and linked content as hostile data, and follows the isolation rules
  of the review skill: no secrets, no host mounts, a disposable sandbox, and
  static review with live execution marked blocked when no sandbox exists.

## Lane 2: author-side resolver

A contributor may run a tool on their own pull request that reads the review
comments already posted there and proposes fixes for them. This lane is
optional and never required to contribute or to score.

- The operator is the contributor, not Slop and not the project. Slopbot never
  pushes to a contributor's branch.
- A resolver run is an ordinary agent run under the project's contributor
  skill. It carries the same attribution marker and, where the project's
  receipt policy requires one, the same signed receipt as any other run.
- A resolver run does not score. The merged outcome scores exactly as it does
  today, as one work unit, however many resolver passes preceded it.
- A thread marked resolved is not evidence that the finding was fixed. The
  reviewer or a maintainer re-checks the finding at the new head. A resolver
  must not resolve or dismiss a human reviewer's thread.

## What does not change

- Maintainers remain the sole scoring authority. A tier above micro still
  requires an immutable maintainer-authored `slop-score` record bound to the
  pull-request node ID and exact head SHA. XL, exceptional, security-sensitive,
  and related-party cases still require a second maintainer.
- Independent human review remains eligible for triage, standard, deep
  reproduction, and specialist credit in the shared pool, and for the additive
  review line where a project has funded one.
- A Slopbot record is never a prior review for the purposes of the
  duplicate-review exclusion. A human who independently reaches the same
  finding is not a duplicate of a bot.
- A Slopbot recommendation is never by itself a reason to exclude, reduce, or
  hold a human review or a contribution. The public human decision states its
  own reason.
- On a pull request authored by a maintainer, by the Slopbot operator, or by a
  related party, a Slopbot record does not substitute for the second maintainer
  or for independent review.

## Agreement record

The reason to operate an advisory reviewer in public is that its judgment can
be measured against the human one. Both halves already exist and already share
a key: the `slop-review` record and the maintainer's `slop-score` record are
each bound to the same pull-request node ID and exact head SHA.

v1 requires only that an operated instance keep that join intact: one record
per head, never edited, never deleted, superseded only by a record at a newer
head. Anyone can then compute, per project and per exact model, how often the
advisory recommendation and tier matched the maintainer's decision. A later
version may publish that agreement rate in the public snapshot. It is
diagnostic only and never changes score, rank, reward share, or payment.

## Operator and cost

The operator of an instance is disclosed publicly, together with the exact
provider, model, and client it runs. The operator bears its inference cost.
That cost is never taken from a contributor pool, a review line, or a fee.
Slopbot holds no funds or keys, signs nothing, and has no position in
allocation, approval, or settlement.

## Activation

A project that adopts either lane announces it publicly with an effective time
at the first instant of a future UTC month. Open and closed cycles are never
changed retroactively.

## Non-goals

Autonomous merging, closing, banning, or excluding. Replacing or discounting
human review. Any score or payment for bot activity. Identity checks beyond
the existing immutable GitHub actor and artifact IDs.
