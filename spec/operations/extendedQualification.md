# Extended escrow acceptance suite

PRD sections 8 and 11 (the #902 extended acceptance). The pinned sources are
`scripts/escrow-acceptance/evm-extended.ts` (Base Sepolia, Ethereum Sepolia,
Robinhood Chain Testnet), `contracts/solana/scripts/acceptance-extended.ts`
(Solana devnet) and `runScenarios` in `scripts/escrow-acceptance/shared.ts`.
The suite runs on public test networks only, after the base sequence of
[Mainnet escrow qualification](./escrowQualification.md), with the same role
keys; each scenario uses its own vault (or Solana project). The outcomes it
checks are those of the [EVM escrow](../contracts/evmEscrow.md) and of the
uncertain-attempt rules of [payments](../settlement/payment.md). Amounts are
whole units of the scenario stablecoin before the reviewed unit divisor. The
figures each group reports are read by the suite from finalized receipts,
contract totals and the payments ledger, and whether a group stopped to wait
and each scenario's finality come from the suite's own chain reads; none is
a caller flag.

## Story: Record each extended scenario with its expected outcome and finality

### The extended suite records a bounty 75/25 payout, the monthly switch, cap and window, a walletless award that stays reserved, an interrupted send, a failed recipient and a frozen fee destination, each with its expected outcome

The groups run in this order: the private bounty, the walletless binding
lifecycle, the monthly commitment, the three production dispatch scenarios
together (interrupted send, failed recipient, frozen fee destination), and
the identity key recovery. A run interrupted while the recovery key is in
force runs the recovery first, so the configured identity authority is
restored before any other scenario binds; the suite reads that the recovery
key is in force from its saved run when it begins, and the other groups
follow in the same order. Only the EVM leg can find the recovery key in
force; the Solana devnet leg always runs the recovery last. A Solana local
validator run, which runs only the key recovery and records that deviation,
is not qualification evidence and is out of scope here.

- **Bounty**: a 100-unit private bounty pays 75 to the researcher and 25 as
  the Slop fee and nothing else; an ordinary award and an inexact split are
  refused in a bounty vault; the vault ends empty and a withdrawal is
  refused.
- **Monthly**: nobody can commit while the switch is off at vault creation;
  only the period whose 72-hour cutoff window is open accepts; an allocation
  changed after signing is refused; the owner's cap edits apply to the next
  commitment; opting out and in again is respected; the owner's manual award
  is paid first, and a changed award for that source fails closed; the
  commitment through the production executor or keeper reserves only the two
  new awards and counts the manual award once, with no double reservation
  or payment, and nothing stays reserved.
- **Walletless lifecycle**: an award without a wallet stays reserved and
  nothing can pay it; a signature for another network or vault and a stale
  binding version are refused; a replacement supersedes the earlier version
  at once; owner cancellation is refused at the deployed zero binding delay;
  a co-signed recovery pays at once.
- **Interrupted send**: with the first broadcast answer lost and the Worker
  restarted, the award is paid once, by one transaction and one attempt.
- **Failed recipient**: a recipient that rejects the token is not paid and
  its award stays reserved; once it accepts, one retried attempt pays it.
- **Frozen fee destination**: while the fee recipient rejects the token, fees
  cannot be claimed yet the waiting payout proceeds; once it accepts, one
  claim moves every accrued fee and nothing owed stays in the vault.
- **Key recovery**: the old identity key can no longer bind and the new one
  can, a binding made before the rotation still pays, and the configured
  authority is restored.

A group runs only while one of its scenarios is neither passed nor
complete; it meets its expectation only when every scenario in it does. A
group that stops to wait for the chain while it executes neither meets nor
misses it. A scenario whose group met its expectation, or that was already
complete, is saved as complete apart from its finality and is never executed
again: a later run checks the same receipts. It passes once its receipts are
finalized, waits while they are not, and fails when the finality check fails
for any other reason, such as a reorganized or reverted receipt, even though
it is complete. A scenario that was not complete waits when its group waited
and fails when its group missed its expectation. After the last group the
run waits if any scenario waits, passes only when every scenario passed, and
fails otherwise.

```quint
type Scenario = Bounty | WalletlessLifecycle | Monthly | InterruptedSend | FailedRecipient | FrozenFeeDestination | KeyRecovery
type ScenarioStatus = ScenarioPending | ScenarioPassed | ScenarioFailed
type Finality = Finalized | NotYetFinal | FinalityFailed
type GroupResult = GroupMet | GroupWaiting | GroupFailed
type Group = BountyGroup | LifecycleGroup | MonthlyGroup | DispatchGroup | RecoveryGroup
type ScenarioEntry = { scenario: Scenario, status: ScenarioStatus, complete: bool, executions: int }
type SuiteStatus = NotStarted | SuiteRunning | SuiteWaiting | SuitePassed | SuiteFailed
type Suite = { status: SuiteStatus, entries: List[ScenarioEntry], group: int, waited: bool, runs: int, identityRotated: bool }
type BountyFigures = { grossUnits: int, researcherUnits: int, slopFeeUnits: int, otherFeeUnits: int, leftUnits: int,
  ordinaryAwardRefused: bool, inexactSplitRefused: bool, withdrawalRefused: bool }
type LifecycleFigures = { paidWithoutWallet: bool, reservedWithoutWallet: bool, wrongNetworkRefused: bool,
  staleVersionRefused: bool, replacementSupersedes: bool, zeroDelayCancelRefused: bool, recoveryPaidAtOnce: bool }
type MonthlyFigures = { commitWhileOffRefused: bool, closedWindowRefused: bool, changedAllocationRefused: bool,
  capAppliesToNext: bool, optOutRespected: bool, manualAwardPaidFirst: bool, changedManualAwardRefused: bool,
  newAwardsReserved: int, manualAwardCountedOnce: bool, doubleReservations: int, doublePayments: int, reservedAfter: int }
type DispatchFigures = { answerLost: bool, interruptedPayments: int, interruptedTransactions: int, interruptedAttempts: int,
  blockedRecipientPaid: bool, blockedAwardReserved: bool, unblockedRetriedAttempts: int, unblockedPaid: bool,
  feeClaimWhileFrozenRefused: bool, payoutWhileFeeFrozen: bool, feeClaimsAfterThaw: int, owedLeft: int }
type RecoveryFigures = { oldKeyBindRefused: bool, newKeyBinds: bool, oldBindingStillPays: bool, authorityRestored: bool }
pure val scenarioOrder: List[Scenario] = List(Bounty, WalletlessLifecycle, Monthly, InterruptedSend, FailedRecipient,
  FrozenFeeDestination, KeyRecovery)
pure val groupCount = 5
pure val initial: Suite = { status: NotStarted, group: 0, waited: false, runs: 0, identityRotated: false,
  entries: scenarioOrder.listMap(x => { scenario: x, status: ScenarioPending, complete: false, executions: 0 }) }
pure val groupOrder: List[Group] = List(BountyGroup, LifecycleGroup, MonthlyGroup, DispatchGroup, RecoveryGroup)
pure val rotatedGroupOrder: List[Group] = List(RecoveryGroup, BountyGroup, LifecycleGroup, MonthlyGroup, DispatchGroup)
pure def groupAt(s: Suite, position: int): Group =
  if (s.identityRotated) rotatedGroupOrder.nthOr(position, RecoveryGroup) else groupOrder.nthOr(position, RecoveryGroup)
pure def groupScenarios(g: Group): List[Scenario] =
  if (g == BountyGroup) List(Bounty) else if (g == LifecycleGroup) List(WalletlessLifecycle) else if (g == MonthlyGroup) List(Monthly)
  else if (g == DispatchGroup) List(InterruptedSend, FailedRecipient, FrozenFeeDestination) else List(KeyRecovery)
pure def groupRunnable(s: Suite, g: Group): bool = s.status == SuiteRunning and s.group < groupCount and groupAt(s, s.group) == g
pure def groupResult(met: bool, waiting: bool): GroupResult = if (waiting) GroupWaiting else if (met) GroupMet else GroupFailed
pure def finalStatus(finality: Finality): ScenarioStatus =
  if (finality == Finalized) ScenarioPassed else if (finality == NotYetFinal) ScenarioPending else ScenarioFailed
pure def bountyMet(f: BountyFigures): bool = f.grossUnits == 100 and f.researcherUnits == 75 and f.slopFeeUnits == 25
  and f.otherFeeUnits == 0 and f.leftUnits == 0 and f.ordinaryAwardRefused and f.inexactSplitRefused and f.withdrawalRefused
pure def lifecycleMet(f: LifecycleFigures): bool = not(f.paidWithoutWallet) and f.reservedWithoutWallet
  and f.wrongNetworkRefused and f.staleVersionRefused and f.replacementSupersedes and f.zeroDelayCancelRefused
  and f.recoveryPaidAtOnce
pure def monthlyMet(f: MonthlyFigures): bool = f.commitWhileOffRefused and f.closedWindowRefused
  and f.changedAllocationRefused and f.capAppliesToNext and f.optOutRespected and f.manualAwardPaidFirst
  and f.changedManualAwardRefused and f.newAwardsReserved == 2 and f.manualAwardCountedOnce
  and f.doubleReservations == 0 and f.doublePayments == 0 and f.reservedAfter == 0
pure def interruptedSendMet(f: DispatchFigures): bool = f.answerLost and f.interruptedPayments == 1
  and f.interruptedTransactions == 1 and f.interruptedAttempts == 1
pure def failedRecipientMet(f: DispatchFigures): bool = not(f.blockedRecipientPaid) and f.blockedAwardReserved
  and f.unblockedRetriedAttempts == 1 and f.unblockedPaid
pure def frozenFeeMet(f: DispatchFigures): bool = f.feeClaimWhileFrozenRefused and f.payoutWhileFeeFrozen
  and f.feeClaimsAfterThaw == 1 and f.owedLeft == 0
pure def dispatchMet(f: DispatchFigures): bool = interruptedSendMet(f) and failedRecipientMet(f) and frozenFeeMet(f)
pure def recoveryMet(f: RecoveryFigures): bool = f.oldKeyBindRefused and f.newKeyBinds and f.oldBindingStillPays
  and f.authorityRestored
pure def settleEntry(e: ScenarioEntry, result: GroupResult, finality: Finality): ScenarioEntry =
  if (result == GroupMet or e.complete)
    { ...e, complete: true, executions: e.executions + (if (e.complete) 0 else 1), status: finalStatus(finality) }
  else if (result == GroupWaiting) { ...e, executions: e.executions + 1, status: ScenarioPending }
  else { ...e, executions: e.executions + 1, status: ScenarioFailed }
pure def settleGroup(result: GroupResult, s: Suite, finality: Finality): Suite =
  val members = groupScenarios(groupAt(s, s.group))
  val entries = s.entries.listMap(e => if (members.includes(e.scenario)) settleEntry(e, result, finality) else e)
  { ...s, entries: entries, group: s.group + 1,
    waited: s.waited or entries.some(e => members.includes(e.scenario) and e.status == ScenarioPending) }
pure def canBeginSuite(s: Suite, identityRotated: bool): bool = s.status != SuiteRunning
pure def beginSuite(s: Suite, identityRotated: bool): Suite =
  { ...s, status: SuiteRunning, group: 0, waited: false, runs: s.runs + 1, identityRotated: identityRotated }
pure def canRunBounty(s: Suite): bool = groupRunnable(s, BountyGroup)
pure def runBounty(s: Suite, bountyRun: BountyFigures, waiting: bool, finality: Finality): Suite =
  settleGroup(groupResult(bountyMet(bountyRun), waiting), s, finality)
pure def canRunLifecycle(s: Suite): bool = groupRunnable(s, LifecycleGroup)
pure def runLifecycle(s: Suite, lifecycleRun: LifecycleFigures, waiting: bool, finality: Finality): Suite =
  settleGroup(groupResult(lifecycleMet(lifecycleRun), waiting), s, finality)
pure def canRunMonthly(s: Suite): bool = groupRunnable(s, MonthlyGroup)
pure def runMonthly(s: Suite, monthlyRun: MonthlyFigures, waiting: bool, finality: Finality): Suite =
  settleGroup(groupResult(monthlyMet(monthlyRun), waiting), s, finality)
pure def canRunDispatch(s: Suite): bool = groupRunnable(s, DispatchGroup)
pure def runDispatch(s: Suite, dispatchRun: DispatchFigures, waiting: bool, finality: Finality): Suite =
  settleGroup(groupResult(dispatchMet(dispatchRun), waiting), s, finality)
pure def canRunRecovery(s: Suite): bool = groupRunnable(s, RecoveryGroup)
pure def runRecovery(s: Suite, recoveryRun: RecoveryFigures, waiting: bool, finality: Finality): Suite =
  settleGroup(groupResult(recoveryMet(recoveryRun), waiting), s, finality)
pure def canFinishSuite(s: Suite): bool = s.status == SuiteRunning and s.group == groupCount
pure def finishSuite(s: Suite): Suite = { ...s, status: if (s.waited) SuiteWaiting
  else if (s.entries.every(e => e.status == ScenarioPassed)) SuitePassed else SuiteFailed }
pure def alwaysPassedScenarioIsComplete(s: Suite): bool = s.entries.length() == 7 and s.group >= 0 and s.group <= groupCount
  and s.entries.every(e => (e.status == ScenarioPassed implies e.complete) and (e.complete implies e.executions >= 1)
    and e.executions >= 0)
pure def alwaysSuitePassesOnlyWhenEveryScenarioPassed(s: Suite): bool =
  s.status == SuitePassed implies s.entries.every(e => e.status == ScenarioPassed)
pure def stepCompletedScenarioNeverRunsAgain(before: Suite, after: Suite): bool =
  before.entries.every(b => b.complete implies after.entries.some(a => a.scenario == b.scenario and a.complete
    and a.executions == b.executions))
pure def sometimesSuitePassed(s: Suite): bool = s.status == SuitePassed
pure def sometimesSuiteWaiting(s: Suite): bool = s.status == SuiteWaiting and s.entries.some(e => e.complete and e.status == ScenarioPending)
pure def sometimesScenarioFailed(s: Suite): bool = s.status == SuiteFailed and s.entries.some(e => e.status == ScenarioFailed)
pure def sometimesFinalizedOnALaterRun(s: Suite): bool = s.runs > 1 and s.entries.some(e => e.status == ScenarioPassed and e.executions == 1)
pure def sometimesCompleteScenarioFailedFinality(s: Suite): bool = s.entries.some(e => e.complete and e.status == ScenarioFailed)
pure def sometimesWaitingDuringExecution(s: Suite): bool =
  s.entries.some(e => not(e.complete) and e.status == ScenarioPending and e.executions > 0)
pure def sometimesRecoveryRanFirst(s: Suite): bool = s.identityRotated and s.status == SuiteRunning and s.group == 1
  and s.entries.some(e => e.scenario == KeyRecovery and e.executions > 0)
  and s.entries.some(e => e.scenario == Bounty and e.executions == 0)
pure val expectedBounty: BountyFigures = { grossUnits: 100, researcherUnits: 75, slopFeeUnits: 25, otherFeeUnits: 0, leftUnits: 0,
  ordinaryAwardRefused: true, inexactSplitRefused: true, withdrawalRefused: true }
pure val expectedLifecycle: LifecycleFigures = { paidWithoutWallet: false, reservedWithoutWallet: true, wrongNetworkRefused: true,
  staleVersionRefused: true, replacementSupersedes: true, zeroDelayCancelRefused: true, recoveryPaidAtOnce: true }
pure val expectedMonthly: MonthlyFigures = { commitWhileOffRefused: true, closedWindowRefused: true, changedAllocationRefused: true,
  capAppliesToNext: true, optOutRespected: true, manualAwardPaidFirst: true, changedManualAwardRefused: true,
  newAwardsReserved: 2, manualAwardCountedOnce: true, doubleReservations: 0, doublePayments: 0, reservedAfter: 0 }
pure val expectedDispatch: DispatchFigures = { answerLost: true, interruptedPayments: 1, interruptedTransactions: 1,
  interruptedAttempts: 1, blockedRecipientPaid: false, blockedAwardReserved: true, unblockedRetriedAttempts: 1,
  unblockedPaid: true, feeClaimWhileFrozenRefused: true, payoutWhileFeeFrozen: true, feeClaimsAfterThaw: 1, owedLeft: 0 }
pure val expectedRecovery: RecoveryFigures = { oldKeyBindRefused: true, newKeyBinds: true, oldBindingStillPays: true,
  authorityRestored: true }
pure def lawBountySplitsSeventyFiveTwentyFive(bountyRun: BountyFigures): bool = bountyMet(bountyRun) implies
  (bountyRun.researcherUnits + bountyRun.slopFeeUnits == bountyRun.grossUnits and bountyRun.researcherUnits * 4 == bountyRun.grossUnits * 3)
pure def lawDoublePaymentNeverMeetsMonthly(monthlyRun: MonthlyFigures): bool = monthlyRun.doublePayments > 0 implies not(monthlyMet(monthlyRun))
pure val bountyRunValues = Set(expectedBounty).union(Set({ ...expectedBounty, researcherUnits: 98, slopFeeUnits: 2 }))
pure val lifecycleRunValues = Set(expectedLifecycle).union(Set({ ...expectedLifecycle, paidWithoutWallet: true }))
pure val monthlyRunValues = Set(expectedMonthly).union(Set({ ...expectedMonthly, doublePayments: 1 }))
pure val dispatchRunValues = Set(expectedDispatch).union(Set({ ...expectedDispatch, interruptedTransactions: 2 }))
pure val recoveryRunValues = Set(expectedRecovery).union(Set({ ...expectedRecovery, oldKeyBindRefused: false }))
pure val finalityValues = Set(Finalized, NotYetFinal, FinalityFailed)
pure val weight_runBounty = 10
pure val weight_runLifecycle = 10
pure val weight_runMonthly = 10
pure val weight_runDispatch = 10
pure val weight_runRecovery = 10
pure val weight_finishSuite = 10
```
