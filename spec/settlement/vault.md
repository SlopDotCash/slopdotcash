# Project vault conservation

PRD sections 2 and 6 govern one asset and one network per vault. This model uses arbitrary-length amounts from the exact-amount library. One reservation slot abstracts one obligation while cumulative amounts retain conservation across all operations. External chain observations must be finalized and authenticated by the future chain adapter. Source models include `escrow_balances`, `vault_creation`, `token_admission`, `vault_setup_resolution` and `monthly_reserve`.

## Story: Deposit and preserve obligations

### A vault begins empty with a fixed asset and refund destination

```quint
import money as M from "./money"
type Vault = { id: str, recipient: str, obligation: int, receipts: List[int], asset: str, refund: str, free: M::Amount, reserved: M::Amount,
  paid: M::Amount, refunded: M::Amount, deposited: M::Amount, reservation: bool }
pure val initial: Vault = { id: "vault", recipient: "", obligation: 0, receipts: List(), asset: "asset", refund: "owner", free: M::zero, reserved: M::zero,
  paid: M::zero, refunded: M::zero, deposited: M::zero, reservation: false }
pure val amountValues = Set(List(0), List(1), List(5), List(999, 999, 999, 999, 999, 999))
pure val recipientValues = Set("contributor", "wrong", "")
pure val vaultValues = Set("vault", "wrong")
pure val assetValues = Set("asset", "wrong")
pure val destinationValues = Set("owner", "wrong")
pure val byValues = Set("owner", "wrong")
```

### Only finalized deposits of the configured asset increase free funds

The deposit adapter must bind the observed transfer to this exact vault and reject replay before dispatch. Transaction identity and persistent deduplication compose with the settlement-evidence machine.

```quint
pure def canDeposit(v: Vault, amount: M::Amount, asset: str, receipt: int, finalized: bool): bool =
  finalized and receipt > 0 and not(v.receipts.includes(receipt)) and asset == v.asset and M::validAmount(amount) and M::positiveAmount(amount)
pure def deposit(v: Vault, amount: M::Amount, asset: str, receipt: int, finalized: bool): Vault =
  { ...v, free: M::addAmounts(v.free, amount), deposited: M::addAmounts(v.deposited, amount), receipts: v.receipts.append(receipt) }
```

### Reservations require the complete amount and never consume another reserve

```quint
pure def canReserve(v: Vault, amount: M::Amount, recipient: str, obligation: int): bool =
  not(v.reservation) and recipient != "" and obligation > v.obligation and M::validAmount(amount) and M::positiveAmount(amount) and M::compareAmounts(v.free, amount) >= 0
pure def reserve(v: Vault, amount: M::Amount, recipient: str, obligation: int): Vault =
  { ...v, free: M::subtractAmounts(v.free, amount), reserved: amount, reservation: true, recipient: recipient, obligation: obligation }
pure def canPayReserved(v: Vault, amount: M::Amount, vault: str, asset: str, recipient: str,
  obligation: int, receipt: int, finalizedHeight: int): bool = v.reservation and M::positiveAmount(v.reserved)
    and M::equalAmounts(amount, v.reserved) and vault == v.id and asset == v.asset
    and recipient == v.recipient and obligation == v.obligation and finalizedHeight > 0
    and receipt > 0 and not(v.receipts.includes(receipt))
pure def payReserved(v: Vault, amount: M::Amount, vault: str, asset: str, recipient: str,
  obligation: int, receipt: int, finalizedHeight: int): Vault =
  { ...v, paid: M::addAmounts(v.paid, v.reserved), reserved: M::zero, reservation: false,
    receipts: v.receipts.append(receipt) }

```

### Only the fixed refund destination receives free funds

The displayed deposit consent identifies the refund destination before signature. Withdrawal fees remain part of the withdrawn gross amount and the split is verified in payment evidence.

```quint
pure def canRefund(v: Vault, amount: M::Amount, destination: str, receipt: int, finalizedHeight: int, by: str): bool =
  by == v.refund and destination == v.refund and receipt > 0 and finalizedHeight > 0
    and not(v.receipts.includes(receipt)) and M::validAmount(amount) and M::positiveAmount(amount)
    and M::compareAmounts(v.free, amount) >= 0
pure def refund(v: Vault, amount: M::Amount, destination: str, receipt: int, finalizedHeight: int, by: str): Vault =
  { ...v, free: M::subtractAmounts(v.free, amount), refunded: M::addAmounts(v.refunded, amount), receipts: v.receipts.append(receipt) }
pure def alwaysConserved(v: Vault): bool = M::equalAmounts(v.deposited,
  M::addAmounts(M::addAmounts(v.free, v.reserved), M::addAmounts(v.paid, v.refunded)))
pure def alwaysValidAmounts(v: Vault): bool = M::validAmount(v.free) and M::validAmount(v.reserved)
  and M::validAmount(v.paid) and M::validAmount(v.refunded) and M::validAmount(v.deposited)
pure def alwaysReservationMatches(v: Vault): bool = v.reservation == M::positiveAmount(v.reserved)
pure def stepIdentityFixed(before: Vault, after: Vault): bool = before.id == after.id and before.asset == after.asset and before.refund == after.refund
pure def sometimesReserved(v: Vault): bool = v.reservation
pure def sometimesPaid(v: Vault): bool = M::positiveAmount(v.paid)
pure def sometimesRefunded(v: Vault): bool = M::positiveAmount(v.refunded)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val finalizedHeightValues = Set(0, 1, 2)
pure val obligationValues = Set(0, 1, 2)
pure val receiptValues = Set(0, 1, 2)
```
