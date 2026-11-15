# Solana project escrow program

This specification owns the on-chain state of the `slop-escrow` Anchor
program in `packages/contracts/solana/programs/slop-escrow/src/lib.rs` and
its Token-2022 admission in `token_policy.rs` (PRD section 6). One state
holds the program's upgrade authority and build, the global `Config`, and
one `Project` with its vault, obligations, origins, monthly allocations,
settlement markers, wallet bindings and vetoes. Keys are strings; `"project"`
and `"vault"` are the project and vault PDAs, and the empty string is the
default key. A required signer and the Ed25519 instruction that precedes an
attested instruction are booleans the chain adapter verifies; Merkle-sum
proofs are modeled by the allocation's leaves. A failed transfer fails the
whole transaction. Every project instruction deserializes the current
`Project` layout, so a project of the earlier 316-byte build accepts only
`migrate_project`.

## Story: Pin the program's authorities

### The program upgrade authority writes the Config once with three distinct keys

`initialize_config` is signed by the program's upgrade authority and fixes
the identity authority, fee recipient and rotation authority, which are
nonzero and pairwise distinct; nothing changes or closes the Config. The
upgrade authority replaces the program's bytes, moves to another key, or is
revoked to make the program immutable. The earlier build, represented here
only by the project it created, is replaced by the current one.

```quint
import ledger as L from "./ledger"
import money as M from "../settlement/money"
type Build = LegacyBuild | CurrentBuild
type Layout = NoProject | LegacyLayout | CurrentLayout
type TokenKind = ClassicSpl | Token2022 | OtherProgram
type MintFacts = { kind: TokenKind, bytes: int, mintAuthority: bool, freezeAuthority: bool, extensions: List[str],
  pointerAuthority: bool, updateAuthority: bool, selfHosted: bool }
type AccountFacts = { kind: TokenKind, initialized: bool, extensions: List[str] }
type SolBinding = { actor: int, network: str, authority: str, destination: str, claim: int, version: int, boundAt: int,
  walletSigned: bool, paidVersion: int, vetoes: int }
type Veto = { actor: int, version: int }
type SolMonth = { period: int, root: str, committed: int, total: int, released: int, frozenAt: int, cap: int,
  wholeReleased: bool, leaves: List[L::Leaf], settled: List[int] }
type Program = { build: Build, upgradeAuthority: str, now: int,
  configured: bool, configIdentity: str, configFee: str, rotationAuthority: str,
  layout: Layout, owner: str, project: str, network: str, purpose: L::Purpose, native: bool, mint: MintFacts, rent: int,
  identityAuthority: str, feeRecipient: str, bindingDelay: int, rotationDelay: int,
  pendingIdentity: str, rotationEffectiveAt: int, rotationConfirmed: bool,
  reserved: int, deposited: int, paid: int, payoutFees: int, withdrawnGross: int, withdrawalFees: int,
  accruedFees: int, monthlyOutstanding: int, monthlyCap: int, monthlyEnabled: bool,
  vaultAmount: int, unsolicited: int, claimedFees: int, ownerRefunded: int,
  awards: List[L::Award], monthlySources: List[int], months: List[SolMonth], bindings: List[SolBinding], vetoes: List[Veto] }
pure val maxDelay = 30 * 86400
pure val maxRotationDelay = 90 * 86400
pure val noMint: MintFacts = { kind: ClassicSpl, bytes: 0, mintAuthority: false, freezeAuthority: false, extensions: List(),
  pointerAuthority: false, updateAuthority: false, selfHosted: true }
pure val initial: Program = { build: LegacyBuild, upgradeAuthority: "upgrader", now: 1796342399,
  configured: false, configIdentity: "", configFee: "", rotationAuthority: "",
  layout: NoProject, owner: "", project: "", network: "", purpose: L::Ordinary, native: false, mint: noMint, rent: 0,
  identityAuthority: "", feeRecipient: "", bindingDelay: 0, rotationDelay: 0,
  pendingIdentity: "", rotationEffectiveAt: 0, rotationConfirmed: false,
  reserved: 0, deposited: 0, paid: 0, payoutFees: 0, withdrawnGross: 0, withdrawalFees: 0,
  accruedFees: 0, monthlyOutstanding: 0, monthlyCap: 0, monthlyEnabled: false,
  vaultAmount: 0, unsolicited: 0, claimedFees: 0, ownerRefunded: 0,
  awards: List(), monthlySources: List(), months: List(), bindings: List(), vetoes: List() }
pure def canUpgradeProgram(p: Program, by: str): bool = p.build == LegacyBuild and p.upgradeAuthority != "" and by == p.upgradeAuthority
pure def upgradeProgram(p: Program, by: str): Program = { ...p, build: CurrentBuild }
pure def canSetUpgradeAuthority(p: Program, successor: str, by: str): bool = p.upgradeAuthority != "" and by == p.upgradeAuthority
pure def setUpgradeAuthority(p: Program, successor: str, by: str): Program = { ...p, upgradeAuthority: successor }
pure def canInitializeConfig(p: Program, identity: str, feeRecipient: str, rotation: str, by: str): bool =
  p.build == CurrentBuild and not(p.configured) and p.upgradeAuthority != "" and by == p.upgradeAuthority
    and identity != "" and feeRecipient != "" and rotation != "" and identity != feeRecipient
    and rotation != identity and rotation != feeRecipient
pure def initializeConfig(p: Program, identity: str, feeRecipient: str, rotation: str, by: str): Program =
  { ...p, configured: true, configIdentity: identity, configFee: feeRecipient, rotationAuthority: rotation }
pure def canTick(p: Program, timestamp: int): bool = timestamp > p.now
pure def tick(p: Program, timestamp: int): Program = { ...p, now: timestamp }
pure def alwaysConfigSeparate(p: Program): bool = if (p.configured)
  p.configIdentity != "" and p.configFee != "" and p.rotationAuthority != "" and p.configIdentity != p.configFee
    and p.rotationAuthority != p.configIdentity and p.rotationAuthority != p.configFee
  else p.configIdentity == "" and p.configFee == "" and p.rotationAuthority == ""
pure def sometimesImmutable(p: Program): bool = p.build == CurrentBuild and p.configured and p.upgradeAuthority == ""
```

