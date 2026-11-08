# Expired-message history UI

`SolanaBountyRecovery` does not send transactions. The previous `ui_transaction`
mapping incorrectly associated it with pre-send persistence and a paid-state
transition. That source mapping is removed. `ui_solana_history_recovery` covers
its actual protocol; the ordinary payment components keep their own model.

The parent first checks private-session identity, current case authority,
recovery generation and exact message list. The child connects the original
payer's message-signing wallet. It reads an actor/case/generation-scoped session
cache, checks authority and identity before each message, signs missing exact
message bytes, and caches each signature **after** the wallet returns. A failed
cache write becomes a visible error and stops verification. A later retry may
need another message signature; no transfer is sent by this operation.

An outstanding wallet prompt cannot be canceled by this component. If its view
closes while that prompt is open, its eventual signature can still be stored
under the old actor's cache key. The next parent authorization prevents a
private verification request from that departed view. This is represented in
the model rather than incorrectly asserting that every write stops on unmount.

After all signatures are collected, the parent checks recovery authority again.
The final private POST independently checks actor identity and supplies the
captured case revision. A revision can change between those checks; the server
must reject that stale revision. The model separates these events. A history
request, wallet signature, or cached signature is not paid/finalized evidence.
Backend retirement, chain history and cryptographic validation are covered by
`direct_solana_retirement` and the actual backend workflows, not this UI model.

The finite model has two messages, one fixed case/generation cache, two actors
plus sign-out, one generation/message-list replacement, at most four wallet
prompts and two verification requests. Bounds stop further exploration; they
are not application retry limits. Foreign-key and mismatched-message cache
entries cannot replace the exact-message entry used here. DOM interaction,
wallet implementation, storage availability and backend results are inputs.

Quint 0.33.1 passed type checking, 13 named scenarios and 500 seeded traces of
at most 60 steps. TLC completed 13,328 distinct states, 112,899 generated states,
depth 50 and an empty queue with unchanged model/source hashes. This is finite
exploration, not mechanical React refinement or proof of external wallet truth.

The browser conformance fixture is a synthetic case captured from the actual
local `handleSecurityApi` workflow after its retained payment message expired.
`tests/e2e/solana-history-recovery.spec.ts` loads the normal built Security page,
uses its parent/child controls and real session storage, and supplies controlled
HTTP and message-wallet replies. It checks failed-verification retry across
reload, identity change during a prompt, and storage refusal before POST. The
wallet response is deliberately not claimed to be a valid payer signature;
the native backend workflow provides separate signature and chain evidence.
Browser results and any initial probe errors are recorded separately under
ignored `evidence/formal/solana-history-ui/`.

The initial conformance run passed all six Chromium desktop/mobile cases with
zero unexpected, skipped or flaky results. The final whole-head browser gate
will repeat the committed test, whose connect locator was narrowed afterward
to the history panel. Application runtime bytes were unchanged during this
focused run. Controlled HTTP failure is declared explicitly; it is not counted
as successful backend verification.
