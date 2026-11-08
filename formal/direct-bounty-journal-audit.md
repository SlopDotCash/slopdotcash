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

## Model and limits

`direct_bounty_journal.qnt` models two instances, two nonces and three prompt
identities. Seven authored scenarios describe cross-leg merging, same-nonce
ABA completion/rejection, duplicate-prompt refusal, failed marker/hash writes
and a retained legacy candidate. None has been executed.

The synchronous read/modify/write assumption covers cooperative component
instances in one JavaScript context. It is not a cross-process storage lock,
and separate tabs normally have separate session storage. This change does
not make external wallet promises cancelable or prove that all possible
manual storage edits are safe. Original actor authorization, nonce checks,
chain proof and server-side generation checks remain separate boundaries.
The old wallet promise can still complete after unmount; its narrowly owned
journal update preserves evidence without discarding another leg.
