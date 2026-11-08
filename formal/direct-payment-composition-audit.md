# Direct-payment parent and recovery composition

This review started at `120c7a22a121`, with a follow-up at `d6323d9f2426`.
It adds two focused models and the read-generation correction described below.
The user directed this chat to skip checks and focus on pushing, so those
authoring checkpoints had no execution evidence. The independent review below
records later scoped checks of the reviewed parent. The additional captured-
storage and accepted-replacement transitions are now reconciled with those
reviewed models; earlier results do not validate their combined revision.

## Parent selection and identity

The reviewed source is `CaseDetail`, `SecurityInbox`, `useSecurityData`, and
their callbacks in `src/SecurityBounty.tsx`, plus `DirectBountyPayment.tsx`,
`SolanaBountyPayment.tsx` and `BountySubmittedPayments.tsx`.

- The private-session provider removes its content during session checking,
  known sign-out or a known actor mismatch. Its content is keyed by actor;
  the selected detail is keyed by case. Private API calls check the actor
  before and after the request and send the expected-actor header.
- Case refresh retains the last ready detail. Request generations prevent an
  older GET from replacing a newer GET result. A transient refresh error is shown
  with the retained case. Authoritative access refusal is also handled by the
  enclosing private provider; it is not permission to keep sending from a
  stale case.
- EVM send controls require a direct payment, a generation, suitable nonce and
  chain fields, an owner request and a financial/maintainer viewer role. The
  retirement-required and retirement-unproven modes exclude that sender.
- Solana send controls require the direct generation and the issued wire
  transaction/message ID, plus the owner request and payer role. The backend
  returns a role-filtered owner request in one chain family.
- When neither sender is available, the submitted-payment fallback requires a
  direct generation, payer role and `verify-payment` action. It contains no
  wallet send operation.

`ui_bounty_payment_parent` represents these valid case projections as EVM,
Solana, submitted recovery or no child. It does not parse arbitrary malformed
responses or assume that a visible button is current authority.

## Keys, wallet invocation and uncertainty

The EVM child key is case plus generation. A same-generation plan update keeps
its nonce journal; byte comparison marks a journal entry that differs from the
current transaction and disables that send path. The Solana key additionally
includes message ID, so a newly issued message mounts a new child and loads a
different storage slot. Actor-specific storage keys retain older requests for
later verification; they do not migrate an old request to another actor.

Both senders authorize against a fresh private case before handing off to the
wallet. Sender authorization compares generation and exact issued transaction
or Solana plan; a mismatch replaces the displayed case and refuses the send.
The EVM sender also checks account, chain and exact nonce, including a second
identity/wallet check after gas estimation. The Solana Wallet Standard adapter
checks the connected account and supported chain before `beforeSend`.

The journal marker is written before the wallet send. A missing result retains
that marker and gives a manual verification path. A wallet-returned hash is
evidence to verify, not a paid state. After unmount, a returning wallet promise
can still write its captured old storage key; it does not fill a new child's
in-memory state. A known wallet decline removes the old marker only when the
storage clear succeeds.

The final `beforeSend` callback in both senders now checks the component's
mounted lifetime immediately before recording and opening the wallet request.
A component that departs while its preflight or adapter preparation is waiting
cannot then create a new marker or open a prompt. The parent model's earlier
departed-preflight witness is corrected to refuse that transition; its State,
finished-prompt cleanup, factored choices and finite bounds are unchanged.

Once `beforeSend` has recorded the request and the wallet prompt is open,
navigation does not cancel that prompt. Its later wallet response may retain
evidence for the original request, subject to that component's storage-ownership
checks. It does not fill a replacement child's local state. The separate
[Solana pending-record audit](solana-payment-pending-audit.md) covers the
same-slot candidate/write race, failed-save acknowledgement and exact-record
guards added after this parent review. A recorded signature remains evidence
to check, not proof of finality or payment.

This module bounds one selected case, two actors, two generations/messages/plan
classes, three case reads, two local replacements, two identity rechecks and one outstanding wallet
invocation. The journal is one representative transfer. It does not exclude
simultaneous prompts from independent children/tabs, model every partial EVM
leg or prove nonce uniqueness. Those remain the `ui_tab_scope` and financial
protocol boundaries. Storage reads assume coherent visibility of a marker
already written in the same modeled tab. External browser/storage behavior,
wallet decisions, exact transaction checks and chain finality are predicates.

## Submitted-payment fallback

The fallback is not keyed by generation. Its effect reloads storage when the
case, generation or chain family changes, with an active flag for old reads.
It deliberately retains the old rows and actor until the new read completes;
a failed read also leaves those rows visible with an error. Therefore the
model does not assert that every displayed row belongs to the current
generation. A cookie change alone is also not an immediate storage event.
The raw session check and enclosing private request must still agree on the
actor before any verification request proceeds.

