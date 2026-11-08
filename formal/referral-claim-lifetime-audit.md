# Referral claim lifetime and local storage

This source-only correction covers `ReferralClaims.tsx` and the optional
Storage argument of the existing pending-attempt helpers. It does not activate
referrals or change a contract, amount, review, proof, wallet, or network gate.
The backend still returns an enabled view only when the existing program cache
and live accrual record are present. No tests, parsers, checkers, simulations,
provers, applications or browsers were run. All twenty named scenarios in
`ui_referral_claim_lifetime.qnt` and five added browser definitions are unexecuted.

The old component could continue from review RPC to a wallet prompt after
departure. A late wallet hash or rejection unconditionally wrote or removed
the localStorage key shared by the program, distributor and wallet. A new view
could explicitly reset that key and start another request before the old
wallet result arrived. Its newer marker could then be overwritten or deleted.

The correction uses mounted/action/scope ownership before a new prompt and for
UI publication. Each new stored request has an optional, backward-compatible
UUID attempt ID. New requests create only an empty slot. Wallet results update
only their own attempt; declines and verification delete only their captured
record. A known hash whose write failed remains in the mounted view, separately
from its last persisted record, so later verified cleanup compares the payload
actually stored. Legacy records remain readable; unknown or malformed records
do not authorize a send. An older legacy record cannot confirm a newer local
claim by its smaller cumulative amount.

All mutations use a per-key, exclusive Web Lock with `ifAvailable`. The send
holds it through preflight, wallet completion and its record update. A second
view cannot send or reset while that operation is active, including after SPA
departure. It receives an explicit refusal. A wallet result that returns after
departure may still update or clear its own record under that lock; it cannot
publish into the departed view. When the request completes, or its browser
context terminates, a later view may explicitly reset an unchanged record after
checking wallet activity. Termination is not proof that no transaction was sent.

The action counter changes on connect, send, reset and unmount. A refresh
revision does not itself invalidate an action; the visible Refresh control is
disabled while busy. Its read effect has its own abort lifetime, and an action
also checks the current program/distributor/wallet scope before a new prompt.

Automatic verified cleanup uses the captured stored payload after the observed
claimed total covers the retained claim. It acquires the same lock and compares
the complete payload immediately before removal. A different UUID or updated
hash makes that comparison fail; the handler retains and rereads the current
record instead. No unobserved replacement is deleted by that path. A storage
read failure may retain the last known in-memory hash and captured payload,
but deletion still requires a working read and exact match. A fresh inaccessible
record cannot be explicitly reset until its bytes can be observed.

Browsers without Web Locks refuse send, reset and automatic record deletion;
they may still show the verified amounts and retained transaction. Storage
read/write failures remain explicit. Failed deletion does not claim that the
marker was removed. Locks serialize cooperating same-origin contexts; they do
not protect against older deployed bundles, developer tools, extensions, or
other uncoordinated writers. UUID and exact-record comparisons fence those
lost-ownership tails where the value has changed. No new history sidecar or
unconditional all-transaction retention claim is introduced.

The finite model uses two views, two UUIDs, two cumulative amounts and seven
record classes (empty, legacy, each UUID with/without hash, unreadable). It
separates SPA departure from context termination, lock ownership from storage
ownership, and verified amount from a captured record. `externalReplacement`
is an explicit uncoordinated-writer boundary, not an action performed by the
current UI without a lock. The model abstracts raw JSON into exact record
classes and groups failed storage mutations. The blocked-read fallback to a
previous in-memory snapshot is source-reviewed and covered by an existing
browser definition, not a distinct read-availability state in this model.
It does not prove browser lock fairness,
UUID entropy, arbitrary byte parsing, contract truth, RPC freshness, or provider
delivery. Existing `referral_claim_review` and contract models retain those
financial and authorization boundaries.

Five added definitions in `tests/e2e/referral-claims.spec.ts` use the existing
rendered `/earnings` fixture with explicit wallet/RPC doubles: overlap refused
during a held preflight followed by departure, cross-view reset refused during
a held wallet request and allowed after completion, cleanup after a departed
wallet rejection, unsupported-lock refusal, and hash-write failure followed
by exact-record verified cleanup. The six existing definitions retain
successful claims, stale/paused/unknown refusal,
storage failures, unreadable-record recovery and older-record protection.
None is current runtime evidence, and none enables a real referral program.
