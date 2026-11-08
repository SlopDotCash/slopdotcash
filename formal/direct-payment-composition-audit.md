# Direct-payment parent and recovery composition

This source-only review started at `120c7a22a121`. It adds two focused models;
it changes no production code. The user initially directed the team to skip
checks and focus on pushing, so that first checkpoint had no execution
evidence. The independent review below records the later scoped checks.

## Parent selection and identity

The reviewed source is `CaseDetail`, `SecurityInbox`, `useSecurityData`, and
their callbacks in `src/SecurityBounty.tsx`, plus `DirectBountyPayment.tsx`,
`SolanaBountyPayment.tsx` and `BountySubmittedPayments.tsx`.

- The private-session provider removes its content during session checking,
  known sign-out or a known actor mismatch. Its content is keyed by actor;
  the selected detail is keyed by case. Private API calls check the actor
  before and after the request and send the expected-actor header.
- Case refresh retains the last ready detail. Request generations prevent an
  older GET from replacing a newer result. A transient refresh error is shown
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

Unmount does not universally cancel a send already in progress. In particular,
the EVM path awaits wallet/network/nonce work after its last private identity
guard. The model admits departure during that tail and a subsequent marker and
wallet handoff for the already selected request. This is an explicit boundary,
not a claim that navigation proves nothing was sent. No new source defect or
authorization bypass was established by this review.

This module bounds one selected case, two actors, two generations/messages/plan
classes, three case reads, two identity rechecks and one outstanding wallet
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
original storage records. A failed later write can leave earlier candidate
writes intact, but it stops the verification call.

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
server acceptance distinct from delivery to the current private view.

`ui_submitted_payment_recovery` bounds one fallback instance, two actors,
two generations, two rows and two dependency-triggered storage reads. It
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

## Conformance references and status

The existing `tests/e2e/bounty-full-flow.spec.ts` and
`tests/e2e/bounty-solana-flow.spec.ts` contain the real wallet workflows,
uncertain-return recovery, reload, verification and paid-state assertions.
Backend `direct-payments.ts` / `handler.ts` and their protocol models retain
authority over intent, generation, receipt and settlement rules. Those are
references for future conformance checks; no earlier pass certifies these new
models. Model-to-source mapping is not proof of refinement or completion.

## Independent model review

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