## Story: Admit only the supported asset behavior

### A Token-2022 mint has at most metadata extensions and no active authority, and its token accounts at most ImmutableOwner

`admitted_mint` admits a classic SPL mint unchanged. A Token-2022 mint must
fit in 1,024 bytes, have no mint or freeze authority, and carry at most
`MetadataPointer` and `TokenMetadata`, once each, with no pointer or update
authority and metadata that names the mint itself; any other or unknown
extension refuses. `admitted_token_account` admits a classic account, or an
initialized Token-2022 account whose only extension is `ImmutableOwner`. A
token account must belong to the project's token program. Native SOL uses a
program-owned vault, never a wrapped token.

```quint
pure def admittedMint(m: MintFacts): bool = m.kind == ClassicSpl or (m.kind == Token2022
  and M::token2022Admissible(m.bytes, m.mintAuthority, m.freezeAuthority, m.pointerAuthority, m.updateAuthority,
    m.selfHosted, m.extensions, List())
  and m.extensions.length() <= 2 and m.extensions.every(x => m.extensions.select(y => y == x).length() == 1))
pure def admittedAccount(a: AccountFacts, kind: TokenKind): bool = a.kind == kind and (a.kind == ClassicSpl
  or (a.kind == Token2022 and a.initialized and a.extensions.length() <= 1 and a.extensions.every(x => x == "ImmutableOwner")))
pure def alwaysAdmittedAsset(p: Program): bool = p.layout == CurrentLayout implies (p.native or admittedMint(p.mint))
pure def sometimesToken2022Funded(p: Program): bool = not(p.native) and p.mint.kind == Token2022 and p.deposited > 0
```

## Story: Create one project per owner, project ID and purpose

### The owner creates a token or native project with the Config's identity authority and fee recipient

`initialize` and `initialize_native` derive the project from the owner,
project ID and purpose, so a second project for that key fails. The
identity authority and fee recipient must be the Config's, nonzero and
distinct from each other and the owner, and the owner is not the rotation
authority. Any project ID is accepted, the all-zero one included. The binding delay is zero through 30 days and the rotation delay
zero through 90 days; new deployments use zero. A native vault keeps its
rent-exempt minimum forever.

```quint
pure def projectKeysValid(p: Program, identity: str, feeRecipient: str, delay: int, rotationDelay: int, by: str): bool =
  p.build == CurrentBuild and p.configured and p.layout == NoProject and by != ""
    and identity != "" and feeRecipient != "" and identity != by and identity != feeRecipient and feeRecipient != by
    and feeRecipient != "project" and by != p.rotationAuthority
    and identity == p.configIdentity and feeRecipient == p.configFee
    and delay >= 0 and delay <= maxDelay and rotationDelay >= 0 and rotationDelay <= maxRotationDelay
pure def opened(project: str, p: Program, network: str, identity: str, feeRecipient: str, delay: int,
  rotationDelay: int, purpose: L::Purpose, by: str): Program =
  { ...p, layout: CurrentLayout, owner: by, project: project, network: network, purpose: purpose,
    identityAuthority: identity, feeRecipient: feeRecipient, bindingDelay: delay, rotationDelay: rotationDelay }
pure def canInitialize(p: Program, project: str, network: str, identity: str, feeRecipient: str, delay: int,
  rotationDelay: int, purpose: L::Purpose, mint: MintFacts, by: str): bool =
  projectKeysValid(p, identity, feeRecipient, delay, rotationDelay, by) and admittedMint(mint)
pure def initialize(p: Program, project: str, network: str, identity: str, feeRecipient: str, delay: int,
  rotationDelay: int, purpose: L::Purpose, mint: MintFacts, by: str): Program =
  { ...opened(project, p, network, identity, feeRecipient, delay, rotationDelay, purpose, by), native: false, mint: mint }
pure def canInitializeNative(p: Program, project: str, network: str, identity: str, feeRecipient: str, delay: int,
  rotationDelay: int, purpose: L::Purpose, rent: int, by: str): bool =
  projectKeysValid(p, identity, feeRecipient, delay, rotationDelay, by) and rent > 0
pure def initializeNative(p: Program, project: str, network: str, identity: str, feeRecipient: str, delay: int,
  rotationDelay: int, purpose: L::Purpose, rent: int, by: str): Program =
  { ...opened(project, p, network, identity, feeRecipient, delay, rotationDelay, purpose, by), native: true, rent: rent }
```

### The earlier build's project grows to the current layout with new counters at zero

The 316-byte build had no accrued-fee or monthly-outstanding counters: it
sent fees out at once and had no monthly gate. Anyone may call
`migrate_project`, paying any extra rent, once the current build is
deployed; no other instruction reads the old layout. The model creates the
earlier build's project with deposits only. The program also carries over
that build's obligations with their recorded fee, payout fees already sent
(counted in `payout_fees` but never accrued) and expired months that left
the outstanding count. The rules on fees accounted, paid totals, award fees
and monthly outstanding gross therefore cover projects created by the
current build and migrated projects without such history.

