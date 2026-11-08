# Binding veto budgets and authority rotation

`payment_binding` previously represented cancellation as a boolean.
`authority_rotation` represented authority change and retained signed sends.
Neither represented the cancellation count, its reset on payment, or the
different rotation predicates that waive the cap in EVM and Solana.
`binding_veto_policy.qnt` adds that composition without changing production.

The model has one project/actor, eight increasing binding versions, two
sequential awards, four clock values, and binding delay zero or one. Solana's
rotation delay is separately zero or one; EVM's checked-in rotation delay is
zero. These are relative representatives, not changes to deployment settings.
The model separates the current binding from
the paid binding version and retains canceled versions. A replayed veto cannot
increase the count twice. A new binding does not reset the count. Successful
payment resets it; a canceled binding cannot pay, and a binding that already
paid cannot be vetoed even when a new award opens a commit window.

The normal cap is three. EVM waives it while an identity-authority proposal is
pending. Solana requires both a pending proposal and independent confirmation.
Waived vetoes do not consume the normal count. Canceling or executing the
rotation removes that waiver with the old count intact. Solana execution
requires both confirmation and the effective time; duplicate confirmation is
refused. Cancellation and execution clear the pending proposal's effective
time and confirmation. A subsequent proposal has a fresh effective time.
EVM has no confirmation operation and can execute at proposal time. Role
authentication and candidate identities remain with the existing authority
models and real contract tests.

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
version histories. It has at most one unpaid award at a time. The source can
have concurrent unpaid awards and pay an older matured award during a newer
award's commit window; that multi-award ordering is not enumerated here.

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

For the earlier model revision, eleven named scenarios and the initial selected type/scenario/simulation check
passed. A twelfth explicit duplicate-veto scenario was added afterward and was
not rerun. The finite verifier was stopped at the user's instruction to skip
remaining checks and prioritize pushing. That interrupted run is not a
verification pass. Its partial receipt and the earlier check output remain
under ignored `evidence/formal/binding-veto/`. The final model needs a fresh
full check before any verified-completion claim. Root integration must refresh
the global source and model inventories.

## Source-only follow-up at `120c7a22a`

The follow-up compares the integrated model with the guards in
`ProjectEscrow.sol` (`cancelBinding`, `pay`, and factory identity rotation)
and `lib.rs` (`confirm_authority_rotation`, `cancel_authority_rotation`,
`execute_authority_rotation`, `veto_binding`, and `pay`/`pay_native`). It found
no new production defect. The existing model deliberately assumed a valid
rotation, but its local action relation accepted repeat Solana confirmation
and same-tick execution of a positive-delay Solana proposal. Those branches
are now refused explicitly so the composed veto-waiver clock has the same
ordering as the source.

The follow-up adds named scenarios for pre-deadline refusal, missing and repeat
confirmation, cancellation followed by a fresh proposal, zero-delay Solana
confirmation, and immediate EVM execution without confirmation. It also
retains the scenario in which a confirmed proposal waives the cap until actual
execution. **These model changes and new scenarios have not been run.** The
user directed the team to skip further checks and prioritize pushing. Earlier
scenario and contract results above do not validate this revised model.

The same source-only review found no mismatch in `evm_factory_authority.qnt`
for proposal replacement, recipient acceptance, immediate identity execution,
candidate exclusion against both pending roles, or clearing pending state.
Its successful-vault-creation and compatible-upgrade assumptions remain
explicit boundaries in `factory-authority-audit.md`; no factory-model or
production change was made.
