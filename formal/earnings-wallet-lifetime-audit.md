# Earnings wallet-operation lifetime

This source-only correction starts from `7f03f6b59`. It changes only the
existing wallet-confirmation flow in `src/Earnings.tsx`; layout, labels, wallet
selection, replacement consent and per-chain authorization remain unchanged.
No tests, type/syntax/lint/format checks, model parser, simulator, prover,
application, or browser was run. All sixteen named model scenarios and the
three new browser regression definitions are unexecuted.

## Confirmed source path and correction

`connect` previously waited for `chosen.connect`, then called `registerFamily`
without checking whether the page still existed. Only the different-address
consent branch checked `mounted`. With no saved address, or the same address,
a visitor could start connection, leave through the normal Home link while
the wallet waited, and have the departed page initiate registration,
challenge acquisition and a message-signature prompt afterward.

The family loop and `register` also lacked checks between awaited steps. A
visitor leaving while a challenge waited could still receive a new signature
prompt. Leaving while the first chain's authorization waited could start
another chain's registration and prompt. Guarding only final text and refresh
did not stop those later operations.

Each `walletStep` now captures an operation number and the existing mounted
lifetime. Unmount advances that number; a later wallet operation also owns a
new number. The predicate is passed through connection, registration and the
family loop. The implementation checks it after connection, after registration,
after challenge delivery, after a returned signature, and before each next
chain. The same predicate fences error, busy, message and refresh updates.

An HTTP request already sent is not canceled, retried, reversed, or assumed
unsuccessful. An accepted registration or authorization remains in the API.
A signature that returns after departure does not initiate a new authorize
request. A completed authorization that returns late does not start the next
chain. The next mounted account view can read already accepted records.
The existing backend remains the authority for account and wallet ownership;
this lifetime predicate grants no authority and does not infer it from an
address or wallet response.

## Source-to-model relation

`ui_earnings_wallet_lifetime.qnt` models two component lifetimes, two operation
numbers, and two representative family chains. The implementation currently
offers one Solana chain and three EVM chains; the two-chain abstraction exposes
the first-to-next-chain boundary and does not claim a two-chain production cap.

| Implementation | Model transition |
| --- | --- |
| `walletStep` captures the operation and guards error/finally updates | `connect`, `failure`, `owns` |
| Selected provider returns a connection or a different-address consent step | `connectReply`, `confirmReplacement`, `keepSaved` |
| `registerFamily` checks before each chain | `register`, `authorizationReply` |
| Already confirmed matching addresses skip new requests | `existingConfirmed`, `skipConfirmed` |
| `wallets/register` may accept before its response returns | `acceptRegistration`, `registrationReply` |
| A valid challenge is required before message signing | `requestChallenge`, `challengeReply`, `requestSignature` |
| A returned signature is required before sending authorization | `signatureReply`, `requestAuthorization` |
| Authorization can be retained independently of current UI ownership | `acceptAuthorization`, `authorizationReply` |
| The component leaves or a new operation replaces its old continuation | `depart`, `remount`, a new `connect` |

Registration and authorization acceptance are separate from response delivery.
They may occur after the caller leaves or sees an error; the model does not
erase them. An old continuation can settle but cannot reset the current
operation's busy/error state. The raw handler functions have no independent
synchronous busy lock; the model admits replacement of an operation rather
than assuming a render-level disabled button proves one invocation forever.

The model treats valid challenge shape, signature/cryptographic checks,
session/actor authorization, wallet provider identity and server request
atomicity as existing external contracts. It does not model the wider payout
read, every account-refresh interleaving, or infer a fresh authenticated actor
from this operation number. Exact per-chain message strings and Ethereum
signature bytes remain backend/provider conformance boundaries.

## Browser regression definitions

`tests/e2e/earnings-wallet-lifetime.spec.ts` uses the actual `/account#wallets`
route and its Home link, with explicit provider/API doubles like the existing
`payout-wallet-picker.spec.ts`:

- Hold `eth_requestAccounts`, leave through Home, then release it. Require no
  registration, challenge, authorization or message signature.
- Hold challenge delivery after registration, leave, then release it. Preserve
  the registration request and require no message signature or authorization.
- Hold an already accepted first-chain authorization, leave, then release its
  reply. Preserve that accepted wallet, require no second-chain request, and
  remount Account to read its confirmed state.

The tests retain the same browser document during departure so the old wallet
promise can settle. They observe provider calls, API paths, retained fixture
state and the remounted UI. Existing wallet-picker definitions still cover
normal three-EVM/one-Solana completion, replacement consent, declined signatures
and partial confirmation recovery; none was run here. The new definitions are
not real-provider, live-session, blockchain or end-to-end production evidence.

Before/after browser recordings and current-source runtime results remain
pending under the user's instruction to skip execution. Source inspection
establishes the missing and added guards, not a runtime pass.

The later source-only account-binding follow-up is documented in
`earnings-actor-binding-audit.md` and `ui_earnings_actor_binding.qnt`. It adds
captured/fresh actor checks and backend expected-header admission. The
lifetime model remains focused on operation ownership; its earlier external
actor boundary must not be read as proof of that later composition.
