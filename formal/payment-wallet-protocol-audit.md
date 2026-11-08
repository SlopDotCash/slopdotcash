# Payment wallet authorization protocol

This is a focused review at source checkpoint
`5f7841ba3550e7a6d877f836f8c99cb698c242ce`. The current global
`formal/inventory.json` remains the source-hash authority after integration.
The new `api_payment_wallet_protocol` model is distinct from
`api_wallet_claims`: that older module covers the trace possession route, whose
invalid-proof consumption behavior does not describe the payment API.

## Source and transition boundary

- `backend/payments/wallet-registration.ts`: registering the current registry
  address returns the same claim; a changed address appends a successor.
  `backend/trace/cloudflare-persistence.ts` provides the atomic insert/history
  boundary. The model uses its successful serialized outcome.
- `backend/payments/handler.ts`, `/wallets/challenge`: only the authenticated
  actor's current registry claim can receive a challenge. The immutable message
  binds actor, chain, address, claim, claim digest, nonce, and expiry.
- `backend/payments/possession.ts`: signature verification uses that stored
  message and the stored wallet address. Bad signatures leave a live challenge
  unconsumed. Address and exact-message predicates in the model abstract the
  reviewed EVM/Ed25519 verification and encoding implementation.
- `/wallets/authorize`: a successful read is followed by consume-once UPDATE,
  then a separate authorization/outbox batch, then an effective-claim read.
  Replacement can intervene. Consumption does not imply authorization. An
  atomic batch failure leaves the challenge consumed and returns 503. Requesting
  and signing a new challenge can recover. A concurrent second consumer returns
  409; replay after consumption returns 403. Authorization records remain
  immutable; another successful consent does not rewrite the first record.
- `migrations/0011_payments.sql` supplies the consume-once/immutable constraints.
  `migrations/0100_effective_payment_wallets.sql` retains an authorized ancestor
  until a descendant is authorized; merely registering a new intent does not
  replace a verified destination.
- `tests/authorize-fixture-wallet.ts` uses the real register/challenge/authorize
  protocol and checks response chain/address before signing. It neither
  bypasses the signature check nor declares success from registration alone.

This API grants wallet authorization. It does not sign a transaction, submit a
payment, establish finality, or mark an obligation paid. Dispatch/outbox money
semantics remain in their separate models; this module makes no payment claim.

## Time semantics and limits

The handler captures `now` once at the start of each HTTP request. Both its
challenge read and later consumption compare against that same value. The model
therefore permits a request admitted before expiry to consume after wall-clock
expiry. This is **request-admission semantics**, not proof of freshness at the
time of consumption. The existing fifteen-minute-message description does not
by itself settle whether a queued request must fail at consumption time. No
policy tightening or production change was made.

The finite model has one actor/chain partition, a foreign caller, two addresses,
two append-only claims, two challenges, two concurrent authorization requests,
and time 0 through 2. One time step stands for the challenge lifetime; fresh
challenges expire one step after issuance. UUID/message bytes and signature
mathematics are external predicates. Refused actor/signature/message requests
share an equivalent 403 transition in random/exhaustive exploration; named
scenarios exercise those individual inputs explicitly. Claim retention and
effective destination are modeled, but arbitrary history depth, legacy
non-registry import, cross-partition isolation, registration conflict/retry,
database transport consistency, and complete SQL/parser refinement are not
proved by this module. The earlier effective-wallet and persistence models
remain complementary, rather than being replaced by this model.

## Implementation conformance

The unchanged real handler suite
`backend/payments/wallet-replacement.test.ts` passed **7/7** with pinned
Bun 1.3.14 and the ordinary `--timeout 30000`. It includes generated wallet
histories and actual migrated SQLite/D1-adapter registration, signatures,
replacement, replay, expiry before request, destination continuity, and first
authorization retention. This is existing implementation evidence, not a new
unit test that repeats the implementation.

A disposable evidence-only probe also called the real handler over the complete
migrations and used the new `authorizeFixtureWallet` helper for recovery. It
controlled actual D1 await boundaries, without changing handler source:

1. A challenge admitted at 16:00 with expiry 16:15 returned 200 after the probe
   moved the clock to 16:16 following the successful challenge read. The consumed
   timestamp remained the request-start value, as the source specifies.
2. Injecting a failed atomic batch after consumption returned 503, left no
   authorization, refused replay with 403, and recovered with a newly signed
   challenge through the shared fixture helper.
3. Calling actual replacement registration after consumption made the old
   authorization return 409 without an authorization row. The current wallet
   recovered through a fresh challenge and the shared fixture helper.

These are controlled real-handler/SQLite observations, not a live D1 concurrency
or external-wallet/chain test. The probe initially expected a generic 500, found
the actual 503, and corrected the model response. Its initial failed assertion
and the canceled pre-correction verifier are retained with the passing probe
evidence in `evidence/formal/payment-wallet/`. No application defect is inferred
from that model correction.

## Verification

The module has **17 named scenarios**. Quint **0.33.1** typechecking and every
scenario passed, as did **500 seeded traces of up to 60 steps** (seed 20261107).
Safe local-translation TLC with Java **21.0.10**, two workers and a 2 GiB heap
completed in **30.9 seconds**: **146,300 distinct states**, **1,887,817 generated
states**, **depth 19**, and an empty final queue. Source hashes stayed unchanged.
These runs are recorded in
`evidence/formal/checks-api_payment_wallet_protocol.json` and
`evidence/formal/verification-api_payment_wallet_protocol.json`. The checked
model SHA-256 is
`07dd407b3b4678adf19aa4d252ababfaa848ed1cca57292fb0daca718b4593a7`.

The three controlled handler probes are additional local implementation
evidence. The two simultaneous consumers are explored in the model; this pass
did not run an additional concurrent remote D1 test. The initial verifier was
canceled for the status correction and is excluded from the passing result.
Model passes do not prove implementation refinement or absence of all state
errors. No runtime source or existing test assertions were changed.
