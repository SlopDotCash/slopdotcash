# Buyback sends and arrivals bound to the fee journals

The [bridge legs](./buyback.md) and the [purchase pool](./buybackPool.md)
each leave a binding to the [conversion journal](./conversion.md) and to
each other as a composition obligation. This library states those bindings
so the shell checks them before it forms an event. Buyback income is bound
to its owning records by the [received-fee flow composition](./composition.md).
The pinned implementation is `workers/fee-converter/{buyback,buyback-store}.ts`
and migration `0121_fee_buyback.sql`: every bridge approval, bridge order,
purchase and burn is a row of `fee_conversions` (kinds `approval`, `bridge`,
`buyback`, `burn`) written before broadcast under the network lease, and an
arrival is a `fee_bridge_outcomes` row bound to its bridge row by trigger.

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
pure val liveRuntime: R::Runtime = R::verifyReadiness(R::verifyReadiness(R::publish(R::setReleaseVariable(R::initial, true, R::Owner),
  R::liveAll, R::ReleaseWorkflow), R::Base, R::Owner), R::Robinhood, R::Owner)
pure val baseJournal: C::Fee = { ...C::initial, runtime: liveRuntime, lease: { holder: 1, expiresAt: 840000 }, nextRun: 2,
  holdings: List({ ...C::noHolding, token: 1, asset: C::TargetStable, feeIncome: 1000000000, claimed: 1000000000,
    vaultObserved: 1000000000, balance: 1000000000 }, { ...C::noHolding, token: 2, asset: C::NativeAsset }),
  rows: List({ ...C::noRow, id: 1, token: 1, kind: C::Claim, live: true, state: C::Finalized, runId: 1, wallet: 1,
    amountIn: 1000000000, nonce: 0, attempts: List({ tx: 12, maxFee: 50, priority: 2, at: 0 }) },
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
```

## Story: Credit the pool only from the owning leg

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
pure val arrivedLeg: B::Buyback = { ...B::initial, orders: List(1),
  outcomes: List({ order: 1, amount: 500000000, takeAmount: 495000000, result: B::OrderArrived, height: 2 }) }
pure val legValues = Set(B::initial).union(Set(arrivedLeg)).union(Set({ ...arrivedLeg, source: R::Solana }))
pure val arrivalValues = Set({ network: R::Base, order: 1, takeAmount: 495000000, height: 2 },
  { network: R::Base, order: 1, takeAmount: 500000000, height: 2 }, { network: R::Solana, order: 1, takeAmount: 495000000, height: 2 })
pure val poolValues = Set(P::initial).union(Set({ ...P::initial, credit: 495000000,
  arrivals: List({ network: R::Base, order: 1, takeAmount: 495000000, height: 2 }) }))
```
