# Vault registration and finalized balance observations

PRD sections 6, 9 and 11 and the vault setup rules in Slop AGENTS require
immutable deployment registration, recoverable observation, and exact
finalized evidence. This unit models one project with independent ordinary
and private payout purposes. It coordinates the canonical project revision
append and the canonical observation writer. The registry owns authorization,
immutable manifests and deployment inventory. [Vault accounting](./vault.md)
owns funds and obligations. A snapshot reports a finalized read and confers
no right to deposit, withdraw, reserve or settle.

Source anchors at Slop main `6b3b9d0b979f0608d87941f1146056a98513ffcf` are
`backend/projects/{handler,vault-setup}.ts`,
`backend/payments/vault-snapshots.ts`, `backend/security/payment-database.ts`,
`workers/payments/index.ts`, `contracts/solana/adapter.ts` and
`scripts/recover-vault-observations.ts`. The legacy
`vault_initial_snapshot` scenarios model the same race with one
representative cumulative counter. Development
`0d0f0817a439df03cc022bf7aeed4bbe64ef4c65` additionally gates the scheduled
Solana totals read on the reviewed genesis root in
`workers/payments/index.ts` and `contracts/solana/adapter.ts`. The associated
`workers/payments/solana-progress.workflow.mjs` tests observe both separate
workers' checks. This unit covers the snapshot check only.

## Story: Register the reviewed deployment before observing its balances

### Retry recognizes the exact creation transaction before checking a revision

Requests capture one registry read. Existing scoped network and transaction
recognition permits another observation, including after an unrelated owner
edit. A new attempt can verify against an older retained revision when its
ordinary or private payment policy is compatible with the captured current
revision. New attachment uses the current immutable revision as its compare
target. A write conflict fails and a fresh request may recognize the winner.
The reviewed policy identity represents the source's exact normalized
comparisons for the chosen purpose. External authorization and creation
verification establish authenticated current steward or repository administrator,
project eligibility, reviewed factory or Solana program, and exact deployment
identity. A pending or merely included creation exposes no registered snapshot.

