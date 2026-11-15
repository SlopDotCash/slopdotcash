# Finalized payouts to unauthorized destinations

PRD sections 3 and 6 and Slop AGENTS require `paid` only with finalized
evidence that reconciles the exact vault, obligation, recipient, principal
and fee. The ledger records `paid` only when the payout destination is one of
the contributor's authorized wallets, current or historical. Any other
destination means the identity authority was misused (the accepted risk of a
stolen attester key), so indexing fails closed for investigation. One
instance is the ledger view of one reserved obligation.

Source anchors are development `backend/payments/ledger.ts`
(`indexPaymentEvent`, the authorized-wallet query over `wallet_claims` and
`payment_wallet_authorizations`), `backend/payments/README.md` ("The ledger
records `paid` only when…") and `workers/payments/scanner.ts`. The finalized
payout comes from the [EVM scanner](./evmScan.md) or the
[Solana scanner](./solanaScan.md); authorized wallet history comes from
backend wallets as typed `WalletAuthorization` rows. The contract has already
moved the funds; [escrow accounting](./escrow.md) records that chain fact
regardless of this ledger decision.

Owner decision gate: no owner decision names who closes an investigation,
whether closing it lets the vault's scanner resume, or whether the
contributor is compensated. Development has no resolution at all: the
scanner stops at the payout. The model refuses every resolution until the
platform owner's decision is recorded, takes both the resolving role and
whether indexing resumes from that decision, and never repays or re-reserves
anything. The decision is one platform-wide record; each instance reads it
as a typed `ResolutionDecision` (a composition obligation). While an
investigation holds, the scanner holds the payout's block
([EVM scanner](./evmScan.md) `holdBlock`), another composition obligation.

## Story: Index a finalized payout only to an authorized wallet

### An obligation starts reserved with immutable terms

```quint
type LedgerPhase = Reserved | Paid | Investigating | MisuseConfirmed
type Terms = { obligation: str, vault: str, network: str, actor: int, gross: int, fee: int }
type WalletAuthorization = { actor: int, network: str, address: str, claim: str }
type PaidEvent = { obligation: str, vault: str, network: str, actor: int, transaction: str, index: int,
  destination: str, gross: int, fee: int, net: int, block: int }
type Resolver = NoResolver | PlatformOwnerResolves | ModeratorResolves | AdministratorResolves
type ResolutionDecision = { resolver: Resolver, resumesIndexing: bool }
type Investigation = { phase: LedgerPhase, terms: Terms, wallets: List[WalletAuthorization], payout: PaidEvent,
  decision: ResolutionDecision, resolvedBy: str, cursorHeld: bool, replays: int }
pure val noEvent: PaidEvent = { obligation: "", vault: "", network: "", actor: 0, transaction: "", index: -1,
  destination: "", gross: 0, fee: 0, net: 0, block: 0 }
pure val initial: Investigation = { phase: Reserved,
  terms: { obligation: "o1", vault: "vault", network: "base", actor: 7, gross: 100, fee: 2 },
  wallets: List(), payout: noEvent, decision: { resolver: NoResolver, resumesIndexing: false }, resolvedBy: "", cursorHeld: false, replays: 0 }
pure def authorized(i: Investigation, address: str): bool =
  i.wallets.some(w => w.actor == i.terms.actor and w.network == i.terms.network and w.address == address)
pure def matchesTerms(i: Investigation, payout: PaidEvent): bool =
  payout.obligation == i.terms.obligation and payout.vault == i.terms.vault and payout.network == i.terms.network
    and payout.actor == i.terms.actor and payout.gross == i.terms.gross and payout.fee == i.terms.fee
    and payout.net == payout.gross - payout.fee and payout.transaction != "" and payout.index >= 0
    and payout.block > 0 and payout.destination != ""
```

### Wallet authorizations are append-only history

A wallet authorization recorded by the wallets owner stays authorized for
historical payouts after a newer wallet replaces it.

```quint
pure def canRecordWallet(i: Investigation, wallet: WalletAuthorization): bool =
  wallet.actor > 0 and wallet.address != "" and wallet.claim != "" and not(i.wallets.some(w => w.claim == wallet.claim))
pure def recordWallet(i: Investigation, wallet: WalletAuthorization): Investigation = { ...i, wallets: i.wallets.append(wallet) }
```

### A matching finalized payout is paid if its destination is authorized, otherwise held for investigation

The scanner cursor stays at an payout it could not index, so later events of
the vault wait. A distinct payout for the same obligation is refused: the
contract pays an obligation once. An exact replay is acknowledged without a
change.

```quint
pure def canIndexEvent(i: Investigation, payout: PaidEvent): bool = i.phase == Reserved and matchesTerms(i, payout)
pure def indexEvent(i: Investigation, payout: PaidEvent): Investigation =
  if (authorized(i, payout.destination)) { ...i, phase: Paid, payout: payout }
  else { ...i, phase: Investigating, payout: payout, cursorHeld: true }
pure def canReplay(i: Investigation, payout: PaidEvent): bool = i.phase != Reserved and payout == i.payout
pure def replay(i: Investigation, payout: PaidEvent): Investigation = { ...i, replays: i.replays + 1 }
```

### A later authorization of the same destination clears the hold as paid

If the wallets owner later records an authorization of the same destination
for this actor and network, re-indexing records `paid` and releases the
hold. As in development, no time bound applies: the authorization may be
recorded after the payout. A new authorization of another address never
clears it.

```quint
pure def canReindex(i: Investigation): bool = i.phase == Investigating and authorized(i, i.payout.destination)
pure def reindex(i: Investigation): Investigation = { ...i, phase: Paid, cursorHeld: false }
```

### Only the role the platform owner's decision names confirms misuse

Confirming misuse records the unauthorized payout as a permanent exception
and never marks the obligation paid. Whether the scanner then resumes is
part of the owner's decision; without it the hold stays. It never repays,
re-reserves or changes the contract.

```quint
pure def canRecordDecision(i: Investigation, decision: ResolutionDecision, by: str): bool =
  i.decision.resolver == NoResolver and decision.resolver != NoResolver and by == "platform-owner"
pure def recordDecision(i: Investigation, decision: ResolutionDecision, by: str): Investigation = { ...i, decision: decision }
pure def resolverRole(resolver: Resolver): str =
  if (resolver == PlatformOwnerResolves) "platform-owner" else if (resolver == ModeratorResolves) "moderator"
  else if (resolver == AdministratorResolves) "administrator" else ""
pure def canConfirmMisuse(i: Investigation, by: str): bool =
  i.phase == Investigating and i.decision.resolver != NoResolver and by == resolverRole(i.decision.resolver)
    and not(authorized(i, i.payout.destination))
pure def confirmMisuse(i: Investigation, by: str): Investigation =
  { ...i, phase: MisuseConfirmed, resolvedBy: by, cursorHeld: not(i.decision.resumesIndexing) }
```

### Paid needs an authorized destination and every outcome keeps the finalized payout

```quint
pure def alwaysPaidAuthorized(i: Investigation): bool = i.phase == Paid implies authorized(i, i.payout.destination) and matchesTerms(i, i.payout)
pure def alwaysHeldUntilResolved(i: Investigation): bool =
  i.cursorHeld == (i.phase == Investigating or (i.phase == MisuseConfirmed and not(i.decision.resumesIndexing)))
pure def alwaysNoResolutionWithoutDecision(i: Investigation): bool = i.phase == MisuseConfirmed implies i.decision.resolver != NoResolver
pure def stepDecisionRecordedOnce(before: Investigation, after: Investigation): bool =
  before.decision.resolver != NoResolver implies after.decision == before.decision
pure def alwaysEventRetained(i: Investigation): bool = i.phase != Reserved implies matchesTerms(i, i.payout)
pure def alwaysMisuseResolvedByRole(i: Investigation): bool = i.phase == MisuseConfirmed implies
  i.resolvedBy != "" and i.resolvedBy == resolverRole(i.decision.resolver)
pure def stepTerminal(before: Investigation, after: Investigation): bool =
  (before.phase == Paid implies after.phase == Paid and after.payout == before.payout)
    and (before.phase == MisuseConfirmed implies after.phase == MisuseConfirmed and after.payout == before.payout)
    and (before.phase != Reserved implies after.payout == before.payout) and after.terms == before.terms
pure def stepWalletsRetained(before: Investigation, after: Investigation): bool = before.wallets.every(w => after.wallets.includes(w))
pure def sometimesInvestigating(i: Investigation): bool = i.phase == Investigating
pure def sometimesClearedLate(i: Investigation): bool = i.phase == Paid and i.payout.destination == "w2" and i.wallets.length() >= 2
pure def sometimesMisuse(i: Investigation): bool = i.phase == MisuseConfirmed
pure def sometimesMisuseStillHeld(i: Investigation): bool = i.phase == MisuseConfirmed and i.cursorHeld
pure def sometimesHistoricalPaid(i: Investigation): bool = i.phase == Paid and i.payout.destination == "w1"
  and i.wallets.some(w => w.address == "w2")
```

### Simulation samples

```quint
pure val walletValues = Set({ actor: 7, network: "base", address: "w1", claim: "c1" },
  { actor: 7, network: "base", address: "w2", claim: "c2" }, { actor: 8, network: "base", address: "w3", claim: "c3" })
pure val samplePayout: PaidEvent = { obligation: "o1", vault: "vault", network: "base", actor: 7, transaction: "t1", index: 0,
  destination: "w1", gross: 100, fee: 2, net: 98, block: 5 }
pure val payoutValues = Set(samplePayout, { ...samplePayout, destination: "w2" }, { ...samplePayout, destination: "w3" },
  { ...samplePayout, net: 100 }, { ...samplePayout, transaction: "t2", destination: "w1" })
pure val decisionValues = Set({ resolver: ModeratorResolves, resumesIndexing: true }, { resolver: PlatformOwnerResolves, resumesIndexing: false })
pure val byValues = Set("platform-owner", "moderator", "anyone")
```
