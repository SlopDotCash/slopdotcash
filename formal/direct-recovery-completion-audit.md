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
three reporter wallets, two generations and bounded case revisions. Eight
named scenarios describe stable completion, changes before/after the second
read, generation/revision races, lost wallet authorization, actor-mismatched
events and fee-only recovery after a reporter wallet change. Retirement and
chain correctness remain external predicates covered by their existing models.

The user instructed the team to skip checks and focus on pushing. No tests,
syntax/type checks, formatter, model scenarios, simulations or verifier were
run for this change. This is an unvalidated source-level correction; the
concurrent-handler/SQLite workflow still requires execution when checks resume.
