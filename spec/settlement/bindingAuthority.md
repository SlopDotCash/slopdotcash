# Destination bindings, owner cancellation and identity-authority rotation

PRD sections 3, 6 and 11 and the owner decisions in Slop AGENTS govern who
may bind a payout destination and how the project owner can stop one. This
unit is the finalized projection of the binding state of one project escrow
and of its factory's identity authority. A binding needs the current identity
authority's transaction and the destination wallet's own signature over the
same actor, destination, expected version, claim digest and expiry. The
latest binding activates immediately; an earlier version never pays.

Source anchors are development `contracts/evm/src/ProjectEscrow.sol`
(`bindDestination`, `cancelBinding`, `payableBinding`, `pay`,
`MAX_CANCELS_BETWEEN_PAYMENTS`) and `ProjectEscrowFactory`
(`proposeIdentityAuthority`, `cancelIdentityAuthorityRotation`,
`executeIdentityAuthorityRotation`, `AUTHORITY_ROTATION_DELAY = 0`), and the
Solana handlers `bind_wallet`, `veto_binding`, `propose_authority_rotation`,
`confirm_authority_rotation`, `cancel_authority_rotation` and
`execute_authority_rotation`. Legacy models `binding_veto_policy`,
`authority_rotation` and `inactive_attester` map here. The chain adapter
reports the recovered signer of the wallet signature and the finalized block
time; [escrow accounting](./escrow.md) owns the award amounts.