```quint
import money as M from "./money"
type Purpose = Ordinary | PrivateBounty
type Chain = Evm | SolanaMain | SolanaOther
type RequestPhase = ReadyRegistration | ReadyAppend | ReadyChainCheck | ReadyGenesisProbe | ReadyTotals | ReadyPrior | ReadyWrite | RequestDone
type RequestResult = NoResult | CreationPending | RegistrationConflict | RegistrationRefused | ObservationUnavailable | ObservationOlder | ObservationStored | ObservationReplyLost
type CreationFinality = UnverifiedCreation | PendingCreation | IncludedCreation | FinalizedCreation
type WriteReply = WriteFailed | WriteAcknowledged | WriteReplyLost
type Source = RegistrationRequest | ScheduledRead | RecoveryRead
type Identity = { chain: Chain, network: str, vault: str, readVault: str, asset: str, decimals: int, rules: str }
type Creation = { identity: Identity, transaction: str, reviewed: int, purpose: Purpose, status: CreationFinality }
type Registration = { tx: str, revision: int, identity: Identity }
type Revision = { number: int, ordinaryPolicy: int, privatePolicy: int }
type Counters = { deposits: M::Amount, payments: M::Amount, payoutFees: M::Amount, withdrawals: M::Amount, withdrawalFees: M::Amount }
type Balance = { present: bool, amount: M::Amount }
type Balances = { free: Balance, principal: Balance, feesReserved: Balance, feesAccrued: Balance, reserved: Balance }
type Observation = { exists: bool, identity: Identity, purpose: Purpose, block: M::Amount, blockTime: int,
  observedAt: int, counters: Counters, balances: Balances, legacyServiceFees: M::Amount }
type DeploymentRow = { registration: Registration, observation: Observation }
type RequestRow = { id: int, purpose: Purpose, source: Source, phase: RequestPhase, result: RequestResult, http: int,
  capture: int, expected: int, network: str, tx: str, registration: Registration, incoming: Observation,
  genesisRoot: str, genesisConfirmed: bool, genesisProbes: int }
type Snapshots = { revision: Revision, history: List[Revision], ordinary: DeploymentRow, privateBounty: DeploymentRow,
  requests: List[RequestRow] }
pure val noIdentity: Identity = { chain: Evm, network: "", vault: "", readVault: "", asset: "", decimals: 0, rules: "" }
pure val noRegistration: Registration = { tx: "", revision: 0, identity: noIdentity }
pure val noRevision: Revision = { number: 0, ordinaryPolicy: 0, privatePolicy: 0 }
pure val firstRevision: Revision = { number: 1, ordinaryPolicy: 1, privatePolicy: 2 }
pure val zeroCounters: Counters = { deposits: M::zero, payments: M::zero, payoutFees: M::zero, withdrawals: M::zero, withdrawalFees: M::zero }
pure val missingBalance: Balance = { present: false, amount: M::zero }
pure val zeroBalances: Balances = { free: missingBalance, principal: missingBalance, feesReserved: missingBalance,
  feesAccrued: missingBalance, reserved: missingBalance }
pure val noObservation: Observation = { exists: false, identity: noIdentity, purpose: Ordinary, block: M::zero,
  blockTime: 0, observedAt: 0, counters: zeroCounters, balances: zeroBalances, legacyServiceFees: M::zero }
pure val noDeployment: DeploymentRow = { registration: noRegistration, observation: noObservation }
pure val noRequest: RequestRow = { id: 0, purpose: Ordinary, source: RegistrationRequest, phase: RequestDone,
  result: NoResult, http: 0, capture: 0, expected: 0, network: "", tx: "", registration: noRegistration,
  incoming: noObservation, genesisRoot: "", genesisConfirmed: false, genesisProbes: 0 }
pure val initial: Snapshots = { revision: firstRevision, history: List(firstRevision),
  ordinary: noDeployment, privateBounty: noDeployment, requests: List() }
pure def deployment(s: Snapshots, purpose: Purpose): DeploymentRow = if (purpose == Ordinary) s.ordinary else s.privateBounty
pure def setDeployment(purpose: Purpose, row: DeploymentRow, s: Snapshots): Snapshots =
  if (purpose == Ordinary) { ...s, ordinary: row } else { ...s, privateBounty: row }
pure def requestRow(s: Snapshots, requestId: int): RequestRow = s.requests.select(r => r.id == requestId).nthOr(0, noRequest)
pure def updateRequest(r: RequestRow, s: Snapshots): Snapshots = { ...s, requests: s.requests.listMap(old => if (old.id == r.id) r else old) }
pure def finish(r: RequestRow, conclusion: RequestResult, http: int, s: Snapshots): Snapshots =
  updateRequest({ ...r, phase: RequestDone, result: conclusion, http: http }, s)
pure def immutableRevision(s: Snapshots, number: int): Revision = s.history.select(r => r.number == number).nthOr(0, noRevision)
pure def policy(revision: Revision, purpose: Purpose): int = if (purpose == Ordinary) revision.ordinaryPolicy else revision.privatePolicy
pure def registered(r: Registration): bool = r.revision > 0
pure def validIdentity(identity: Identity): bool = identity.network != "" and identity.vault != ""
  and identity.readVault != "" and identity.asset != "" and identity.rules != "" and identity.decimals >= 0
pure def nextRevision(revision: Revision, s: Snapshots): Snapshots = { ...s, revision: revision, history: s.history.append(revision) }
pure def canAppendRegistryRevision(s: Snapshots, ordinaryPolicy: int, privatePolicy: int, authorized: bool): bool =
  authorized and ordinaryPolicy > 0 and privatePolicy > 0
pure def appendRegistryRevision(s: Snapshots, ordinaryPolicy: int, privatePolicy: int, authorized: bool): Snapshots =
  nextRevision({ number: s.revision.number + 1, ordinaryPolicy: ordinaryPolicy, privatePolicy: privatePolicy }, s)
pure def firstReadPhase(identity: Identity): RequestPhase = if (identity.chain == Evm) ReadyTotals else ReadyChainCheck
pure def canBeginRegistration(s: Snapshots, requestId: int, tx: str, network: str, authorized: bool): bool =
  requestId > 0 and requestRow(s, requestId).id == 0 and tx != "" and network != "" and authorized
pure def beginRegistration(s: Snapshots, requestId: int, purpose: Purpose, tx: str, network: str, expected: int,
  authorized: bool): Snapshots =
  val binding = deployment(s, purpose).registration
  val existing = registered(binding) and binding.tx == tx and binding.identity.network == network
  val phase = if (existing) firstReadPhase(binding.identity) else if (registered(binding)) RequestDone else ReadyRegistration
  { ...s, requests: s.requests.append({ ...noRequest, id: requestId, purpose: purpose, phase: phase,
    result: if (phase == RequestDone) RegistrationConflict else NoResult, http: if (phase == RequestDone) 409 else 0,
    capture: s.revision.number, expected: expected, tx: tx, network: network,
    registration: if (existing) binding else noRegistration }) }
pure def canCheckCreation(s: Snapshots, requestId: int): bool = requestRow(s, requestId).phase == ReadyRegistration
pure def checkCreation(s: Snapshots, requestId: int, creation: Creation): Snapshots =
  val r = requestRow(s, requestId)
  val reviewed = immutableRevision(s, r.expected)
  val captured = immutableRevision(s, r.capture)
  if (reviewed.number == 0 or policy(reviewed, r.purpose) != policy(captured, r.purpose))
    finish(r, RegistrationConflict, 409, s)
  else if (creation.transaction != r.tx or creation.reviewed != r.expected or creation.purpose != r.purpose
    or creation.status == UnverifiedCreation) finish(r, RegistrationRefused, 409, s)
  else if (creation.status == PendingCreation) finish(r, CreationPending, 200, s)
  else if (not(validIdentity(creation.identity)) or creation.identity.network != r.network)
    finish(r, RegistrationRefused, 409, s)
  else if (creation.status == IncludedCreation) finish(r, CreationPending, 200, s)
  else updateRequest({ ...r, phase: ReadyAppend, registration: { ...noRegistration, tx: r.tx, identity: creation.identity } }, s)
pure def canCommitRegistration(s: Snapshots, requestId: int): bool = requestRow(s, requestId).phase == ReadyAppend
pure def commitRegistration(s: Snapshots, requestId: int, saved: bool): Snapshots =
  val r = requestRow(s, requestId)
  val revision = { ...s.revision, number: s.revision.number + 1 }
  val admitted = { ...r.registration, revision: revision.number }
  val attached = setDeployment(r.purpose, { ...noDeployment, registration: admitted }, nextRevision(revision, s))
  if (not(saved) or r.capture != s.revision.number or registered(deployment(s, r.purpose).registration))
    finish(r, RegistrationConflict, 409, s)
  else updateRequest({ ...r, phase: firstReadPhase(admitted.identity), registration: admitted }, attached)
```

