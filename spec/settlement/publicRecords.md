# Public payment records

PRD sections 6 and 9 publish every finalized ordinary vault payment and
every [disclosed direct transfer](./directTransfers.md), and a public total
of what each contributor received. Public pages read these records, never
the chain. Source anchors are development `backend/payments/public-records.ts`
(`publicVaultPayments`, `publicReceivedTotals`),
`backend/payments/direct-history.ts` (`directTransferPage`),
`src/lib/received-totals.ts` (`isUsdMicroAsset`) and
`backend/projects/pool-funding.ts`. Which rows a page may show at all is
[frontend projections](../frontend/projections.md), "Ordinary public payment
rows require finalized evidence and a public account".

## Story: Publish finalized payments without fabricating a total

### Public vault payments are paged at most 100 per page under a frozen upper bound

The first page freezes the highest record sequence at the time of the read;
every later page of the same reading passes that bound back, so payments
recorded meanwhile never shift or repeat rows. A cursor outside
`0 ≤ after ≤ through ≤ highest` is refused. A page holds at most 100 rows in
sequence order after the cursor, the cursor of the next page when more rows
remain, and the count of matching rows up to the bound. Scopes are the whole
record, one project or one contributor.

```quint
import money as M from "./money"
type PageWindow = { valid: bool, sequences: List[int], nextCursor: int, total: int }
type PageFold = { taken: List[int], more: bool }
pure val publicPageSize = 100
pure def validCursor(after: int, through: int, highest: int): bool = after >= 0 and through >= after and through <= highest
pure def pageWindow(sequences: List[int], after: int, through: int, highest: int): PageWindow =
  val inBound = sequences.select(q => q <= through)
  val walk = inBound.select(q => q > after).foldl({ taken: List(), more: false }, (acc, q) =>
    if (acc.taken.length() < publicPageSize) { ...acc, taken: acc.taken.append(q) } else { ...acc, more: true })
  if (not(validCursor(after, through, highest))) { valid: false, sequences: List(), nextCursor: 0, total: 0 }
  else { valid: true, sequences: walk.taken, nextCursor: if (walk.more) walk.taken.nthOr(publicPageSize - 1, 0) else 0,
    total: inBound.length() }
```

### A paid row is published only with its finalized payment event

A vault payment row is the finalized `paid` event of a paid obligation whose
recorded transaction is that event's, joined to its monthly source when it
has one. Its evidence must restate the obligation's network, chain, vault,
contributor, source, gross, fee, net and asset exactly; one row that does
not fails the whole read rather than being skipped. A contributor whose
Points account is private or closed is left out. The row shows the net
amount, the asset and its decimals, the transaction and the time it was
indexed.

```quint
type VaultPaymentRecord = { sequence: int, project: str, actor: int, network: str, testnet: bool, asset: str, decimals: int,
  referenceStablecoin: bool, gross: M::Amount, fee: M::Amount, finalizedPaid: bool, evidenceMatches: bool, publicAccount: bool }
pure def recordShown(r: VaultPaymentRecord, includeTestnets: bool): bool =
  r.finalizedPaid and r.publicAccount and (includeTestnets or not(r.testnet))
pure def recordValid(r: VaultPaymentRecord): bool = r.evidenceMatches and M::validAmount(r.gross) and M::validAmount(r.fee)
  and M::compareAmounts(r.fee, r.gross) <= 0 and r.decimals >= 0 and r.decimals <= 36
pure def netAmount(r: VaultPaymentRecord): M::Amount = M::subtractAmounts(r.gross, r.fee)
pure def vaultPage(records: List[VaultPaymentRecord], after: int, through: int, highest: int, includeTestnets: bool): PageWindow =
  val window = pageWindow(records.select(r => recordShown(r, includeTestnets)).listMap(r => r.sequence), after, through, highest)
  if (records.some(r => window.sequences.includes(r.sequence) and not(recordValid(r)))) { ...window, valid: false } else window
```

### The received total sums only 6-decimal reference stablecoins in micro-dollars over at most 20,000 records and keeps other assets apart

