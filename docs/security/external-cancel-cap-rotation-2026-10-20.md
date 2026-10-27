# Owner cancel cap shortens the authority-rotation cover (externally reported)

**Status:** fixed in `617de6e8`, which is part of the mainnet deployment source `bce5b0df` (24 October 2026). No funds were at risk before the fix: nothing was deployed on mainnet and every project had payments disabled.
**Reported by:** an outside security firm, by email to the Operator, 20 October 2026; credit withheld until the reporter agrees to be named. External, unsolicited report; no engagement or payment is attached to it. This is not an audit of the contracts.
**Reporter's severity:** Medium. **Lead assessment:** Medium, agreed: it needs a stolen identity authority key (review finding H-1) plus one earlier cancel on the target actor with no payment since, and it is bounded to that actor's committed awards.
**Verified by:** Drew Pierson on `development` at `42c62a7`, by reading `contracts/evm/src/ProjectEscrow.sol` and `contracts/solana/programs/slop-escrow/src/lib.rs` and by the failing Foundry test below.
**Affects:** both chains. EVM `ProjectEscrow.cancelBinding` (`MAX_CANCELS_BETWEEN_PAYMENTS`, `cancelCount` reset only in `pay`); Solana `veto_binding` (`MAX_VETOES_BETWEEN_PAYMENTS`, `veto_count` reset only on payment).

## Finding

The key-compromise runbook in both contract READMEs, the registry check in `src/lib/escrow-policy.mjs` and `test_H1_stolenAuthorityCannotTakeAnAward` all assume the owner has three cancels available when the identity authority key is stolen: three cancels, each late in a 48-hour delay, plus the fourth binding's own delay cover 8 days, longer than the 7-day rotation notice.

The counter resets only on a payment. If the owner had already cancelled once for an actor (a routine retraction of a wrong wallet, say) and no award to that actor has paid since, only two cancels remain. Two cancels and the third binding's delay cover 6 days. A stolen key can then bind an attacker wallet a third time on day 4, the owner's cancel reverts with `CancelLimit` or `VetoLimit`, the binding activates on day 6, and `pay` sends every committed award for that actor to the attacker before the rotation executes on day 7. With two or three earlier cancels the cover is 4 days or 2 days. After the rotation, the owner still cannot cancel for that actor until a payment, so the new authority's corrective binding is the only remedy.

Resetting the counter when the rotation executes would not help: the race is over before execution.

## Fix

The cap exists to bound a griefing owner's power to delay a contributor. It should not bound the owner during a key compromise, which is a public event the owner cannot stage alone.

- **EVM:** `cancelBinding` skips the `CancelLimit` check and does not increment `cancelCount` while `factory.pendingIdentityAuthority()` is set. Only the registrar can propose a rotation, and it is public for 7 days, so the owner cannot use the waiver on its own. When the rotation executes or the registrar withdraws it, the cap applies again with the count the owner had before.
- **Solana:** `veto_binding` skips the `VetoLimit` check and does not increment `veto_count` while `pending_identity_authority` is set **and** `rotation_confirmed` is true. The owner alone proposes a rotation there, so a bare proposal must not lift the cap: an owner could park an unconfirmed proposal forever and veto without bound. The fee recipient's confirmation is the second signature the owner cannot produce. The runbook therefore tells the fee recipient to confirm at once, within one binding delay of the proposal for an actor whose vetoes are already spent.
- **Counter:** a waived cancel or veto is not counted. Counting it would spend the owner's post-rotation budget on cancels the attacker forced, and could overflow the `uint8`/`u8` under a fast-rebinding attacker.
- **Registry check:** the "rotation delay shorter than four binding delays" check in `src/lib/escrow-policy.mjs` stays as defence in depth, so that with no earlier veto the capped vetoes alone still outlast the notice on Solana before the confirmation lands.

## Evidence

- `contracts/evm/test/BoundedAttester.t.sol`: `test_H1_stolenAuthorityCannotTakeAnAwardAfterPriorCancel` runs the H-1 sequence with one earlier cancel on the actor and no payment since. On `42c62a7` it fails at the third attacker cancel with `CancelLimit()`; with the fix it passes and the attacker's balance is zero. `test_cancelCapStillAppliesWithoutPendingRotation` and `test_cancelCapResumesWhenRotationIsCancelled` show the cap is unchanged outside a pending rotation and returns, with the count unchanged, when the registrar withdraws a proposal.
- `contracts/solana/integration/escrow.e2e.mjs`: "veto cap is waived during a confirmed authority rotation and resumes after it" runs the same sequence on a local validator under the `short-delay-for-tests` build, including the unconfirmed-proposal case where the cap still applies.

## Not changed

The PRD of that date (PAY-05 and its section 22 "Payout execution authority" row) still described the owner's cancel during the delay accurately and was not edited here. No deployment, registry entry, adapter or executor changes; the instruction signatures and the Solana IDL are unchanged. The 12 October review report carries a pointer to this entry under H-1 and M-2.
