# Binding veto budgets and authority rotation

`payment_binding` previously represented cancellation as a boolean.
`authority_rotation` represented authority change and retained signed sends.
Neither represented the cancellation count, its reset on payment, or the
different rotation predicates that waive the cap in EVM and Solana.
`binding_veto_policy.qnt` adds that composition without changing production.

The model has one project/actor, eight increasing binding versions, two awards,
four clock values, and delay zero or one. The delay is a relative representative,
not a change to the deployment setting. It separates the current binding from
the paid binding version and retains canceled versions. A replayed veto cannot
increase the count twice. A new binding does not reset the count. Successful
payment resets it; a canceled binding cannot pay, and a binding that already
paid cannot be vetoed even when a new award opens a commit window.

The normal cap is three. EVM waives it while an identity-authority proposal is
pending. Solana requires both a pending proposal and independent confirmation.
Waived vetoes do not consume the normal count. Canceling or executing the
rotation removes that waiver with the old count intact. This model assumes a
valid rotation transition; role authentication and rotation waiting periods
remain with the existing authority models and real contract tests.

A veto requires either the binding review window or an award commit window.
In EVM the latter uses the actor's last commitment timestamp. In Solana it
requires the matching unpaid obligation account to be supplied. A zero-delay
binding has no veto window, including while a rotation is pending; the cap
waiver does not extend time. Boundaries use strict less-than for veto and
greater-than-or-equal for payment maturity.

Signature checks, account derivation, token transfer and all monetary amounts
remain outside this control model. Payment is a successful atomic contract
transaction; a failed transfer cannot reset the counter in the implementation.
The model does not replace those transaction/asset tests or prove arbitrary
version histories.

## Conformance

The existing `BindingLifecycleTest` and `BoundedAttesterTest` Foundry suites pass
27 cases on the unchanged EVM source. They exercise pre/post-payment budgets,
proposal cancellation, waiver without consuming count, owner authority,
binding/commit windows and old-version refusal. No test duplicate or new
production guard was needed.

The current native Solana run has independently completed the named
`commit delay, rotation freezes the earlier wallet, veto cap, bounded delay,
project-scoped bindings, bind and fee checks` and `veto cap is waived during a
confirmed authority rotation and resumes after it` cases. Those checks used
the newly compiled local test ELF and unchanged Rust source; the whole native
suite was still running when this audit was written. The two case results do
not claim a full native-suite pass or public-network acceptance.

Eleven named scenarios and the initial selected type/scenario/simulation check
passed. A twelfth explicit duplicate-veto scenario was added afterward and was
not rerun. The finite verifier was stopped at the user's instruction to skip
remaining checks and prioritize pushing. That interrupted run is not a
verification pass. Its partial receipt and the earlier check output remain
under ignored `evidence/formal/binding-veto/`. The final model needs a fresh
full check before any verified-completion claim. Root integration must refresh
the global source and model inventories.