```quint
pure def canCreateLegacyProject(p: Program, project: str, identity: str, feeRecipient: str, amount: int, by: str): bool =
  p.build == LegacyBuild and p.layout == NoProject and by != "" and project != "" and identity != "" and feeRecipient != ""
    and identity != by and identity != feeRecipient and feeRecipient != by and amount >= 0
pure def createLegacyProject(p: Program, project: str, identity: str, feeRecipient: str, amount: int, by: str): Program =
  { ...p, layout: LegacyLayout, owner: by, project: project, network: "legacy", purpose: L::Ordinary,
    identityAuthority: identity, feeRecipient: feeRecipient, mint: { ...noMint, bytes: 82 },
    deposited: amount, vaultAmount: amount }
pure def canMigrateProject(p: Program): bool = p.build == CurrentBuild and p.layout == LegacyLayout
pure def migrateProject(p: Program): Program = { ...p, layout: CurrentLayout, accruedFees: 0, monthlyOutstanding: 0 }
pure def alwaysProjectShape(p: Program): bool =
  (p.layout == NoProject implies p.owner == "" and p.deposited == 0 and p.vaultAmount == 0 and p.unsolicited == 0
    and p.awards.length() == 0 and p.months.length() == 0 and p.bindings.length() == 0)
    and (p.layout == LegacyLayout implies p.awards.length() == 0 and p.months.length() == 0 and p.bindings.length() == 0
      and p.accruedFees == 0 and p.monthlyOutstanding == 0 and p.reserved == 0)
    and (p.layout != NoProject implies p.owner != "" and p.identityAuthority != "" and p.feeRecipient != ""
      and p.identityAuthority != p.owner and p.identityAuthority != p.feeRecipient and p.feeRecipient != p.owner
      and p.bindingDelay >= 0 and p.bindingDelay <= maxDelay and p.rotationDelay >= 0 and p.rotationDelay <= maxRotationDelay)
    and (p.native implies p.rent > 0)
pure def stepProjectFixed(before: Program, after: Program): bool = before.layout != NoProject implies
  after.layout != NoProject and after.owner == before.owner and after.project == before.project
    and after.network == before.network and after.purpose == before.purpose and after.native == before.native
    and after.mint == before.mint and after.rent == before.rent and after.feeRecipient == before.feeRecipient
    and after.bindingDelay == before.bindingDelay and after.rotationDelay == before.rotationDelay
pure def sometimesMigrated(p: Program): bool = p.layout == CurrentLayout and p.network == "legacy" and p.deposited > 0
```

## Story: Rotate the identity authority with the owner and the rotation authority

### The owner proposes, the rotation authority confirms and anyone executes after the delay

`propose_authority_rotation` names one nonzero replacement that is not the
current authority, the owner, the fee recipient or the rotation authority.
`confirm_authority_rotation` is signed by the Config's rotation authority,
once; `cancel_authority_rotation` lets the owner withdraw the proposal; and
`execute_authority_rotation` succeeds for anyone once confirmed and due. The
current authority has no instruction that blocks it, and bindings, keyed by
project and actor, survive it.

```quint
pure def live(p: Program): bool = p.build == CurrentBuild and p.layout == CurrentLayout
pure def canProposeAuthorityRotation(p: Program, successor: str, by: str): bool =
  live(p) and p.configured and by == p.owner and successor != "" and successor != p.identityAuthority
    and successor != p.owner and successor != p.feeRecipient and successor != p.rotationAuthority and p.pendingIdentity == ""
pure def proposeAuthorityRotation(p: Program, successor: str, by: str): Program =
  { ...p, pendingIdentity: successor, rotationEffectiveAt: p.now + p.rotationDelay, rotationConfirmed: false }
pure def canConfirmAuthorityRotation(p: Program, by: str): bool =
  live(p) and p.configured and by == p.rotationAuthority and p.pendingIdentity != "" and not(p.rotationConfirmed)
pure def confirmAuthorityRotation(p: Program, by: str): Program = { ...p, rotationConfirmed: true }
pure def canCancelAuthorityRotation(p: Program, by: str): bool = live(p) and by == p.owner and p.pendingIdentity != ""
pure def cancelAuthorityRotation(p: Program, by: str): Program =
  { ...p, pendingIdentity: "", rotationEffectiveAt: 0, rotationConfirmed: false }
pure def canExecuteAuthorityRotation(p: Program): bool =
  live(p) and p.pendingIdentity != "" and p.rotationConfirmed and p.now >= p.rotationEffectiveAt
pure def executeAuthorityRotation(p: Program): Program =
  { ...p, identityAuthority: p.pendingIdentity, pendingIdentity: "", rotationEffectiveAt: 0, rotationConfirmed: false }
pure def alwaysRotationSeparate(p: Program): bool =
  (p.pendingIdentity == "" implies not(p.rotationConfirmed) and p.rotationEffectiveAt == 0)
    and (p.pendingIdentity != "" implies p.pendingIdentity != p.identityAuthority and p.pendingIdentity != p.owner
      and p.pendingIdentity != p.feeRecipient and p.pendingIdentity != p.rotationAuthority and p.configured)
pure def stepAuthorityChanges(before: Program, via: str, after: Program): bool =
  (before.identityAuthority != after.identityAuthority implies (via == "executeAuthorityRotation" or via == "initialize"
    or via == "initializeNative" or via == "createLegacyProject"))
    and ((after.rotationConfirmed and not(before.rotationConfirmed)) implies via == "confirmAuthorityRotation")
    and (before.upgradeAuthority != after.upgradeAuthority implies via == "setUpgradeAuthority")
    and (before.build != after.build implies via == "upgradeProgram")
    and (before.configured implies after.configIdentity == before.configIdentity and after.configFee == before.configFee
      and after.rotationAuthority == before.rotationAuthority)
pure def sometimesRotated(p: Program): bool = p.layout == CurrentLayout and p.identityAuthority == "nextAttester"
```

## Story: Hold funds in one vault

### Anyone deposits the exact amount, and only credited deposits enter the free balance

`deposit` moves an admitted token from an admitted account the depositor
controls with `transfer_checked`; `deposit_native` first checks the
existing vault and its rent reserve. The free balance is computed as
deposits less paid principal, payout fees, gross withdrawals and reserves;
uncredited transfers into the vault give no free balance.

