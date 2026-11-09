# Owner vault setup lifetime and retained requests

This change and its model/regression source were authored without running
tests, parsers, type checks, format checks, simulations, verifiers, browsers
or services. The 18 named Quint scenarios remain unexecuted.

## Confirmed source traces

The original `OwnerVaultSetup.create` awaited wallet identity checks and a
fresh server review, then saved a pending record and opened the wallet with
no departure check. Leaving the SPA while that final review waited could
therefore open a new creation prompt after the component was removed.
`connect`, review publication and registration completion had the same
missing component/action ownership boundary.

The original storage helper wrote or removed the entire project/purpose key
without comparing the record it had read. A wallet promise from component A
could remain open while a later component explicitly cleared A's unknown
request, reviewed again and saved B. A's later hash overwrote B, and A's
later 4001 rejection removed B. A registration completion also removed the
key after awaiting its parent callback, without checking for a newer record.

## Correction and ownership

Each connect/review/create/register action captures a monotonically increasing
component-local action identity. Component removal invalidates it. Awaited
preflight results cannot start another API request or wallet prompt, publish
a review or call `onRegistered` after departure or supersession. The existing
load effect retains its separate active flag. Changing a wallet, network,
automatic choice, recovery hash or review also invalidates the old action;
this does not rely on the shared hook keeping every control busy.

New pending records have an optional-on-legacy `attemptId`, using the existing
`pending-attempt` helpers. Reservation is synchronous immediately before the
EVM send or Wallet Standard send callback. A failed storage reservation stops
the prompt. A late wallet result can retain its hash after departure only if
the complete stored record still matches its captured reservation. A 4001
removes only that exact reservation. Unknown outcomes retain the request.

Registration first compares and saves the exact captured record with the
selected recovery hash, then rechecks those stored fields after the API
reply before it can notify the parent. An unchanged legacy record without an attempt ID is
still recoverable. A returned pending result retains the request; a departed
registration result does not notify the parent. Once a current validated
registration has invoked its parent callback, cleanup can remove its exact
record even if that callback removed the component. It cannot remove a
different hash or successor written while the callback awaited.

If saving a returned wallet hash fails, the current view keeps the hash in
its recovery input and notice. It does not overwrite an unverified successor
record with an in-memory copy. A later registration must again pass the exact
storage comparison. A page reload after a failed write cannot reconstruct
an unsaved hash; wallet activity remains the recovery authority.

## Model and evidence boundary

`ui_owner_vault_setup` uses two component lifetimes, seven monotonically
identified actions, two hash values and one project/purpose storage key.
It covers connect/review/preflight/send/register, explicit unknown-request
clearance, legacy recovery, pending completion, write failure and old-result
interleavings. Creation transaction identity, provider trust, chain identity,
server authority, registration finality and valid hash syntax are external
predicates supplied by the existing helpers and backend. The model does not
prove those predicates, unbounded retries, React scheduling or the generic
`useAction` hook's busy/error continuation ordering. Storage comparisons are
synchronous within one browser document; this does not establish an atomic
transaction across separate browser processes.

The existing gated **owner creates, registers and funds a vault through the
real API** workflow in `tests/e2e/vault-actions.spec.ts` retains its local
Anvil, actual registry/SQLite API, wrong-transaction, interrupted-result,
pending/finalized registration, revision and funding assertions. Added source
holds a real fresh-review response while navigating through SPA Home, then
requires no send or pending reservation after release. It also holds a 4001
wallet reply across departure, explicit recovery clearance and a new real
creation attempt, then requires the newer saved bytes to remain unchanged.
These additions have not been executed. Connect/review-only supersession,
late registration callbacks, storage failures and legacy exact-record
interleavings have authored model scenarios but no new runtime receipt here.
