# EVM finalized payment scanner

PRD sections 6 and 9 require payment state to come only from finalized
chain evidence that background jobs cache. One instance is the scanner
checkpoint of one project vault on one EVM network (Base, Ethereum or
Robinhood Chain). The cursor is the last block whose recognized escrow events
were all verified and indexed. Source anchors are development
`workers/payments/scanner.ts` (`scanEvmPayments`), the
`payment_chain_cursors` upsert that never lowers a position, and
`backend/payments/README.md` ("Every EVM scan checks the RPC chain ID…").
Legacy model `evm_scan_checkpoint` maps here.

The RPC adapter reports the chain ID, the `finalized` block number, the
deployment transaction receipt and the escrow logs of one block range. Each
recognized `Reserved` or `Paid` log is indexed through the payment ledger
([payment investigation](./paymentInvestigation.md) for payouts). The
indexer reports, for one page, a typed `PageIndex`: each log in the page's
block range with its kind (recognized or unknown) and the ledger's outcome
(indexed, refused, or held for investigation). A page verifies only when that
report covers exactly the page's range and every log in it is recognized and
indexed. A payout the ledger holds for investigation also places a hold on
its block, which [payment investigation](./paymentInvestigation.md) sets and
releases (a composition obligation); no page containing a held block
verifies, so the cursor never passes an investigated payout.

## Story: Advance coverage only over verified finalized pages

### A reviewed deployment record fixes the chain, page size and origin

The scanner refuses to run without the reviewed chain ID, a page size from
one to 9,999,999 blocks and the successful deployment transaction's block.
A cursor stored before the chain-ID check was released is imported as it
is (`origin - 1` when none) and remembered as legacy coverage.

```quint
type Page = { id: int, start: int, end: int, verified: bool }
type Coverage = Trusted | NeedsAudit | Audited
type LogKind = Recognized | Unknown
type LogOutcome = Indexed | Refused | Held
type LogResult = { block: int, kind: LogKind, outcome: LogOutcome }
type PageIndex = { pageId: int, start: int, end: int, logs: List[LogResult] }
type AuditEvidence = { fromBlock: int, through: int, replayed: int, matched: int }
type EvmScan = { configured: bool, expectedChain: int, pageBlocks: int, origin: int, cursor: int, head: int,
  pages: List[Page], coverage: Coverage, legacyThrough: int, unverifiedThrough: int, holds: List[int], refusals: int, failures: int }
pure val initial: EvmScan = { configured: false, expectedChain: 0, pageBlocks: 0, origin: 0, cursor: -1, head: 0,
  pages: List(), coverage: Trusted, legacyThrough: -1, unverifiedThrough: -1, holds: List(), refusals: 0, failures: 0 }
pure def canConfigure(s: EvmScan, chainId: int, pageBlocks: int, origin: int, legacyCursor: int): bool =
  not(s.configured) and chainId > 0 and pageBlocks >= 1 and pageBlocks <= 9999999 and origin > 0 and legacyCursor >= origin - 1
pure def configure(s: EvmScan, chainId: int, pageBlocks: int, origin: int, legacyCursor: int): EvmScan =
  { ...s, configured: true, expectedChain: chainId, pageBlocks: pageBlocks, origin: origin, cursor: legacyCursor,
    head: legacyCursor, legacyThrough: legacyCursor }
```

### A run first authenticates the RPC chain, including for an empty page

A chain-ID mismatch stops the run before it reads or advances the cursor.

```quint
pure def canRefuseChain(s: EvmScan, rpcChain: int): bool = s.configured and rpcChain != s.expectedChain
pure def refuseChain(s: EvmScan, rpcChain: int): EvmScan = { ...s, refusals: s.refusals + 1 }
pure def canObserveHead(s: EvmScan, rpcChain: int, height: int): bool = s.configured and rpcChain == s.expectedChain and height > s.head
pure def observeHead(s: EvmScan, rpcChain: int, height: int): EvmScan = { ...s, head: height }
```

### A page starts at the cursor and never passes the finalized head

Overlapping runs may start pages from the same cursor.

