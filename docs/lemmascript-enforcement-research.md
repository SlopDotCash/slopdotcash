# Project restriction and appeal folds

This cohort starts at `11e8cf06992c594f8f847e936fed17950a11fb2a` in an
isolated worktree. It covers the current project restriction and appeal
reductions in `backend/projects/enforcement.ts`. PRD sections 2 and 8 require
independent moderator decisions, separate project and account appeals, and
account restrictions that survive project reinstatement. The change proves
existing behavior. It adds no policy, authority, refusal, state transition,
or interface control. No new runtime defect is claimed.

## Research and selected scope

The important state is spread across several existing reductions. Proving
only the final state string would leave the opening record, moderator
identity, pending appeals and active account bans unchecked. The selected
module, `backend/projects/verified-enforcement.ts`, therefore contains eight
executable functions. Four are directly called by the original module and
four are private, proved components of those calls.

| Production behavior | Complete executable proof |
| --- | --- |
| Current restriction and its effective appeal | `foldEnforcementStatus`, composed with `foldRestrictionEpisode` and `anyAccountRequested` |
| Pending project requests, including requests kept by malicious results | `selectProjectAppeals` |
| An account's latest request after the applicable decision | `openAccountAppealSource`, composed with `findAccountBoundary` and `containsAccount` |
| Active bans after exact ban/account releases | `selectActiveBanIndices` |

`account-bans.ts` is a D1 query, not another in-memory fold. Its exact
ban/account anti-join remains unchanged. Project access helpers consume the
same `projectRestriction` result. Their SQL reads, authority checks,
repository matching and first-match selection remain outside this theorem.
The native chronological sort remains in the original wrapper.

## Complete contracts

### Restriction episode and effective appeal

The episode fold proves the final state and recorded appeal, the exact
opening record index, the complete first-occurrence list of restricting
actors, and the final record index. A quarantine or ban opens a new episode
only when the preceding state is clear. A clear result resets the opening
and restricting actors. Actor identity is the exact GitHub ID. Repeated
actors retain the first actor record in that episode; the returned source
indices preserve its original metadata. The proof establishes valid source
indices and pairwise distinct actor IDs.

The status fold then proves the effective appeal, with the original
precedence:

1. A recorded `requested` appeal stays requested.
2. A non-clear project with an open project request is requested.
3. Otherwise, an open request from any active banned account is requested.
4. Otherwise, retain the recorded appeal.

The active account list comes from the real selected ban records. The fold
also handles the existing clear-project/account-appeal combination; it does
not infer that a clear project clears an account ban.

The wrapper returns the exact original opening record's timestamp and
revision, the exact original actor objects selected by the fold, and the
last record's repository identity and key-array reference. It still returns
`records.length + 1` as the next sequence. It does not replace that expression
with a maximum or change duplicate/input ordering behavior.

### Project appeals

The project selector proves the complete newest-first list after the last
applicable closing record. A normal ban closes a project appeal only if it
does not retain `requested`. A vetting-service ban closes it unless the
caller requests kept appeals and the ban retains `requested`. Quarantine,
project reinstatement and denial close it. Account-role requests are
excluded. The boundary defaults to zero.

A tagged optional sequence limit implements the existing account-decision
query for all records with `sequence < decision.sequence`. The theorem
covers that filter and the complete selected output. It does not assume the
supplied array is already sorted or that sequence values are unique. The
wrapper's comment now correctly says newest first; its former comment said
oldest first although the implementation reversed the records.

### Account appeals and decision precedence

The account selector proves the exact last matching closing record and the
latest qualifying account request. A closing record is:

- A ban that names this exact account.
- An account reinstatement that names this exact account.
- A denial with no open project request among records earlier than the
  denial's sequence.

The final case is important: a denial decides a pending project appeal
before account appeals. The proof calls the complete project selector for
that decision; it does not replace this rule with an assumed boolean. It
uses the full supplied history and the numeric sequence filter, preserving
the original behavior even for non-chronological direct-call arrays.

Only a `banned-account` request by the exact actor ID after the boundary is
selected. The public account wrapper retains its original early inactive
account check before any history projection.

### Active ban/account pairs

The native adapter assigns a dense index to each exact existing
`${banEnforcementId}:${githubId}` string. It processes release keys before
ban keys and retains the original ban/account objects and their order. The
proved scan establishes that the complete result contains exactly the ban
positions whose key does not occur among releases, in ascending source
order. Duplicate ban entries remain duplicate entries; an unrelated release
has no effect. Releasing one ban does not release another ban for that
account. Project reinstatement alone does not release either.

The pair mapping is a reviewed adapter, not an axiom of the proof. It retains
the original string construction, including its existing equality behavior.
The scan's index-range preconditions follow from the same native Map that
produces `keyCount` and every supplied key index.

## Runtime and proof boundaries

The module uses source indices rather than copying actor, timestamp,
repository or audit metadata into a second state model. The production
wrappers consume every selected result. The temporary old account-list
accumulation inside the episode loop was removed because the old code
unconditionally replaced it with `activeAccountBans` before returning.