## Story: Recover or refresh with exact finalized evidence

### Only a reviewed registry binding can obtain totals

A scheduled read uses the matching registered deployment. Missing-observation
repair is restricted to an ordinary Solana mainnet deployment and the exact
trusted release workflow, event, branch and checkout. Selection skips a
retained observation. A writer can still race after this selection. Recovery
and normal refresh use the same atomic predicate and neither appends a registry
revision. Solana captures its configured reviewed genesis root before reading the
endpoint identity and requires a match before any vault totals RPC. A missing root makes no RPC. A wrong or unavailable result permits
only the attempted genesis probe. A full read carries the finalized vault
or project PDA, asset, decimals and reviewed deployment facts. Post-read
failures leave the canonical registration immutable.

```quint
pure def canBeginRead(s: Snapshots, requestId: int, purpose: Purpose): bool = requestId > 0
  and requestRow(s, requestId).id == 0 and registered(deployment(s, purpose).registration)
pure def beginBoundRead(purpose: Purpose, requestId: int, origin: Source, s: Snapshots): Snapshots =
  val binding = deployment(s, purpose).registration
  { ...s, requests: s.requests.append({ ...noRequest, id: requestId, purpose: purpose, source: origin,
    phase: firstReadPhase(binding.identity), capture: s.revision.number, registration: binding }) }
pure def beginRead(s: Snapshots, requestId: int, purpose: Purpose): Snapshots =
  beginBoundRead(purpose, requestId, ScheduledRead, s)
pure def canBeginRecovery(s: Snapshots, requestId: int, trustedMain: bool): bool =
  trustedMain and canBeginRead(s, requestId, Ordinary) and s.ordinary.registration.identity.chain == SolanaMain
    and not(s.ordinary.observation.exists)
pure def beginRecovery(s: Snapshots, requestId: int, trustedMain: bool): Snapshots =
  beginBoundRead(Ordinary, requestId, RecoveryRead, s)
pure def canPinGenesis(s: Snapshots, requestId: int): bool = requestRow(s, requestId).phase == ReadyChainCheck
pure def pinGenesis(s: Snapshots, requestId: int, pinnedRoot: str): Snapshots =
  val r = requestRow(s, requestId)
  if (pinnedRoot == "") finish(r, ObservationUnavailable, 503, s)
  else updateRequest({ ...r, phase: ReadyGenesisProbe, genesisRoot: pinnedRoot }, s)
pure def canCheckGenesis(s: Snapshots, requestId: int): bool =
  val r = requestRow(s, requestId)
  r.phase == ReadyGenesisProbe and r.genesisRoot != ""
pure def checkGenesis(s: Snapshots, requestId: int, seenRoot: str): Snapshots =
  val r = requestRow(s, requestId)
  val checked = { ...r, genesisProbes: 1 }
  if (seenRoot != r.genesisRoot) finish(checked, ObservationUnavailable, 503, s)
  else updateRequest({ ...checked, phase: ReadyTotals, genesisConfirmed: true }, s)
pure def validCounters(c: Counters): bool = M::validAmount(c.deposits) and M::validAmount(c.payments)
  and M::validAmount(c.payoutFees) and M::validAmount(c.withdrawals) and M::validAmount(c.withdrawalFees)
pure def validBalance(b: Balance): bool = if (b.present) M::validAmount(b.amount) else b.amount == M::zero
pure def validBalances(b: Balances): bool = validBalance(b.free) and validBalance(b.principal)
  and validBalance(b.feesReserved) and validBalance(b.feesAccrued) and validBalance(b.reserved)
pure def exactObservation(observation: Observation, r: RequestRow): bool =
  observation.exists and observation.identity == r.registration.identity and observation.purpose == r.purpose
    and M::validAmount(observation.block) and observation.blockTime > 0 and observation.observedAt > 0
    and validCounters(observation.counters) and validBalances(observation.balances)
pure def canReadTotals(s: Snapshots, requestId: int): bool =
  val r = requestRow(s, requestId)
  r.phase == ReadyTotals and (r.registration.identity.chain == Evm or r.genesisConfirmed)
pure def readTotals(s: Snapshots, requestId: int, observation: Observation, finalized: bool): Snapshots =
  val r = requestRow(s, requestId)
  if (finalized and exactObservation(observation, r))
    updateRequest({ ...r, phase: ReadyPrior, incoming: { ...observation, legacyServiceFees: M::zero } }, s)
  else finish(r, ObservationUnavailable, 503, s)
pure def canObservationFails(s: Snapshots, requestId: int): bool =
  val phase = requestRow(s, requestId).phase
  phase == ReadyChainCheck or phase == ReadyGenesisProbe or phase == ReadyTotals or phase == ReadyPrior or phase == ReadyWrite
pure def observationFails(s: Snapshots, requestId: int): Snapshots =
  finish(requestRow(s, requestId), ObservationUnavailable, 503, s)
```