```quint
pure def nextStart(s: EvmScan): int = s.cursor + 1
pure def pageEnd(s: EvmScan): int = if (nextStart(s) + s.pageBlocks - 1 < s.head) nextStart(s) + s.pageBlocks - 1 else s.head
pure def canStartPage(s: EvmScan, pageId: int, rpcChain: int): bool =
  s.configured and rpcChain == s.expectedChain and nextStart(s) <= s.head and pageId > 0 and not(s.pages.some(p => p.id == pageId))
pure def startPage(s: EvmScan, pageId: int, rpcChain: int): EvmScan =
  { ...s, pages: s.pages.append({ id: pageId, start: nextStart(s), end: pageEnd(s), verified: false }) }
```

### Every recognized event of a page must index before the page verifies

A failed or unavailable read, an unknown event, or an event the ledger
refuses or holds (such as a payout to an unauthorized destination) fails the
page and retains the last completed block. A held block blocks every page
that contains it until the investigation releases the hold.

```quint
pure def hasPage(s: EvmScan, pageId: int): bool = s.pages.some(p => p.id == pageId)
pure def pageFor(s: EvmScan, pageId: int): Page = s.pages.select(p => p.id == pageId).nthOr(0, { id: 0, start: 0, end: -1, verified: false })
pure def cleanIndex(page: Page, index: PageIndex): bool =
  index.pageId == page.id and index.start == page.start and index.end == page.end
    and index.logs.every(l => l.block >= page.start and l.block <= page.end and l.kind == Recognized and l.outcome == Indexed)
pure def heldIn(s: EvmScan, page: Page): bool = s.holds.some(b => b >= page.start and b <= page.end)
pure def canVerifyPage(s: EvmScan, index: PageIndex): bool =
  val page = pageFor(s, index.pageId)
  page.id > 0 and not(page.verified) and cleanIndex(page, index) and not(heldIn(s, page))
pure def verifyPage(s: EvmScan, index: PageIndex): EvmScan =
  { ...s, pages: s.pages.listMap(p => if (p.id == index.pageId) { ...p, verified: true } else p) }
pure def canFailPage(s: EvmScan, pageId: int): bool = hasPage(s, pageId) and not(pageFor(s, pageId).verified)
pure def failPage(s: EvmScan, pageId: int): EvmScan = { ...s, pages: s.pages.select(p => p.id != pageId), failures: s.failures + 1 }
pure def canHoldBlock(s: EvmScan, block: int): bool = s.configured and block > s.cursor and not(s.holds.includes(block))
pure def holdBlock(s: EvmScan, block: int): EvmScan =
  { ...s, holds: s.holds.append(block), pages: s.pages.select(p => not(block >= p.start and block <= p.end)) }
pure def canReleaseHold(s: EvmScan, block: int): bool = s.holds.includes(block)
pure def releaseHold(s: EvmScan, block: int): EvmScan = { ...s, holds: s.holds.select(b => b != block) }
```

### Completion advances the cursor monotonically, even when runs finish out of order

```quint
pure def canCompletePage(s: EvmScan, pageId: int): bool = s.pages.some(p => p.id == pageId and p.verified)
pure def completePage(s: EvmScan, pageId: int): EvmScan =
  val page = pageFor(s, pageId)
  { ...s, cursor: if (page.end > s.cursor) page.end else s.cursor, pages: s.pages.select(p => p.id != pageId) }
```

## Story: Coverage advanced before the chain check needs an audit

### Historic coverage is verified only after an audit from the deployment boundary

Only coverage imported from before the chain-ID check was released is
flagged; coverage this scanner advanced itself was checked. It stays
unverified until an audit replays every retained event from the trusted
deployment boundary through that block and every replayed event matches the
ledger. The flag never lowers the cursor.

```quint
pure def canFlagLegacyCoverage(s: EvmScan): bool = s.configured and s.coverage == Trusted and s.legacyThrough >= s.origin
pure def flagLegacyCoverage(s: EvmScan): EvmScan = { ...s, coverage: NeedsAudit, unverifiedThrough: s.legacyThrough }
pure def canRecordAudit(s: EvmScan, audit: AuditEvidence): bool =
  s.coverage == NeedsAudit and audit.fromBlock == s.origin and audit.through >= s.unverifiedThrough
    and audit.replayed >= 0 and audit.matched == audit.replayed
pure def recordAudit(s: EvmScan, audit: AuditEvidence): EvmScan = { ...s, coverage: Audited }
pure def verifiedThrough(s: EvmScan): int = if (s.coverage == NeedsAudit) s.origin - 1 else s.cursor
```

