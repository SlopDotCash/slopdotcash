# Earnings account binding

This source-only change preserves the earlier wallet-operation lifetime fix.
No tests, parsers, type/lint/format checks, simulations, verifiers, applications
or browsers were run. Ten new actor-model scenarios and four new browser
scenario definitions remain unexecuted.

## Confirmed cross-account path

`EarningsPage` could load account A, wait for a wallet connection, and then
continue with a still-mounted component after its cookie changed silently to
B. Its operation counter had no account identity. Registration carried no
expected actor, so `handlePaymentsApi` authenticated B and
`registerPaymentWallet` correctly appended B's claim. The next B-owned
challenge matched the selected address/chain and could prompt for a signature
before authorizing B. The same transition could occur between family chains.

This did not bypass a wallet signature or let B authorize A's existing claim:
challenge and authorization queries already bind claim ownership to the
authenticated actor. The missing constraint was that the user action still
belonged to the account that started it.

## Source correction

Every wallet flow captures `data.githubUserId`. Replacement consent retains
that same actor. Fresh session observations gate the initial connection,
registration, challenge, message signing, authorization and the next chain.
Actor mismatch or sign-out clears cached account data, picker and replacement
state and invalidates the wallet operation. A /me response also receives a
final current-session comparison before replacing cached data.

Actor-specific requests carry `x-slop-expected-github-id`. After the payments
handler's existing session resolution and original signed-out response, the
shared `requireActor` enforces the optional header before authenticated
dispatch. Missing headers retain session-only compatibility; malformed
headers refuse with 400 and valid mismatches refuse with 403. Public payment
reads remain before this private admission boundary.

An accepted A registration or authorization remains an A record after a
cookie change. Client refusal does not roll it back. Existing per-claim
signature/currentness checks and downstream payment behavior are unchanged.
No payment is signed, broadcast or declared finalized by this correction.

## Models and authored conformance

`ui_earnings_actor_binding` composes one initiated wallet flow with two actors,
two representative chains, fresh session observations and server admission
of captured expected-actor headers. It distinguishes accepted server facts
from delivered responses and subsequent prompts. The existing
`ui_earnings_wallet_lifetime` retains the two-operation/departure interleavings;
`api_payment_wallet_protocol` retains claim/challenge/currentness mechanics.
Signature validity, account parsing, exact message bytes, D1 transactions and
unbounded operation histories remain external boundaries, not new proof claims.
The actual EVM family has three chains; two represent the first-to-next
transition here, not a production limit. A cookie can still change after a
fresh session observation and before a wallet prompt. The model permits that
order: the prompt carries the already prepared A message, while the server's
expected-actor admission prevents it from becoming a B mutation. This change
does not claim continuous identity observation or cancellation of an open
wallet prompt.

The existing browser-lifetime file gains silent actor changes while connection,
challenge or accepted authorization waits, plus a swap between the last
session check and registration admission. Its HTTP/provider doubles enforce
the expected header and retain the earlier A authorization. These are authored
browser regressions, not executed or live-provider evidence.

The existing real SQLite wallet-replacement test file gains a handler workflow
for mismatch refusal before claim/challenge/authorization writes, unchanged
challenge consumption on refusal, matching-actor signed authorization,
malformed-header refusal and absent-header compatibility. This test also
remains unexecuted.
