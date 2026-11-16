# EVM monthly reserve and materialized awards

PRD section 6 bounds the ordinary monthly root commitment by the owner's
cap, enabled setting and one commitment per period. This is the contract
projection from an authenticated root admission to individual payable awards.
The [monthly coordinator](./monthly.md) owns frozen private amounts. The
[untouched reserve release](./reserveRelease.md) owns the product attester's
stricter release approval. The payout adapter supplies exact existing actor
binding and finalized evidence when a materialized award is paid.

Source is Slop main `ee1a4b2cd2672245537928380e425f5bd9ecb994`,
`contracts/evm/src/ProjectEscrow.sol:327–359,393–412,475–496,507–518,564–695,757–788`.
EIP-712 signatures, chain receipts, Merkle-sum proofs, exact deposit and payout
observations remain authenticated adapter inputs. No action sends a
transaction. Balances are the gross values attributed to free funds, uncreated
monthly leaves, created unpaid awards and paid or refunded funds. The gross
projections do not imply that a payout fee already moved to the fee wallet.
This projection covers V2 root admission. An existing legacy root still blocks admission to its period. A retained-vault
reader must also supply complete consumed-source history. This initial state
starts before those commitments.

## Story: Reserve one signed monthly root, then reclassify its funded leaves

### The current cap, authority and UTC commitment window gate only root admission

The EVM period is YYYYMM from 2000 through 9999. Its window starts 72 hours
after that UTC month ends and closes 72 hours after the next month ends.
Amounts use exact base units and the contract's uint128 domain. The uint256
ordinary source sequence ranges over full-width limbs. Identifiers represent
canonical nonzero contract and signature identities. Before the first
observation, no prior balances or contract roots have been imported.