Verification captures the rendered rows and visible, syntactically valid
identifiers at the time of the click. Already-confirmed identifiers are hidden
and excluded from that list. Inputs remain editable while the action runs;
later edits do not change its captured list. The callback first checks the raw
actor and authorizes the current generation. It writes candidates back to their
original storage records. The follow-up replaces the model's single storage
list with four actor/generation groups and captures the original row group
alongside the clicked rows. A generation change and new storage read while
authorization is pending must not redirect those writes into the new group's
records. A named scenario records the old candidate in generation 1 while
preserving the newly loaded generation-2 record.

The source's storage loop has no `await`. The model now treats it as one atomic
attempt with zero, one or both row writes completed; it no longer admits React
input edits between its synchronous writes. A failed later write can leave
earlier candidate writes intact, but it stops the verification call. Edits
during either pending API request remain possible and do not change the
captured POST body or captured storage keys.

`verifyExistingPayment` then performs another fresh, actor-bound case GET. It
requires `verify-payment` and the same generation, and sends the POST with the
revision from that fresh GET. The existing API accepts one or two identifiers
and verifies the exact current payment intent. A syntactically valid candidate
or retained old-generation row is not evidence that verification succeeded.

There is no automatic uncertainty polling in these three child components.
The user checks again or reloads; a new case response can also change the
available path. Removing only the fallback does not cancel its promise while
the enclosing provider stays valid. Removing the provider prevents a later
successful private response from being delivered, although a POST already
accepted by the server may have recorded evidence. The second model keeps
server acceptance distinct from delivery to the private view. The model names
the latter `responseDelivered`: it is an observation that the response arrived
through a valid provider, not a lasting authority capability. It can remain a
historical observation after the private view is closed; it does not then
enable a new verification request.

`ui_submitted_payment_recovery` bounds one fallback instance, two actors,
two generations, two stable row keys per actor/generation group, two visible
rows and two dependency-triggered storage reads. It
models both preflights, partial candidate writes, captured versus edited
inputs, confirmation filtering, cookie changes and both departure boundaries.
Its finite `step` now explores at most two verification invocations and two
distinct nonzero identifier representatives, plus empty/invalid input. These
are verifier bounds, not limits on application retries or submitted hashes.
The separate `unboundedStep` keeps repeated invocations and all three original
identifier representatives for seeded simulation. The finite result does not
prove an unbounded retry history. A named failure-then-success scenario keeps
the retry path inside the finite two-invocation scope.
Hash grammar, local-storage key enumeration, receipt cryptography, backend
atomicity and the exact chain status are external predicates. It is not a
model of payment broadcasting.

## Source-confirmed replacement race

The follow-up found that `useSecurityData.replace(value)` did not advance the
read generation. An active GET could therefore start before an action, return
after the action's successful replacement, and overwrite that newer detail.
An old GET failure could likewise add a refresh error to the replaced value.
This is a source-confirmed interleaving; no new runtime reproduction was run.

The shared hook now advances its read generation before publishing a local
replacement. Existing success/error callbacks from older reads fail their
generation comparison. Two named model scenarios cover replacement followed
by an old success and by an old failure. The model does not infer that a
displayed revision is current authorization: each payment preflight still
reads the private API. The correction fences the hook's state commit, not
independent authority decisions made by the enclosing private-request wrapper.

## Conformance references and status

The existing `tests/e2e/bounty-full-flow.spec.ts` and
`tests/e2e/bounty-solana-flow.spec.ts` contain the real wallet workflows,
uncertain-return recovery, reload, verification and paid-state assertions.
Backend `direct-payments.ts` / `handler.ts` and their protocol models retain
authority over intent, generation, receipt and settlement rules. Those are
references for future conformance checks; no earlier pass certifies these new
models. Model-to-source mapping is not proof of refinement or completion.

## Earlier independent model review

The PR review found two authoring errors before model execution: a list used
the set-only `filter` operator, and the typed `received` function lacked its
required return type. The correction uses list `select` and a shared state
type. Neither correction changes a production component.

The first finite runs reached their 180-second limit. Moving nondeterministic
choices into their own parameterized branches removes repeated successors
without changing their domains or transition union. A second review identified
another unnecessary source of state: captured arguments were kept after their
async calls had returned. The models now clear completed prompt/check captures,
and completed storage-read actor/generation cells. They preserve durable
journals, row state, request-list lengths, all still-pending reads, and every
capture used by a live call. The storage response projects its actor and
generation into the row before clearing the completed request cell. A separate
reviewer checked those uses against the guards and named scenarios.

The bounded parent model retains six behavior dimensions: two actors, two
generations, two messages, two plan classes, three reads and two identity
rechecks. Its 13 named scenarios and 500 seeded traces of at most 60 steps pass
with Quint 0.33.1 and seed `20261107`. Finite TLC completes in 146.8 seconds:
1,217,185 distinct states, 94,451,565 generated states, depth 23, empty queue.
The original unnormalized run was incomplete at 180 seconds; it is not a pass.
At that first cutoff, it had reached 35,615 distinct states with a nonempty
queue. The completed run above uses the same actor/read/message/plan bounds
and clears only expired invocation captures. Intermediate representations of
the submitted-recovery model also reached the 180-second deadline; none are
counted as successful verification.