```quint
pure def free(p: Program): int = p.deposited - p.paid - p.payoutFees - p.withdrawnGross - p.reserved
pure def held(p: Program): int = p.reserved + p.accruedFees
pure def canDeposit(p: Program, amount: int, account: AccountFacts, transferOk: bool): bool =
  live(p) and not(p.native) and amount > 0 and admittedMint(p.mint) and admittedAccount(account, p.mint.kind) and transferOk
pure def deposit(p: Program, amount: int, account: AccountFacts, transferOk: bool): Program =
  { ...p, deposited: p.deposited + amount, vaultAmount: p.vaultAmount + amount }
pure def canDepositNative(p: Program, amount: int): bool = live(p) and p.native and amount > 0
pure def depositNative(p: Program, amount: int): Program =
  { ...p, deposited: p.deposited + amount, vaultAmount: p.vaultAmount + amount }
pure def canTransferIn(p: Program, amount: int): bool = p.layout != NoProject and amount > 0
pure def transferIn(p: Program, amount: int): Program =
  { ...p, vaultAmount: p.vaultAmount + amount, unsolicited: p.unsolicited + amount }
```

### The vault holds exactly the free, reserved and accrued funds plus uncredited transfers, above its rent reserve

The computed free balance never underflows. A native vault's spendable
amount is its lamports above the rent-exempt minimum, which no transfer
reaches. Accrued fees are payout and withdrawal fees not yet claimed, and
the owner received each withdrawal less its fee.

```quint
pure def alwaysVaultCovers(p: Program): bool = free(p) >= 0
  and p.vaultAmount == free(p) + p.reserved + p.accruedFees + p.unsolicited
pure def alwaysFeesAccounted(p: Program): bool = p.accruedFees + p.claimedFees == p.payoutFees + p.withdrawalFees
  and p.ownerRefunded + p.withdrawalFees == p.withdrawnGross
pure def alwaysNonnegative(p: Program): bool = p.reserved >= 0 and p.deposited >= 0 and p.paid >= 0 and p.payoutFees >= 0
  and p.withdrawnGross >= 0 and p.withdrawalFees >= 0 and p.accruedFees >= 0 and p.monthlyOutstanding >= 0
  and p.vaultAmount >= 0 and p.unsolicited >= 0 and p.claimedFees >= 0 and p.ownerRefunded >= 0 and p.monthlyCap >= 0
pure def sometimesUnsolicited(p: Program): bool = p.unsolicited > 0
```

## Story: Commit awards from free funds

### The owner commits an ordinary award with the 2% fee or a bounty award with the 75/25 split

`commit` is for an ordinary project and refuses while an admitted month has
uncommitted gross (`MonthlyOutstanding`). `commit_bounty` is for a bounty
project and needs a gross divisible by four. Both reserve the whole gross
from the free balance and the vault, refuse a zero actor or gross but not
a zero source digest, and create the source's origin and obligation accounts, so a source commits
once.

```quint
pure def recordable(p: Program, source: int, actor: int, gross: int): bool =
  gross > 0 and actor > 0 and not(L::hasSource(p.awards, source))
pure def fundable(p: Program, gross: int): bool = p.vaultAmount >= held(p) + gross and free(p) >= gross
pure def canCommit(p: Program, source: int, actor: int, gross: int, by: str): bool =
  live(p) and by == p.owner and p.purpose == L::Ordinary and p.monthlyOutstanding == 0
    and recordable(p, source, actor, gross) and fundable(p, gross)
pure def commit(p: Program, source: int, actor: int, gross: int, by: str): Program =
  { ...p, reserved: p.reserved + gross, awards: p.awards.append(L::newAward(source, actor, gross, L::awardFee(p.purpose, gross), p.now)) }
pure def canCommitBounty(p: Program, source: int, actor: int, gross: int, by: str): bool =
  live(p) and by == p.owner and p.purpose == L::Bounty and gross % 4 == 0
    and recordable(p, source, actor, gross) and fundable(p, gross)
pure def commitBounty(p: Program, source: int, actor: int, gross: int, by: str): Program =
  { ...p, reserved: p.reserved + gross, awards: p.awards.append(L::newAward(source, actor, gross, L::awardFee(p.purpose, gross), p.now)) }
```

### Reserves are exactly the unpaid awards plus outstanding monthly gross, and paid totals are exactly the paid awards

```quint
pure def alwaysReservedMatches(p: Program): bool =
  p.reserved == L::unpaidPrincipal(p.awards) + L::unpaidFees(p.awards) + p.monthlyOutstanding
pure def alwaysPaidMatches(p: Program): bool = p.paid == L::paidPrincipal(p.awards) and p.payoutFees == L::paidFees(p.awards)
pure def alwaysAwardsWellFormed(p: Program): bool = L::uniqueSources(p.awards) and p.awards.every(a =>
  a.actor > 0 and L::awardGrossAdmissible(p.purpose, a.gross)
    and a.fee == L::awardFee(p.purpose, a.gross) and a.committedAt > 0 and a.committedAt <= p.now
    and (a.paid == (a.paidVersion > 0)) and (a.paid implies a.paidTo != ""))
pure def stepAwardsRetained(before: Program, after: Program): bool = before.awards.every(a =>
  after.awards.some(b => b.source == a.source and b.actor == a.actor and b.gross == a.gross and b.fee == a.fee
    and b.committedAt == a.committedAt and (a.paid implies b == a)))
pure def stepFreeSpentByOwnerOrAttestation(before: Program, via: str, after: Program): bool =
  free(after) < free(before) implies (via == "commit" or via == "commitBounty" or via == "commitMonthly"
    or via == "withdraw" or via == "withdrawNative")
```

## Story: Admit one funded monthly allocation per period within the owner's cap

### The owner sets the cap and turns monthly commitments on or off

`set_monthly_commitment` is for an ordinary project and refuses an enabled
zero cap. Turning commitments off stops new admissions only.