```quint
import money as M from "./money"
type AwardLeaf = { sourceDigest: str, actor: str, gross: M::Amount }
type SignedMonthlyRoot = { period: int, vault: str, chain: str, allocationDigest: str, root: str,
  wholeGross: M::Amount, remainingGross: M::Amount, leafCount: int, sourceSequence: M::Amount,
  authority: str, validSignature: bool }
type MonthRoot = { period: int, allocationDigest: str, root: str, admittedGross: M::Amount,
  remaining: M::Amount, releasedGross: M::Amount, leafCount: int, admittedAt: int }
type AwardRow = { leaf: AwardLeaf, period: int, index: int, paidReceipt: str, recipient: str }
type LeafProof = { period: int, index: int, allocationDigest: str, root: str, leaf: AwardLeaf,
  rootTotal: M::Amount, verifiedProof: bool, canonicalTransaction: str }
type ContractRelease = { period: int, root: str, allocationDigest: str, expectedRemaining: M::Amount,
  releaseGross: M::Amount, authority: str, authenticated: bool, canonicalTransaction: str }
type AwardPayment = { sourceDigest: str, actor: str, gross: M::Amount, recipient: str,
  transaction: str, finalized: bool, authorizedBinding: bool, exactSettlement: bool }
type GrossBalances = { free: M::Amount, pending: M::Amount, reserved: M::Amount, paid: M::Amount, refunded: M::Amount, deposits: M::Amount }
type MonthlyReserve = { vault: str, chain: str, owner: str, authority: str, clock: int,
  enabledMonthly: bool, cap: M::Amount, sourceSequence: M::Amount,
  balances: GrossBalances, months: List[MonthRoot], awards: List[AwardRow], receipts: List[str] }
pure val maxU128: M::Amount = List(455, 211, 768, 431, 607, 374, 463, 463, 938, 920, 366, 282, 340)
pure val maxU256: M::Amount = List(935, 639, 129, 913, 7, 584, 457, 39, 564, 640, 665, 984, 269, 853, 907, 687, 8, 985, 570, 423, 195, 316, 237, 89, 792, 115)
pure val noLeaf: AwardLeaf = { sourceDigest: "", actor: "", gross: M::zero }
pure val noAward: AwardRow = { leaf: noLeaf, period: 0, index: -1, paidReceipt: "", recipient: "" }
pure val noMonth: MonthRoot = { period: 0, allocationDigest: "", root: "", admittedGross: M::zero,
  remaining: M::zero, releasedGross: M::zero, leafCount: 0, admittedAt: 0 }
pure val initial: MonthlyReserve = { vault: "vault", chain: "base", owner: "owner", authority: "authority", clock: 1796342400,
  enabledMonthly: true, cap: List(8), sourceSequence: M::zero, months: List(), awards: List(), receipts: List(),
  balances: { free: M::zero, pending: M::zero, reserved: M::zero, paid: M::zero, refunded: M::zero, deposits: M::zero } }
pure def boundedGross(amount: M::Amount): bool = M::validAmount(amount) and M::compareAmounts(amount, maxU128) <= 0
pure def positiveGross(amount: M::Amount): bool = boundedGross(amount) and M::positiveAmount(amount)
pure def validPeriod(period: int): bool = period >= 200001 and period <= 999912 and period % 100 >= 1 and period % 100 <= 12
pure def nextPeriod(period: int): int = if (period % 100 == 12) (period / 100 + 1) * 100 + 1 else period + 1
pure def monthStart(period: int): int =
  val month = period % 100
  val year = period / 100 - (if (month <= 2) 1 else 0)
  val era = year / 400
  val yearOfEra = year - era * 400
  val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5
  (era * 146097 + yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear - 719468) * 86400
pure def windowOpen(period: int, clock: int): bool = validPeriod(period)
  and clock >= monthStart(nextPeriod(period)) + 259200 and clock < monthStart(nextPeriod(nextPeriod(period))) + 259200
pure def canObserveClock(v: MonthlyReserve, timestamp: int): bool = timestamp > v.clock
pure def observeClock(v: MonthlyReserve, timestamp: int): MonthlyReserve = { ...v, clock: timestamp }
pure def canSetMonthly(v: MonthlyReserve, cap: M::Amount, enabledMonthly: bool, by: str): bool =
  by == v.owner and boundedGross(cap) and (not(enabledMonthly) or M::positiveAmount(cap))
pure def setMonthly(v: MonthlyReserve, cap: M::Amount, enabledMonthly: bool, by: str): MonthlyReserve =
  { ...v, cap: cap, enabledMonthly: enabledMonthly }
pure def canObserveAuthority(v: MonthlyReserve, authority: str, verifiedFactoryChange: bool): bool =
  authority != "" and authority != v.authority and verifiedFactoryChange
pure def observeAuthority(v: MonthlyReserve, authority: str, verifiedFactoryChange: bool): MonthlyReserve = { ...v, authority: authority }
pure def hasMonth(v: MonthlyReserve, period: int): bool = v.months.some(row => row.period == period)
pure def rootFor(v: MonthlyReserve, period: int): MonthRoot =
  v.months.foldl(noMonth, (selected, row) => if (row.period == period) row else selected)
pure def awardFor(v: MonthlyReserve, sourceDigest: str): AwardRow =
  v.awards.foldl(noAward, (selected, row) => if (row.leaf.sourceDigest == sourceDigest) row else selected)
pure def sourceFree(v: MonthlyReserve, sourceDigest: str): bool = not(v.awards.some(row => row.leaf.sourceDigest == sourceDigest))
pure def availableSequence(v: MonthlyReserve): bool = M::compareAmounts(v.sourceSequence, maxU256) < 0
pure def availableReceipt(v: MonthlyReserve, transaction: str): bool = transaction != "" and not(v.receipts.includes(transaction))
pure def enoughFree(v: MonthlyReserve, amount: M::Amount): bool = M::compareAmounts(v.balances.free, amount) >= 0
pure def validLeaf(leaf: AwardLeaf): bool = leaf.sourceDigest != "" and leaf.actor != "" and positiveGross(leaf.gross)
```

