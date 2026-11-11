# Inference attempt ID symmetry

This is a manual, source-bound symmetry argument for the finite safety model
`models/slopbot/bot_inference_retention.qnt`. It is not implementation refinement
or a proof of the production inference system. Native qualification is pending
until its actual control and complete-graph receipts are recorded.

The hosted concrete graph exceeded its 180-second limit. It did not establish
a pass. This change leaves the entire QNT file, all eight identities, all row
bits, the attempt cap, transitions, invariant and scenarios unchanged. The
ordinary checker still runs that complete source. The VIEW only identifies
states that differ by a permutation of the eight attempt IDs.

## Exact inputs

- QNT SHA-256: `01644b21ca4172dc45be3abb9585a55ce4cd1b2341d2e3328d01da2c5b5ce60f`.
- Complete translated TLA SHA-256: `2d5c042cd5bcd404884ceab0fd07cdfbe9ab66d7aa0c560e93a24e8cb797b507`.
- TLA with appended VIEW SHA-256: `93de8063bf58e3bb06db80e80412a26392b52beb383551a3a5efebf910aa5c8d`.
- Operator: `SlopBotInferenceAttemptIdViewV1`.
- Production definition and bindings are fixed in `scripts/quint-safety-view.mjs`
  and `formal/tlc-safety-views.json`. Neither the manifest nor the caller can
  supply an arbitrary expression. Source, translation, definition and runner
  drift refuse before exploration. The complete TLA body is retained.

The source models one inference key and one active caller, eight distinct
admitted identities, and at most three counted reservations. Four free denials
and three counted attempts can still use seven different identities and refuse
the eighth. Unreserved admissions, unrecorded costs, mixed costs, no-call
completion/reconciliation, result retention and publication remain distinct.
Other reservation concurrency and late contradictory evidence retain their
existing source-model limitations.

## Observation and reconstruction

For every row ID, the VIEW observes the triple
`(complete row, id == current, id == retained)`. A complete row includes
`admitted`, `reserved`, `called`, `usage`, `free`, `valid`, `completed`, and
`zeroReconciled`, with their exact Boolean values and correlations. The VIEW
keeps a multiset of these triples: every distinct triple is paired with its
exact cardinality. A plain set would be unsound because it could hide a fourth
counted attempt; this VIEW retains counts.

It also retains the exact row domain and `published`. If `current` or `retained`
belongs to the row domain, its status is marked; otherwise its exact sentinel
value is retained. In reachable source states the domain is always `1..8` and
each pointer is either zero or an element of that domain. Init establishes
these facts; admit assigns an ID from `ids`, retain copies current, finish and
budget refusal assign zero, and no action changes the row domain.

Two reachable states with the same observation therefore admit a bijection
between IDs: pair the IDs within each equal observation class. Multiplicity
gives equal class sizes. The bijection maps every complete row, the current
pointer, and the retained pointer to their counterpart. If the two pointers
overlap, the corresponding row has both markers; separate rows cannot be
mistaken for overlap. Zero remains fixed. The published flag is identical.
Conversely, renaming IDs by such a permutation leaves the VIEW unchanged.
Thus these observations identify precisely the ID-permutation orbits, rather
than deleting cost, completion or identity relationships.

## Transition relation

All source uses of an attempt ID are membership, equality and map access. The
only numeric pointer tests are `current > 0` and `retained > 0`; permutations
of `1..8` preserve them and fix zero. There is no ordering, minimum, special
nonzero ID, ID arithmetic or ID-specific output in this model.

| Action | Preservation under a permutation |
| --- | --- |
| init | All eight rows are identical and both pointers are zero. |
| admit(id) | Rename the nondeterministically chosen ID. Admission, current/retained guards, counted limit and the complete reset row are preserved. |
| reserve | The current marker selects the corresponding exact row. Its reserved bit and counted guard match. |
| budgetRefused | The corresponding current row has the same reserved bit; both states clear the current pointer. |
| call, freeDenial, mixedDenial | All guarded current-row bits match, and the same bits change in the corresponding row. Mixed denial remains the call alias. |
| recordUsage, validate | Current-row called/free/completed bits and the updated usage/valid bit match exactly. |
| retain | Usage/valid guards match. Copying current into retained preserves pointer overlap and the exact retained row. |
| complete | Reservation, called/usage, valid and retained-equals-current guards match; only the corresponding completed bit changes. |
| reconcileZeroCall | Current-row completed/called guards match and the same reconciliation bit changes. |
| finish | Both states clear only the current marker; rows and retained marker remain. |
| publish | Retained existence matches and both states set the same published flag. |
| stutter | Preserves the observation. |

The original nondeterministic step contains exactly these alternatives. Every
concrete transition has a corresponding renamed transition, and applying the
inverse permutation gives the reverse correspondence. This is a manual
transition-congruence argument for the finite model, not a machine-checked
refinement theorem or an assertion that fixed seeded traces use the same IDs.

## Invariant

All five source clauses are determined by the observation:

1. The counted total is the sum of class multiplicities satisfying the exact
   reserved, usage/free, completed/reconciled conditions; it remains at most
   three.
2. Called implies reserved is checked within each complete row.
3. Reconciliation implies completed and no call is checked within each row.
4. Retention selects the exact marked row, preserving both usage and validity.
5. Published implies a positive retained pointer, whose existence is retained.

This does not assume that an invariant holds before checking it. The native
observation controls deliberately include faulty transitions and independent
false clauses. A new ID-specific invariant or action guard invalidates the
source hash and needs a new review. The bridge refuses temporal properties;
fairness, identity-sensitive liveness and production provider billing truth
are outside this safety authorization.

## Qualification requirements

`scripts/bot-inference-symmetry.test.ts` must run with
`SLOP_QUINT_TRANSLATOR_TEST=1` in the existing formal inventory job. All prior
native files remain required. New controls retain counterexamples for every
row bit, counted multiplicity, call reservation, zero-call completion/no-call,
retained-row usage/validity, publication, current-row role and pointer overlap.
Two raw/viewed native pairs require exactly two raw states and one viewed
state for genuine ID renamings, with all eight rows present.

Those tiny native fixtures exercise the actual pinned runner and production
VIEW. They are not a substitute for the unchanged QNT scenarios, seeded
simulation and complete source-bound finite graph. No success is claimed
until those finish with unchanged inputs, no cancellation, and zero queued
states. A graph count will be labeled as symmetry classes, not raw states.