Each contributor's dollar total is every disclosed direct transfer, already
in micro-dollars, plus the net of each shown vault payment whose asset is a
registered reference stablecoin of its network with 6 decimals. Every other
asset is kept as its own total per network and asset, never converted or
added to dollars. Each source is read in pages under a frozen bound; more
than 20,000 rows of either source fails the read instead of returning a
partial total, and one invalid vault record fails it too.

```quint
type AssetTotal = { network: str, asset: str, decimals: int, net: M::Amount }
type DirectRecord = { sequence: int, project: str, actor: int, amountMicro: M::Amount }
type ReceivedTotal = { complete: bool, usdMicro: M::Amount, directMicro: M::Amount, vaultUsdMicro: M::Amount,
  directTransfers: int, vaultPayments: int, otherAssets: List[AssetTotal] }
pure val receivedRecordBound = 20000
pure def usdMicroAsset(r: VaultPaymentRecord): bool = r.referenceStablecoin and r.decimals == 6
pure def addOtherAsset(totals: List[AssetTotal], r: VaultPaymentRecord): List[AssetTotal] =
  if (totals.some(t => t.network == r.network and t.asset == r.asset))
    totals.listMap(t => if (t.network == r.network and t.asset == r.asset) { ...t, net: M::addAmounts(t.net, netAmount(r)) } else t)
  else totals.append({ network: r.network, asset: r.asset, decimals: r.decimals, net: netAmount(r) })
pure def receivedBy(records: List[VaultPaymentRecord], directs: List[DirectRecord], actor: int, includeTestnets: bool): ReceivedTotal =
  val shown = records.select(r => r.actor == actor and recordShown(r, includeTestnets))
  val dollars = shown.select(r => usdMicroAsset(r))
  val own = directs.select(d => d.actor == actor)
  val direct = own.foldl(M::zero, (sum, d) => M::addAmounts(sum, d.amountMicro))
  val vault = dollars.foldl(M::zero, (sum, r) => M::addAmounts(sum, netAmount(r)))
  { complete: records.length() <= receivedRecordBound and directs.length() <= receivedRecordBound
      and records.every(r => not(recordShown(r, includeTestnets)) or recordValid(r)),
    usdMicro: M::addAmounts(direct, vault), directMicro: direct, vaultUsdMicro: vault,
    directTransfers: own.length(), vaultPayments: shown.length(),
    otherAssets: shown.select(r => not(usdMicroAsset(r))).foldl(List(), (totals, r) => addOtherAsset(totals, r)) }
```

### Disclosed direct transfers are paged and never counted as vault payments

Direct transfers of one project or one contributor use the same frozen-bound
paging, 100 rows a page, with the micro-dollar total of the rows on the
page. They are counted as direct transfers only: a direct transfer never
becomes a vault payment, an obligation or a paid award.

```quint
pure def directPage(directs: List[DirectRecord], after: int, through: int, highest: int): PageWindow =
  pageWindow(directs.listMap(d => d.sequence), after, through, highest)
pure def pageMicro(directs: List[DirectRecord], window: PageWindow): M::Amount =
  directs.select(d => window.sequences.includes(d.sequence)).foldl(M::zero, (sum, d) => M::addAmounts(sum, d.amountMicro))
```

### Testnet rows appear only on staging

Production leaves testnet vault payments, testnet received totals and
testnet vaults in pool funding out; the staging deployment includes them.

```quint
type Tier = Production | Staging
pure def testnetsShownOn(tier: Tier): bool = tier == Staging
pure def lawProductionHidesTestnets(r: VaultPaymentRecord): bool = r.testnet implies not(recordShown(r, testnetsShownOn(Production)))
pure val rValues = Set({ sequence: 1, project: "eliza", actor: 3, network: "base-sepolia", testnet: true, asset: "usdc", decimals: 6,
  referenceStablecoin: true, gross: List(100), fee: List(2), finalizedPaid: true, evidenceMatches: true, publicAccount: true },
  { sequence: 2, project: "eliza", actor: 3, network: "base", testnet: false, asset: "usdc", decimals: 6,
  referenceStablecoin: true, gross: List(100), fee: List(2), finalizedPaid: true, evidenceMatches: true, publicAccount: true })
```