### Admission holds gross once and follows the current ordinary-source sequence

The attestation binds chain, vault, period, allocation digest, root, full
pool, remaining gross, leaf count, and ordinary-source sequence. The cap
checks the full pool. The amount debited is only its unfunded remainder.
The ordinary source sequence advances for every created award. A concurrent
manual award or a leaf from another period makes a previously signed but
unadmitted root stale. A root with all its awards already committed may have
zero pending gross and zero leaves. Root identity occupies the period forever.
Root admission observes the externally attested transaction. The service cannot choose its allocation or use the signature for an unrelated transfer.

```quint
pure def canAdmitRoot(v: MonthlyReserve, authorization: SignedMonthlyRoot, canonicalTransaction: str): bool =
  v.enabledMonthly and windowOpen(authorization.period, v.clock) and not(hasMonth(v, authorization.period))
    and authorization.vault == v.vault and authorization.chain == v.chain and authorization.authority == v.authority
    and authorization.validSignature and authorization.root != "" and authorization.allocationDigest != ""
    and M::validAmount(authorization.sourceSequence) and M::equalAmounts(authorization.sourceSequence, v.sourceSequence)
    and positiveGross(authorization.wholeGross) and boundedGross(authorization.remainingGross)
    and M::compareAmounts(authorization.remainingGross, authorization.wholeGross) <= 0
    and M::compareAmounts(authorization.wholeGross, v.cap) <= 0
    and authorization.leafCount >= 0 and authorization.leafCount <= 4294967295
    and ((authorization.leafCount == 0) == M::equalAmounts(authorization.remainingGross, M::zero))
    and enoughFree(v, authorization.remainingGross) and availableReceipt(v, canonicalTransaction)
pure def admitRoot(v: MonthlyReserve, authorization: SignedMonthlyRoot, canonicalTransaction: str): MonthlyReserve =
  val amount = authorization.remainingGross
  { ...v, receipts: v.receipts.append(canonicalTransaction),
    months: v.months.append({ period: authorization.period, allocationDigest: authorization.allocationDigest,
      root: authorization.root, admittedGross: amount, remaining: amount,
      releasedGross: M::zero, leafCount: authorization.leafCount, admittedAt: v.clock }),
    balances: { ...v.balances, free: M::subtractAmounts(v.balances.free, amount), pending: M::addAmounts(v.balances.pending, amount) } }
pure def canManual(v: MonthlyReserve, leaf: AwardLeaf, canonicalTransaction: str, by: str): bool =
  by == v.owner and M::equalAmounts(v.balances.pending, M::zero) and validLeaf(leaf) and sourceFree(v, leaf.sourceDigest)
    and availableSequence(v) and enoughFree(v, leaf.gross) and availableReceipt(v, canonicalTransaction)
pure def manual(v: MonthlyReserve, leaf: AwardLeaf, canonicalTransaction: str, by: str): MonthlyReserve =
  { ...v, receipts: v.receipts.append(canonicalTransaction), sourceSequence: M::addAmounts(v.sourceSequence, List(1)),
    awards: v.awards.append({ leaf: leaf, period: 0, index: -1, paidReceipt: "", recipient: "" }),
    balances: { ...v.balances, free: M::subtractAmounts(v.balances.free, leaf.gross), reserved: M::addAmounts(v.balances.reserved, leaf.gross) } }
```

### An admitted leaf reclassifies its gross without debiting free funds again

A verified Merkle-sum proof identifies the exact indexed payment source,
actor, amount and admitted total. The contract requires a globally unused
source. Two distinct roots can carry the same source, but only the first
materialization reaches an award. A later owner opt-out, authority rotation
or closed period leaves a valid funded leaf actionable. No payout wallet is
needed to materialize it. Closing the window does not release remaining funds.

