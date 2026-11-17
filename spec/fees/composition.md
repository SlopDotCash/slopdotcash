# Buyback sends, arrivals and income across the fee machines

The [bridge legs](./buyback.md), the [purchase pool](./buybackPool.md) and
the [conversion journal](./conversion.md) each leave a binding to the others
as a composition obligation. This library states those bindings so the shell
checks them before it forms an event. The pinned implementation is
`workers/fee-converter/{buyback,buyback-store}.ts` and migration
`0121_fee_buyback.sql`: every bridge approval, bridge order, purchase and
burn is a row of `fee_conversions` (kinds `approval`, `bridge`, `buyback`,
`burn`) written before broadcast under the network lease, and an arrival is
a `fee_bridge_outcomes` row bound to its bridge row by trigger. Direct-award
income comes from the [direct award recognition](./directBountyIncome.md).

## Story: Bind every buyback send to its network's fee journal

### Every buyback send is a row of its network's fee journal and shares its lease, nonce floor and native reservation

A bridge approval and a bridge order run on a source network (an approval
only on an EVM network); a purchase and a burn run on Robinhood Chain. Each
send is admitted only while the run holds that network's journal lease, the
journal has no native overrun, the buyback signs on the network, and its
transaction identifier is new to the journal. An EVM send takes a nonce at or
above the journal's nonce floor, and a Solana send takes the next number of
the journal's sequence, so a buyback send and a conversion never share a
nonce. Its worst-case native fee is reserved in the journal's
`fee_native_gas` within the per-transaction ceiling and the day's liability
ceiling, in the same batch that writes its row, before the bytes are
broadcast. A buyback send is then reconciled, rebroadcast and expired like
any other row of the journal.

```quint
import runtime as R from "./runtime"
import conversion as C from "./conversion"
import buyback as B from "./buyback"
import buybackPool as P from "./buybackPool"
import money as M from "../settlement/money"
type BuybackSendKind = BridgeApprovalSend | BridgeOrderSend | PurchaseSend | BurnSend
type BuybackSend = { network: R::Network, kind: BuybackSendKind, runId: int, tx: int, nonce: int, maximum: int }
pure def sendNetworkFits(buybackSend: BuybackSend): bool =
  if (buybackSend.kind == PurchaseSend or buybackSend.kind == BurnSend) buybackSend.network == R::Robinhood
  else buybackSend.network != R::Robinhood and (buybackSend.kind != BridgeApprovalSend or buybackSend.network != R::Solana)
pure def nonceAdmitted(f: C::Fee, nonce: int): bool =
  if (f.network == R::Solana) nonce == C::solanaSequence(f) else nonce >= C::nonceFloor(f)
pure def reservationAdmitted(f: C::Fee, buybackSend: BuybackSend): bool =
  buybackSend.maximum > 0 and buybackSend.maximum <= R::transactionCeilingOf(f.network)
    and C::liabilityOf(f.gas.append({ ...C::noGas, id: f.gas.length() + 1, nonce: buybackSend.nonce, maximum: buybackSend.maximum,
      state: C::Reserved, settled: false }), C::day(f)) <= R::dailyCeilingOf(f.network)
pure def buybackSendAdmitted(f: C::Fee, buybackSend: BuybackSend): bool =
  f.network == buybackSend.network and sendNetworkFits(buybackSend) and C::leaseHeld(f, buybackSend.runId) and not(f.overrun)
    and R::buybackSigns(f.runtime, f.network) and buybackSend.tx > 0 and not(C::txUsed(f, buybackSend.tx))
    and nonceAdmitted(f, buybackSend.nonce) and reservationAdmitted(f, buybackSend)
pure def lawAdmittedSendSharesTheJournal(f: C::Fee, buybackSend: BuybackSend): bool =
  buybackSendAdmitted(f, buybackSend) implies C::leaseHeld(f, buybackSend.runId) and R::buybackSigns(f.runtime, buybackSend.network)
    and buybackSend.maximum <= R::transactionCeilingOf(buybackSend.network)
    and (buybackSend.network != R::Solana implies buybackSend.nonce >= C::nonceFloor(f))
```

## Story: Credit the pool and the budget only from the owning records

### A pool arrival credit is exactly a retained OrderArrived outcome of the named source leg

The pool credits an arrival only when the bridge leg of the named source
network retains an `OrderArrived` outcome with the same order, take amount
and finalized height. Such an arrival is admitted by the pool exactly when
the pool has not credited that network and order before.