Accepted risk (owner decision, Slop AGENTS escrow attester bullet, #1086 and
#1100): with a zero binding delay the owner's cancellation windows are empty,
so a stolen attester key with a wallet it controls can bind and be paid any
matured unpaid award before the owner can cancel. Protection rests on custody
of the attester key. A registrar rotation replaces the key and the attester
cannot block it.

## Story: Bind a destination with both the authority and the wallet

### A deployment fixes its chain, owner, registrar, binding delay and rotation delay

The EVM rotation delay is zero and EVM rotation needs no confirmation. A
Solana rotation needs the independent rotation authority's confirmation and
may carry a delay. The binding delay is between zero and 30 days; the owner
decision for Slop deployments is zero.

```quint
type Chain = EvmChain | SolanaChain
type Binding = { actor: int, destination: str, version: int, claimDigest: str, activatesAt: int, cancelled: bool }
type ActorBinding = { actor: int, current: Binding, paidVersion: int, cancelCount: int, lastCommittedAt: int }
type Authority = { current: str, pending: str, effectiveAt: int, confirmed: bool }
type BindRequest = { actor: int, destination: str, expectedVersion: int, claimDigest: str, expiresAt: int, walletSigner: str }
type Bindings = { deployed: bool, chain: Chain, owner: str, registrar: str, rotationAuthority: str,
  bindingDelay: int, rotationDelay: int, clock: int, authority: Authority,
  actors: List[ActorBinding], history: List[Binding], payments: int }
pure val noBinding: Binding = { actor: 0, destination: "", version: 0, claimDigest: "", activatesAt: 0, cancelled: false }
pure val noActor: ActorBinding = { actor: 0, current: noBinding, paidVersion: 0, cancelCount: 0, lastCommittedAt: 0 }
pure val initial: Bindings = { deployed: false, chain: EvmChain, owner: "owner", registrar: "registrar",
  rotationAuthority: "rotation", bindingDelay: 0, rotationDelay: 0, clock: 1796342400,
  authority: { current: "attester", pending: "", effectiveAt: 0, confirmed: false },
  actors: List(), history: List(), payments: 0 }
pure val maxCancelsBetweenPayments = 3
pure val maxBindingDelay = 2592000
pure val ownerDecisionBindingDelay = 0
pure def canDeploy(b: Bindings, chain: Chain, delay: int, rotation: int): bool =
  not(b.deployed) and delay >= 0 and delay <= maxBindingDelay and rotation >= 0 and (chain == SolanaChain or rotation == 0)
pure def deploy(b: Bindings, chain: Chain, delay: int, rotation: int): Bindings =
  { ...b, deployed: true, chain: chain, bindingDelay: delay, rotationDelay: rotation }
pure def canObserveTime(b: Bindings, now: int): bool = b.deployed and now > b.clock
pure def observeTime(b: Bindings, now: int): Bindings = { ...b, clock: now }
pure def actorState(b: Bindings, actor: int): ActorBinding = b.actors.select(a => a.actor == actor).nthOr(0, { ...noActor, actor: actor })
pure def withActor(ab: ActorBinding, b: Bindings): Bindings =
  if (b.actors.some(a => a.actor == ab.actor)) { ...b, actors: b.actors.listMap(a => if (a.actor == ab.actor) ab else a) }
  else { ...b, actors: b.actors.append(ab) }
```

### Only the current authority binds, for the current version and before expiry, with the wallet's own signature

The expected version prevents a stale or reordered wallet update. Expiry
limits submission of both signatures, not the claim's lifetime. A rotated-out
authority cannot bind, so an old signed binding transaction reverts.

```quint
pure def canBind(b: Bindings, request: BindRequest, by: str): bool =
  val ab = actorState(b, request.actor)
  b.deployed and by == b.authority.current and request.actor > 0 and request.destination != ""
    and request.claimDigest != "" and request.expiresAt >= b.clock and request.walletSigner == request.destination
    and ab.current.version == request.expectedVersion
pure def bind(b: Bindings, request: BindRequest, by: str): Bindings =
  val ab = actorState(b, request.actor)
  val bound = { actor: request.actor, destination: request.destination, version: request.expectedVersion + 1,
    claimDigest: request.claimDigest, activatesAt: b.clock, cancelled: false }
  { ...withActor({ ...ab, current: bound }, b), history: b.history.append(bound) }
```

## Story: Let the owner cancel an unpaid binding inside its window

### An award commitment opens the commit window

The escrow reports each committed award for an actor. The commit window lasts
the binding delay after the latest commitment.

```quint
pure def canRecordCommit(b: Bindings, actor: int): bool = b.deployed and actor > 0
pure def recordCommit(b: Bindings, actor: int): Bindings = withActor({ ...actorState(b, actor), lastCommittedAt: b.clock }, b)
```

### The owner cancels the latest unpaid binding at most three times between payments

Cancellation needs the binding's review window or the actor's commit window.
Without a pending rotation the owner has three cancellations between
payments; an EVM pending rotation, or a confirmed Solana rotation, waives the
count. A paid version cannot be cancelled, and a new co-signed version is
needed after a cancellation. Payment and cancellation race on chain; the
first mined wins.

```quint
pure def rotationWaiver(b: Bindings): bool = b.authority.pending != "" and (b.chain == EvmChain or b.authority.confirmed)
pure def cancelWindowOpen(b: Bindings, ab: ActorBinding): bool =
  b.clock < ab.current.activatesAt + b.bindingDelay
    or (ab.lastCommittedAt > 0 and b.clock < ab.lastCommittedAt + b.bindingDelay)
pure def canCancel(b: Bindings, actor: int, expectedVersion: int, by: str): bool =
  val ab = actorState(b, actor)
  b.deployed and by == b.owner and ab.current.version > 0 and ab.current.version == expectedVersion
    and not(ab.current.cancelled) and ab.current.version != ab.paidVersion
    and cancelWindowOpen(b, ab) and (rotationWaiver(b) or ab.cancelCount < maxCancelsBetweenPayments)
pure def cancel(b: Bindings, actor: int, expectedVersion: int, by: str): Bindings =
  val ab = actorState(b, actor)
  val cancelled = { ...ab.current, cancelled: true }
  { ...withActor({ ...ab, current: cancelled,
      cancelCount: if (rotationWaiver(b)) ab.cancelCount else ab.cancelCount + 1 }, b),
    history: b.history.listMap(h => if (h.actor == actor and h.version == expectedVersion) cancelled else h) }
```

### A payment uses only the latest active binding and resets the cancellation budget

Anyone may pay; the contract fixes the destination. The expected version must
equal the payable binding's version. The award's own commit delay is checked
by [escrow accounting](./escrow.md).

```quint
pure def payable(ab: ActorBinding, now: int): bool =
  ab.current.version > 0 and not(ab.current.cancelled) and now >= ab.current.activatesAt
pure def canPay(b: Bindings, actor: int, expectedVersion: int): bool =
  val ab = actorState(b, actor)
  b.deployed and payable(ab, b.clock) and expectedVersion == ab.current.version
pure def pay(b: Bindings, actor: int, expectedVersion: int): Bindings =
  val ab = actorState(b, actor)
  { ...withActor({ ...ab, paidVersion: ab.current.version, cancelCount: 0 }, b), payments: b.payments + 1 }
```

## Story: Rotate the identity authority without the attester's cooperation

### The registrar proposes and may cancel one rotation at a time

The proposed key differs from the current authority, the owner, the
registrar and the rotation authority.

```quint
pure def canProposeRotation(b: Bindings, nextAuthority: str, by: str): bool =
  b.deployed and by == b.registrar and b.authority.pending == "" and nextAuthority != ""
    and nextAuthority != b.authority.current and nextAuthority != b.registrar and nextAuthority != b.owner
    and nextAuthority != b.rotationAuthority
pure def proposeRotation(b: Bindings, nextAuthority: str, by: str): Bindings =
  { ...b, authority: { ...b.authority, pending: nextAuthority, effectiveAt: b.clock + b.rotationDelay, confirmed: false } }
pure def canCancelRotation(b: Bindings, by: str): bool = b.deployed and by == b.registrar and b.authority.pending != ""
pure def cancelRotation(b: Bindings, by: str): Bindings =
  { ...b, authority: { ...b.authority, pending: "", effectiveAt: 0, confirmed: false } }
```

### Solana needs the rotation authority's confirmation; anyone executes after the delay

The current attester has no transition that blocks, confirms or cancels a
rotation. Existing bindings stay valid after rotation; only who may bind next
changes.

```quint
pure def canConfirmRotation(b: Bindings, by: str): bool =
  b.deployed and b.chain == SolanaChain and by == b.rotationAuthority and b.authority.pending != "" and not(b.authority.confirmed)
pure def confirmRotation(b: Bindings, by: str): Bindings = { ...b, authority: { ...b.authority, confirmed: true } }
pure def canExecuteRotation(b: Bindings): bool =
  b.deployed and b.authority.pending != "" and b.clock >= b.authority.effectiveAt and (b.chain == EvmChain or b.authority.confirmed)
pure def executeRotation(b: Bindings): Bindings =
  { ...b, authority: { current: b.authority.pending, pending: "", effectiveAt: 0, confirmed: false } }
```

## Story: State the guarantees and the accepted risk

### Versions only grow, history is retained and the cancellation budget is bounded

```quint
pure def alwaysActorsUnique(b: Bindings): bool = b.actors.every(a => a.actor > 0 and b.actors.select(o => o.actor == a.actor).length() == 1)
pure def alwaysCancelBudget(b: Bindings): bool = b.actors.every(a => a.cancelCount >= 0 and a.cancelCount <= maxCancelsBetweenPayments)
pure def alwaysPaidVersionKnown(b: Bindings): bool = b.actors.every(a => a.paidVersion >= 0 and a.paidVersion <= a.current.version
  and not(a.current.cancelled and a.paidVersion == a.current.version))
pure def alwaysTimesInPast(b: Bindings): bool = b.actors.every(a => a.current.activatesAt <= b.clock and a.lastCommittedAt <= b.clock)
pure def alwaysRotationShape(b: Bindings): bool =
  (b.authority.pending == "" implies b.authority.effectiveAt == 0 and not(b.authority.confirmed))
    and (b.authority.confirmed implies b.chain == SolanaChain) and b.authority.current != ""
    and (b.chain == EvmChain implies b.rotationDelay == 0)
pure def alwaysCurrentInHistory(b: Bindings): bool = b.actors.every(a => a.current.version == 0 or b.history.includes(a.current))
pure def stepVersionsGrow(before: Bindings, after: Bindings): bool =
  before.actors.every(a => actorState(after, a.actor).current.version >= a.current.version
    and actorState(after, a.actor).paidVersion >= a.paidVersion)
pure def stepHistoryRetained(before: Bindings, after: Bindings): bool =
  after.history.length() >= before.history.length()
    and before.history.every(h => after.history.some(n => n.actor == h.actor and n.version == h.version
      and n.destination == h.destination and n.claimDigest == h.claimDigest and n.activatesAt == h.activatesAt))
pure def stepOnlyRegistrarOrAnyoneRotates(before: Bindings, via: str, after: Bindings): bool =
  after.authority.current != before.authority.current implies via == "executeRotation"
pure def stepDeploymentFixed(before: Bindings, after: Bindings): bool =
  before.deployed implies after.deployed and after.chain == before.chain and after.bindingDelay == before.bindingDelay
    and after.rotationDelay == before.rotationDelay and after.owner == before.owner and after.registrar == before.registrar
```

### With the owner-decision zero delay no cancellation window is ever open

This is the accepted risk stated above, checked in every reachable state.

```quint
pure def alwaysZeroDelayLeavesNoVeto(b: Bindings): bool =
  b.bindingDelay == 0 implies b.actors.every(a => not(cancelWindowOpen(b, a)))
pure def sometimesCancelledWithDelay(b: Bindings): bool = b.bindingDelay > 0 and b.history.some(h => h.cancelled)
pure def sometimesBudgetExhausted(b: Bindings): bool = b.actors.some(a => a.cancelCount == maxCancelsBetweenPayments)
pure def sometimesWaivedCancellation(b: Bindings): bool = rotationWaiver(b) and b.actors.some(a => a.current.cancelled)
pure def sometimesSolanaRotated(b: Bindings): bool = b.chain == SolanaChain and b.authority.current != "attester"
pure def sometimesRotatedAuthorityBinds(b: Bindings): bool = b.authority.current != "attester" and b.history.length() > 0
  and b.history.some(h => h.version >= 2)
pure def sometimesPaidAfterRebind(b: Bindings): bool = b.actors.some(a => a.paidVersion >= 2)
pure def sometimesZeroDelayPaid(b: Bindings): bool = b.deployed and b.bindingDelay == 0 and b.payments > 0
```

### Simulation samples

These input sets bound simulation only.

```quint
pure val byValues = Set("attester", "next", "owner", "registrar", "rotation", "anyone")
pure val chainValues = Set(EvmChain, SolanaChain)
pure val delayValues = Set(0, 3600)
pure val rotationValues = Set(0, 60)
pure val nowValues = Set(1796342460, 1796346000, 1796349700)
pure val actorValues = Set(1, 2)
pure val expectedVersionValues = Set(0, 1, 2, 3)
pure val nextAuthorityValues = Set("next", "attester", "owner")
pure val requestValues = Set(
  { actor: 1, destination: "w1", expectedVersion: 0, claimDigest: "c1", expiresAt: 1799999999, walletSigner: "w1" },
  { actor: 1, destination: "w2", expectedVersion: 1, claimDigest: "c2", expiresAt: 1799999999, walletSigner: "w2" },
  { actor: 1, destination: "w3", expectedVersion: 2, claimDigest: "c3", expiresAt: 1799999999, walletSigner: "w3" },
  { actor: 1, destination: "w4", expectedVersion: 3, claimDigest: "c4", expiresAt: 1799999999, walletSigner: "w4" },
  { actor: 2, destination: "w5", expectedVersion: 0, claimDigest: "c5", expiresAt: 1799999999, walletSigner: "w5" },
  { actor: 1, destination: "w2", expectedVersion: 1, claimDigest: "c2", expiresAt: 1799999999, walletSigner: "other" },
  { actor: 1, destination: "w2", expectedVersion: 1, claimDigest: "c2", expiresAt: 1, walletSigner: "w2" })
pure val weight_bind = 10
pure val weight_cancel = 10
pure val weight_recordCommit = 4
pure val weight_pay = 4
```
