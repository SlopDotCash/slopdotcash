# Complete enforcement action planning

This cohort starts at `b8d6cc7b8a6a23a48edf44f0005a2673b3f606d9` and extends
the existing [restriction and appeal folds](lemmascript-enforcement-research.md).
Those folds computed current status but did not prove the substantive
`planEnforcement` action policy. This work closes that separate original
priority-one candidate. It changes no policy, permission, refusal message,
interface or stored history.

PRD sections 2 and 8 keep moderator decisions separate from automated
findings and keep project appeals separate from account appeals. The planner
must preserve those distinctions through all six supported actions, including
independent review and the paused/retired revision requirement.

## Complete action result

`planEnforcement` now calls `planEnforcementAction` in the same
`verified-enforcement.ts` module as the original folds. It supplies actual
history rows, moderator/actor IDs, active ban records, named accounts, current
restriction fields and manifest status/tier. No input is a supplied Boolean
claim that an actor is independent or an action is authorized.

The new helpers reuse `selectProjectAppeals`, `openAccountAppealSource` and
`containsAccount`. All helpers are defined and checked in the same proof
module. The complete result is either the exact refusal status/code/message
or the exact post-action state, appeal, maintainer-ban flag and desired
revision class. The wrapper consumes every result. No alternate policy model
runs beside the old policy in production.

The action result preserves:

- Quarantine or ban: already-restricted refusal first; a pending malicious
  finding determines the maintainer-ban decision. Closing a kept project
  appeal requires an independent project moderator. Re-banned account
  appellants require account-specific independence. The requested retired
  revision remains paused.
- Project/account request: active banned-account identity and the original
  optional actor role select the appeal type. No restriction and already-open
  appeal refusals retain their original precedence. A new request preserves
  current restriction state and requests no manifest revision.
- Account reinstatement: an appeal and active banned accounts are required.
  Without an open project appeal, each selected active account needs its own
  appeal. The reviewer cannot be a selected account or the moderator who
  banned it. A kept project appeal and unselected account appeals survive.
- Project reinstatement or denial: project and account appeal precedence is
  preserved. Project decisions require independence from all restricting
  moderators and all kept appellants. An account-only denial uses the
  selected account-ban identities instead. A malicious finding still needs
  its explicit ban/reinstate decision. Reinstatement requires a paused,
  retired manifest before clearing, and can restore only the community tier
  when the restriction began on a listed project.

The prior independent-moderator helpers, account-set construction and action
switch have moved into this production-used verified layer. `revisionTo`
and `assertProjectPolicyTransition` remain unchanged in the wrapper. They
still decide whether a desired revision is needed, allowed or pending and
return the exact original manifest or reason. The theorem does not replace
schema validation or infer that a manifest transition is valid.

## Actor/history and sequence contracts

`latestRestrictionSource` returns the last quarantine/ban source index.
The planner derives the pending malicious-result condition from that source's
action and role, together with the actual current restriction state.
`openAccountIds` retains first occurrence and deduplicates exactly as the old
Set did, but proves its complete result using the existing account-appeal
boundary algorithm. `projectModeratorConflict` identifies a placing actor
before an appealing actor, preserving the two different refusal messages.
`accountModeratorIndependent` examines the selected account IDs and original
active-ban moderator IDs; it does not infer responsibility from current
ownership.

The sole action-domain precondition lists the six existing
`EnforcementAction` variants. The public wrapper already accepts that union.
No new validation or collection/amount bound is introduced. Existing D1
history order, string identity and native active-ban key mapping remain the
same adapters as the earlier fold cohort. Their authenticity is not assumed
proved by the decision result.

## Flag-only scan reinstatement

`planFlagScanReinstatement` reuses the same latest-restrictive-record selector.
It returns no plan unless current state is quarantined, the latest restrictive
source is a contributor-flags record, a restriction start exists, the scan was
requested at or after that start, and its content digest matches the current
content digest. Its positive result contains the exact clear/granted-or-none
state transition.

The original `planScanReinstatement` constructs the same enforcement record
from that result. Its native repository identity/key union, assessment IDs,
issuer metadata, timestamps, revision fields and immutable-record persistence
stay outside the theorem. Timestamp comparison retains the original lexical
string behavior; the proof uses the pinned JavaScript UTF-16 comparison,
not a newly imposed Date interpretation. `pausedByFlagsOnly` remains the
unchanged public helper for its other callers.