```quint
pure def leafUnspent(v: MonthlyReserve, period: int, index: int): bool =
  not(v.awards.some(row => row.period == period and row.index == index))
pure def hasPending(v: MonthlyReserve, amount: M::Amount): bool = M::compareAmounts(v.balances.pending, amount) >= 0
pure def canMaterialize(v: MonthlyReserve, proof: LeafProof): bool =
  val month = rootFor(v, proof.period)
  month.period > 0 and proof.verifiedProof and proof.root == month.root and proof.allocationDigest == month.allocationDigest
    and M::validAmount(proof.rootTotal) and M::equalAmounts(proof.rootTotal, month.admittedGross)
    and proof.index >= 0 and proof.index < month.leafCount and validLeaf(proof.leaf)
    and sourceFree(v, proof.leaf.sourceDigest) and leafUnspent(v, proof.period, proof.index) and availableSequence(v)
    and M::compareAmounts(month.remaining, proof.leaf.gross) >= 0 and hasPending(v, proof.leaf.gross)
    and availableReceipt(v, proof.canonicalTransaction)
pure def afterLeaf(month: MonthRoot, amount: M::Amount): MonthRoot =
  { ...month, remaining: M::subtractAmounts(month.remaining, amount) }
pure def materialize(v: MonthlyReserve, proof: LeafProof): MonthlyReserve =
  val amount = proof.leaf.gross
  { ...v, receipts: v.receipts.append(proof.canonicalTransaction), sourceSequence: M::addAmounts(v.sourceSequence, List(1)),
    months: v.months.listMap(month => if (month.period == proof.period) afterLeaf(month, amount) else month),
    awards: v.awards.append({ leaf: proof.leaf, period: proof.period, index: proof.index, paidReceipt: "", recipient: "" }),
    balances: { ...v.balances, pending: M::subtractAmounts(v.balances.pending, amount), reserved: M::addAmounts(v.balances.reserved, amount) } }
```

### A valid contract release returns only the selected remaining gross

The contract requires the current owner and an exact current identity-authority
signature over this period's root, allocation digest, expected remainder and
release amount. The contract can accept a partial release. The application
service approves only the entire untouched wrong-total reserve under its
separate product rules. This action only records contract acceptance. It
issues no approval. Already materialized awards stay payable, and a remaining
leaf can still prove if it fits. A changed remainder invalidates an earlier
release signature, and the period stays occupied after a release.

```quint
pure def canRelease(v: MonthlyReserve, release: ContractRelease, by: str): bool =
  val month = rootFor(v, release.period)
  month.period > 0 and by == v.owner and release.authenticated and release.authority == v.authority
    and release.root == month.root and release.allocationDigest == month.allocationDigest
    and boundedGross(release.expectedRemaining) and M::equalAmounts(release.expectedRemaining, month.remaining)
    and positiveGross(release.releaseGross) and M::compareAmounts(month.remaining, release.releaseGross) >= 0
    and hasPending(v, release.releaseGross) and availableReceipt(v, release.canonicalTransaction)
pure def afterRelease(month: MonthRoot, amount: M::Amount): MonthRoot =
  { ...month, remaining: M::subtractAmounts(month.remaining, amount), releasedGross: M::addAmounts(month.releasedGross, amount) }
pure def release(v: MonthlyReserve, release: ContractRelease, by: str): MonthlyReserve =
  val amount = release.releaseGross
  { ...v, receipts: v.receipts.append(release.canonicalTransaction),
    months: v.months.listMap(month => if (month.period == release.period) afterRelease(month, amount) else month),
    balances: { ...v.balances, pending: M::subtractAmounts(v.balances.pending, amount), free: M::addAmounts(v.balances.free, amount) } }
```

### Only materialized awards can pay, and a refund uses only free funds

A finalized payment names the exact award source and actor, approved binding,
gross and actual recipient. The chain adapter checks the exact principal and
fee split and current binding version from the canonical transaction. Paying
moves gross out of created-award reserve while retaining its immutable source
identity. Only the current contract owner can refund free funds to the owner's
destination under the reviewed withdrawal terms.

