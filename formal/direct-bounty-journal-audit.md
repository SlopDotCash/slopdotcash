# Direct bounty journal concurrency

This source-only follow-up starts from `ba7a78ba9`. No tests, syntax/type/lint/
format checks, simulations, model verifiers or browsers ran. The implementation
and model changes are unvalidated.

## Source trace

`DirectBountyPayment.send()` copied the component's whole journal before its
wallet/chain awaits. It then persisted that old copy both before each prompt
and after each wallet response. The key is scoped to case, generation, payment
purpose and actor; different component instances with that same key use the
same session storage.

An old instance A can retain a wallet promise for nonce N while another
instance B recovers and verifies N. The server can remove the paid leg from
its remaining transactions without changing the case generation or journal
key. B then records remaining nonce M. A's late wallet result previously wrote
its old `{N}` copy over B's `{N,M}`, deleting M's prompt marker. A late wallet
rejection could similarly overwrite unrelated entries. A local component's
`sending` ref does not serialize a different instance.

## Narrow correction

Every journal mutation now reads and validates the latest stored journal
synchronously and changes only the affected nonce. New prompts refuse a nonce
that is already recorded. Hash completion and rejection compare a unique
per-prompt `requestId` as well as exact transaction bytes. This prevents an old
promise from updating/deleting a newer same-nonce reservation after the old
slot was resolved and removed (the ABA case). Rejection removes only its own
still-empty marker and preserves a recovered candidate or known hash.

Candidate updates during verification also merge the latest journal and must
match the entry identity captured by that component. Legacy records without
`requestId` stay readable and recoverable; they cannot be overwritten by a new
prompt because the nonce is occupied. The verification request uses hashes
from the merged result rather than an old whole-journal snapshot.

If hash persistence fails, a mounted prompt keeps the known hash in its own
matching in-memory entry and reports the hash for manual retention. If a newer
entry owns the nonce, the old completion does not replace it and instead
reports its submitted hash. No whole key is cleared by these operations.

## Failed-write readback correction

Source review found that rereading storage during `check()` could replace a
known in-memory wallet hash with the earlier null marker after its write had
failed. The check now carries that known hash into the fresh record only when
request ID and exact transaction still match and the stored hash is null. A
newer stored hash is retained. If persistence still fails, the known in-memory
hash remains and a notice tells the user to retain it; verification is not
called with an empty list. Displayed and submitted hash selection now use the
same precedence: an unedited input uses the saved candidate or known hash;
an explicitly cleared input selects no hash. Clearing the visible input cannot
silently resubmit an earlier saved candidate. The known hash remains retained
in the journal even when a user clears the input.

A final synchronous mounted check immediately precedes nonce reservation.
Unmount during the last wallet RPC therefore cannot start a new prompt. An
already-open prompt may still complete and merge its own evidence after
unmount; it cannot touch another reservation.

## Model and limits

`direct_bounty_journal.qnt` models two instances, two nonces and three prompt
identities. Fifteen authored scenarios describe cross-leg merging, same-nonce
ABA completion/rejection, duplicate-prompt refusal, failed marker/hash writes
and a retained legacy candidate. Follow-up scenarios cover check after a failed
hash write, repeated storage failure, newer stored evidence, same-nonce
replacement, component departure, and an explicitly cleared recovery input.
The legacy retention assertion and refused replacement use separate scenarios
so the refused action is terminal. None has been executed.

The synchronous read/modify/write assumption covers cooperative component
instances in one JavaScript context. It is not a cross-process storage lock,
and separate tabs normally have separate session storage. This change does
not make external wallet promises cancelable or prove that all possible
manual storage edits are safe. Original actor authorization, nonce checks,
chain proof and server-side generation checks remain separate boundaries.
The old wallet promise can still complete after unmount; its narrowly owned
journal update preserves evidence without discarding another leg.

## Independent model validation

The model at `0c15d9b02c3ff5c21f866b611518b592abac6e9e` did not parse with
Quint 0.33.1: three local values named `next` shadowed a reserved built-in name
(`QNT101`). Renaming those local bindings and references to `nextStore` changes
no transition, state field, guard, invariant or finite bound. The unchanged
transition model then passed type checking, all 15 named scenarios and the
normal 500-trace, 60-step simulation. Its first finite TLC run reached the
180-second deadline with a nonempty queue: the last progress report recorded
7,499,260 generated states, 496,814 distinct states, depth 7 and 421,716 queued
states. No invariant violation was reported. This run is incomplete, not a pass.

That version selected component, nonce and request identifiers around the
entire step disjunction. Every action therefore repeated for values it did
not use. The revised step factors those same finite choices into separate
actions. The transition union, state fields and domains remain unchanged:
two instances, two nonces and three unique prompt identities. The original
failed parser and incomplete TLC receipts remain outside committed source.

The factored version also passes type checking, all 15 named scenarios and
500 seeded traces of at most 60 steps (seed `20261107`). Its full finite TLC
run remains incomplete at the unchanged 180-second deadline. The last progress
report recorded 10,042,515 generated states, 2,329,004 distinct states, depth 8
and 1,895,997 queued states. No invariant violation was reported before the
timeout. These progress counts are not a complete reachable-state bound or a
verification pass. Further exhaustive verification remains required.

Both timeouts used Quint 0.33.1, local Apalache 0.62.4, Node 24.15.0, OpenJDK
21.0.10, two TLC workers and a 2 GiB heap. The cleanup path also reported an
`EPERM` process-group probe; subsequent read-only inspection found none of this
run's known checker or model-checker processes still alive. That observation
is not a general guarantee about escaped processes. No runtime code or model
bound was changed, and no application/browser test is claimed here.

## Auxiliary witness projection

After the two incomplete finite runs, the next model changes only the ignored
cell of the `before` witness. Define P(s) to replace `before[touched]` with the
existing empty entry when `touched` is 1 or 2, and leave s unchanged when
`touched` is 0. The actual store, per-instance memory, held requests, identities,
control state and untouched `before` cell are not changed. This is not a
projection of persisted journal contents.

No action reads `before`. On original reachable states, every selected nonce
and every nonempty held nonce is 1 or 2, by initialization and reservation.
A transition either carries the witness unchanged, or overwrites it from the
actual pre-transition store and sets `touched` to its affected nonce. P is
idempotent, and for every transition T from those reachable states with the
same choice of parameters, P(T(P(s))) = P(T(s)). The implementation applies
P at all seven witness-writing sites. Carrying an already canonical witness
requires no extra transition. All original enabled choices remain enabled.
The initial state is fixed by P. Thus the projected reachable graph contains
the P-image of every original reachable state, without dropping actual
journal/control states or reducing any actor, nonce or request-ID domain.

The invariant reads `before` only at indices other than `touched`; when
`touched` is zero that clause is inactive. Therefore I(P(s)) is equivalent to
I(s). The ownership implication is retained verbatim, and the untouched-cell
comparison still compares the actual store with its real pre-write value.
No invariant is replaced with a self-comparison or assumed Boolean. This is
a property-preserving normalization of an auxiliary witness, not a proof of
arbitrary browser storage or source refinement.

The projected model passes the unchanged normal gate: type checking, all 15
named scenarios and 500 seeded traces of at most 60 steps. Its 180-second TLC
run is still incomplete. The last progress report records 8,836,601 generated
states, 2,015,095 distinct states, depth 8 and 1,630,464 queued states. No
invariant violation was reported before termination. The source and mapped
runtime hashes remained unchanged. This result does not establish completed
finite verification; the projection argument does not turn a nonempty queue
into a successful checker result. All three incomplete receipts are retained.