```quint
pure def canSetMonthlyCommitment(p: Program, cap: int, on: bool, by: str): bool =
  live(p) and by == p.owner and p.purpose == L::Ordinary and cap >= 0 and not(on and cap == 0)
pure def setMonthlyCommitment(p: Program, cap: int, on: bool, by: str): Program = { ...p, monthlyCap: cap, monthlyEnabled: on }
```

### Anyone records a signed, fully funded allocation once per period inside its window

`commit_monthly` needs the identity authority's Ed25519 signature over the
program, project, period, root, total, freeze time and network. The period
must be open, the freeze time between the window's opening and now, the
total positive, within the cap and covered by the free balance and the
vault. The month account exists once per period, and its total joins the
reserve and the outstanding monthly gross.

```quint
pure val noSolMonth: SolMonth = { period: 0, root: "", committed: 0, total: 0, released: 0, frozenAt: 0, cap: 0,
  wholeReleased: false, leaves: List(), settled: List() }
pure def hasMonth(ms: List[SolMonth], period: int): bool = ms.some(m => m.period == period)
pure def monthFor(ms: List[SolMonth], period: int): SolMonth = ms.foldl(noSolMonth, (found, m) => if (m.period == period) m else found)
pure def withMonth(ms: List[SolMonth], m: SolMonth): List[SolMonth] = ms.listMap(x => if (x.period == m.period) m else x)
pure def sumUnsettled(ms: List[SolMonth]): int = ms.foldl(0, (t, m) => t + m.total - m.committed)
pure def canCommitMonthly(p: Program, period: int, root: str, total: int, frozenAt: int, leaves: List[L::Leaf], attested: bool): bool =
  live(p) and p.purpose == L::Ordinary and p.monthlyEnabled and L::inWindow(period, p.now)
    and frozenAt >= L::opensAt(period) and frozenAt <= p.now and total > 0 and total <= p.monthlyCap
    and free(p) >= total and p.vaultAmount >= held(p) + total and attested and not(hasMonth(p.months, period))
pure def commitMonthly(p: Program, period: int, root: str, total: int, frozenAt: int, leaves: List[L::Leaf], attested: bool): Program =
  { ...p, reserved: p.reserved + total, monthlyOutstanding: p.monthlyOutstanding + total,
    months: p.months.append({ ...noSolMonth, period: period, root: root, total: total, frozenAt: frozenAt,
      cap: p.monthlyCap, leaves: leaves }) }
```

### Anyone commits a proved leaf from its month's reserve

`commit_monthly_award` proves the leaf against the root and requires the
tree's total to equal the month's total, so a wrong-total allocation never
settles a leaf. The leaf must fit the unsettled gross, and its per-month
settlement marker, project-wide monthly-source marker, origin and
obligation must not exist. The gross moves from the month's reservation to
an obligation with the ordinary fee, without charging the free balance.

```quint
pure def leafProves(m: SolMonth, leaf: L::Leaf): bool = m.leaves.includes(leaf) and L::leafTotal(m.leaves) == m.total
pure def settleable(p: Program, period: int, leaf: L::Leaf): bool =
  val m = monthFor(p.months, period)
  live(p) and hasMonth(p.months, period) and leafProves(m, leaf) and m.committed + leaf.gross <= m.total
    and not(m.settled.includes(leaf.source))
pure def settledMonths(p: Program, period: int, leaf: L::Leaf, released: int): List[SolMonth] =
  val m = monthFor(p.months, period)
  withMonth(p.months, { ...m, committed: m.committed + leaf.gross, released: m.released + released,
    settled: m.settled.append(leaf.source) })
pure def canCommitMonthlyAward(p: Program, period: int, leaf: L::Leaf): bool =
  settleable(p, period, leaf) and not(p.monthlySources.includes(leaf.source))
    and recordable(p, leaf.source, leaf.actor, leaf.gross) and p.vaultAmount >= held(p)
pure def commitMonthlyAward(p: Program, period: int, leaf: L::Leaf): Program =
  { ...p, months: settledMonths(p, period, leaf, 0), monthlyOutstanding: p.monthlyOutstanding - leaf.gross,
    monthlySources: p.monthlySources.append(leaf.source),
    awards: p.awards.append(L::newAward(leaf.source, leaf.actor, leaf.gross, M::ordinaryFee(leaf.gross), p.now)) }
pure def sometimesLeafCommitted(p: Program): bool = p.months.some(m => m.committed > m.released)
```

### Anyone returns a leaf that can never commit, and never a selective refund

`release_monthly_award` releases a positive leaf whose actor is zero, or
whose source already has an obligation that pays the same actor at least
this gross and principal, or was committed before the allocation froze. A
smaller or redirected award after the freeze leaves the gross reserved. The
shared settlement marker lets each source of a month settle once.

```quint
pure def neverCommits(p: Program, m: SolMonth, leaf: L::Leaf): bool =
  val a = L::awardFor(p.awards, leaf.source)
  leaf.actor == 0 or (L::hasSource(p.awards, leaf.source) and ((a.actor == leaf.actor and a.gross >= leaf.gross
    and a.gross - a.fee >= leaf.gross - M::ordinaryFee(leaf.gross)) or a.committedAt < m.frozenAt))
pure def canReleaseMonthlyAward(p: Program, period: int, leaf: L::Leaf): bool =
  leaf.gross > 0 and settleable(p, period, leaf) and neverCommits(p, monthFor(p.months, period), leaf)
pure def releaseMonthlyAward(p: Program, period: int, leaf: L::Leaf): Program =
  { ...p, months: settledMonths(p, period, leaf, leaf.gross), reserved: p.reserved - leaf.gross,
    monthlyOutstanding: p.monthlyOutstanding - leaf.gross }
pure def sometimesAwardReleased(p: Program): bool = p.months.some(m => m.released > 0 and not(m.wholeReleased))
```