```quint
pure def canDeposit(v: MonthlyReserve, amount: M::Amount, canonicalTransaction: str, exactTransfer: bool): bool =
  exactTransfer and positiveGross(amount) and boundedGross(M::addAmounts(v.balances.deposits, amount))
    and availableReceipt(v, canonicalTransaction)
pure def deposit(v: MonthlyReserve, amount: M::Amount, canonicalTransaction: str, exactTransfer: bool): MonthlyReserve =
  { ...v, receipts: v.receipts.append(canonicalTransaction),
    balances: { ...v.balances, free: M::addAmounts(v.balances.free, amount), deposits: M::addAmounts(v.balances.deposits, amount) } }
pure def paidMatches(oldAward: AwardRow, payout: AwardPayment): bool = oldAward.leaf.sourceDigest == payout.sourceDigest
pure def canPay(v: MonthlyReserve, payout: AwardPayment): bool =
  val award = awardFor(v, payout.sourceDigest)
  award.leaf.sourceDigest != "" and paidMatches(award, payout) and award.paidReceipt == "" and payout.actor == award.leaf.actor
    and payout.recipient != "" and boundedGross(payout.gross) and M::equalAmounts(payout.gross, award.leaf.gross)
    and M::compareAmounts(v.balances.reserved, award.leaf.gross) >= 0 and availableReceipt(v, payout.transaction)
    and payout.finalized and payout.authorizedBinding and payout.exactSettlement
pure def pay(v: MonthlyReserve, payout: AwardPayment): MonthlyReserve =
  val amount = awardFor(v, payout.sourceDigest).leaf.gross
  { ...v, receipts: v.receipts.append(payout.transaction),
    awards: v.awards.listMap(award => if (paidMatches(award, payout))
      { ...award, paidReceipt: payout.transaction, recipient: payout.recipient } else award),
    balances: { ...v.balances, reserved: M::subtractAmounts(v.balances.reserved, amount), paid: M::addAmounts(v.balances.paid, amount) } }
pure def canRefund(v: MonthlyReserve, amount: M::Amount, canonicalTransaction: str, exactWithdrawal: bool, by: str): bool =
  by == v.owner and exactWithdrawal and positiveGross(amount) and enoughFree(v, amount) and availableReceipt(v, canonicalTransaction)
pure def refund(v: MonthlyReserve, amount: M::Amount, canonicalTransaction: str, exactWithdrawal: bool, by: str): MonthlyReserve =
  { ...v, receipts: v.receipts.append(canonicalTransaction),
    balances: { ...v.balances, free: M::subtractAmounts(v.balances.free, amount), refunded: M::addAmounts(v.balances.refunded, amount) } }
```

### A funded leaf keeps its historical root and never changes its approved identity

Every money transition moves an exact amount between two gross balance buckets
or records an equal external deposit. The sum of the gross buckets includes
both funds still held and the cumulative paid or refunded value. Root and
award identity records remain available after payout and release. One source
can lead to at most one recorded award. An authenticated receipt's identity
is consumed once. Multiple operations in one chain transaction can be
represented using the distinct canonical event identity for each operation.