### The cursor stays inside the finalized deployment range and never decreases

```quint
pure def alwaysCursorBounded(s: EvmScan): bool = s.configured implies
  s.cursor >= s.origin - 1 and (s.cursor == s.origin - 1 or s.cursor <= s.head)
pure def alwaysPagesInsideHead(s: EvmScan): bool = s.pages.every(p => p.start >= s.origin and p.start <= p.end and p.end <= s.head
  and p.start <= s.cursor + 1 and s.pages.select(o => o.id == p.id).length() == 1)
pure def alwaysUnconfiguredIdle(s: EvmScan): bool = not(s.configured) implies s.pages.length() == 0 and s.cursor == -1
pure def alwaysAuditFlagShape(s: EvmScan): bool = (s.coverage == NeedsAudit implies s.unverifiedThrough >= s.origin
  and s.unverifiedThrough == s.legacyThrough) and verifiedThrough(s) <= s.cursor
pure def alwaysHeldBlocksUncovered(s: EvmScan): bool = s.holds.every(b => b > s.cursor)
pure def alwaysNoVerifiedPageOverHold(s: EvmScan): bool = s.pages.every(p => not(p.verified and heldIn(s, p)))
pure def stepCursorMonotone(before: EvmScan, after: EvmScan): bool = after.cursor >= before.cursor and after.head >= before.head
pure def stepCursorOnlyByVerifiedPage(before: EvmScan, via: str, after: EvmScan): bool =
  after.cursor != before.cursor implies (via == "completePage" or via == "configure")
pure def stepConfigurationFixed(before: EvmScan, after: EvmScan): bool = before.configured implies
  after.expectedChain == before.expectedChain and after.pageBlocks == before.pageBlocks and after.origin == before.origin
pure def sometimesOutOfOrder(s: EvmScan): bool = s.cursor > s.origin and s.failures > 0 and s.refusals > 0
pure def sometimesTwoPagesInFlight(s: EvmScan): bool = s.pages.length() >= 2
pure def sometimesAudited(s: EvmScan): bool = s.coverage == Audited
pure def sometimesHeldThenPassed(s: EvmScan): bool = s.holds.length() == 0 and s.cursor >= 13 and s.failures > 0
```

### Simulation samples

```quint
pure val chainIdValues = Set(8453)
pure val pageBlocksValues = Set(2)
pure val originValues = Set(10)
pure val rpcChainValues = Set(8453, 1)
pure val heightValues = Set(11, 13, 16)
pure val pageIdValues = Set(1, 2, 3)
pure val legacyCursorValues = Set(9, 11)
pure val blockValues = Set(12)
pure val indexValues = Set(
  { pageId: 1, start: 10, end: 11, logs: List() }, { pageId: 1, start: 12, end: 13, logs: List({ block: 12, kind: Recognized, outcome: Indexed }) },
  { pageId: 1, start: 12, end: 13, logs: List({ block: 12, kind: Recognized, outcome: Held }) },
  { pageId: 2, start: 12, end: 13, logs: List({ block: 12, kind: Recognized, outcome: Indexed }) },
  { pageId: 2, start: 14, end: 15, logs: List({ block: 15, kind: Unknown, outcome: Indexed }) },
  { pageId: 2, start: 14, end: 15, logs: List() }, { pageId: 3, start: 14, end: 15, logs: List() },
  { pageId: 3, start: 12, end: 13, logs: List() }, { pageId: 1, start: 14, end: 15, logs: List() },
  { pageId: 3, start: 16, end: 16, logs: List() }, { pageId: 1, start: 12, end: 12, logs: List() })
pure val auditValues = Set({ fromBlock: 10, through: 11, replayed: 3, matched: 3 }, { fromBlock: 10, through: 11, replayed: 3, matched: 2 },
  { fromBlock: 1, through: 16, replayed: 0, matched: 0 })
```