## Native and effect boundaries

The new adapter eagerly projects fields from typed retained history and the
validated manifest/actor. Within that plain-data caller domain it preserves
behavior; it does not claim arbitrary getter/proxy or malformed-object
exception-order equivalence. In particular, some old short-circuit decisions
could skip malformed history/account fields that the projection now reads.
No speculative guard or narrowed public schema was added.

Recorded IDs and actor roles are compared exactly. Optional role presence is
represented separately from its text, so absence is not confused with an
empty string. Active-ban source records are computed with the existing
release-aware adapter, not from an assumed authorization flag. Supplied
`listedBefore` remains the existing recorded listing fact; it is not obtained
from a new policy lookup.

The theorem does not establish live moderator membership, GitHub authority,
scan honesty, digest collision resistance, clock truth, D1 isolation or
notification delivery. Existing role acquisition, request validation,
revision policy and transactional guards retain those responsibilities.
The complete action decision is proved; the whole moderation lifecycle is
not claimed proved.

## Evidence

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6, Dafny 4.11.0.
Ignored `evidence/enforcement-plans/` contains the baselines, comparisons,
proof logs and benchmark. Captured artifacts are not committed.

The actual old and new `planEnforcement` functions agree on **4,200** full
calls, including every refusal category, status/code/message and successful
revision result. The actual `planScanReinstatement` functions agree on
**2,100** full record/null results. Cases include competing project/account
appeals, malicious results, shared/duplicate actors, released/re-banned
accounts, manifest-state combinations and before/equal/after scan times.
Generated direct-call histories intentionally include combinations D1 policy
would not produce; that comparison establishes compatibility, not stored
history reachability.

The expanded module has **14 selected runtime functions** and passes **879
isolated Dafny obligations, zero errors**. This includes the original eight
fold functions and their 421-obligation scope. The six additions are the
latest-source scan, complete open-account selection, two independence
checks, the full action planner and the flag-scan decision. The full action
postcondition equates all result fields with the defined action semantics;
additional postconditions bound refusal status and revision classes and
prove that maintainer bans occur only for the actual pending malicious-ban
decision. Generated executable bodies and headers are unchanged. Strict
integrity and complete source-function checks pass, with no assumptions,
opaque imports or bodyless declarations.

The three existing project self-service, registry API and vetting/flags
workflow suites pass before and after: **95 tests, 1,507 assertions, zero
failures**. They cover both appeal filing orders, kept appeals, account
releases, moderator conflicts, status/revision failures, flagged pauses and
fresh-scan reinstatement. Type checking and scoped Biome checks pass. These
are controlled provider and real SQLite-backed workflows, not a live
moderation or GitHub authority claim.

A nine-round alternating local benchmark called the actual `planEnforcement`
with a pending malicious decision and a successful independent reviewer.
Twenty paired warmups preceded each case. Median milliseconds were:

| History records | Original | New |
| --- | ---: | ---: |
| 1 | 0.001011 | 0.000644 |
| 10 | 0.002693 | 0.001552 |
| 100 | 0.024240 | 0.010658 |
| 1,000 | 0.219208 | 0.096292 |

The 1,000-record maximum round averages were 0.730238/0.126300 ms. This is a
bounded scenario, not a general speedup claim. The wrapper now projects the
history once for the planner and adds tagged/index arrays, while the old
public composition repeatedly projected it through its appeal helpers.
Early-refusal calls can instead pay projection work the original deferred.
No worst-case complexity reduction or production latency bound is claimed.

Independent read-only review found no substantive discrepancy in action
precedence, kept/project/account appeal independence, latest vetting-ban
selection, duplicate account treatment or revision intent. It confirmed the
original `revisionTo` path is unchanged and the native adapter domain remains
explicit.

A second independent read-only review compared 180 histories across all six
actions, plus 180 scan decisions: **1,260 actual-wrapper comparisons** agree.
It confirmed project/account appeal selection, re-banned appellants,
independence-refusal precedence, retired/community revision intent and scan
freshness, with the native persisted-input boundary left explicit.
