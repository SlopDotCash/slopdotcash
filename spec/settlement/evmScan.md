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
([payment investigation](./paymentInvestigation.md) for payouts); a page
verifies only when every recognized log in it indexed.

## Story: Advance coverage only over verified finalized pages

### A reviewed deployment record fixes the chain, page size and origin

The scanner refuses to run without the reviewed chain ID, a page size from
one to 9,999,999 blocks and the successful deployment transaction's block.

```quint
type Page = { id: int, start: int, end: int, verified: bool }
type Coverage = Trusted | NeedsAudit | Audited
type EvmScan = { configured: bool, expectedChain: int, pageBlocks: int, origin: int, cursor: int, head: int,
  pages: List[Page], coverage: Coverage, unverifiedThrough: int, refusals: int, failures: int }
pure val initial: EvmScan = { configured: false, expectedChain: 0, pageBlocks: 0, origin: 0, cursor: -1, head: 0,
  pages: List(), coverage: Trusted, unverifiedThrough: -1, refusals: 0, failures: 0 }
pure def canConfigure(s: EvmScan, chainId: int, pageBlocks: int, origin: int): bool =
  not(s.configured) and chainId > 0 and pageBlocks >= 1 and pageBlocks <= 9999999 and origin > 0
pure def configure(s: EvmScan, chainId: int, pageBlocks: int, origin: int): EvmScan =
  { ...s, configured: true, expectedChain: chainId, pageBlocks: pageBlocks, origin: origin, cursor: origin - 1 }
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
refuses (such as a payout to an unauthorized destination) fails the page and
retains the last completed block.

```quint
pure def hasPage(s: EvmScan, pageId: int): bool = s.pages.some(p => p.id == pageId)
pure def canVerifyPage(s: EvmScan, pageId: int): bool = s.pages.some(p => p.id == pageId and not(p.verified))
pure def verifyPage(s: EvmScan, pageId: int): EvmScan = { ...s, pages: s.pages.listMap(p => if (p.id == pageId) { ...p, verified: true } else p) }
pure def canFailPage(s: EvmScan, pageId: int): bool = hasPage(s, pageId)
pure def failPage(s: EvmScan, pageId: int): EvmScan = { ...s, pages: s.pages.select(p => p.id != pageId), failures: s.failures + 1 }
```

### Completion advances the cursor monotonically, even when runs finish out of order

```quint
pure def pageFor(s: EvmScan, pageId: int): Page = s.pages.select(p => p.id == pageId).nthOr(0, { id: 0, start: 0, end: -1, verified: false })
pure def canCompletePage(s: EvmScan, pageId: int): bool = s.pages.some(p => p.id == pageId and p.verified)
pure def completePage(s: EvmScan, pageId: int): EvmScan =
  val page = pageFor(s, pageId)
  { ...s, cursor: if (page.end > s.cursor) page.end else s.cursor, pages: s.pages.select(p => p.id != pageId) }
```

## Story: Coverage advanced before the chain check needs an audit

### Historic coverage is verified only after an audit from the deployment boundary

A cursor advanced before the chain-ID check was released is flagged. It
stays unverified coverage until an audit replays the retained events from
the trusted deployment boundary through that block. The flag never lowers
the cursor.

```quint
pure def canFlagLegacyCoverage(s: EvmScan): bool = s.configured and s.coverage == Trusted and s.cursor >= s.origin
pure def flagLegacyCoverage(s: EvmScan): EvmScan = { ...s, coverage: NeedsAudit, unverifiedThrough: s.cursor }
pure def canRecordAudit(s: EvmScan, auditFrom: int, through: int): bool =
  s.coverage == NeedsAudit and auditFrom == s.origin and through >= s.unverifiedThrough
pure def recordAudit(s: EvmScan, auditFrom: int, through: int): EvmScan = { ...s, coverage: Audited }
pure def verifiedThrough(s: EvmScan): int = if (s.coverage == NeedsAudit) s.origin - 1 else s.cursor
```

### The cursor stays inside the finalized deployment range and never decreases

```quint
pure def alwaysCursorBounded(s: EvmScan): bool = s.configured implies
  s.cursor >= s.origin - 1 and (s.cursor == s.origin - 1 or s.cursor <= s.head)
pure def alwaysPagesInsideHead(s: EvmScan): bool = s.pages.every(p => p.start >= s.origin and p.start <= p.end and p.end <= s.head
  and p.start <= s.cursor + 1 and s.pages.select(o => o.id == p.id).length() == 1)
pure def alwaysUnconfiguredIdle(s: EvmScan): bool = not(s.configured) implies s.pages.length() == 0 and s.cursor == -1
pure def alwaysAuditFlagShape(s: EvmScan): bool = (s.coverage == NeedsAudit implies s.unverifiedThrough >= s.origin)
  and verifiedThrough(s) <= s.cursor
pure def stepCursorMonotone(before: EvmScan, after: EvmScan): bool = after.cursor >= before.cursor and after.head >= before.head
pure def stepCursorOnlyByVerifiedPage(before: EvmScan, via: str, after: EvmScan): bool =
  after.cursor != before.cursor implies (via == "completePage" or via == "configure")
pure def stepConfigurationFixed(before: EvmScan, after: EvmScan): bool = before.configured implies
  after.expectedChain == before.expectedChain and after.pageBlocks == before.pageBlocks and after.origin == before.origin
pure def sometimesOutOfOrder(s: EvmScan): bool = s.cursor > s.origin and s.failures > 0 and s.refusals > 0
pure def sometimesTwoPagesInFlight(s: EvmScan): bool = s.pages.length() >= 2
pure def sometimesAudited(s: EvmScan): bool = s.coverage == Audited
```

### Simulation samples

```quint
pure val chainIdValues = Set(8453)
pure val pageBlocksValues = Set(2)
pure val originValues = Set(10)
pure val rpcChainValues = Set(8453, 1)
pure val heightValues = Set(11, 13, 16)
pure val pageIdValues = Set(1, 2, 3)
pure val auditFromValues = Set(10, 1)
pure val throughValues = Set(11, 16)
```
