# EVM project escrow

This specification owns the on-chain state of `EscrowFactory` and
`ProjectEscrow` in `packages/contracts/evm/src/ProjectEscrow.sol`, version 5
signatures behind ERC-1967 UUPS proxies (PRD section 6, "Assets and
funding", "Monthly allocation", "Fees and payment evidence" and "Service
signer boundaries"). One state holds the factory and the first vault it
creates; later vaults record only their keys, which is all the factory keeps
of them. Addresses are strings, the empty string is the zero address, and
`"vault"` is the vault's own address. ECDSA and EIP-712 checks are booleans
that the chain adapter verifies: the attester's signature over an allocation,
reservation or release digest, and the destination wallet's signature over
its binding. Merkle-sum proofs are modeled by the allocation's leaves, which
the signed root commits to. A failed or inexact asset transfer reverts the
whole call. The model describes this implementation's logic; an upgrade
replaces logic and needs its own specification before its rules are relied on.

## Story: Deploy the factory with separate keys

### The factory is initialized once with an upgrade key apart from the fee recipient and identity, and an identity apart from the registrar

`EscrowFactory.initialize` runs atomically in the proxy's constructor. The
upgrade authority differs from the fee recipient and the identity authority,
and the identity authority differs from the registrar. The award and binding
review delay is from zero through 30 days; new deployments use zero. The
vault implementation must be UUPS-compatible (`proxiableUUID`).

```quint
import ledger as L from "./ledger"
import money as M from "../settlement/money"
type VaultKey = { owner: str, project: str, token: str, purpose: L::Purpose }
type Binding = { actor: int, destination: str, version: int, claim: int, activatesAt: int, cancelled: bool,
  attester: str, walletSigned: bool, paidVersion: int, cancels: int }
type Month = { period: int, version2: bool, digest: str, root: str, wholeGross: int, total: int, remaining: int,
  count: int, committedGross: int, released: int, admittedAt: int, cap: int, leaves: List[L::Leaf] }
type Pledge = { period: int, amount: int, open: bool }
type LeafOrigin = { period: int, leaf: L::Leaf }
type Reservation = { digest: str, root: str, wholeGross: int, remainingGross: int, count: int, leaves: List[L::Leaf] }
type Vault = { key: VaultKey, native: bool, feeRecipient: str, bindingDelay: int, implementation: int,
  free: int, pendingMonthly: int, reservedPrincipal: int, reservedFees: int, deposited: int, paid: int, payoutFees: int,
  grossWithdrawn: int, withdrawalFees: int, accruedFees: int, claimedFees: int, ownerRefunded: int,
  balance: int, unsolicited: int, monthlyCap: int, monthlyEnabled: bool, sourceSequence: int,
  awards: List[L::Award], bindings: List[Binding], months: List[Month], pledges: List[Pledge], pledged: int,
  origins: List[LeafOrigin] }
type Escrow = { initialized: bool, now: int, factoryImplementation: int, vaultImplementation: int,
  upgradeAuthority: str, pendingUpgradeAuthority: str, registrar: str, feeRecipient: str, bindingDelay: int,
  identityAuthority: str, pendingIdentityAuthority: str, identityEffectiveAt: int,
  vaultKeys: List[VaultKey], created: bool, vault: Vault }
pure val maxBindingDelay = 30 * 86400
pure val rotationDelay = 0
pure val emptyKey: VaultKey = { owner: "", project: "", token: "", purpose: L::Ordinary }
pure val emptyVault: Vault = { key: emptyKey, native: false, feeRecipient: "", bindingDelay: 0, implementation: 0,
  free: 0, pendingMonthly: 0, reservedPrincipal: 0, reservedFees: 0, deposited: 0, paid: 0, payoutFees: 0,
  grossWithdrawn: 0, withdrawalFees: 0, accruedFees: 0, claimedFees: 0, ownerRefunded: 0,
  balance: 0, unsolicited: 0, monthlyCap: 0, monthlyEnabled: false, sourceSequence: 0,
  awards: List(), bindings: List(), months: List(), pledges: List(), pledged: 0, origins: List() }
pure val initial: Escrow = { initialized: false, now: 1796342399, factoryImplementation: 0, vaultImplementation: 0,
  upgradeAuthority: "", pendingUpgradeAuthority: "", registrar: "", feeRecipient: "", bindingDelay: 0,
  identityAuthority: "", pendingIdentityAuthority: "", identityEffectiveAt: 0,
  vaultKeys: List(), created: false, vault: emptyVault }
pure def canInitializeFactory(e: Escrow, registrar: str, feeRecipient: str, identity: str, delay: int,
  upgrader: str, factoryLogic: int, logic: int, uups: bool): bool =
  not(e.initialized) and upgrader != "" and upgrader != feeRecipient and upgrader != identity
    and factoryLogic > 0 and logic > 0 and uups
    and registrar != "" and feeRecipient != "" and identity != "" and identity != registrar
    and delay >= 0 and delay <= maxBindingDelay
pure def initializeFactory(e: Escrow, registrar: str, feeRecipient: str, identity: str, delay: int,
  upgrader: str, factoryLogic: int, logic: int, uups: bool): Escrow =
  { ...e, initialized: true, factoryImplementation: factoryLogic, vaultImplementation: logic, upgradeAuthority: upgrader,
    registrar: registrar, feeRecipient: feeRecipient, identityAuthority: identity, bindingDelay: delay }
pure def canTick(e: Escrow, timestamp: int): bool = timestamp > e.now
pure def tick(e: Escrow, timestamp: int): Escrow = { ...e, now: timestamp }
```

### Block time is positive

Awards record `block.timestamp` as their commitment time and bindings as
their activation time; both must be positive, and a live chain's timestamp
is never zero.

```quint
pure def alwaysClockStarted(e: Escrow): bool = e.now > 0
```

### Upgrade control moves only to an accepting recipient that holds no service key

`proposeUpgradeAuthority` names a nonzero recipient that is neither the fee
recipient nor the current or pending identity authority, and
`acceptUpgradeAuthority` completes the transfer when that recipient calls it.
No delay applies. The upgrade authority alone selects the implementation for
new vaults (`setVaultImplementation`), upgrades the factory and upgrades each
existing vault (`_authorizeUpgrade`); each target must be UUPS-compatible.
Proxy storage, and so every balance, award and binding, survives an upgrade.

```quint
pure def canProposeUpgradeAuthority(e: Escrow, successor: str, by: str): bool = e.initialized and by == e.upgradeAuthority
  and successor != "" and successor != e.feeRecipient and successor != e.identityAuthority and successor != e.pendingIdentityAuthority
pure def proposeUpgradeAuthority(e: Escrow, successor: str, by: str): Escrow = { ...e, pendingUpgradeAuthority: successor }
pure def canAcceptUpgradeAuthority(e: Escrow, by: str): bool = e.initialized and e.pendingUpgradeAuthority != "" and by == e.pendingUpgradeAuthority
pure def acceptUpgradeAuthority(e: Escrow, by: str): Escrow = { ...e, upgradeAuthority: by, pendingUpgradeAuthority: "" }
pure def canSetVaultImplementation(e: Escrow, logic: int, uups: bool, by: str): bool =
  e.initialized and by == e.upgradeAuthority and logic > 0 and uups
pure def setVaultImplementation(e: Escrow, logic: int, uups: bool, by: str): Escrow = { ...e, vaultImplementation: logic }
pure def canUpgradeFactory(e: Escrow, logic: int, uups: bool, by: str): bool =
  e.initialized and by == e.upgradeAuthority and logic > 0 and uups
pure def upgradeFactory(e: Escrow, logic: int, uups: bool, by: str): Escrow = { ...e, factoryImplementation: logic }
pure def canUpgradeVault(e: Escrow, logic: int, uups: bool, by: str): bool =
  e.created and by == e.upgradeAuthority and logic > 0 and uups
pure def upgradeVault(e: Escrow, logic: int, uups: bool, by: str): Escrow = { ...e, vault: { ...e.vault, implementation: logic } }
```

### The registrar rotates the identity authority with no delay the current authority can block

`proposeIdentityAuthority` names one replacement, which is nonzero and
differs from the current authority, the registrar and the current and
pending upgrade authorities. `AUTHORITY_ROTATION_DELAY` is zero, so anyone
may call `executeIdentityAuthorityRotation` at once; only the registrar can
withdraw its proposal. The factory cannot see vault owners, so the registrar
must not propose a vault owner. Bindings never reference the authority and
survive rotation.

```quint
pure def canProposeIdentityAuthority(e: Escrow, successor: str, by: str): bool = e.initialized and by == e.registrar
  and successor != "" and successor != e.identityAuthority and successor != e.registrar and successor != e.upgradeAuthority
  and successor != e.pendingUpgradeAuthority and e.pendingIdentityAuthority == ""
pure def proposeIdentityAuthority(e: Escrow, successor: str, by: str): Escrow =
  { ...e, pendingIdentityAuthority: successor, identityEffectiveAt: e.now + rotationDelay }
pure def canCancelIdentityAuthorityRotation(e: Escrow, by: str): bool =
  e.initialized and by == e.registrar and e.pendingIdentityAuthority != ""
pure def cancelIdentityAuthorityRotation(e: Escrow, by: str): Escrow = { ...e, pendingIdentityAuthority: "", identityEffectiveAt: 0 }
pure def canExecuteIdentityAuthorityRotation(e: Escrow): bool =
  e.initialized and e.pendingIdentityAuthority != "" and e.now >= e.identityEffectiveAt
pure def executeIdentityAuthorityRotation(e: Escrow): Escrow =
  { ...e, identityAuthority: e.pendingIdentityAuthority, pendingIdentityAuthority: "", identityEffectiveAt: 0 }
pure val fair_executeIdentityAuthorityRotation = "weak"
pure def leadsToRotationResolved(e: Escrow, later: Escrow): bool =
  e.pendingIdentityAuthority != "" implies later.pendingIdentityAuthority == ""
```

### Factory roles stay distinct through every transfer and rotation

The contract does not refuse an identity authority equal to the fee
recipient, nor an upgrade authority equal to the registrar; those
separations rest on deployment review.

```quint
pure def alwaysFactoryRolesSeparate(e: Escrow): bool = e.initialized implies
  e.upgradeAuthority != "" and e.registrar != "" and e.feeRecipient != "" and e.identityAuthority != ""
    and e.upgradeAuthority != e.feeRecipient and e.upgradeAuthority != e.identityAuthority
    and e.upgradeAuthority != e.pendingIdentityAuthority and e.identityAuthority != e.registrar
    and e.pendingIdentityAuthority != e.identityAuthority and e.pendingIdentityAuthority != e.registrar
    and (e.pendingUpgradeAuthority == "" or (e.pendingUpgradeAuthority != e.feeRecipient
      and e.pendingUpgradeAuthority != e.identityAuthority and e.pendingUpgradeAuthority != e.pendingIdentityAuthority))
    and e.bindingDelay >= 0 and e.bindingDelay <= maxBindingDelay
    and e.factoryImplementation > 0 and e.vaultImplementation > 0
pure def alwaysUninitializedEmpty(e: Escrow): bool = not(e.initialized) implies
  e.upgradeAuthority == "" and e.pendingUpgradeAuthority == "" and e.registrar == "" and e.feeRecipient == ""
    and e.identityAuthority == "" and e.pendingIdentityAuthority == "" and e.vaultKeys.length() == 0 and not(e.created)
pure def alwaysRotationEffective(e: Escrow): bool =
  if (e.pendingIdentityAuthority == "") e.identityEffectiveAt == 0 else e.identityEffectiveAt <= e.now
```

### Only the upgrade authority changes logic and only a rotation changes the identity authority

```quint
pure def stepAuthorityChanges(before: Escrow, via: str, after: Escrow): bool =
  (before.vault.implementation != after.vault.implementation implies (via == "upgradeVault" or via == "create" or via == "createWithMonthlyCommitment"))
    and (before.factoryImplementation != after.factoryImplementation implies (via == "upgradeFactory" or via == "initializeFactory"))
    and (before.vaultImplementation != after.vaultImplementation implies (via == "setVaultImplementation" or via == "initializeFactory"))
    and (before.identityAuthority != after.identityAuthority implies (via == "executeIdentityAuthorityRotation" or via == "initializeFactory"))
    and (before.upgradeAuthority != after.upgradeAuthority implies (via == "acceptUpgradeAuthority" or via == "initializeFactory"))
pure def stepConfigurationFixed(before: Escrow, after: Escrow): bool =
  (before.initialized implies after.initialized and after.registrar == before.registrar
    and after.feeRecipient == before.feeRecipient and after.bindingDelay == before.bindingDelay)
    and (before.created implies after.created and after.vault.key == before.vault.key and after.vault.native == before.vault.native
      and after.vault.feeRecipient == before.vault.feeRecipient and after.vault.bindingDelay == before.vault.bindingDelay)
    and before.vaultKeys.every(k => after.vaultKeys.includes(k))
pure def sometimesRotated(e: Escrow): bool = e.initialized and e.identityAuthority == "nextAttester"
pure def sometimesUpgradeAuthorityTransferred(e: Escrow): bool = e.initialized and e.upgradeAuthority == "nextUpgrader"
pure def sometimesVaultUpgraded(e: Escrow): bool = e.created and e.vault.implementation == 2
pure def sometimesFactoryUpgraded(e: Escrow): bool = e.factoryImplementation == 2
```

## Story: Create one vault per owner, project, token and purpose

### The caller becomes the owner of the only vault for its key

`create` and `createWithMonthlyCommitment` key the vault by
`vaultKey(msg.sender, projectId, token, purpose)` and refuse a second vault
for that key. The vault initializes atomically with the factory's fee
recipient, binding delay and current vault implementation, and refuses a
zero project, a token without code or readable decimals, and an owner equal
to the identity authority. The zero token is native ETH. `create` leaves
monthly commitments off; `createWithMonthlyCommitment` creates an ordinary
vault with the owner's cap, and refuses an enabled zero cap.

```quint
pure def keyOf(owner: str, project: str, token: str, purpose: L::Purpose): VaultKey =
  { owner: owner, project: project, token: token, purpose: purpose }
pure def canCreate(e: Escrow, project: str, token: str, purpose: L::Purpose, tokenReady: bool, by: str): bool =
  e.initialized and by != "" and by != "vault" and not(e.vaultKeys.includes(keyOf(by, project, token, purpose)))
    and project != "" and (token == "" or tokenReady) and by != e.identityAuthority
pure def freshVault(e: Escrow, key: VaultKey, cap: int, on: bool): Vault =
  { ...emptyVault, key: key, native: key.token == "", feeRecipient: e.feeRecipient, bindingDelay: e.bindingDelay,
    implementation: e.vaultImplementation, monthlyCap: cap, monthlyEnabled: on }
pure def withKey(key: VaultKey, e: Escrow, cap: int, on: bool): Escrow =
  { ...e, vaultKeys: e.vaultKeys.append(key), created: true, vault: if (e.created) e.vault else freshVault(e, key, cap, on) }
pure def create(e: Escrow, project: str, token: str, purpose: L::Purpose, tokenReady: bool, by: str): Escrow =
  withKey(keyOf(by, project, token, purpose), e, 0, false)
pure def canCreateWithMonthlyCommitment(e: Escrow, project: str, token: str, cap: int, on: bool, tokenReady: bool, by: str): bool =
  canCreate(e, project, token, L::Ordinary, tokenReady, by) and cap >= 0 and not(on and cap == 0)
pure def createWithMonthlyCommitment(e: Escrow, project: str, token: str, cap: int, on: bool, tokenReady: bool, by: str): Escrow =
  withKey(keyOf(by, project, token, L::Ordinary), e, cap, on)
pure def alwaysOneVaultPerKey(e: Escrow): bool = e.vaultKeys.every(k => e.vaultKeys.select(o => o == k).length() == 1)
pure def alwaysCreatedVault(e: Escrow): bool =
  (e.created == (e.vaultKeys.length() > 0))
    and (e.created implies e.vaultKeys.nthOr(0, emptyKey) == e.vault.key and e.vault.key.owner != ""
      and e.vault.key.project != "" and e.vault.native == (e.vault.key.token == "") and e.vault.feeRecipient == e.feeRecipient
      and e.vault.bindingDelay == e.bindingDelay and e.vault.implementation > 0 and e.vault.monthlyCap >= 0
      and not(e.vault.monthlyEnabled and e.vault.monthlyCap == 0))
    and (not(e.created) implies e.vault == emptyVault)
pure def sometimesTwoVaults(e: Escrow): bool = e.vaultKeys.length() >= 2
```

## Story: Hold deposits in one free balance

### Anyone deposits the exact amount, and only credited deposits enter the free balance

`deposit` requires a positive amount; native ETH requires exactly that
value, and a token requires zero value and an exact balance increase, so a
fee-on-transfer token reverts. A direct transfer is not credited: it raises
the asset balance but gives no free balance, award or refund right.

```quint
pure def canDeposit(e: Escrow, amount: int, sent: int, transferExact: bool): bool = e.created and amount > 0
  and (if (e.vault.native) sent == amount else sent == 0 and transferExact)
pure def deposit(e: Escrow, amount: int, sent: int, transferExact: bool): Escrow =
  { ...e, vault: { ...e.vault, free: e.vault.free + amount, deposited: e.vault.deposited + amount, balance: e.vault.balance + amount } }
pure def canTransferIn(e: Escrow, amount: int): bool = e.created and amount > 0
pure def transferIn(e: Escrow, amount: int): Escrow =
  { ...e, vault: { ...e.vault, balance: e.vault.balance + amount, unsolicited: e.vault.unsolicited + amount } }
pure def sometimesUnsolicited(e: Escrow): bool = e.vault.unsolicited > 0
```

### Every credited unit stays in exactly one bucket and the asset balance covers them all

The free balance, pending monthly gross, reserved principal and fees, paid
principal, payout fees and gross withdrawals sum to the deposits. The asset
balance equals what the vault still owes or holds: free, pending, reserved,
accrued fees and uncredited transfers. Accrued fees are the payout and
withdrawal fees not yet claimed, and the owner received each withdrawal
less its fee.

```quint
pure def alwaysConserved(e: Escrow): bool = e.vault.deposited == e.vault.free + e.vault.pendingMonthly
  + e.vault.reservedPrincipal + e.vault.reservedFees + e.vault.paid + e.vault.payoutFees + e.vault.grossWithdrawn
pure def alwaysBalanceCovers(e: Escrow): bool = e.vault.balance == e.vault.free + e.vault.pendingMonthly
  + e.vault.reservedPrincipal + e.vault.reservedFees + e.vault.accruedFees + e.vault.unsolicited
pure def alwaysFeesAccounted(e: Escrow): bool =
  e.vault.accruedFees + e.vault.claimedFees == e.vault.payoutFees + e.vault.withdrawalFees
    and e.vault.ownerRefunded + e.vault.withdrawalFees == e.vault.grossWithdrawn
pure def alwaysNonnegative(e: Escrow): bool = e.vault.free >= 0 and e.vault.pendingMonthly >= 0
  and e.vault.reservedPrincipal >= 0 and e.vault.reservedFees >= 0 and e.vault.deposited >= 0 and e.vault.paid >= 0
  and e.vault.payoutFees >= 0 and e.vault.grossWithdrawn >= 0 and e.vault.withdrawalFees >= 0
  and e.vault.accruedFees >= 0 and e.vault.claimedFees >= 0 and e.vault.ownerRefunded >= 0
  and e.vault.balance >= 0 and e.vault.unsolicited >= 0 and e.vault.sourceSequence >= 0
```

## Story: Commit awards from free funds

### The owner commits an ordinary award with the 2% fee or a bounty award with the 75/25 split

`commitAward` is for an ordinary vault and refuses while a monthly reserve
still has uncommitted leaves (`MonthlyLeavesPending`).
`commitBountyAward` is for a bounty vault and needs a gross divisible by
four. Both reserve the whole gross from the free balance and refuse a zero
actor, gross or source and a source already consumed. Every award in an
ordinary vault advances the source sequence, so it makes a reservation
signed at the earlier sequence stale. Both spend only unpledged free
funds, and the owner commits by hand nothing while the period whose window is
open is pledged, since each award would make its pledged reservation stale.

```quint
pure def recordable(v: Vault, source: int, actor: int, gross: int): bool =
  actor > 0 and gross > 0 and source > 0 and not(L::hasSource(v.awards, source))
pure def recorded(v: Vault, source: int, actor: int, gross: int, fee: int, now: int): Vault =
  { ...v, awards: v.awards.append(L::newAward(source, actor, gross, fee, now)),
    reservedPrincipal: v.reservedPrincipal + gross - fee, reservedFees: v.reservedFees + fee,
    sourceSequence: if (v.key.purpose == L::Ordinary) v.sourceSequence + 1 else v.sourceSequence }
pure def charged(v: Vault, source: int, actor: int, gross: int, now: int): Vault =
  { ...recorded(v, source, actor, gross, L::awardFee(v.key.purpose, gross), now), free: v.free - gross }
pure def canCommitAward(e: Escrow, source: int, actor: int, gross: int, by: str): bool =
  e.created and by == e.vault.key.owner and e.vault.key.purpose == L::Ordinary and e.vault.pendingMonthly == 0
    and not(e.vault.pledges.some(p => p.open and L::inWindow(p.period, e.now)))
    and recordable(e.vault, source, actor, gross) and gross <= unpledged(e.vault)
pure def commitAward(e: Escrow, source: int, actor: int, gross: int, by: str): Escrow =
  { ...e, vault: charged(e.vault, source, actor, gross, e.now) }
pure def canCommitBountyAward(e: Escrow, source: int, actor: int, gross: int, by: str): bool =
  e.created and by == e.vault.key.owner and e.vault.key.purpose == L::Bounty and gross % 4 == 0
    and recordable(e.vault, source, actor, gross) and gross <= unpledged(e.vault)
pure def commitBountyAward(e: Escrow, source: int, actor: int, gross: int, by: str): Escrow =
  { ...e, vault: charged(e.vault, source, actor, gross, e.now) }
pure def stepSourceSequenceCountsOrdinaryAwards(before: Escrow, after: Escrow): bool =
  if (before.vault.key.purpose == L::Ordinary)
    after.vault.sourceSequence == before.vault.sourceSequence + (after.vault.awards.length() - before.vault.awards.length())
  else after.vault.sourceSequence == before.vault.sourceSequence
pure def lawRecordedAwardStalesReservation(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: str,
  source: int, actor: int, gross: int): bool =
  (canReserveMonthly(e, period, reservation, sequence, signer) and canCommitAward(e, source, actor, gross, e.vault.key.owner))
    implies not(canReserveMonthly(commitAward(e, source, actor, gross, e.vault.key.owner), period, reservation, sequence, signer))
pure def lawCommittedLeafStalesReservation(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: str,
  leafPeriod: int, leaf: L::Leaf): bool =
  (canReserveMonthly(e, period, reservation, sequence, signer) and canCommitMonthlyLeaf(e, leafPeriod, leaf))
    implies not(canReserveMonthly(commitMonthlyLeaf(e, leafPeriod, leaf), period, reservation, sequence, signer))
```

### Reserved principal and fees are exactly the unpaid awards, and paid totals are exactly the paid awards

Each source has one award, whose fee is the purpose's fee of its gross; an
ordinary award reserved before fees rounded up holds floor(gross / 50),
which `commitMonthly` still accepts. The model creates only ceiling-fee
awards, so that compatibility path is never simulated. A paid award's
binding version and destination are model-only fields; the contract keeps
the version per actor and names both in the `Paid` event.

```quint
pure def alwaysReservedMatchesAwards(e: Escrow): bool =
  e.vault.reservedPrincipal == L::unpaidPrincipal(e.vault.awards) and e.vault.reservedFees == L::unpaidFees(e.vault.awards)
pure def alwaysPaidMatchesAwards(e: Escrow): bool =
  e.vault.paid == L::paidPrincipal(e.vault.awards) and e.vault.payoutFees == L::paidFees(e.vault.awards)
pure def alwaysAwardsWellFormed(e: Escrow): bool = L::uniqueSources(e.vault.awards) and e.vault.awards.every(a =>
  a.source > 0 and a.actor > 0 and L::awardGrossAdmissible(e.vault.key.purpose, a.gross)
    and (a.fee == L::awardFee(e.vault.key.purpose, a.gross) or (e.vault.key.purpose == L::Ordinary and a.fee == a.gross / 50))
    and a.committedAt > 0 and a.committedAt <= e.now
    and (a.paid == (a.paidVersion > 0)) and (a.paid implies a.paidTo != ""))
pure def stepAwardsRetained(before: Escrow, after: Escrow): bool = before.vault.awards.every(a =>
  after.vault.awards.some(b => b.source == a.source and b.actor == a.actor and b.gross == a.gross and b.fee == a.fee
    and b.committedAt == a.committedAt and (a.paid implies b == a)))
pure def sometimesBountyPaid(e: Escrow): bool = e.vault.key.purpose == L::Bounty and e.vault.paid > 0
```

## Story: Admit one monthly allocation per period within the owner's cap

### The owner sets the cap and turns monthly commitments on or off

`setMonthlyCommitment` is for an ordinary vault and refuses an enabled zero
cap. Turning commitments off stops new admissions only; a reserve already
admitted keeps settling.

```quint
pure def canSetMonthlyCommitment(e: Escrow, cap: int, on: bool, by: str): bool =
  e.created and by == e.vault.key.owner and e.vault.key.purpose == L::Ordinary and cap >= 0 and not(on and cap == 0)
pure def setMonthlyCommitment(e: Escrow, cap: int, on: bool, by: str): Escrow =
  { ...e, vault: { ...e.vault, monthlyCap: cap, monthlyEnabled: on } }
pure def stepMonthlyPolicyByOwner(before: Escrow, via: str, after: Escrow): bool =
  ((before.vault.monthlyCap != after.vault.monthlyCap or before.vault.monthlyEnabled != after.vault.monthlyEnabled)
    implies (via == "setMonthlyCommitment" or via == "create" or via == "createWithMonthlyCommitment"))
```

### A legacy allocation commits all its new awards at once and counts an existing identical award once

`commitMonthly` accepts one period inside its window while commitments are
on, for a nonempty allocation the identity authority signed, whose gross
total is within the period's cap: the monthly cap while commitments are on,
raised to the period's open pledge. A pledged period admits even while
commitments are off. Admission closes the period's own pledge, whose funds
pay it; every other period's pledge stays out of reach. An entry whose source already has an award must
match its actor and gross and the ceiling or the earlier floor fee; the
rest are committed in order from the free balance, so a duplicate new
source or an uncovered entry reverts the whole allocation.

```quint
pure val noMonth: Month = { period: 0, version2: false, digest: "", root: "", wholeGross: 0, total: 0, remaining: 0,
  count: 0, committedGross: 0, released: 0, admittedAt: 0, cap: 0, leaves: List() }
pure def hasMonth(ms: List[Month], period: int): bool = ms.some(m => m.period == period)
pure def monthFor(ms: List[Month], period: int): Month = ms.foldl(noMonth, (found, m) => if (m.period == period) m else found)
pure def withMonth(ms: List[Month], m: Month): List[Month] = ms.listMap(x => if (x.period == m.period) m else x)
pure def sumRemaining(ms: List[Month]): int = ms.foldl(0, (t, m) => t + m.remaining)
pure def signedByAuthority(e: Escrow, signer: str): bool = signer != "" and signer == e.identityAuthority
pure def admissionOpen(e: Escrow, period: int): bool = e.created and e.vault.key.purpose == L::Ordinary
  and (e.vault.monthlyEnabled or pledgeOf(e.vault, period).open) and L::inWindow(period, e.now)
  and not(hasMonth(e.vault.months, period))
pure def capFor(v: Vault, period: int): int =
  val cap = if (v.monthlyEnabled) v.monthlyCap else 0
  val p = pledgeOf(v, period)
  if (p.open and p.amount > cap) p.amount else cap
pure def closePledge(v: Vault, period: int): Vault =
  val p = pledgeOf(v, period)
  if (p.open) { ...v, pledged: v.pledged - p.amount,
    pledges: v.pledges.listMap(x => if (x.period == period) { ...x, open: false } else x) } else v
pure def existingMatches(v: Vault, l: L::Leaf): bool =
  val a = L::awardFor(v.awards, l.source)
  a.actor == l.actor and a.gross == l.gross and (a.fee == M::ordinaryFee(l.gross) or a.fee == l.gross / 50)
pure def freshEntries(v: Vault, entries: List[L::Leaf]): List[L::Leaf] = entries.select(l => not(L::hasSource(v.awards, l.source)))
pure def canCommitMonthly(e: Escrow, period: int, entries: List[L::Leaf], signer: str): bool =
  val fresh = freshEntries(e.vault, entries)
  admissionOpen(e, period) and entries.length() > 0 and signedByAuthority(e, signer)
    and L::leafTotal(entries) <= capFor(e.vault, period)
    and entries.every(l => not(L::hasSource(e.vault.awards, l.source)) or existingMatches(e.vault, l))
    and fresh.every(l => l.actor > 0 and l.gross > 0 and l.source > 0 and fresh.select(o => o.source == l.source).length() == 1)
    and L::leafTotal(fresh) <= e.vault.free and L::leafTotal(fresh) <= unpledged(closePledge(e.vault, period))
pure def commitMonthly(e: Escrow, period: int, entries: List[L::Leaf], signer: str): Escrow =
  val funded = freshEntries(e.vault, entries).foldl(closePledge(e.vault, period), (v, l) => charged(v, l.source, l.actor, l.gross, e.now))
  { ...e, vault: { ...funded, months: funded.months.append({ ...noMonth, period: period, root: "legacy",
    wholeGross: L::leafTotal(entries), count: entries.length(), admittedAt: e.now, cap: capFor(e.vault, period), leaves: entries }) } }
pure def sometimesLegacyAllocation(e: Escrow): bool = e.vault.months.some(m => not(m.version2) and m.count > 0)
```

### A version-2 reservation reserves the unfunded remainder against the current source sequence

`reserveMonthly` admits one period inside its window while commitments are
on. The signed reservation carries a nonzero allocation digest and root, a
positive whole gross within the cap, a remaining gross no larger than the
whole and positive exactly when its leaf count is, and the source sequence
it was built at: any award committed since then makes it stale
(`MonthlySourceChanged`). The free balance must cover the remaining gross,
which moves to the pending monthly reserve. Anyone may submit an admission;
its signer must be the identity authority in force, so a rotated-out or
pending authority refuses. The signature is EIP-712 over this vault's
domain (chain id and vault address) and must be a canonical 65-byte
signature by an externally owned account.

```quint
pure def canReserveMonthly(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: str): bool =
  admissionOpen(e, period) and sequence == e.vault.sourceSequence
    and reservation.digest != "" and reservation.root != "" and reservation.wholeGross > 0
    and reservation.remainingGross >= 0 and reservation.remainingGross <= reservation.wholeGross
    and (reservation.count == 0) == (reservation.remainingGross == 0) and reservation.count >= 0
    and reservation.wholeGross <= capFor(e.vault, period) and signedByAuthority(e, signer)
    and reservation.remainingGross <= e.vault.free and reservation.remainingGross <= unpledged(closePledge(e.vault, period))
pure def reserveMonthly(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: str): Escrow =
  val v = closePledge(e.vault, period)
  { ...e, vault: { ...v, free: v.free - reservation.remainingGross,
    pendingMonthly: v.pendingMonthly + reservation.remainingGross,
    months: v.months.append({ period: period, version2: true, digest: reservation.digest, root: reservation.root,
      wholeGross: reservation.wholeGross, total: reservation.remainingGross, remaining: reservation.remainingGross,
      count: reservation.count, committedGross: 0, released: 0, admittedAt: e.now, cap: capFor(e.vault, period),
      leaves: reservation.leaves }) } }
pure def lawRotatedAuthorityRefuses(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: str): bool =
  (canReserveMonthly(e, period, reservation, sequence, signer) and canExecuteIdentityAuthorityRotation(e)
    and signer != e.pendingIdentityAuthority)
    implies not(canReserveMonthly(executeIdentityAuthorityRotation(e), period, reservation, sequence, signer))
```

### Anyone commits a proved leaf from its period's reserve without charging the free balance again

`commitMonthlyLeaf` proves the leaf against the stored root and count and
requires the tree's total to equal the reserved total, so an allocation
signed with the wrong total never settles a leaf. The leaf must fit the
remaining reserve and pass the ordinary award checks; it moves from the
reserve to an award with the ordinary fee. It needs no wallet, fresh
signature, open window or current opt-in.

```quint
pure def leafProves(m: Month, leaf: L::Leaf): bool =
  m.version2 and m.leaves.includes(leaf) and m.leaves.length() == m.count and L::leafTotal(m.leaves) == m.total
pure def canCommitMonthlyLeaf(e: Escrow, period: int, leaf: L::Leaf): bool =
  val m = monthFor(e.vault.months, period)
  e.created and hasMonth(e.vault.months, period) and leafProves(m, leaf) and leaf.gross <= m.remaining
    and recordable(e.vault, leaf.source, leaf.actor, leaf.gross)
pure def commitMonthlyLeaf(e: Escrow, period: int, leaf: L::Leaf): Escrow =
  val m = monthFor(e.vault.months, period)
  val v = recorded(e.vault, leaf.source, leaf.actor, leaf.gross, M::ordinaryFee(leaf.gross), e.now)
  { ...e, vault: { ...v, pendingMonthly: v.pendingMonthly - leaf.gross,
    months: withMonth(v.months, { ...m, remaining: m.remaining - leaf.gross, committedGross: m.committedGross + leaf.gross }),
    origins: v.origins.append({ period: period, leaf: leaf }) } }
pure def sometimesLeafCommitted(e: Escrow): bool = e.vault.months.some(m => m.version2 and m.committedGross > 0)
pure def sometimesLeafPendingInNextWindow(e: Escrow): bool =
  e.vault.months.some(m => m.version2 and m.remaining > 0 and L::closesAt(m.period) <= e.now)
pure def sometimesOrdinaryPaid(e: Escrow): bool = e.vault.key.purpose == L::Ordinary and e.vault.paid > 0
```

### The owner releases the whole untouched reserve of a wrong-total period once, with the attester's signature

`releaseMonthlyReserve`, after the reviewed reserve-release upgrade,
returns the remaining gross of a version-2 period to the free balance only
while it still equals the admitted total, for exactly that amount, which the
identity authority signed. A committed leaf or an earlier release lowers the
remainder below the total, so a partial amount, a touched or released period
and a stale expected remainder all refuse. The root, awards and fees do not
change, and the period stays admitted. The deployed source before that
upgrade also accepted partial and repeated releases.

```quint
pure def canReleaseMonthlyReserve(e: Escrow, period: int, expectedRemaining: int, releasedGross: int, signer: str, by: str): bool =
  val m = monthFor(e.vault.months, period)
  e.created and by == e.vault.key.owner and hasMonth(e.vault.months, period) and m.version2 and m.digest != ""
    and releasedGross > 0 and m.remaining == expectedRemaining and m.remaining == m.total
    and releasedGross == expectedRemaining and signedByAuthority(e, signer)
pure def releaseMonthlyReserve(e: Escrow, period: int, expectedRemaining: int, releasedGross: int, signer: str, by: str): Escrow =
  val m = monthFor(e.vault.months, period)
  { ...e, vault: { ...e.vault, free: e.vault.free + releasedGross, pendingMonthly: e.vault.pendingMonthly - releasedGross,
    months: withMonth(e.vault.months, { ...m, remaining: 0, released: releasedGross }) } }
pure def sometimesWholeReserveReleased(e: Escrow): bool = e.vault.months.some(m => m.released > 0)
```

### Each period has one root, its gross stays within the cap at admission, and the pending reserve is the sum of remainders

A released period settled nothing, and a settled period released nothing.
Only an ordinary vault holds monthly state. Each period keeps the time it
was admitted, inside its window. A version-2 whole gross is read from the
`MonthlyReserved` event, since storage keeps only the reserved total.

```quint
pure def alwaysMonthsWellFormed(e: Escrow): bool = e.vault.months.every(m =>
  e.vault.months.select(o => o.period == m.period).length() == 1 and L::validPeriod(m.period)
    and m.wholeGross <= m.cap and m.total <= m.wholeGross and m.remaining >= 0 and m.committedGross >= 0 and m.released >= 0
    and m.committedGross + m.released + m.remaining == m.total
    and (m.released == 0 or (m.released == m.total and m.committedGross == 0))
    and (if (m.version2) m.digest != "" and m.root != "" else m.total == 0 and m.leaves.length() == m.count))
pure def alwaysPendingMatchesMonths(e: Escrow): bool = e.vault.pendingMonthly == sumRemaining(e.vault.months)
pure def alwaysBountyHasNoMonthly(e: Escrow): bool = e.vault.key.purpose == L::Bounty implies
  e.vault.months.length() == 0 and not(e.vault.monthlyEnabled) and e.vault.monthlyCap == 0 and e.vault.pledges.length() == 0
pure def alwaysAdmittedInWindow(e: Escrow): bool = e.vault.months.every(m => L::inWindow(m.period, m.admittedAt))
pure def stepMonthsRetained(before: Escrow, after: Escrow): bool = before.vault.months.every(m =>
  after.vault.months.some(o => o.period == m.period and o.version2 == m.version2 and o.digest == m.digest and o.root == m.root
    and o.wholeGross == m.wholeGross and o.total == m.total and o.leaves == m.leaves and o.released >= m.released
    and o.committedGross >= m.committedGross and o.admittedAt == m.admittedAt))
```

### Each committed leaf's award traces to a leaf of its own period, and a period's committed gross is exactly the gross of those awards

`ProjectEscrow` keeps no period on an award, and `commitMonthlyLeaf` emits
only `AwardCommitted` (PRD section 6, "Monthly allocation"; development
`bf73d46fa`), so `origins` is a model-only log: each committed leaf
appends its period and leaf, and nothing else changes it. The conformance
driver drops it from the observed vault and never compares it, since the
chain cannot report it. Every logged leaf
is proved by its period's stored root, count and total, and its source has
the award of that leaf's actor and gross, logged once. A period's committed
gross is the sum of the gross of its logged leaves, so it equals the gross
of the awards materialized from them. A legacy allocation commits its new
awards at admission and keeps its committed gross at zero, so it logs
nothing.

```quint
pure def originGross(os: List[LeafOrigin], period: int): int =
  os.foldl(0, (t, o) => if (o.period == period) t + o.leaf.gross else t)
pure def alwaysCommittedLeavesTraced(e: Escrow): bool =
  e.vault.months.every(m => m.committedGross == originGross(e.vault.origins, m.period))
    and e.vault.origins.every(o => hasMonth(e.vault.months, o.period)
      and leafProves(monthFor(e.vault.months, o.period), o.leaf)
      and L::hasSource(e.vault.awards, o.leaf.source)
      and L::awardFor(e.vault.awards, o.leaf.source).actor == o.leaf.actor
      and L::awardFor(e.vault.awards, o.leaf.source).gross == o.leaf.gross
      and e.vault.origins.select(x => x.leaf.source == o.leaf.source).length() == 1)
pure def stepOriginsRetained(before: Escrow, after: Escrow): bool =
  before.vault.origins.every(o => after.vault.origins.includes(o))
```

### A proved leaf whose source another award consumed never settles, and a touched period never releases

A leaf is stranded when it is proved, fits its period's remainder, and its
source already has an award that did not come from this leaf of this period:
the same source in another period's root, a legacy entry or an earlier
award. The allocation builder can sign a root at the current source
sequence that still lists a source the owner committed by hand (PRD section
6, "Monthly allocation"; development `bf73d46fa`), since
`reserveMonthly` checks the sequence, not the leaves. `commitMonthlyLeaf`
refuses a stranded leaf because the award ID exists, and once any leaf of
the period has committed, `releaseMonthlyReserve` refuses the period (its
remainder is below its total), so a stranded leaf's gross stays in the
pending reserve for good.

```quint
pure def evmStrandedLeaf(e: Escrow, period: int, leaf: L::Leaf): bool =
  val m = monthFor(e.vault.months, period)
  leafProves(m, leaf) and leaf.gross <= m.remaining and L::hasSource(e.vault.awards, leaf.source)
    and not(e.vault.origins.some(o => o.period == period and o.leaf.source == leaf.source))
pure def lawStrandedLeafNeverCommits(e: Escrow, period: int, leaf: L::Leaf): bool =
  evmStrandedLeaf(e, period, leaf) implies not(canCommitMonthlyLeaf(e, period, leaf))
pure def lawTouchedMonthNeverReleases(e: Escrow, period: int, expectedRemaining: int, releasedGross: int,
  signer: str, by: str): bool =
  (alwaysMonthsWellFormed(e) and monthFor(e.vault.months, period).committedGross > 0)
    implies not(canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by))
pure def sometimesEvmStrandedLeaf(e: Escrow): bool =
  e.vault.months.some(m => m.leaves.some(l => evmStrandedLeaf(e, m.period, l)))
pure def sometimesEvmStrandedLeafLocked(e: Escrow): bool =
  e.vault.months.some(m => m.committedGross > 0 and m.leaves.some(l => evmStrandedLeaf(e, m.period, l)))
```

## Story: Pledge free funds to future months irrevocably

### The owner pledges an amount to each of up to twelve months, raising but never lowering an open pledge

`pledgeMonths` is for an ordinary vault. Its periods run consecutively from
the first, each from the current month to eleven months after it and not
yet admitted. An open pledge below the amount is raised to it, an equal one
is unchanged, and a higher one refuses (`PledgeTooLow`): nothing lowers or
cancels a pledge. Every open pledge together must stay within the free
balance.

```quint
pure val noPledge: Pledge = { period: 0, amount: 0, open: false }
pure def pledgeOf(v: Vault, period: int): Pledge = v.pledges.foldl(noPledge, (found, p) => if (p.period == period) p else found)
pure def unpledged(v: Vault): int = v.free - v.pledged
pure def openPledged(ps: List[Pledge]): int = ps.foldl(0, (t, p) => if (p.open) t + p.amount else t)
pure def pledgePeriods(fromPeriod: int, count: int): List[int] =
  List(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12).select(i => i <= count).foldl(List(), (ps, i) =>
    ps.append(if (ps.length() == 0) fromPeriod else L::nextPeriod(ps.nthOr(ps.length() - 1, fromPeriod))))
// The period has not ended, and the same month a year later has not begun: from the current month to eleven after it.
pure def pledgeable(v: Vault, period: int, now: int): bool =
  L::validPeriod(period) and L::monthStart(L::nextPeriod(period)) > now
    and L::monthStart(L::nextPeriod(period - 100)) <= now and not(hasMonth(v.months, period))
pure def raisedBy(v: Vault, period: int, amount: int): int =
  if (pledgeOf(v, period).open) amount - pledgeOf(v, period).amount else amount
pure def addedBy(v: Vault, periods: List[int], amount: int): int = periods.foldl(0, (t, period) => t + raisedBy(v, period, amount))
pure def canPledgeMonths(e: Escrow, fromPeriod: int, count: int, amount: int, by: str): bool =
  val periods = pledgePeriods(fromPeriod, count)
  e.created and by == e.vault.key.owner and e.vault.key.purpose == L::Ordinary and count >= 1 and count <= 12
    and amount > 0 and periods.every(period => pledgeable(e.vault, period, e.now)
      and (not(pledgeOf(e.vault, period).open) or pledgeOf(e.vault, period).amount <= amount))
    and e.vault.pledged + addedBy(e.vault, periods, amount) <= e.vault.free
pure def pledgeMonths(e: Escrow, fromPeriod: int, count: int, amount: int, by: str): Escrow =
  val periods = pledgePeriods(fromPeriod, count)
  val kept = e.vault.pledges.select(p => not(periods.includes(p.period)))
  { ...e, vault: { ...e.vault, pledged: e.vault.pledged + addedBy(e.vault, periods, amount),
    pledges: periods.foldl(kept, (ps, period) => ps.append({ period: period, amount: amount, open: true })) } }
```

### Anyone expires a pledge whose period's window closed without admission

```quint
pure def canExpirePledge(e: Escrow, period: int): bool =
  e.created and e.vault.key.purpose == L::Ordinary and pledgeOf(e.vault, period).open and e.now >= L::closesAt(period)
pure def expirePledge(e: Escrow, period: int): Escrow = { ...e, vault: closePledge(e.vault, period) }
pure def sometimesPledgeAdmitted(e: Escrow): bool =
  e.vault.pledges.some(p => not(p.open) and hasMonth(e.vault.months, p.period))
pure def sometimesPledgeExpired(e: Escrow): bool =
  e.vault.pledges.some(p => not(p.open) and not(hasMonth(e.vault.months, p.period)))
```

### Free funds always cover the open pledges, a pledged month is never admitted, and a pledge only rises until it closes

```quint
pure def alwaysPledgesCovered(e: Escrow): bool =
  e.vault.pledged == openPledged(e.vault.pledges) and e.vault.pledged <= e.vault.free
    and e.vault.pledges.every(p => p.amount > 0 and e.vault.pledges.select(o => o.period == p.period).length() == 1)
pure def alwaysPledgedMonthUnadmitted(e: Escrow): bool =
  e.vault.pledges.every(p => p.open implies not(hasMonth(e.vault.months, p.period)))
pure def stepPledgeIrrevocable(before: Escrow, via: str, after: Escrow): bool = before.vault.pledges.every(p => p.open implies
  (pledgeOf(after.vault, p.period).open and pledgeOf(after.vault, p.period).amount >= p.amount)
    or via == "commitMonthly" or via == "reserveMonthly" or via == "expirePledge")
```

## Story: Bind each actor's destination with the attester and the wallet

### The identity authority binds a wallet that co-signed the exact binding, activating it at once

`bindDestination` is called by the identity authority in force with the
destination wallet's EIP-712 signature over the chain, vault, actor,
destination, expected predecessor version, claim digest and expiry. It
refuses a zero actor, a zero or vault destination, a zero claim, an expired
submission and a stale predecessor. The new version activates in the same
block; only the latest version can pay.

```quint
pure val noBinding: Binding = { actor: 0, destination: "", version: 0, claim: 0, activatesAt: 0, cancelled: false,
  attester: "", walletSigned: false, paidVersion: 0, cancels: 0 }
pure def hasBinding(bs: List[Binding], actor: int): bool = bs.some(b => b.actor == actor)
pure def bindingFor(bs: List[Binding], actor: int): Binding = bs.foldl(noBinding, (found, b) => if (b.actor == actor) b else found)
pure def withBinding(bs: List[Binding], b: Binding): List[Binding] =
  if (hasBinding(bs, b.actor)) bs.listMap(x => if (x.actor == b.actor) b else x) else bs.append(b)
pure def canBindDestination(e: Escrow, actor: int, destination: str, expectedVersion: int, claim: int,
  expiresAt: int, walletSigned: bool, by: str): bool =
  e.created and by == e.identityAuthority and actor > 0 and destination != "" and destination != "vault" and claim != 0
    and expiresAt >= e.now and bindingFor(e.vault.bindings, actor).version == expectedVersion and walletSigned
pure def bindDestination(e: Escrow, actor: int, destination: str, expectedVersion: int, claim: int,
  expiresAt: int, walletSigned: bool, by: str): Escrow =
  val old = bindingFor(e.vault.bindings, actor)
  { ...e, vault: { ...e.vault, bindings: withBinding(e.vault.bindings, { ...old, actor: actor, destination: destination,
    version: expectedVersion + 1, claim: claim, activatesAt: e.now, cancelled: false, attester: by, walletSigned: true }) } }
pure def stepNewBindingAttested(before: Escrow, after: Escrow): bool = after.vault.bindings.every(b =>
  before.vault.bindings.some(o => o.actor == b.actor and o.version == b.version)
    or (b.attester == before.identityAuthority and b.walletSigned))
```

### The owner cancels the latest unpaid binding only inside a review window and within the cap

`cancelBinding` needs the latest version, not cancelled and not the version
the actor was last paid with. The binding's own review period or the
actor's latest award's commit period must still be open; with the zero
production delay neither ever is, so cancellation needs a deployment with a
positive delay. Without a pending identity rotation the owner cancels at
most three times between payments.

```quint
pure def lastCommittedAt(awards: List[L::Award], actor: int): int =
  awards.foldl(0, (t, a) => if (a.actor == actor and a.committedAt > t) a.committedAt else t)
pure def canCancelBinding(e: Escrow, actor: int, expectedVersion: int, by: str): bool =
  val b = bindingFor(e.vault.bindings, actor)
  val committed = lastCommittedAt(e.vault.awards, actor)
  e.created and by == e.vault.key.owner and b.version != 0 and b.version == expectedVersion and not(b.cancelled)
    and b.version != b.paidVersion
    and (e.now < b.activatesAt + e.vault.bindingDelay or (committed != 0 and e.now < committed + e.vault.bindingDelay))
    and L::cancelAllowed(b.cancels, e.pendingIdentityAuthority != "")
pure def cancelBinding(e: Escrow, actor: int, expectedVersion: int, by: str): Escrow =
  val b = bindingFor(e.vault.bindings, actor)
  { ...e, vault: { ...e.vault, bindings: withBinding(e.vault.bindings,
    { ...b, cancelled: true, cancels: L::cancelsAfter(b.cancels, e.pendingIdentityAuthority != "") }) } }
pure def alwaysBindingsWellFormed(e: Escrow): bool = e.vault.bindings.every(b =>
  e.vault.bindings.select(o => o.actor == b.actor).length() == 1 and b.actor > 0 and b.version > 0
    and b.destination != "" and b.destination != "vault" and b.claim != 0 and b.walletSigned and b.attester != ""
    and b.paidVersion >= 0 and b.paidVersion <= b.version and b.cancels >= 0 and b.cancels <= L::maxCancels
    and b.activatesAt > 0 and b.activatesAt <= e.now)
pure def sometimesBindingCancelled(e: Escrow): bool = e.vault.bindings.some(b => b.cancelled)
```

## Story: Pay, refund and claim fees exactly

### Anyone pays a matured award to its actor's latest uncancelled binding

`pay` refuses a missing or paid award, an award inside its commit delay, an
actor without a payable binding and a stale expected version. It sends the
net to the binding's destination and moves the fee to accrued fees; the
caller chooses neither amount nor destination. A failed transfer leaves the
award unpaid. A zero net sends nothing.

```quint
pure def canPay(e: Escrow, source: int, expectedVersion: int, transferOk: bool): bool =
  val a = L::awardFor(e.vault.awards, source)
  val b = bindingFor(e.vault.bindings, a.actor)
  e.created and a.actor != 0 and not(a.paid) and e.now >= a.committedAt + e.vault.bindingDelay
    and b.version != 0 and not(b.cancelled) and e.now >= b.activatesAt and b.version == expectedVersion
    and (transferOk or a.gross - a.fee == 0)
pure def pay(e: Escrow, source: int, expectedVersion: int, transferOk: bool): Escrow =
  val a = L::awardFor(e.vault.awards, source)
  val b = bindingFor(e.vault.bindings, a.actor)
  val net = a.gross - a.fee
  { ...e, vault: { ...e.vault, awards: L::markPaid(e.vault.awards, source, b.destination, b.version),
    bindings: withBinding(e.vault.bindings, { ...b, paidVersion: b.version, cancels: 0 }),
    reservedPrincipal: e.vault.reservedPrincipal - net, reservedFees: e.vault.reservedFees - a.fee,
    paid: e.vault.paid + net, payoutFees: e.vault.payoutFees + a.fee, accruedFees: e.vault.accruedFees + a.fee,
    balance: e.vault.balance - net } }
pure def paidThroughBinding(bs: List[Binding], a: L::Award): bool =
  val b = bindingFor(bs, a.actor)
  b.version == a.paidVersion and b.destination == a.paidTo and not(b.cancelled)
pure def stepPaidToLiveBinding(before: Escrow, after: Escrow): bool = after.vault.awards.every(a =>
  not(a.paid) or L::awardFor(before.vault.awards, a.source).paid or paidThroughBinding(before.vault.bindings, a))
```

### The owner withdraws free funds to itself less the 2% fee

`withdrawUnused` refuses a zero gross and a gross above the unpledged free
balance; pledged, reserved, pending and accrued funds cannot be withdrawn. The fee is
`ceil(gross / 50)` and stays in the vault as accrued fees; the rest goes
only to the owner. Only a deposit or a whole reserve release raises the
free balance; closing a pledge raises only the unpledged balance.

```quint
pure def canWithdrawUnused(e: Escrow, gross: int, transferOk: bool, by: str): bool =
  e.created and by == e.vault.key.owner and gross > 0 and gross <= unpledged(e.vault)
    and (transferOk or gross - M::ordinaryFee(gross) == 0)
pure def withdrawUnused(e: Escrow, gross: int, transferOk: bool, by: str): Escrow =
  val fee = M::ordinaryFee(gross)
  { ...e, vault: { ...e.vault, free: e.vault.free - gross, grossWithdrawn: e.vault.grossWithdrawn + gross,
    withdrawalFees: e.vault.withdrawalFees + fee, accruedFees: e.vault.accruedFees + fee,
    ownerRefunded: e.vault.ownerRefunded + gross - fee, balance: e.vault.balance - (gross - fee) } }
pure def stepFreeSpentByOwnerOrAttestation(before: Escrow, via: str, after: Escrow): bool =
  after.vault.free < before.vault.free implies (via == "commitAward" or via == "commitBountyAward"
    or via == "withdrawUnused" or via == "commitMonthly" or via == "reserveMonthly")
pure def stepFreeRisesOnlyByDepositOrRelease(before: Escrow, via: str, after: Escrow): bool =
  after.vault.free > before.vault.free implies (via == "deposit" or via == "releaseMonthlyReserve")
pure def sometimesWithdrawn(e: Escrow): bool = e.vault.grossWithdrawn > 0
```

### Anyone moves all accrued fees to the fee recipient

`claimFees` refuses when nothing has accrued. Only this call depends on the
fee recipient, so a blocked recipient never stops a payment or withdrawal.

```quint
pure def canClaimFees(e: Escrow, transferOk: bool): bool = e.created and e.vault.accruedFees > 0 and transferOk
pure def claimFees(e: Escrow, transferOk: bool): Escrow =
  { ...e, vault: { ...e.vault, claimedFees: e.vault.claimedFees + e.vault.accruedFees,
    balance: e.vault.balance - e.vault.accruedFees, accruedFees: 0 } }
pure def sometimesFeesClaimed(e: Escrow): bool = e.vault.claimedFees > 0
```

### Simulation samples cover distinct and colliding keys, windows, allocations and signatures

These sets bound simulation only. Timestamps start just before the November
2026 window opens and reach past the December window, so a pledge can lapse.

```quint
pure val byValues = Set("owner", "registrar", "attester", "nextAttester", "upgrader", "nextUpgrader", "other")
pure val registrarValues = Set("registrar", "attester")
pure val feeRecipientValues = Set("fees", "upgrader")
pure val identityValues = Set("attester", "registrar")
pure val upgraderValues = Set("upgrader", "fees")
pure val delayValues = Set(0, 1)
pure val factoryLogicValues = Set(1)
pure val logicValues = Set(1, 2)
pure val successorValues = Set("nextAttester", "nextUpgrader", "registrar", "fees")
pure val projectValues = Set("slop", "other")
pure val tokenValues = Set("", "usdc")
pure val capValues = Set(0, 54, 100)
pure val amountValues = Set(54, 100)
pure val sentValues = Set(0, 54, 100)
pure val sourceValues = Set(1, 2)
pure val actorValues = Set(1, 2)
pure val grossValues = Set(0, 4, 50, 51)
pure val periodValues = Set(202611, 202612, 202613)
pure val entriesValues = Set(List(),
  List({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 }),
  List({ actor: 1, gross: 50, source: 1 }),
  List({ actor: 1, gross: 50, source: 12 }, { actor: 1, gross: 50, source: 12 }))
pure val reservationValues = Set(
  { digest: "d", root: "r", wholeGross: 54, remainingGross: 54, count: 2,
    leaves: List({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 }) },
  { digest: "d", root: "r", wholeGross: 60, remainingGross: 60, count: 1, leaves: List({ actor: 1, gross: 50, source: 12 }) },
  { digest: "d", root: "r", wholeGross: 54, remainingGross: 4, count: 1, leaves: List({ actor: 2, gross: 4, source: 13 }) },
  { digest: "d", root: "r", wholeGross: 54, remainingGross: 54, count: 2,
    leaves: List({ actor: 1, gross: 50, source: 1 }, { actor: 2, gross: 4, source: 11 }) },
  { digest: "d", root: "r", wholeGross: 4, remainingGross: 0, count: 0, leaves: List() },
  { digest: "", root: "r", wholeGross: 54, remainingGross: 54, count: 2,
    leaves: List({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 }) })
pure val sequenceValues = Set(0, 1)
pure val leafValues = Set({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 },
  { actor: 1, gross: 50, source: 12 }, { actor: 2, gross: 4, source: 13 })
pure val signerValues = Set("attester", "nextAttester", "registrar", "other", "")
pure val leafPeriodValues = Set(202611, 202612)
pure val expectedRemainingValues = Set(4, 54, 60)
pure val releasedGrossValues = Set(4, 54, 60)
pure val destinationValues = Set("wallet", "vault", "")
pure val expectedVersionValues = Set(0, 1)
pure val claimValues = Set(0, 7)
pure val expiresAtValues = Set(1796342399, 1799020801)
pure val timestampValues = Set(1796342400, 1796342401, 1799020800, 1801699200)
pure val weight_initializeFactory = 20
pure val weight_create = 15
pure val weight_createWithMonthlyCommitment = 15
pure val weight_deposit = 25
pure val weight_commitAward = 20
pure val weight_commitBountyAward = 20
pure val weight_bindDestination = 25
pure val weight_pay = 30
pure val weight_tick = 10
pure val weight_reserveMonthly = 25
pure val weight_commitMonthly = 15
pure val weight_commitMonthlyLeaf = 30
pure val weight_releaseMonthlyReserve = 25
pure val weight_cancelBinding = 15
pure val weight_withdrawUnused = 10
pure val weight_claimFees = 10
pure val fromPeriodValues = Set(202612, 202701)
pure val countValues = Set(1, 2)
pure val weight_pledgeMonths = 20
pure val weight_expirePledge = 15
```