```quint
pure def heldGross(balances: GrossBalances): M::Amount =
  List(balances.free, balances.pending, balances.reserved, balances.paid, balances.refunded).foldl(M::zero, (sum, itemAmount) => M::addAmounts(sum, itemAmount))
pure def alwaysConserved(v: MonthlyReserve): bool = M::equalAmounts(v.balances.deposits, heldGross(v.balances))
pure def alwaysValidAmounts(v: MonthlyReserve): bool = M::validAmount(v.balances.free) and M::validAmount(v.balances.pending)
  and M::validAmount(v.balances.reserved) and M::validAmount(v.balances.paid) and M::validAmount(v.balances.refunded)
  and M::validAmount(v.balances.deposits) and M::validAmount(v.sourceSequence)
pure def validMonth(month: MonthRoot): bool = validPeriod(month.period) and month.root != "" and month.allocationDigest != ""
  and M::validAmount(month.admittedGross) and M::validAmount(month.remaining) and M::validAmount(month.releasedGross)
  and month.leafCount >= 0 and month.leafCount <= 4294967295 and month.admittedAt > 0
pure def alwaysMonths(v: MonthlyReserve): bool = v.months.every(month => validMonth(month))
pure def validAward(award: AwardRow): bool = validLeaf(award.leaf)
  and ((award.period == 0 and award.index == -1) or (validPeriod(award.period) and award.index >= 0))
  and ((award.paidReceipt == "") == (award.recipient == ""))
pure def alwaysAwards(v: MonthlyReserve): bool = v.awards.every(award => validAward(award))
pure def alwaysCompatibleRows(v: MonthlyReserve): bool = v.months.every(month =>
  v.months.every(other => other.period == month.period implies other == month))
  and v.awards.every(award => v.awards.every(other => (other.leaf.sourceDigest == award.leaf.sourceDigest
    or (award.period > 0 and other.period == award.period and other.index == award.index)) implies other == award))
pure def selfSameRoot(a: MonthRoot, b: MonthRoot): bool = a.period == b.period and a.root == b.root
  and a.allocationDigest == b.allocationDigest and a.admittedGross == b.admittedGross and a.leafCount == b.leafCount and a.admittedAt == b.admittedAt
pure def stepRetainedRoots(before: MonthlyReserve, after: MonthlyReserve): bool = before.months.every(oldRoot =>
  after.months.some(newRoot => selfSameRoot(oldRoot, newRoot)))
pure def sameAwardIdentity(a: AwardRow, b: AwardRow): bool = a.leaf == b.leaf and a.period == b.period and a.index == b.index
pure def stepRetainedAwards(before: MonthlyReserve, after: MonthlyReserve): bool = before.awards.every(oldAward =>
  after.awards.some(newAward => sameAwardIdentity(oldAward, newAward) and (oldAward.paidReceipt != "" implies oldAward == newAward)))
pure def stepExactSourceSequence(before: MonthlyReserve, via: str, after: MonthlyReserve): bool =
  if (via == "manual" or via == "materialize") after.sourceSequence == M::addAmounts(before.sourceSequence, List(1))
  else after.sourceSequence == before.sourceSequence
pure def stepSourceReceiptsRetained(before: MonthlyReserve, after: MonthlyReserve): bool =
  before.receipts.every(receipt => after.receipts.includes(receipt))
pure def stepMaterializationKeepsFree(before: MonthlyReserve, via: str, after: MonthlyReserve): bool =
  via == "materialize" implies after.balances.free == before.balances.free
    and after.awards.length() == before.awards.length() + 1
pure def stepNewSource(before: MonthlyReserve, via: str, after: MonthlyReserve): bool =
  val row = after.awards.nthOr(before.awards.length(), noAward)
  (via == "manual" or via == "materialize") implies after.awards == before.awards.append(row)
    and sourceFree(before, row.leaf.sourceDigest)
pure def stepNewPeriod(before: MonthlyReserve, via: str, after: MonthlyReserve): bool =
  val month = after.months.nthOr(before.months.length(), noMonth)
  via == "admitRoot" implies after.months == before.months.append(month) and not(hasMonth(before, month.period))
pure def sometimesConcurrentPeriods(v: MonthlyReserve): bool = v.months.length() > 1 and M::positiveAmount(v.balances.pending)
pure def sometimesPartialMaterialization(v: MonthlyReserve): bool = M::positiveAmount(v.balances.pending) and M::positiveAmount(v.balances.reserved)
pure def sometimesLeafAfterOptOut(v: MonthlyReserve): bool = not(v.enabledMonthly) and v.awards.some(award => award.period > 0)
pure def sometimesReleased(v: MonthlyReserve): bool = v.months.some(month => M::positiveAmount(month.releasedGross))
pure def sometimesPaid(v: MonthlyReserve): bool = M::positiveAmount(v.balances.paid)
```

