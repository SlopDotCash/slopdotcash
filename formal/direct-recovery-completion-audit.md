# Direct-payment recovery completion fence

Source-only review at `d6323d9f` found a stale-successor path. Recovery captured
reporter wallet B and its consent, then awaited chain reads. A reporter could
register and authorize wallet C during those reads without changing the case
revision. The second `directRecoveryConsent` read returned the current marker,
but `recoverDirectIntent` discarded it. Its successor still used B, and the
completion SQL checked only the case event. The successor could therefore
commit and immediately appear held because B was no longer current.

This is a stale recovery-state finding. No unauthorized payment or new money
movement was reproduced. Existing transfer verification deliberately accepts
matching finalized transfers to the frozen earlier destination even after a
wallet change; that behavior is preserved.

The correction compares the second marker with the captured proposal. It also
carries a completion predicate into the existing case-revision CAS. That SQL
predicate checks the current direct-payment generation and, for an unpaid
researcher leg, the captured authorized claim ID, digest, actor and chain. A
replacement claim also requires the exact recovery-consent marker. The same
predicate guards successor insertion, whose event witness additionally names
the recovering payer actor. A wallet change during later chain work therefore
returns `payment_recovery_changed` without advancing the case or successor.

Fee-only recovery skips the current reporter-wallet predicate because that
leg is already paid and must retain its immutable destination. Existing
retirement proof, original-payer checks, paid-leg triggers, reserved nonces and
partial transfer receipts are unchanged. Immutable recovery scan evidence may
still append before the final transaction; the fence prevents stale case and
successor completion, not observation of public chain history.

`direct_recovery_completion.qnt` isolates the boundary across one request,
three reporter wallets, two generations and bounded case revisions. Nine
named scenarios describe stable completion, changes before/after the second
read, generation/revision races, lost wallet authorization, actor-mismatched
events and fee-only recovery after a reporter wallet change. Retirement and
chain correctness remain external predicates covered by their existing models.

The original source-only patch was prepared without checks, as requested in
that chat. Independent validation in the LemmaScript integration subsequently
reproduced the race with real local Anvil, migrated SQLite and the private API:
the original source returned 200 and appended one stale successor; the fixed
source returned 409 with no successor, case revision or case-event change.
The complete five-scenario direct-payment integration then passed for native,
token, USDC, USDG and full-award payments. Type checking and scoped style checks
also passed. No public-network payment was performed.

The initial finite model bound `revision <= 4` failed exhaustive checking:
two prior case actions, another generation, and the recovery commit can reach
revision 5. The corrected bound includes that composed path and a named
regression; no transition or wallet/consent condition was removed. All nine
model scenarios and exhaustive TLC checking now pass: 3,416 distinct states,
16,955 generated states, depth 13 and no states left queued. The receipt
reports unchanged source/model/tool inputs. These are finite abstract-model
checks, not proof of implementation refinement or live chain availability.

The before/after logs, full integration output and model receipt remain under
ignored `evidence/recovery-fence/` and `evidence/formal/` in the isolated
validation worktree.

The isolated validation used the broader proof branch plus this recovery fix.
Its model, handler, wallet-registration and migration hashes match the local
follow-up. The full `direct-payments.ts` hash does not: that proof branch
extracts EVM recovery planning into `verified-direct-recovery.ts`. The
completion-fence code matches by source comparison, but this is not a byte-for-
byte whole-file or whole-branch validation claim. Preserve the extracted proof
implementation when rebasing and repeat the combined-head checks separately.
The later initial-preparation fence has its own source audit and is not covered
by this earlier recovery receipt.