The proof uses the pinned LemmaScript 0.6.6 number-as-integer model. Array
positions and dense indices are actual native collection indices. Stored
sequence numbers are positive D1 integers; the append trigger requires the
next gapless sequence, and production appends derive that sequence from the
actual record count. No monetary arithmetic, timestamp arithmetic or float
calculation is added. The theorem does not claim to cover NaN, Infinity,
fractional or unsafe-integer sequence values in arbitrary JavaScript calls.
No new public guard or supported-value restriction is introduced.

String equality uses the pinned string model. There is no normalization,
case conversion, date parsing, truncation or authority inference in the
kernel. An explicit tagged actor replaces a nullable field in the proof
input: the nullable nested-string representation emitted by this compiler
was unsuitable, while the two tagged cases generate faithful constructors.
The adapter reads the original actor and retains the original actor object
for output; it does not invent an actor for system records.

The proof does not establish native Map semantics, native stable sorting,
SQL integrity, database completeness, authorization, concurrent writes,
notification delivery or repository ownership. These remain existing
application and Quint boundaries. It proves the complete selected in-memory
algorithms over their supplied records, not the whole moderation lifecycle.
The eager projection of plain persisted records does not claim arbitrary
accessor/proxy or malformed-object exception-order equivalence.

All eight functions pass **421 isolated Dafny obligations with zero errors**.
Generated executable bodies are unchanged in the proof file. Added material
consists of proved definitions and `assert ... by { ... }` blocks. Strict
proof-integrity and function-obligation checks pass. There are no axioms,
assumptions, opaque imports or bodyless declarations.

## Evidence

Evidence is retained under ignored `evidence/enforcement/`; captured logs
and scripts are not committed.

- Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
- A deterministic comparison imports the real original and changed modules
  from separate worktrees. **2,501 histories and 92,537 comparisons agree**.
  Cases include empty histories, interleaved projects, clear resets, repeated
  actor and ban IDs, system and account roles, normal and kept appeals,
  account/project denial precedence, exact and unrelated releases, and
  unsorted or equal sequence values. It checks complete output, selected
  original actor/record references and input immutability. These generated
  direct-call histories include combinations that stored policy would not
  create; they establish compatibility, not database reachability.
- The existing project self-service and registry API workflows pass before
  and after: **25 tests, 620 assertions, zero failures**. They cover account
  and project requests in both orders, independent reviewers, concurrent
  appeals, account release, kept malicious appeals, banned repository
  aliases, automatic activation races, reload persistence and revisions.
- Existing scan workflows pass before and after: **4 tests, 57 assertions,
  zero failures**. They cover malicious detection, fresh clean automatic
  reinstatement and publication revalidation for text/native scan reuse.
- TypeScript checking passes. The changed TypeScript files pass the existing
  formatter and linter. No new implementation-mirror tests were added.

These are local source, proof and real SQLite-backed application-workflow
results. They do not claim hosted CI, a deployed moderation action, provider
inference or production state acceptance.

## Bounded runtime comparison

The actual `projectRestriction` caller was measured against the baseline with
10, 100, 1,000 and 10,000 rows, for project and account appeals. Each case had
30 paired warmups and 11 rounds with alternating old/new order. Each round
made 1,000, 100, 10 and 5 calls respectively. Outputs were compared before
timing. One bounded repeat was retained to show variability.

The repeat's median milliseconds per complete call were:

| History | Rows | Original | Proved fold | Ratio |
| --- | ---: | ---: | ---: | ---: |
| Project appeal | 10 | 0.001600 | 0.001740 | 1.09 |
| Project appeal | 100 | 0.008825 | 0.009459 | 1.07 |
| Project appeal | 1,000 | 0.078725 | 0.086654 | 1.10 |
| Project appeal | 10,000 | 1.378258 | 3.022825 | 2.19 |
| Account appeal | 10 | 0.000963 | 0.001464 | 1.52 |
| Account appeal | 100 | 0.010073 | 0.009383 | 0.93 |
| Account appeal | 1,000 | 0.072592 | 0.086133 | 1.19 |
| Account appeal | 10,000 | 1.437292 | 2.141292 | 1.49 |

The first run's 1,000-row medians were 0.076617/0.088042 ms for project
appeals and 0.072121/0.084838 ms for account appeals. Its 10,000-row project
medians were 3.757592/2.117683 ms, the opposite relative result from the
repeat. Tail costs vary substantially: the repeat's 10,000-row project
90th-percentile round cost was 3.510725/9.406850 ms and maximum was
5.980692/18.121608 ms; the first run's maxima were
29.751083/37.784608 ms. The measurements do not establish a speedup or a
stable large-history ratio.

The projection allocates extra history records, tagged actors and account-ID
arrays so the complete folds can be verified without external assumptions.
The account-ban adapter also adds numeric index arrays. This is an explicit
proof-integration cost. The common measured 1,000-row overhead was about
0.008–0.013 ms; the repeat shows a larger absolute and relative cost for
10,000-row histories. No collection cap or policy change is introduced to
hide that cost. The existing nested denial/project-appeal lookup and actor
deduplication complexities are preserved. Further runtime changes would
need their own evidence; this cohort does not claim an optimization.

An independent read-only peer review found no substantive discrepancy in the
final source. Its separate comparison passed 513 histories and 6,191
result/identity checks, including reversed input, duplicate actor metadata
and interleaved projects. It independently confirmed the first/last
boundaries, exact release keys, project-before-account denial precedence
and original source identities. These are additional review results, not
formal claims about native adapters or persistent state.
