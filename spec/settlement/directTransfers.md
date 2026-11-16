# Disclosed direct transfers

Slop AGENTS (`disclosures/`): payouts a project creator signed and broadcast
outside the verified settlement flow are disclosed by reviewed records and
imported on every deploy. They are never escrow obligations and never become
a paid obligation. Source anchors are development migration
`0014_direct_payments.sql` (`payment_direct_transfers`, its conflict and
no-update triggers), `backend/payments/direct-history.ts` and the public
reads `GET /api/v1/payments/direct-transfers` and its actor scope (coverage
routes 101–102). The public received total sums these disclosures with
finalized vault payments; that projection belongs to the frontend.

## Story: Import each disclosed transaction once and never change it

### An identical import is a no-op and a contradicting one fails the whole import

A disclosure is keyed by network and transaction. Its project, month,
contributor, chain, recipient, amount and block facts are immutable.

```quint
type Disclosure = { network: str, transaction: str, project: str, month: int, actor: int, chain: str,
  recipient: str, amountMicro: int, blockTime: int, block: str }
type ImportOutcome = NotRun | Imported | Contradiction
type Disclosures = { rows: List[Disclosure], lastImport: ImportOutcome, imports: int }
pure val initial: Disclosures = { rows: List(), lastImport: NotRun, imports: 0 }
pure def sameKey(a: Disclosure, b: Disclosure): bool = a.network == b.network and a.transaction == b.transaction
pure def validDisclosure(d: Disclosure): bool = d.network != "" and d.transaction != "" and d.project != "" and d.actor > 0
  and (d.chain == "base" or d.chain == "solana") and d.recipient != "" and d.amountMicro > 0 and d.blockTime > 0 and d.block != ""
pure def contradicts(rows: List[Disclosure], d: Disclosure): bool = rows.some(o => sameKey(o, d) and o != d)
pure def canImportBatch(s: Disclosures, batch: List[Disclosure]): bool =
  batch.length() > 0 and batch.every(d => validDisclosure(d))
pure def importBatch(s: Disclosures, batch: List[Disclosure]): Disclosures =
  if (batch.some(d => contradicts(s.rows, d) or contradicts(batch, d))) { ...s, lastImport: Contradiction, imports: s.imports + 1 }
  else { ...s, lastImport: Imported, imports: s.imports + 1,
    rows: batch.foldl(s.rows, (rows, d) => if (rows.includes(d)) rows else rows.append(d)) }
pure def alwaysOneRowPerTransaction(s: Disclosures): bool = s.rows.every(d => validDisclosure(d)
  and s.rows.select(o => sameKey(o, d)).length() == 1)
pure def stepRowsImmutable(before: Disclosures, after: Disclosures): bool = before.rows.every(d => after.rows.includes(d))
pure def sometimesReplayedImport(s: Disclosures): bool = s.lastImport == Imported and s.imports >= 2 and s.rows.length() == 1
pure def sometimesContradictionRefused(s: Disclosures): bool = s.lastImport == Contradiction and s.rows.length() > 0
```

### Simulation samples

```quint
pure val disclosureSample: Disclosure = { network: "base", transaction: "t1", project: "eliza", month: 202609, actor: 7,
  chain: "base", recipient: "w1", amountMicro: 1000000, blockTime: 1, block: "b1" }
pure val batchValues = Set(List(disclosureSample), List({ ...disclosureSample, amountMicro: 2 }),
  List({ ...disclosureSample, transaction: "t2" }), List({ ...disclosureSample, chain: "ethereum" }))
```
