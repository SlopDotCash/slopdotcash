# Factory authority handoff and vault templates

This review starts from `80e6de887`. It adds
`models/evm_factory_authority.qnt` because `evm_proxy_lifecycle` fixes the
upgrade authority and does not express recipient acceptance, replacement of a
pending recipient, or the interaction with a pending identity-authority
rotation. No production code changed and no new contract defect was found.

## Source transitions

The source is `contracts/evm/src/ProjectEscrow.sol`, with the vendored
`UUPSUpgradeable.sol` authorization boundary. The model maps these operations:

| Source operation | Modeled transition and refusal |
| --- | --- |
| `EscrowFactory.proposeUpgradeAuthority` | Only the current upgrade authority can propose. A later proposal replaces the prior recipient. Zero, the fee recipient, the current identity authority and the pending identity authority are refused. |
| `EscrowFactory.acceptUpgradeAuthority` | Only the currently proposed recipient can accept. Acceptance immediately changes authority and clears the proposal. The previous authority loses factory, existing-vault and template authority. |
| `EscrowFactory.proposeIdentityAuthority` | Only the registrar can propose. Zero, the registrar, the current identity authority, the current upgrade authority and its pending recipient are refused. An existing identity proposal cannot be replaced. |
| `cancelIdentityAuthorityRotation` / `executeIdentityAuthorityRotation` | The registrar can cancel. Any sender can execute an existing proposal at its effective time. The checked-in delay is zero, so same-block execution is valid. Cancellation and execution clear the pending identity record. |
| `setVaultImplementation` / `_setVaultImplementation` | The current upgrade authority selects a template only if the implementation call succeeds and returns the required UUID. Failed calls and wrong UUIDs do not change the template. |
| `_create` | A successful creation uses the template selected at that instant. A later template change does not change a previously created proxy. |
| Both `_authorizeUpgrade` implementations | Factory upgrades check the current factory authority; existing vaults read that current authority from the factory, rather than retaining their creation-time authority. |

The source permits proposing the current authority itself or the registrar as
the next upgrade authority. It also permits the fee recipient to become the
identity authority. Named witnesses preserve those actual permissions; the
model does not invent stricter role separation. It starts with distinct roles,
matching the real fixture, and does not enumerate every valid initializer
aliasing arrangement.

## Bounds and proof boundary

The finite model uses six nonzero address identities, zero as the absence of a
proposal, two compatible logic versions, two successfully created vaults,
two upgrade-authority proposals and two block-time values. The proposal log
retains every modeled replacement; accepted recipients form a separate log.
Refusal is represented by a disabled action and named `.fail()` scenarios,
consistent with atomic EVM reversion. The exhaustive step relation includes
successful compatible logic operations; wrong-call/wrong-UUID refusal is
checked by named scenarios. It does not model arbitrary implementation code.

Invariants preserve current/pending role separation, the accepted-authority
history, vault count and implementation domains. Twenty-four named scenarios
cover old and new authority permissions, replacement, forbidden candidates,
both orderings of concurrent role proposals, cancellation, immediate execution,
implementation refusal and old/new vault template separation.

The model treats a successful creation as a distinct valid vault key. Duplicate
key, token, owner, initializer and payment semantics remain with the existing
vault models and real contract tests. UUID compatibility is an external
predicate, not proof of safe implementation behavior or storage layout.
Authorized upgrades are assumed to preserve the modeled fields; arbitrary
malicious upgrade logic is outside this model. There is no claim that a
handoff, a proposal or a template choice signs or pays anything. No fairness
or eventual recipient acceptance is assumed.

## Real conformance and validation

The existing funded workflow in `contracts/evm/test/UpgradeLifecycle.t.sol`
upgrades both proxies, keeps stored obligations and wallet bindings, creates a
new vault with the selected template, completes an exact payment, and checks
that the accepted recipient can upgrade an existing vault while the previous
authority cannot. `BoundedAttester.t.sol` exercises identity proposal,
cancellation, execution, old-authority refusal and retained wallet bindings.
These are actual EVM executions, not newly added tests that repeat the model.
They do not individually assert every candidate/replacement interleaving.

The targeted command was:

```sh
forge test --root contracts/evm --match-contract 'UpgradeLifecycleTest|BoundedAttesterTest' -vv
```

It passed **19 tests, zero failures and zero skips**, using Forge **1.7.1**
(`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`) and the repository-pinned
Solidity **0.8.30**, optimizer 200, Cancun. No source or test bytes changed.
The Forge log is retained under `evidence/formal/factory-authority/`.

The first model used three stored proposal-history entries. Its typechecking,
all 24 scenarios and 500 seeded traces passed. Its TLC run reached the existing
180-second deadline without completion: the last progress report contained
1,344,371 distinct states, 45,413,891 generated states and a nonempty queue.
No violation was reported before termination; that is not a verification pass.
The initial model/receipt and log are retained under
`evidence/formal/factory-authority/three-proposal-*`. The final model uses two
proposals, sufficient for every named replacement and successive-handoff
scenario, without increasing the checker's deadline.

For the final two-proposal model, Quint **0.33.1** typechecking, all **24 named
scenarios**, and **500 seeded traces of up to 60 steps** passed with unchanged
source hashes. Its SHA-256 is
`ea9ac49eb060a2ba839d6c1c5a2fd038ea2bc7dea93c8d04060be491db890424`.
The final TLC run was interrupted at the user's direction to stop checks and
push the combined work. Its partial receipt is retained; **exhaustive
verification of this final model is incomplete**. The completed scenario,
simulation and Forge results are separate from that interrupted run. These
checks do not establish general implementation refinement or prove the
absence of all contract defects.
