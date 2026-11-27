# Mainnet execution switch and production payment networks

PRD sections 6 and 11 ("Limited network qualification" and "Activation
gates and accepted risks") qualify Base, then Solana, then Robinhood Chain.
An earlier qualification must reconcile before a fresh activation on a later
network. Solana also requires its independent full-history recovery RPC,
first registered vault and all readiness checks before the production release.

The reviewed switch is [`reviewedActivation`](./signer.md). The release
derives the Pages `PAYMENT_NETWORKS` list and the attester bindings from it.
Test networks do not use the switch. This machine observes the released switch
values and the
[mainnet escrow qualification ledger](../operations/escrowQualification.md):
that the observed lane count and Ethereum activation are that ledger's
`activated` and `ethereumActive` is a composition obligation. The `by` sender
is the release workflow, the ledger and Solana readiness evidence readers, or
the payment executor and attester runtimes.

PRD section 11 records the 14 November 2026 operator activation of Solana and
Robinhood Chain, and accepts each network's first finalized October payout
on 16 November in place of its qualification transfers. The historical record
is the deployed `bd8ab0f67fa344e04e06910ad15257184c6e41a2` switch in
`workers/payment-executor/mainnet-execution.mjs` and the two exact public
records from the [finalized vault payments ledger](https://slop.cash/api/v1/payments/vault-payments).

## Story: Execute mainnet payouts only on networks whose qualified lane is activated

### A released switch is on only for an activated lane, in qualification order

Base needs the first activated lane, Solana the second together with its
recovery RPC, first registered vault and readiness checks, and Robinhood Chain
the third. For the first release that carries forward the reviewed legacy
switch, the ledger reader may supply the exact historical release and both
finalized payout records for Solana and Robinhood Chain. Verify the source's
enabled switches and each record against the canonical finalized chain event
and the recorded October obligation before observing it. These checks belong
to the evidence reader. Base still needs its activated lane. Solana still
needs all its release readiness evidence. Ethereum needs its own activation
in the ledger. The production network list is exactly the set of networks
switched on. A release may turn a switch off at any time. Once disabled, a
historical lane can turn on again only through its ordinary qualification.

```quint
import escrowQualification as Q from "../operations/escrowQualification"
type Actor = ReleaseWorkflow | LedgerReader | SolanaEvidenceReader | ServiceRuntime | Contributor
type PaymentService = PaymentExecutor | PaymentAttester
type SolanaCheck = RecoveryRpc | FirstRegisteredVault | ReadinessChecks
type ReleasePhase = AwaitingFirstRelease | ObservedHistoricalRelease | Released
type HistoricalRelease = { source: str, solanaReceipt: str, robinhoodReceipt: str, solanaFinalized: bool, robinhoodFinalized: bool }
type SignerRead = { network: Q::Network, service: PaymentService }
type Activation = { activated: int, ethereumActive: bool, recoveryRpc: bool, firstVault: bool, readiness: bool,
  releasePhase: ReleasePhase, historicalNetworks: Set[Q::Network],
  switches: Set[Q::Network], networkList: Set[Q::Network], reads: List[SignerRead], refusals: int }
pure val initial: Activation = { activated: 0, ethereumActive: false, recoveryRpc: false, firstVault: false, readiness: false,
  releasePhase: AwaitingFirstRelease, historicalNetworks: Set(),
  switches: Set(), networkList: Set(), reads: List(), refusals: 0 }
pure val historicalNetworks: Set[Q::Network] = Set(Q::Solana, Q::Robinhood)
pure val historicalRelease: HistoricalRelease = {
  source: "bd8ab0f67fa344e04e06910ad15257184c6e41a2",
  solanaReceipt: "solana-mainnet:5XRgBiXJqmhcf3w1TuRq4vg5jSvFzMsFfc54M4pWxyiAQVv1WSyCid7kdWFpTK1kgYddNLAFn4CLinNZRxRdyWdC:1",
  robinhoodReceipt: "robinhood-mainnet:0x481c164b0e100ef1354195a295c9eaa0cadbab1ce5646c5e916a7186e97a340d:1",
  solanaFinalized: true, robinhoodFinalized: true }
pure def solanaReady(s: Activation): bool = s.recoveryRpc and s.firstVault and s.readiness
pure def eligible(s: Activation, network: Q::Network): bool =
  if (network == Q::Base) s.activated >= 1
  else if (network == Q::Solana) solanaReady(s) and (s.activated >= 2 or s.historicalNetworks.contains(network))
  else if (network == Q::Robinhood) s.activated >= 3 or s.historicalNetworks.contains(network)
  else s.ethereumActive
pure def canObserveLedger(s: Activation, activated: int, ethereumActive: bool, by: Actor): bool =
  by == LedgerReader and activated >= s.activated and activated <= 3 and (ethereumActive implies activated == 3)
    and (s.ethereumActive implies ethereumActive)
pure def observeLedger(s: Activation, activated: int, ethereumActive: bool, by: Actor): Activation =
  { ...s, activated: activated, ethereumActive: ethereumActive }
pure def canObserveHistoricalRelease(s: Activation, evidence: HistoricalRelease, by: Actor): bool =
  by == LedgerReader and s.releasePhase == AwaitingFirstRelease and s.activated >= 1 and evidence == historicalRelease
pure def observeHistoricalRelease(s: Activation, evidence: HistoricalRelease, by: Actor): Activation =
  { ...s, releasePhase: ObservedHistoricalRelease, historicalNetworks: historicalNetworks }
pure def canObserveSolanaCheck(s: Activation, check: SolanaCheck, by: Actor): bool = by == SolanaEvidenceReader
pure def observeSolanaCheck(s: Activation, check: SolanaCheck, by: Actor): Activation =
  if (check == RecoveryRpc) { ...s, recoveryRpc: true }
  else if (check == FirstRegisteredVault) { ...s, firstVault: true }
  else { ...s, readiness: true }
pure def canReleaseSwitches(s: Activation, on: Set[Q::Network], by: Actor): bool =
  by == ReleaseWorkflow and on.forall(n => eligible(s, n))
pure def releaseSwitches(s: Activation, on: Set[Q::Network], by: Actor): Activation =
  { ...s, releasePhase: Released, historicalNetworks: s.historicalNetworks.intersect(on), switches: on, networkList: on }
pure def alwaysSwitchNeedsActivatedLane(s: Activation): bool = s.switches.forall(n => eligible(s, n))
pure def alwaysHistoricalNetworksAreReviewed(s: Activation): bool = s.historicalNetworks.subseteq(historicalNetworks)
pure def alwaysNetworkListIsSwitchedOn(s: Activation): bool =
  s.networkList.subseteq(s.switches) and s.switches.subseteq(s.networkList)
pure def alwaysLedgerShape(s: Activation): bool = s.activated >= 0 and s.activated <= 3 and (s.ethereumActive implies s.activated == 3)
pure def stepEvidenceOnlyGrows(before: Activation, after: Activation): bool = after.activated >= before.activated
  and (before.ethereumActive implies after.ethereumActive) and (before.recoveryRpc implies after.recoveryRpc)
  and (before.firstVault implies after.firstVault) and (before.readiness implies after.readiness)
pure def stepHistoricalNetworksCannotReturn(before: Activation, after: Activation): bool =
  before.releasePhase != AwaitingFirstRelease implies after.releasePhase != AwaitingFirstRelease
    and after.historicalNetworks.subseteq(before.historicalNetworks)
pure def lawRobinhoodNeedsThirdLane(activated: int): bool =
  activated < 3 implies not(eligible({ ...initial, activated: activated, recoveryRpc: true, firstVault: true, readiness: true }, Q::Robinhood))
pure def lawSolanaNeedsRecoveryVaultAndReadiness(check: SolanaCheck): bool =
  not(eligible(observeSolanaCheck({ ...initial, activated: 3, historicalNetworks: historicalNetworks }, check, SolanaEvidenceReader), Q::Solana))
pure def lawHistoricalReleaseNeedsBaseAndMatchedEvidence(evidence: HistoricalRelease, by: Actor): bool =
  not(canObserveHistoricalRelease(initial, evidence, by))
    and (canObserveHistoricalRelease({ ...initial, activated: 1 }, evidence, by) == (evidence == historicalRelease and by == LedgerReader))
pure def lawReleaseCannotRestoreDisabledHistoricalNetworks(network: Q::Network): bool =
  val carried = { ...initial, activated: 1, releasePhase: ObservedHistoricalRelease, historicalNetworks: historicalNetworks,
    recoveryRpc: true, firstVault: true, readiness: true }
  val disabled = releaseSwitches(carried, Set(Q::Base), ReleaseWorkflow)
  (historicalNetworks.contains(network) implies not(eligible(disabled, network))) and not(eligible(carried, Q::Ethereum))
    and not(canObserveHistoricalRelease(disabled, historicalRelease, LedgerReader))
pure def sometimesBaseOn(s: Activation): bool = s.switches.contains(Q::Base)
pure def sometimesThreeNetworksOn(s: Activation): bool =
  s.switches.contains(Q::Base) and s.switches.contains(Q::Solana) and s.switches.contains(Q::Robinhood)
pure def sometimesKeepsHistoricalNetworksOn(s: Activation): bool =
  s.releasePhase == Released and s.activated == 1 and sometimesThreeNetworksOn(s) and not(s.switches.contains(Q::Ethereum))
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

### Simulation samples include the reviewed legacy switch and its refused alternatives

These values exercise the ordinary qualification and the historical release.
Altered source or receipt identities and missing finality refuse. Explicit
Solana evidence is required before the historical switch set can be carried
forward.

```quint
pure val activatedValues = Set(0, 1, 2, 3)
pure val networkValues = Set(Q::Base, Q::Solana, Q::Robinhood, Q::Ethereum)
pure val evidenceValues = Set(historicalRelease, { ...historicalRelease, source: "unreviewed" },
  { ...historicalRelease, solanaReceipt: "other" }, { ...historicalRelease, robinhoodReceipt: "other" },
  { ...historicalRelease, solanaFinalized: false }, { ...historicalRelease, robinhoodFinalized: false })
pure val onValues = Set(Set(), Set(Q::Base), Set(Q::Base).union(Set(Q::Solana)), Set(Q::Base).union(Set(Q::Robinhood)),
  Set(Q::Base).union(Set(Q::Solana)).union(Set(Q::Robinhood)), Set(Q::Ethereum))
pure val byValues = Set(ReleaseWorkflow, LedgerReader, SolanaEvidenceReader, ServiceRuntime, Contributor)
pure val weight_observeLedger = 3
pure val weight_releaseSwitches = 4
pure val eval_witness_sometimesKeepsHistoricalNetworksOn = (
  ("observeLedger", 1, false, LedgerReader),
  ("observeHistoricalRelease", historicalRelease, LedgerReader),
  ("observeSolanaCheck", RecoveryRpc, SolanaEvidenceReader),
  ("observeSolanaCheck", FirstRegisteredVault, SolanaEvidenceReader),
  ("observeSolanaCheck", ReadinessChecks, SolanaEvidenceReader),
  ("releaseSwitches", Set(Q::Base, Q::Solana, Q::Robinhood), ReleaseWorkflow))
```