```quint
pure def arrivalFromLeg(leg: B::Buyback, arrival: P::ArrivalCredit): bool =
  arrival.order > 0 and leg.source == arrival.network and leg.outcomes.some(o => o.result == B::OrderArrived
    and o.order == arrival.order and o.takeAmount == arrival.takeAmount and o.height == arrival.height)
pure def lawBoundArrivalCreditedOnce(leg: B::Buyback, arrival: P::ArrivalCredit, pool: P::Pool): bool =
  (B::alwaysOutcomesOfOrders(leg) and B::alwaysRuntimeSound(leg) and arrivalFromLeg(leg, arrival))
    implies (P::canCreditArrival(pool, arrival) iff not(P::arrivalSeen(pool, arrival)))
```

### Buyback income keys are exactly finalized conversion outputs, USDC claims and booked direct-award fees of the owning journals

A `ConversionOutput` key names a live, finalized conversion row of the source
network's fee journal by its identifier, for exactly that row's USDC
output; a fee in another token therefore counts once, as its conversion.
A `UsdcClaim` key names a live, finalized claim row of the journal's USDC
holding, for exactly the amount that row credited: its `FeesClaimed` amount,
recorded as the row's output. A `DirectFee` key names a booked entry of the
direct award recognition, by its position, on the same network and fee
wallet, paid in the leg's income asset (USDC) and positive, for exactly its
amount; a direct-award fee paid in any other asset is never buyback income
(`buyback-store.ts` `feeIncome` counts a direct fee only when the intent's
asset address is the leg's token and its fee is above zero). Approvals,
top-ups and anything else in the wallet are never income. The activation
instant is checked by the leg itself against the record's chain time.

The direct award recognition's booked entries reach this library as
`DirectFeeEntry` rows in the recognition's order, each with its source
network mapped to the fee runtime's network: the settlement network type and
the fee runtime's network type have the same variants, so no one module can
import both, and that projection is a shell obligation.

```quint
type DirectFeeEntry = { caseId: int, network: R::Network, wallet: str, asset: str, amount: M::Amount }
pure val noDirectFee: DirectFeeEntry = { caseId: 0, network: R::Base, wallet: "", asset: "", amount: M::zero }
pure def journalIncome(f: C::Fee, key: B::IncomeKey, incomeAmount: M::Amount): bool =
  val r = f.rows.nthOr(key.id - 1, C::noRow)
  key.id > 0 and f.network == key.network and r.id == key.id and r.live and r.state == C::Finalized and r.wallet == C::wallet(f)
    and ((key.kind == B::ConversionOutput and r.kind == C::Conversion and M::equalAmounts(incomeAmount, M::smallAmount(r.output)))
      or (key.kind == B::UsdcClaim and r.kind == C::Claim and C::holding(f, r.token).asset == C::TargetStable
        and M::equalAmounts(incomeAmount, M::smallAmount(r.output))))
pure def directIncome(directJournal: List[DirectFeeEntry], key: B::IncomeKey, incomeAmount: M::Amount, feeWalletAddress: str,
  incomeAsset: str): bool =
  val e = directJournal.nthOr(key.id - 1, noDirectFee)
  key.id > 0 and key.kind == B::DirectFee and e.caseId > 0 and e.network == key.network
    and e.wallet == feeWalletAddress and e.asset == incomeAsset and M::positiveAmount(e.amount)
    and M::equalAmounts(e.amount, incomeAmount)
pure def incomeKeyBound(f: C::Fee, directJournal: List[DirectFeeEntry], key: B::IncomeKey, incomeAmount: M::Amount,
  feeWalletAddress: str, incomeAsset: str): bool =
  journalIncome(f, key, incomeAmount) or directIncome(directJournal, key, incomeAmount, feeWalletAddress, incomeAsset)
pure def lawIncomeKeyNamesOneOwningRecord(f: C::Fee, directJournal: List[DirectFeeEntry], key: B::IncomeKey, incomeAmount: M::Amount,
  feeWalletAddress: str, incomeAsset: str): bool =
  incomeKeyBound(f, directJournal, key, incomeAmount, feeWalletAddress, incomeAsset) implies key.id > 0 and key.kind != B::RobinhoodFee
    and (key.kind == B::ConversionOutput implies f.rows.nthOr(key.id - 1, C::noRow).kind == C::Conversion)
    and (key.kind == B::UsdcClaim implies f.rows.nthOr(key.id - 1, C::noRow).kind == C::Claim)
```

### Simulation samples cover admitted and refused sends, arrivals and income keys

These sets bound simulation only.

```quint
pure val liveRuntime: R::Runtime = R::verifyReadiness(R::verifyReadiness(R::publish(R::setReleaseVariable(R::initial, true, R::Owner),
  R::liveAll, R::ReleaseWorkflow), R::Base, 1, R::Owner), R::Robinhood, 1, R::Owner)
pure val baseJournal: C::Fee = { ...C::initial, runtime: liveRuntime, lease: { holder: 1, expiresAt: 840000 }, nextRun: 2,
  holdings: List({ ...C::noHolding, token: 1, asset: C::TargetStable, feeIncome: 1000000000, claimed: 1000000000,
    vaultObserved: 1000000000, balance: 1000000000 }, { ...C::noHolding, token: 2, asset: C::NativeAsset }),
  rows: List({ ...C::noRow, id: 1, token: 1, kind: C::Claim, live: true, state: C::Finalized, runId: 1, wallet: 1,
    amountIn: 1000000000, output: 1000000000, nonce: 0, attempts: List({ tx: 12, maxFee: 50, priority: 2, at: 0 }) },
    { ...C::noRow, id: 2, token: 2, kind: C::Conversion, live: true, state: C::Finalized, runId: 1, wallet: 1,
    amountIn: 500000000, output: 450000000, nonce: 1, attempts: List({ tx: 11, maxFee: 50, priority: 2, at: 0 }) }),
  gas: List({ ...C::noGas, id: 1, runId: 1, nonce: 0, maximum: 50000, state: C::Signed, row: 1, tx: 12, settled: true, actual: 40000 },
    { ...C::noGas, id: 2, runId: 1, nonce: 1, maximum: 50000, state: C::Signed, row: 2, tx: 11, settled: true, actual: 40000 }) }
pure val robinhoodJournal: C::Fee = { ...baseJournal, network: R::Robinhood, holdings: List(), rows: List(), gas: List() }
pure val fValues = Set(baseJournal).union(Set(robinhoodJournal)).union(Set({ ...baseJournal, clock: 900000 }))
pure val buybackSendValues = Set(
  { network: R::Base, kind: BridgeOrderSend, runId: 1, tx: 21, nonce: 2, maximum: 50000 },
  { network: R::Base, kind: BridgeApprovalSend, runId: 1, tx: 21, nonce: 1, maximum: 50000 },
  { network: R::Base, kind: PurchaseSend, runId: 1, tx: 24, nonce: 2, maximum: 50000 },
  { network: R::Robinhood, kind: PurchaseSend, runId: 1, tx: 24, nonce: 0, maximum: 100000 },
  { network: R::Robinhood, kind: BurnSend, runId: 1, tx: 25, nonce: 0, maximum: 300000 })
pure val arrivedLeg: B::Buyback = { ...B::initial, orders: List(1),
  outcomes: List({ order: 1, amount: 500000000, takeAmount: 495000000, result: B::OrderArrived, height: 2 }) }
pure val legValues = Set(B::initial).union(Set(arrivedLeg)).union(Set({ ...arrivedLeg, source: R::Solana }))
pure val arrivalValues = Set({ network: R::Base, order: 1, takeAmount: 495000000, height: 2 },
  { network: R::Base, order: 1, takeAmount: 500000000, height: 2 }, { network: R::Solana, order: 1, takeAmount: 495000000, height: 2 })
pure val poolValues = Set(P::initial).union(Set({ ...P::initial, credit: 495000000,
  arrivals: List({ network: R::Base, order: 1, takeAmount: 495000000, height: 2 }) }))
pure val bookedJournal: List[DirectFeeEntry] = List({ caseId: 1, network: R::Base, wallet: "fees", asset: "usdc", amount: List(0, 0, 5) })
pure val noDirectFees: List[DirectFeeEntry] = List()
pure val directJournalValues = Set(noDirectFees).union(Set(bookedJournal))
pure val keyValues = Set({ kind: B::ConversionOutput, network: R::Base, id: 2 }, { kind: B::UsdcClaim, network: R::Base, id: 1 },
  { kind: B::DirectFee, network: R::Base, id: 1 }, { kind: B::RobinhoodFee, network: R::Robinhood, id: 1 },
  { kind: B::ConversionOutput, network: R::Base, id: 1 })
pure val incomeAmountValues = Set(List(0, 0, 5), List(0, 0, 450), List(0, 0, 0, 1))
pure val feeWalletAddressValues = Set("fees", "other")
pure val incomeAssetValues = Set("usdc", "slop")
```