The submitted-recovery model passes 13 named scenarios and 500 seeded traces
of at most 60 steps through each of `step` and `unboundedStep`, seed
`20261107`. Its final finite attempt uses the two-invocation, two-identifier
scope above, but still reaches the configured 180-second limit: 6,615,547
distinct states, 77,352,325 generated states, depth 15 and a nonempty queue.
No violation was reported before termination. This is **incomplete finite
verification**, not a pass. The wider three-identifier, uncapped-invocation
simulation is also not proof for arbitrary retry histories.

The verification-stage budget was then raised from three to six minutes;
type, scenario and simulation stages retain their 90-second budget. No model
guard or domain changed for that run. It also remains incomplete: the last
progress report contained 8,625,458 distinct states, 110,585,697 generated
states, depth 16 and about 1,946,451 states still queued. The six-minute
deadline stopped the run with no reported violation. Both timeout receipts
are retained outside the source tree. This result does not permit a claim
that the submitted-recovery model passed finite verification.

## Earlier property-specific storage quotient

A separate review found that `stored` cell values feed only later `stored`
writes in this model. No guard, visible row, identity check, authorization,
phase or result depends on those cell values. The invariant reads only the
list length, which remains two. The default finite `step` now selects a
projection flag on every storage-writing transition, replacing these two
cell values with zero. Initial cells are zero and other transitions preserve
them. This is a quotient for the stated invariant and non-storage control
state, not a proof about persisted contents. The projection is applied inside
the writer, because the TLC backend does not support sequential action
composition in the step relation.

`concreteStep` retains the two-invocation/two-identifier transition relation.
`unboundedStep` retains repeated invocations and three identifiers. Both keep
the exact modeled stored cells, as do all named scenarios, including partial
writes, captured rows and the failure-then-success retry. Their separate
500-trace, 60-step simulations are concrete evidence rather than a storage
proof. The earlier six-minute timeout above remains the result for the graph
which retained all stored contents; it is not relabeled as a pass.

The field-level quotient completed its first finite run in 101.9 seconds:
4,819,932 distinct states, 83,119,123 generated states, depth 29 and an empty
queue. No invariant violation was found. This is a pass only for the stated
property quotient and finite invocation/identifier bounds. It does not turn
the earlier full-content timeouts into passes, prove exact stored cells, or
establish implementation refinement. The original three-minute verification
budget is restored; simulation stages remain bounded at 90 seconds.

The final quotient was repeated with that original 180-second limit and
completed in 99.98 seconds with the same 4,819,932 distinct states,
83,119,123 generated states, depth 29 and empty queue. Model and mapped source
hashes stayed unchanged during the run. Exact stored cells remain outside
this finite result; all 13 concrete scenarios and the separate 500-trace
`concreteStep` and `unboundedStep` simulations pass with those cells retained.

## Reconciliation with the observation fixes

Commit `07a232357428cf5055ee7f5f29bb751d69ac5e2d` combines the reviewed
state types, completed-call cleanup and factored choices with the later
observation changes. The parent model adds two accepted replacements and
retains the corresponding epoch bound of seven. The fallback model retains
four actor/generation slots with two rows each, captured write targets,
zero/one/all-write outcomes for the synchronous storage loop, and the
historical `responseDelivered` observation. Neither model changes application
code.

The fallback's finite `step` still projects stored payload values, while
retaining slot identity and all control decisions. `concreteStep`,
`unboundedStep` and the named scenarios retain actual cell values. The 17
named scenarios include nonzero captured-slot and partial-write witnesses.
`postStarted` and `postAuthorized` retain their historical meaning; the
implication between them is not an independent proof that every retry checks
authority. The guarded preflight transitions and concrete retry scenarios are
separate obligations.

The reconciled parent passed 15 named scenarios and the fallback passed 17;
both passed their normal seeded simulations. Both exhaustive TLC runs hit the
unchanged 180-second deadline with work still queued. The parent's last
progress report recorded 45,728,506 generated states, 833,208 distinct states,
depth 11 and 498,493 queued states. The fallback recorded 17,361,030 generated
states, 1,336,578 distinct states, depth 16 and 292,463 queued states. These are
incomplete runs, not successful verification or complete reachable-state
bounds. No counterexample was reported before either timeout.

The unchanged-input receipts remain at
`slopdotcash-lemma-bounty-parent-reconcile/evidence/formal/verification-ui_bounty_payment_parent.json`
(SHA-256 `afcece5a4b96411fa09b0fd3038b692c3111b9395935d0f2c017c166239d79b7`)
and
`slopdotcash-lemma-submitted-model/evidence/formal/verification-ui_submitted_payment_recovery.json`
(SHA-256 `3711a8813c5fc3a6d95786c12b471174e548ba1672fb20c242a2c71ba551d59b`).
Further complete verification remains required. Preserve these failed runs
when recording any later optimization or larger-budget result.