### The owner releases the whole untouched reserve of a wrong-total month once, with the attester's signature

`release_monthly_reserve` needs the identity authority's signature over the
month's root, total, unsettled and released gross. It refuses unless nothing
of the month has settled or been released and the released amount is the
whole unsettled total, so a later per-leaf release can never return the
same gross twice. The month stays recorded.

```quint
pure def canReleaseMonthlyReserve(p: Program, period: int, expectedUnsettled: int, releasedAmount: int, attested: bool, by: str): bool =
  val m = monthFor(p.months, period)
  live(p) and by == p.owner and hasMonth(p.months, period) and m.total - m.committed == expectedUnsettled
    and m.committed == 0 and m.released == 0 and expectedUnsettled == m.total
    and releasedAmount > 0 and releasedAmount == expectedUnsettled and attested
pure def releaseMonthlyReserve(p: Program, period: int, expectedUnsettled: int, releasedAmount: int, attested: bool, by: str): Program =
  val m = monthFor(p.months, period)
  { ...p, reserved: p.reserved - releasedAmount, monthlyOutstanding: p.monthlyOutstanding - releasedAmount,
    months: withMonth(p.months, { ...m, committed: m.total, released: m.total, wholeReleased: true }) }
pure def sometimesWholeReserveReleased(p: Program): bool = p.months.some(m => m.wholeReleased)
```

### Each period has one month within the cap at admission, and outstanding gross is the sum of unsettled totals

A wholly released month settled no leaf; every settled source is a leaf of
its month and settles once. Only an ordinary project holds months.

```quint
pure def alwaysMonthsWellFormed(p: Program): bool = p.months.every(m =>
  p.months.select(o => o.period == m.period).length() == 1 and L::validPeriod(m.period)
    and m.total > 0 and m.total <= m.cap and m.committed >= 0 and m.committed <= m.total
    and m.released >= 0 and m.released <= m.committed and m.frozenAt > 0
    and (m.wholeReleased implies m.released == m.total and m.committed == m.total and m.settled.length() == 0)
    and m.settled.every(s => m.settled.select(o => o == s).length() == 1 and m.leaves.some(l => l.source == s)))
pure def alwaysOutstandingMatchesMonths(p: Program): bool = p.monthlyOutstanding == sumUnsettled(p.months)
pure def alwaysBountyHasNoMonthly(p: Program): bool = p.purpose == L::Bounty implies
  p.months.length() == 0 and not(p.monthlyEnabled) and p.monthlyCap == 0
pure def stepMonthsRetained(before: Program, after: Program): bool = before.months.every(m =>
  after.months.some(o => o.period == m.period and o.root == m.root and o.total == m.total and o.frozenAt == m.frozenAt
    and o.leaves == m.leaves and o.committed >= m.committed and o.released >= m.released
    and m.settled.every(s => o.settled.includes(s))))
```

## Story: Bind each actor's wallet with the attester and the wallet

### The identity authority and the destination both sign a binding for the project's network

`bind_wallet` needs the project's identity authority and the destination
as signers. It refuses a zero actor, a destination equal to the authority,
the project or the vault, a zero claim, an expired submission, another
network and a stale predecessor. The new version is the only one that can
pay; earlier payment and veto counts stay with the actor.

```quint
pure val noSolBinding: SolBinding = { actor: 0, network: "", authority: "", destination: "", claim: 0, version: 0,
  boundAt: 0, walletSigned: false, paidVersion: 0, vetoes: 0 }
pure def hasBinding(bs: List[SolBinding], actor: int): bool = bs.some(b => b.actor == actor)
pure def bindingFor(bs: List[SolBinding], actor: int): SolBinding =
  bs.foldl(noSolBinding, (found, b) => if (b.actor == actor) b else found)
pure def withBinding(bs: List[SolBinding], b: SolBinding): List[SolBinding] =
  if (hasBinding(bs, b.actor)) bs.listMap(x => if (x.actor == b.actor) b else x) else bs.append(b)
pure def canBindWallet(p: Program, actor: int, network: str, expectedVersion: int, claim: int, expiresAt: int,
  destination: str, walletSigned: bool, by: str): bool =
  live(p) and by == p.identityAuthority and walletSigned and actor > 0 and destination != ""
    and destination != by and destination != "project" and destination != "vault" and claim != 0
    and p.now < expiresAt and network == p.network and bindingFor(p.bindings, actor).version == expectedVersion
pure def bindWallet(p: Program, actor: int, network: str, expectedVersion: int, claim: int, expiresAt: int,
  destination: str, walletSigned: bool, by: str): Program =
  val old = bindingFor(p.bindings, actor)
  { ...p, bindings: withBinding(p.bindings, { ...old, actor: actor, network: network, authority: by,
    destination: destination, claim: claim, version: expectedVersion + 1, boundAt: p.now, walletSigned: true }) }
pure def stepNewBindingAttested(before: Program, after: Program): bool = after.bindings.every(b =>
  before.bindings.some(o => o.actor == b.actor and o.version == b.version)
    or (b.authority == before.identityAuthority and b.walletSigned))
```

### The owner vetoes the latest unpaid binding version once, inside a review window and within the cap

`veto_binding` creates the veto account for the actor and version, so a
version is vetoed once. It needs the latest version, not the one last paid,
and an open binding review period or the commit period of a named unpaid
award to that actor. Without a confirmed pending rotation the owner vetoes
at most three times between payments.