### Simulation spans the next commitment window and both authority versions

These examples make the stale sequence and cross-period leaf races reachable
without imposing a limit on the generated transitions.

```quint
pure val firstPeriod = 202611
pure val secondPeriod = 202612
pure val firstAuthorization: SignedMonthlyRoot = { period: firstPeriod, vault: "vault", chain: "base",
  allocationDigest: "allocation-one", root: "root-one", wholeGross: List(4), remainingGross: List(4),
  leafCount: 2, sourceSequence: List(0), authority: "authority", validSignature: true }
pure val secondAuthorization: SignedMonthlyRoot = { ...firstAuthorization, period: secondPeriod,
  allocationDigest: "allocation-two", root: "root-two", wholeGross: List(3), remainingGross: List(3), leafCount: 1 }
pure val secondReattested: SignedMonthlyRoot = { ...secondAuthorization, sourceSequence: List(1), authority: "next-authority" }
pure val firstLeaf: AwardLeaf = { sourceDigest: "source-one", actor: "actor-one", gross: List(1) }
pure val secondLeaf: AwardLeaf = { sourceDigest: "source-two", actor: "actor-two", gross: List(3) }
pure val firstProof: LeafProof = { period: firstPeriod, index: 0, allocationDigest: "allocation-one", root: "root-one",
  leaf: firstLeaf, rootTotal: List(4), verifiedProof: true, canonicalTransaction: "first-leaf" }
pure val nextProof: LeafProof = { ...firstProof, index: 1, leaf: secondLeaf, canonicalTransaction: "second-leaf" }
pure val crossProof: LeafProof = { ...nextProof, period: secondPeriod, index: 0, allocationDigest: "allocation-two",
  root: "root-two", rootTotal: List(3), canonicalTransaction: "cross-leaf" }
pure val partialRelease: ContractRelease = { period: firstPeriod, root: "root-one", allocationDigest: "allocation-one",
  expectedRemaining: List(4), releaseGross: List(1), authority: "authority", authenticated: true, canonicalTransaction: "release" }
pure val paidFirst: AwardPayment = { sourceDigest: "source-one", actor: "actor-one", gross: List(1),
  recipient: "wallet-one", transaction: "paid-first", finalized: true, authorizedBinding: true, exactSettlement: true }
pure val amountValues = Set(List(1), List(3), List(8), List(16))
pure val capValues = Set(List(0), List(8))
pure val leafValues = Set(firstLeaf, secondLeaf)
pure val proofValues = Set(firstProof, nextProof, crossProof, { ...firstProof, verifiedProof: false })
pure val releaseValues = Set(partialRelease, { ...partialRelease, expectedRemaining: List(3) },
  { ...partialRelease, expectedRemaining: List(3), authority: "next-authority" })
pure val payoutValues = Set(paidFirst, { ...paidFirst, sourceDigest: "source-two", actor: "actor-two", gross: List(3), transaction: "paid-second" })
pure val authorizationValues = Set(firstAuthorization, secondAuthorization, secondReattested,
  { ...secondAuthorization, authority: "next-authority" }, { ...secondAuthorization, sourceSequence: List(1) })
pure val canonicalTransactionValues = Set("deposit", "root-tx-one", "root-tx-two", "manual", "refund")
pure val timestampValues = Set(1796342399, 1796342401, 1799020799, 1799020800, 1799020801)
pure val authorityValues = Set("authority", "next-authority")
pure val byValues = Set("owner", "wrong")
pure val weight_observeClock = 1
pure val weight_admitRoot = 12
pure val weight_materialize = 8
pure val weight_deposit = 12
pure val weight_manual = 3
pure val weight_setMonthly = 2
pure val weight_release = 6
pure val weight_pay = 7
```
