# Mainnet execution switch and production payment networks

PRD sections 6 and 11 ("Limited network qualification" and "Activation
gates and accepted risks") qualify Base, then Solana, then Robinhood Chain,
and never activate a later network before the earlier qualification
reconciles. The PRD keeps Solana outside the production network list until its
independent full-history recovery RPC, its first registered vault and all
readiness checks pass. CLAUDE.md "Rewards, funding, and settlement": no
project activates escrow merely because the code is present.

The pinned sources are `workers/payment-executor/mainnet-execution.mjs`
(`MAINNET_EXECUTION`, `mainnetExecutionEnabled`) and
`contracts/DEPLOY-MAINNET.md` sections 3.6 and 3.7. The switch is a reviewed
source value per mainnet network; the release derives the Pages
`PAYMENT_NETWORKS` list and the attester bindings from it. Test networks do
not use the switch. This machine observes the released switch values and the
[mainnet escrow qualification ledger](../operations/escrowQualification.md):
that the observed lane count and Ethereum activation are that ledger's
`activated` and `ethereumActive` is a composition obligation. The `by` sender
is the release workflow, the ledger and Solana readiness evidence readers, or
the payment executor and attester runtimes.

Open owner decision gate. On 14 November 2026 an operator decision set
`robinhood-mainnet` and `solana-mainnet` to `true`. Section 3.7 records that
the readiness report and the first payout reconciliation of each network were
not run before the switch, and no PRD section 11 evidence exception covers
it. This spec does not accept those values: a release carrying a switch for a
network whose lane is not activated is refused here. Resolving the gate needs
either an owner-approved PRD section 11 evidence exception, which this spec
would then model, or a correction on `development` that turns the switches
off until their lanes activate.

## Story: Execute mainnet payouts only on networks whose qualified lane is activated

### A released switch is on only for an activated lane, in qualification order

Base needs the first activated lane, Solana the second together with its
recovery RPC, first registered vault and readiness checks, and Robinhood Chain
the third. Ethereum needs its own activation in the ledger. The production
network list is exactly the set of networks switched on. A release may turn
a switch off at any time.

```quint
import escrowQualification as Q from "../operations/escrowQualification"
type Actor = ReleaseWorkflow | LedgerReader | SolanaEvidenceReader | ServiceRuntime | Contributor
type PaymentService = PaymentExecutor | PaymentAttester
type SolanaCheck = RecoveryRpc | FirstRegisteredVault | ReadinessChecks
type SignerRead = { network: Q::Network, service: PaymentService }
type Activation = { activated: int, ethereumActive: bool, recoveryRpc: bool, firstVault: bool, readiness: bool,
  switches: Set[Q::Network], networkList: Set[Q::Network], reads: List[SignerRead], refusals: int }
pure val initial: Activation = { activated: 0, ethereumActive: false, recoveryRpc: false, firstVault: false, readiness: false,
  switches: Set(), networkList: Set(), reads: List(), refusals: 0 }
pure def solanaReady(s: Activation): bool = s.recoveryRpc and s.firstVault and s.readiness
pure def eligible(s: Activation, network: Q::Network): bool =
  if (network == Q::Base) s.activated >= 1
  else if (network == Q::Solana) s.activated >= 2 and solanaReady(s)
  else if (network == Q::Robinhood) s.activated >= 3
  else s.ethereumActive
pure def canObserveLedger(s: Activation, activated: int, ethereumActive: bool, by: Actor): bool =
  by == LedgerReader and activated >= s.activated and activated <= 3 and (ethereumActive implies activated == 3)
    and (s.ethereumActive implies ethereumActive)
pure def observeLedger(s: Activation, activated: int, ethereumActive: bool, by: Actor): Activation =
  { ...s, activated: activated, ethereumActive: ethereumActive }
pure def canObserveSolanaCheck(s: Activation, check: SolanaCheck, by: Actor): bool = by == SolanaEvidenceReader
pure def observeSolanaCheck(s: Activation, check: SolanaCheck, by: Actor): Activation =
  if (check == RecoveryRpc) { ...s, recoveryRpc: true }
  else if (check == FirstRegisteredVault) { ...s, firstVault: true }
  else { ...s, readiness: true }
pure def canReleaseSwitches(s: Activation, on: Set[Q::Network], by: Actor): bool =
  by == ReleaseWorkflow and on.forall(n => eligible(s, n))
pure def releaseSwitches(s: Activation, on: Set[Q::Network], by: Actor): Activation = { ...s, switches: on, networkList: on }
pure def alwaysSwitchNeedsActivatedLane(s: Activation): bool = s.switches.forall(n => eligible(s, n))
pure def alwaysNetworkListIsSwitchedOn(s: Activation): bool =
  s.networkList.subseteq(s.switches) and s.switches.subseteq(s.networkList)
pure def alwaysLedgerShape(s: Activation): bool = s.activated >= 0 and s.activated <= 3 and (s.ethereumActive implies s.activated == 3)
pure def stepEvidenceOnlyGrows(before: Activation, after: Activation): bool = after.activated >= before.activated
  and (before.ethereumActive implies after.ethereumActive) and (before.recoveryRpc implies after.recoveryRpc)
  and (before.firstVault implies after.firstVault) and (before.readiness implies after.readiness)
pure def lawRobinhoodNeedsThirdLane(activated: int): bool =
  activated < 3 implies not(eligible({ ...initial, activated: activated, recoveryRpc: true, firstVault: true, readiness: true }, Q::Robinhood))
pure def lawSolanaNeedsRecoveryVaultAndReadiness(check: SolanaCheck): bool =
  not(eligible(observeSolanaCheck({ ...initial, activated: 3 }, check, SolanaEvidenceReader), Q::Solana))
pure def sometimesBaseOn(s: Activation): bool = s.switches.contains(Q::Base)
pure def sometimesThreeNetworksOn(s: Activation): bool =
  s.switches.contains(Q::Base) and s.switches.contains(Q::Solana) and s.switches.contains(Q::Robinhood)
pure def sometimesSolanaHeldForReadiness(s: Activation): bool =
  s.activated == 3 and not(solanaReady(s)) and s.switches.contains(Q::Robinhood) and not(s.switches.contains(Q::Solana))
```

### The executor and attester refuse a disabled network before reading any signer secret

Each payment executor or attester run checks the switch of its mainnet
network first. A network that is not switched on is refused, and the run
reads no `SIGNER_PRIVATE_KEY`, `SOLANA_SIGNER_SEED` or RPC secret. A refusal
changes nothing else.

```quint
pure val noRead: SignerRead = { network: Q::Ethereum, service: PaymentExecutor }
pure def canRequestSigner(s: Activation, network: Q::Network, service: PaymentService, by: Actor): bool = by == ServiceRuntime
pure def requestSigner(s: Activation, network: Q::Network, service: PaymentService, by: Actor): Activation =
  if (s.switches.contains(network)) { ...s, reads: s.reads.append({ network: network, service: service }) }
  else { ...s, refusals: s.refusals + 1 }
pure def stepSecretReadOnlyWhenSwitchedOn(before: Activation, after: Activation): bool =
  after.reads.length() == before.reads.length()
    or (after.reads.length() == before.reads.length() + 1
      and before.switches.contains(after.reads.nthOr(after.reads.length() - 1, noRead).network))
pure def stepReadsAppendOnly(before: Activation, after: Activation): bool =
  after.reads.length() >= before.reads.length() and before.reads.every(x => after.reads.includes(x))
pure def sometimesRefusedBeforeSecret(s: Activation): bool = s.refusals > 0 and s.reads.length() == 0
pure def sometimesAttesterSigns(s: Activation): bool = s.reads.some(x => x.service == PaymentAttester and x.network == Q::Solana)
```

### Simulation samples include the 14 November development values

These sets bound simulation only. The last switch set is the development
value of 14 November 2026, which the guard refuses until every lane is
activated and Solana is ready.

```quint
pure val activatedValues = Set(0, 1, 2, 3)
pure val onValues = Set(Set(), Set(Q::Base), Set(Q::Base).union(Set(Q::Solana)), Set(Q::Base).union(Set(Q::Robinhood)),
  Set(Q::Base).union(Set(Q::Solana)).union(Set(Q::Robinhood)), Set(Q::Ethereum))
pure val byValues = Set(ReleaseWorkflow, LedgerReader, SolanaEvidenceReader, ServiceRuntime, Contributor)
pure val weight_observeLedger = 3
pure val weight_releaseSwitches = 4
```