### The write compares the latest row atomically

Compare finalized block first and observation time within the same block.
Check every cumulative deposit, payout, payout fee, withdrawal and withdrawal
fee counter. Copy current balances from the winning observation even if they
decrease. Nullable legacy balances remain distinct from known zero amounts. Preserve legacy service fees exactly
for retained rows and initialize the retired column to zero for a first write.
Amount comparison uses arbitrary-length base-unit limbs. An unsuccessful
conditional write can return older or unavailable as appropriate. A write
that succeeded with a lost reply may still be confirmed by reading the row.

```quint
pure def countersAdvance(newer: Counters, older: Counters): bool =
  M::compareAmounts(newer.deposits, older.deposits) >= 0 and M::compareAmounts(newer.payments, older.payments) >= 0
    and M::compareAmounts(newer.payoutFees, older.payoutFees) >= 0
    and M::compareAmounts(newer.withdrawals, older.withdrawals) >= 0
    and M::compareAmounts(newer.withdrawalFees, older.withdrawalFees) >= 0
pure def isOlder(incoming: Observation, prior: Observation): bool = prior.exists and
  (M::compareAmounts(incoming.block, prior.block) < 0 or
    (M::equalAmounts(incoming.block, prior.block) and incoming.observedAt < prior.observedAt))
pure def writable(incoming: Observation, prior: Observation): bool = not(prior.exists) or
  (not(isOlder(incoming, prior)) and incoming.identity == prior.identity and countersAdvance(incoming.counters, prior.counters))
pure def canReadPrior(s: Snapshots, requestId: int): bool = requestRow(s, requestId).phase == ReadyPrior
pure def readPrior(s: Snapshots, requestId: int): Snapshots =
  val r = requestRow(s, requestId)
  val prior = deployment(s, r.purpose).observation
  if (prior.exists and M::compareAmounts(r.incoming.block, prior.block) < 0) finish(r, ObservationOlder, 200, s)
  else if (prior.exists and (r.incoming.identity != prior.identity or not(countersAdvance(r.incoming.counters, prior.counters))))
    finish(r, ObservationUnavailable, 503, s)
  else updateRequest({ ...r, phase: ReadyWrite }, s)
pure def canWrite(s: Snapshots, requestId: int): bool =
  val r = requestRow(s, requestId)
  r.phase == ReadyWrite and registered(r.registration) and r.registration == deployment(s, r.purpose).registration
    and r.incoming.exists and r.incoming.identity == r.registration.identity and r.incoming.purpose == r.purpose
pure def write(s: Snapshots, requestId: int, reply: WriteReply): Snapshots =
  val r = requestRow(s, requestId)
  val row = deployment(s, r.purpose)
  val prior = row.observation
  val nextObservation = { ...r.incoming, legacyServiceFees: if (prior.exists) prior.legacyServiceFees else M::zero }
  val committed = setDeployment(r.purpose, { ...row, observation: nextObservation }, s)
  if (reply == WriteFailed) finish(r, ObservationUnavailable, 503, s)
  else if (writable(r.incoming, prior) and reply == WriteReplyLost) finish(r, ObservationReplyLost, 503, committed)
  else if (writable(r.incoming, prior)) finish(r, ObservationStored, 200, committed)
  else if (reply == WriteAcknowledged and isOlder(r.incoming, prior)) finish(r, ObservationOlder, 200, s)
  else finish(r, ObservationUnavailable, 503, s)
pure def rowScoped(row: DeploymentRow, purpose: Purpose): bool = row.observation.exists implies
  (registered(row.registration) and row.observation.identity == row.registration.identity and row.observation.purpose == purpose)
pure def alwaysObservationScoped(s: Snapshots): bool = rowScoped(s.ordinary, Ordinary) and rowScoped(s.privateBounty, PrivateBounty)
pure def observationMonotonic(before: Observation, after: Observation): bool = before.exists implies
  (after.exists and (before == after or writable(after, before)) and after.legacyServiceFees == before.legacyServiceFees)
pure def stepOrdinaryObservationMonotonic(before: Snapshots, via: str, after: Snapshots): bool =
  via == "write" implies observationMonotonic(before.ordinary.observation, after.ordinary.observation)
pure def stepPrivateObservationMonotonic(before: Snapshots, via: str, after: Snapshots): bool =
  via == "write" implies observationMonotonic(before.privateBounty.observation, after.privateBounty.observation)
pure def stepRegistrationIsImmutable(before: Snapshots, after: Snapshots): bool =
  (registered(before.ordinary.registration) implies before.ordinary.registration == after.ordinary.registration)
    and (registered(before.privateBounty.registration) implies before.privateBounty.registration == after.privateBounty.registration)
pure def stepWritePreservesRegistry(before: Snapshots, via: str, after: Snapshots): bool = via == "write" implies
  (before.revision == after.revision and before.history == after.history)
pure def sometimesStored(s: Snapshots): bool = s.ordinary.observation.exists or s.privateBounty.observation.exists
pure def sometimesRegisteredWithoutObservation(s: Snapshots): bool = registered(s.ordinary.registration)
  and not(s.ordinary.observation.exists) and s.requests.some(r => r.result == ObservationUnavailable)
pure def sometimesTrustedRecovery(s: Snapshots): bool =
  s.requests.some(r => r.source == RecoveryRead and r.result == ObservationStored)
pure val evm: Identity = { ...noIdentity, network: "Base", vault: "vault", readVault: "vault", asset: "token", decimals: 6, rules: "reviewed" }
pure val solana: Identity = { ...evm, chain: SolanaMain, network: "Solana", readVault: "project-pda" }
pure val ordinaryRead: Observation = { ...noObservation, exists: true, identity: evm, block: List(1), blockTime: 1,
  observedAt: 1, counters: { ...zeroCounters, deposits: List(123, 4, 0, 0, 0, 10) } }
pure val privateRead: Observation = { ...ordinaryRead, purpose: PrivateBounty }
pure val solanaRead: Observation = { ...ordinaryRead, identity: solana }
pure val observationValues = Set(ordinaryRead, privateRead, solanaRead,
  { ...ordinaryRead, block: List(2), observedAt: 1 }, { ...ordinaryRead, observedAt: 2 },
  { ...ordinaryRead, block: List(2), counters: zeroCounters },
  { ...solanaRead, block: List(2), observedAt: 1 }, { ...solanaRead, observedAt: 2 })
pure val baseCreation: Creation = { identity: evm, transaction: "creation-one", reviewed: 1, purpose: Ordinary, status: FinalizedCreation }
pure val creationValues = Set(baseCreation, { ...baseCreation, identity: solana }, { ...baseCreation, purpose: PrivateBounty },
  { ...baseCreation, status: IncludedCreation }, { ...baseCreation, status: PendingCreation },
  { ...baseCreation, status: UnverifiedCreation }, { ...baseCreation, transaction: "creation-two", reviewed: 2 })
pure val networkValues = Set("Base", "Solana")
pure val txValues = Set("creation-one")
pure val requestIdValues = Set(1, 2, 3, 4, 5, 6)
pure val expectedValues = Set(1, 2)
pure val ordinaryPolicyValues = Set(1, 3)
pure val privatePolicyValues = Set(2, 4)
pure val pinnedRootValues = Set("", "genesis")
pure val seenRootValues = Set("genesis", "wrong")
pure val weight_beginRegistration = 2
pure val weight_checkCreation = 12
pure val weight_commitRegistration = 10
pure val weight_beginRecovery = 12
pure val weight_pinGenesis = 12
pure val weight_checkGenesis = 12
pure val weight_readTotals = 12
pure val weight_readPrior = 12
pure val weight_write = 12
```

RPC truth, the encoding of compatible current policy, authenticated authority,
absolute observation timestamps, and D1's atomic append and upsert require
application and deployment conformance.