```quint
pure def vetoed(p: Program, actor: int, version: int): bool = p.vetoes.some(v => v.actor == actor and v.version == version)
pure def canVetoBinding(p: Program, actor: int, version: int, obligation: int, by: str): bool =
  val b = bindingFor(p.bindings, actor)
  val a = L::awardFor(p.awards, obligation)
  live(p) and by == p.owner and hasBinding(p.bindings, actor) and b.version == version and version > 0
    and version != b.paidVersion and not(vetoed(p, actor, version))
    and (obligation == 0 or (L::hasSource(p.awards, obligation) and a.actor == actor and not(a.paid)))
    and (p.now < b.boundAt + p.bindingDelay or (obligation != 0 and p.now < a.committedAt + p.bindingDelay))
    and L::cancelAllowed(b.vetoes, p.pendingIdentity != "" and p.rotationConfirmed)
pure def vetoBinding(p: Program, actor: int, version: int, obligation: int, by: str): Program =
  val b = bindingFor(p.bindings, actor)
  { ...p, vetoes: p.vetoes.append({ actor: actor, version: version }),
    bindings: withBinding(p.bindings, { ...b, vetoes: L::cancelsAfter(b.vetoes, p.pendingIdentity != "" and p.rotationConfirmed) }) }
pure def alwaysBindingsWellFormed(p: Program): bool = p.bindings.every(b =>
  p.bindings.select(o => o.actor == b.actor).length() == 1 and b.actor > 0 and b.version > 0 and b.network == p.network
    and b.destination != "" and b.destination != "project" and b.destination != "vault" and b.destination != b.authority
    and b.claim != 0 and b.walletSigned and b.authority != "" and b.paidVersion >= 0 and b.paidVersion <= b.version
    and b.vetoes >= 0 and b.vetoes <= L::maxCancels and b.boundAt > 0 and b.boundAt <= p.now)
  and p.vetoes.every(v => hasBinding(p.bindings, v.actor) and v.version > 0 and v.version <= bindingFor(p.bindings, v.actor).version
    and p.vetoes.select(o => o == v).length() == 1)
pure def sometimesVetoed(p: Program): bool = p.vetoes.length() > 0
```

## Story: Pay, refund and claim fees exactly

### Anyone pays a matured obligation to its actor's latest unvetoed binding

`pay` and `pay_native` refuse a paid obligation, one inside its commit
delay, an actor without a binding, a vetoed version and a stale expected
version. A token payment goes to the binding destination's associated
account of the project's mint and program; a native payment goes to the
destination itself. The fee stays in the vault as accrued fees.

```quint
pure def payable(p: Program, source: int, expectedVersion: int, destination: str): bool =
  val a = L::awardFor(p.awards, source)
  val b = bindingFor(p.bindings, a.actor)
  live(p) and L::hasSource(p.awards, source) and not(a.paid) and p.now >= a.committedAt + p.bindingDelay
    and hasBinding(p.bindings, a.actor) and b.network == p.network and b.version > 0
    and not(vetoed(p, a.actor, b.version)) and b.version == expectedVersion and destination == b.destination
pure def paidOut(source: int, p: Program): Program =
  val a = L::awardFor(p.awards, source)
  val b = bindingFor(p.bindings, a.actor)
  { ...p, awards: L::markPaid(p.awards, source, b.destination, b.version),
    bindings: withBinding(p.bindings, { ...b, paidVersion: b.version, vetoes: 0 }),
    reserved: p.reserved - a.gross, paid: p.paid + a.gross - a.fee, payoutFees: p.payoutFees + a.fee,
    accruedFees: p.accruedFees + a.fee, vaultAmount: p.vaultAmount - (a.gross - a.fee) }
pure def canPay(p: Program, source: int, expectedVersion: int, destination: str, account: AccountFacts, transferOk: bool): bool =
  val a = L::awardFor(p.awards, source)
  payable(p, source, expectedVersion, destination) and not(p.native) and admittedMint(p.mint)
    and admittedAccount(account, p.mint.kind) and (transferOk or a.gross - a.fee == 0)
pure def pay(p: Program, source: int, expectedVersion: int, destination: str, account: AccountFacts, transferOk: bool): Program =
  paidOut(source, p)
pure def canPayNative(p: Program, source: int, expectedVersion: int, destination: str): bool =
  payable(p, source, expectedVersion, destination) and p.native
pure def payNative(p: Program, source: int, expectedVersion: int, destination: str): Program = paidOut(source, p)
pure def paidThroughBinding(p: Program, a: L::Award): bool =
  val b = bindingFor(p.bindings, a.actor)
  b.version == a.paidVersion and b.destination == a.paidTo and not(vetoed(p, a.actor, b.version))
pure def stepPaidToLiveBinding(before: Program, after: Program): bool = after.awards.every(a =>
  not(a.paid) or L::awardFor(before.awards, a.source).paid or paidThroughBinding(before, a))
pure def sometimesTokenPaid(p: Program): bool = not(p.native) and p.paid > 0
pure def sometimesNativePaid(p: Program): bool = p.native and p.paid > 0
pure def sometimesBountyPaid(p: Program): bool = p.purpose == L::Bounty and p.paid > 0
```

### The owner withdraws free funds to its own account less the 2% fee

`withdraw` sends to a token account the owner controls and `withdraw_native`
to the owner's key. Both refuse a zero gross and a gross that the free
balance or the vault above its holdings cannot cover. The fee stays in the
vault as accrued fees.

```quint
pure def refundable(p: Program, gross: int, transferOk: bool): bool = live(p) and gross > 0
  and p.vaultAmount >= held(p) + gross and free(p) >= gross and (transferOk or gross - M::ordinaryFee(gross) == 0)
pure def refunded(gross: int, p: Program): Program =
  val fee = M::ordinaryFee(gross)
  { ...p, withdrawnGross: p.withdrawnGross + gross, withdrawalFees: p.withdrawalFees + fee, accruedFees: p.accruedFees + fee,
    vaultAmount: p.vaultAmount - (gross - fee), ownerRefunded: p.ownerRefunded + gross - fee }
pure def canWithdraw(p: Program, gross: int, account: AccountFacts, transferOk: bool, by: str): bool =
  by == p.owner and not(p.native) and refundable(p, gross, transferOk) and admittedMint(p.mint) and admittedAccount(account, p.mint.kind)
pure def withdraw(p: Program, gross: int, account: AccountFacts, transferOk: bool, by: str): Program = refunded(gross, p)
pure def canWithdrawNative(p: Program, gross: int, by: str): bool = by == p.owner and p.native and refundable(p, gross, true)
pure def withdrawNative(p: Program, gross: int, by: str): Program = refunded(gross, p)
pure def sometimesWithdrawn(p: Program): bool = p.withdrawnGross > 0
```

### Anyone moves all accrued fees to the fee recipient

`claim_fees` sends to an admitted token account the fee recipient owns and
`claim_fees_native` to the fee recipient's key; both refuse when nothing
has accrued. Only these instructions depend on the fee recipient.

```quint
pure def feesClaimed(amount: int, p: Program): Program =
  { ...p, claimedFees: p.claimedFees + amount, vaultAmount: p.vaultAmount - amount, accruedFees: 0 }
pure def canClaimFees(p: Program, account: AccountFacts, transferOk: bool): bool =
  live(p) and not(p.native) and p.accruedFees > 0 and admittedMint(p.mint) and admittedAccount(account, p.mint.kind) and transferOk
pure def claimFees(p: Program, account: AccountFacts, transferOk: bool): Program = feesClaimed(p.accruedFees, p)
pure def canClaimFeesNative(p: Program): bool = live(p) and p.native and p.accruedFees > 0
pure def claimFeesNative(p: Program): Program = feesClaimed(p.accruedFees, p)
pure def sometimesFeesClaimed(p: Program): bool = p.claimedFees > 0
```

### Simulation samples cover admitted and refused assets, windows, allocations and signers

These sets bound simulation only.

```quint
pure val byValues = Set("owner", "upgrader", "attester", "rotator", "other")
pure val successorValues = Set("nextAttester", "owner", "rotator", "")
pure val identityValues = Set("attester", "fees")
pure val feeRecipientValues = Set("fees", "owner")
pure val rotationValues = Set("rotator", "attester")
pure val projectValues = Set("slop", "")
pure val networkValues = Set("solana", "other")
pure val delayValues = Set(0, 1)
pure val rotationDelayValues = Set(0, 1)
pure val rentValues = Set(890880)
pure val mintValues = Set(
  { kind: ClassicSpl, bytes: 82, mintAuthority: true, freezeAuthority: true, extensions: List(),
    pointerAuthority: false, updateAuthority: false, selfHosted: true },
  { kind: Token2022, bytes: 300, mintAuthority: false, freezeAuthority: false, extensions: List("MetadataPointer", "TokenMetadata"),
    pointerAuthority: false, updateAuthority: false, selfHosted: true },
  { kind: Token2022, bytes: 300, mintAuthority: true, freezeAuthority: false, extensions: List("MetadataPointer", "TokenMetadata"),
    pointerAuthority: false, updateAuthority: false, selfHosted: true },
  { kind: Token2022, bytes: 300, mintAuthority: false, freezeAuthority: false, extensions: List("TransferHook"),
    pointerAuthority: false, updateAuthority: false, selfHosted: true },
  { kind: Token2022, bytes: 1025, mintAuthority: false, freezeAuthority: false, extensions: List(),
    pointerAuthority: false, updateAuthority: false, selfHosted: true },
  { kind: OtherProgram, bytes: 82, mintAuthority: false, freezeAuthority: false, extensions: List(),
    pointerAuthority: false, updateAuthority: false, selfHosted: true })
pure val accountValues = Set(
  { kind: ClassicSpl, initialized: true, extensions: List() },
  { kind: Token2022, initialized: true, extensions: List("ImmutableOwner") },
  { kind: Token2022, initialized: false, extensions: List() },
  { kind: Token2022, initialized: true, extensions: List("MemoTransfer") })
pure val amountValues = Set(54, 100)
pure val sourceValues = Set(0, 1, 2, 10)
pure val actorValues = Set(1, 2)
pure val grossValues = Set(0, 4, 50, 51)
pure val capValues = Set(0, 54, 100)
pure val periodValues = Set(202611, 202612, 202613)
pure val rootValues = Set("r")
pure val totalValues = Set(54, 60)
pure val frozenAtValues = Set(1796342399, 1796342400)
pure val leavesValues = Set(
  List({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 }),
  List({ actor: 1, gross: 50, source: 1 }, { actor: 2, gross: 4, source: 11 }),
  List({ actor: 0, gross: 54, source: 12 }))
pure val leafValues = Set({ actor: 1, gross: 50, source: 10 }, { actor: 2, gross: 4, source: 11 },
  { actor: 1, gross: 50, source: 1 }, { actor: 0, gross: 54, source: 12 })
pure val expectedUnsettledValues = Set(54, 60)
pure val releasedAmountValues = Set(4, 54, 60)
pure val destinationValues = Set("wallet", "attester", "vault")
pure val expectedVersionValues = Set(0, 1)
pure val versionValues = Set(1, 2)
pure val obligationValues = Set(0, 1, 10)
pure val claimValues = Set(0, 7)
pure val expiresAtValues = Set(1796342399, 1799020801)
pure val timestampValues = Set(1796342400, 1796342401, 1799020800)
pure val weight_upgradeProgram = 20
pure val weight_initializeConfig = 20
pure val weight_initialize = 20
pure val weight_initializeNative = 20
pure val weight_deposit = 25
pure val weight_depositNative = 25
pure val weight_commit = 20
pure val weight_commitBounty = 15
pure val weight_bindWallet = 25
pure val weight_pay = 30
pure val weight_payNative = 30
pure val weight_commitMonthly = 25
pure val weight_commitMonthlyAward = 30
pure val weight_releaseMonthlyAward = 30
pure val weight_releaseMonthlyReserve = 25
pure val weight_vetoBinding = 15
pure val weight_tick = 10
```
