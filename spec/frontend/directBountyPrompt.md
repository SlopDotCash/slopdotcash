# Direct bounty wallet prompt ownership

PRD sections 3, 8 and 10 require uncertainty, retry, and exact finalized
payment to remain distinguishable. This browser journal models the EVM
payment and cancellation form in `src/DirectBountyPayment.tsx:30–60,94–144,153–397` at Slop development `cde1f719cda7fc52a0f26dcbbcd524cd2cd7c138`.
It succeeds the local-storage scope of the retained `direct_bounty_journal`.
The durable [award journal](../settlement/directBounty.md) verifies
receipts. A browser hash is only a verification candidate.

One instance represents a validated storage key for an exact case, generation,
actor and purpose in one shared browser context. The shell also checks the
payer, wallet account, network and complete request bytes. It applies the
same per-slot rules for any two overlapping views of the key. Browser tabs
with independent storage are outside this atomicity claim. Older records
with a candidate and no prompt identity remain readable.

## Story: Make wallet outcomes recoverable without repeating an uncertain send

### A wallet prompt starts only after an atomic storage write owns its nonce

The complete prepared transaction bytes identify each slot. The first and
second slots give the full supported standard-award transfer list. A single
prepared cancellation uses only its own slot in a separately scoped key.
Each live view has at most one awaiting wallet call. Before prompting, the
shell verifies the live user and action, expected wallet and chain, exact
available nonce and gas simulation. A synchronous reread rejects a conflicting
entry, even when the view observed an earlier empty slot. A failed marker
write acquires no prompt. IDs are opaque and fresh for this journal, with no
production count cap.

```quint
type Slot = FirstLeg | SecondLeg
type Surface = FirstView | SecondView
type Mode = Pay | Cancel
type Scope = { caseId: int, generation: int, actor: int, purpose: Mode, payer: str, network: str }
type Plan = { nonce: int, bytesId: str }
type Plans = { firstPlan: Plan, secondPlan: Plan }
type Entry = { identity: str, bytesId: str, hash: str, candidate: str }
type Entries = { first: Entry, second: Entry }
type Pending = { slot: Slot, identity: str, bytesId: str }
type Hashes = { firstHash: str, secondHash: str }
type View = { mounted: bool, local: Entries, pending: Pending, warning: bool, checks: Hashes }
type Candidate = { supplied: bool, hash: str }
type Candidates = { firstInput: Candidate, secondInput: Candidate }
type WalletResult = Returned | Declined | Unknown
type Verification = { scope: Scope, hashes: Hashes }
type CheckOutcome = { state: Prompt, out: List[Verification] }
type Prompt = { opened: bool, scope: Scope, plans: Plans, store: Entries, firstView: View, secondView: View, used: List[str] }
pure val noScope: Scope = { caseId: 0, generation: 0, actor: 0, purpose: Pay, payer: "", network: "" }
pure val noPlan: Plan = { nonce: -1, bytesId: "" }
pure val noEntry: Entry = { identity: "", bytesId: "", hash: "", candidate: "" }
pure val noEntries: Entries = { first: noEntry, second: noEntry }
pure val noPending: Pending = { slot: FirstLeg, identity: "", bytesId: "" }
pure val noHashes: Hashes = { firstHash: "", secondHash: "" }
pure val noView: View = { mounted: false, local: noEntries, pending: noPending, warning: false, checks: noHashes }
pure val noCandidate: Candidate = { supplied: false, hash: "" }
pure val initial: Prompt = { opened: false, scope: noScope, plans: { firstPlan: noPlan, secondPlan: noPlan }, store: noEntries,
  firstView: noView, secondView: noView, used: List() }
pure def plan(plans: Plans, slot: Slot): Plan = if (slot == FirstLeg) plans.firstPlan else plans.secondPlan
pure def entry(entries: Entries, slot: Slot): Entry = if (slot == FirstLeg) entries.first else entries.second
pure def view(p: Prompt, surface: Surface): View = if (surface == FirstView) p.firstView else p.secondView
pure def writeEntry(entries: Entries, slot: Slot, updated: Entry): Entries =
  if (slot == FirstLeg) { ...entries, first: updated } else { ...entries, second: updated }
pure def writeView(surface: Surface, p: Prompt, updated: View): Prompt =
  if (surface == FirstView) { ...p, firstView: updated } else { ...p, secondView: updated }
pure def validPlan(plan: Plan): bool = plan.nonce >= 0 and plan.bytesId != ""
pure def validScope(scope: Scope, plans: Plans): bool = scope.caseId > 0 and scope.generation >= 0 and scope.actor > 0
  and scope.payer != "" and scope.network != "" and validPlan(plans.firstPlan)
  and (plans.secondPlan == noPlan or (scope.purpose == Pay and validPlan(plans.secondPlan)
    and plans.secondPlan.nonce != plans.firstPlan.nonce and plans.secondPlan.bytesId != plans.firstPlan.bytesId))
pure def canOpen(p: Prompt, scope: Scope, plans: Plans, captured: bool): bool = not(p.opened) and captured and validScope(scope, plans)
pure def open(p: Prompt, scope: Scope, plans: Plans, captured: bool): Prompt = { ...p, opened: true, scope: scope, plans: plans }
pure def canMount(p: Prompt, surface: Surface, by: int): bool = p.opened and by == p.scope.actor
  and not(view(p, surface).mounted) and view(p, surface).pending == noPending
pure def mount(p: Prompt, surface: Surface, by: int): Prompt =
  writeView(surface, p, { ...noView, mounted: true, local: p.store })
pure def canDepart(p: Prompt, surface: Surface): bool = view(p, surface).mounted
pure def depart(p: Prompt, surface: Surface): Prompt =
  writeView(surface, p, { ...view(p, surface), mounted: false })
pure def blocksSend(plan: Plan, row: Entry): bool = row != noEntry and (row.bytesId != plan.bytesId or row.hash == "")
pure def canReserve(p: Prompt, surface: Surface, slot: Slot, identity: str, walletReady: bool, stored: bool, by: int): bool =
  p.opened and p.scope.actor == by and walletReady and validPlan(plan(p.plans, slot))
    and view(p, surface).mounted and view(p, surface).pending == noPending and identity != "" and not(p.used.includes(identity))
    and not(blocksSend(p.plans.firstPlan, view(p, surface).local.first))
    and not(blocksSend(p.plans.secondPlan, view(p, surface).local.second))
    and entry(view(p, surface).local, slot) == noEntry and entry(p.store, slot) == noEntry
pure def reserve(p: Prompt, surface: Surface, slot: Slot, identity: str, walletReady: bool, stored: bool, by: int): Prompt =
  val digest = plan(p.plans, slot).bytesId
  val marked = writeEntry(p.store, slot, { identity: identity, bytesId: digest, hash: "", candidate: "" })
  val activeView = view(p, surface)
  if (stored) writeView(surface, { ...p, store: marked, used: p.used.append(identity) },
    { ...activeView, local: marked, pending: { slot: slot, identity: identity, bytesId: digest }, warning: false })
  else writeView(surface, p, { ...activeView, warning: true })
```

### A late wallet result updates only the prompt that still owns the stored entry

Compare both the captured request identity and complete transaction bytes after
rereading storage. A valid hash may persist after navigation while the old
view cannot render it. If storage fails, its mounted view remembers the known
hash only under the same identity. A definitive user decline removes only its
own marker when no hash or candidate has been recorded. An uncertain result
keeps the marker and cannot start another signature for that nonce.

```quint
pure def samePrompt(row: Entry, pending: Pending): bool = row.identity == pending.identity and row.bytesId == pending.bytesId
pure def canResolve(p: Prompt, surface: Surface, identity: str, walletResult: WalletResult, hash: str, stored: bool): bool =
  identity != "" and view(p, surface).pending.identity == identity and (walletResult != Returned or hash != "")
pure def resolve(p: Prompt, surface: Surface, identity: str, walletResult: WalletResult, hash: str, stored: bool): Prompt =
  val activeView = view(p, surface)
  val waiting = activeView.pending
  val latest = entry(p.store, waiting.slot)
  val local = entry(activeView.local, waiting.slot)
  val owns = samePrompt(latest, waiting)
  val clear = walletResult == Declined and latest.hash == "" and latest.candidate == ""
  val shouldWrite = owns and stored and (walletResult == Returned or clear)
  val updated = if (walletResult == Returned) { ...latest, hash: hash } else noEntry
  val saved = if (shouldWrite) writeEntry(p.store, waiting.slot, updated) else p.store
  val localKnown = walletResult == Returned and owns and samePrompt(local, waiting)
  val forView = if (not(activeView.mounted)) activeView.local else if (shouldWrite) saved
    else if (localKnown) writeEntry(activeView.local, waiting.slot, { ...local, hash: hash }) else activeView.local
  writeView(surface, { ...p, store: saved }, { ...activeView, pending: noPending, local: forView,
    warning: walletResult == Unknown or (walletResult == Returned and not(shouldWrite)) or (clear and not(stored)) })
```

### Verification candidates merge atomically with current storage

Check rereads all prepared nonce slots before writing candidates or invoking
verification. A hash remembered after a failed write can attach only to the
same saved identity and bytes. Existing stored hashes are retained. A user
candidate may override hash selection only after an exact ownership check.
An explicitly empty hash selects nothing and retains the stored candidate.
A failed write or conflict produces no verification call and retains the
current local recovery information. Candidate hashes are already validated by
the shell. Independent storage observations can model a newer saved entry
or an externally resolved marker being removed. The form has no automatic
remove or resend of an uncertain marker.

```quint
pure def sameEntryOwner(a: Entry, b: Entry): bool = a.identity == b.identity and a.bytesId == b.bytesId
pure def conflicts(latest: Entry, expected: Entry, ready: Plan, candidate: Candidate): bool =
  validPlan(ready) and ((latest != noEntry and latest.bytesId != ready.bytesId)
    or (expected.hash != "" and latest.hash == "" and (expected.identity == "" or not(sameEntryOwner(latest, expected))))
    or (latest != noEntry and candidate.hash != "" and (expected == noEntry or not(sameEntryOwner(latest, expected)))))
pure def recoveredEntry(latest: Entry, expected: Entry, ready: Plan, candidate: Candidate): Entry =
  if (latest == noEntry or not(validPlan(ready))) latest
  else { ...latest, hash: if (latest.hash == "") expected.hash else latest.hash,
    candidate: if (candidate.hash == "") latest.candidate else candidate.hash }
pure def verifiedCandidate(row: Entry, ready: Plan, candidate: Candidate): str =
  if (row == noEntry or not(validPlan(ready)) or row.bytesId != ready.bytesId) ""
  else if (candidate.supplied) candidate.hash else if (row.candidate != "") row.candidate else row.hash
pure def canCheck(p: Prompt, surface: Surface, candidates: Candidates, storageReady: bool, authorized: bool, by: int): bool =
  p.opened and p.scope.actor == by and view(p, surface).mounted and authorized
  and (candidates.firstInput.supplied or candidates.firstInput.hash == "")
  and (candidates.secondInput.supplied or candidates.secondInput.hash == "")
pure def check(p: Prompt, surface: Surface, candidates: Candidates, storageReady: bool, authorized: bool, by: int): CheckOutcome =
  val activeView = view(p, surface)
  val conflict = conflicts(p.store.first, activeView.local.first, p.plans.firstPlan, candidates.firstInput)
    or conflicts(p.store.second, activeView.local.second, p.plans.secondPlan, candidates.secondInput)
  val saved = { first: recoveredEntry(p.store.first, activeView.local.first, p.plans.firstPlan, candidates.firstInput),
    second: recoveredEntry(p.store.second, activeView.local.second, p.plans.secondPlan, candidates.secondInput) }
  val hashes = { firstHash: verifiedCandidate(saved.first, p.plans.firstPlan, candidates.firstInput),
    secondHash: verifiedCandidate(saved.second, p.plans.secondPlan, candidates.secondInput) }
  if (storageReady and not(conflict)) { state: writeView(surface, { ...p, store: saved },
    { ...activeView, local: saved, checks: hashes, warning: hashes == noHashes }),
    out: if (hashes == noHashes) List() else List({ scope: p.scope, hashes: hashes }) }
  else { state: writeView(surface, p, { ...activeView, checks: noHashes, warning: true }), out: List() }
pure def canRestoreLegacy(p: Prompt, slot: Slot, hash: str, authenticated: bool): bool = p.opened
  and validPlan(plan(p.plans, slot)) and entry(p.store, slot) == noEntry and hash != "" and authenticated
pure def restoreLegacy(p: Prompt, slot: Slot, hash: str, authenticated: bool): Prompt =
  { ...p, store: writeEntry(p.store, slot, { ...noEntry, bytesId: plan(p.plans, slot).bytesId, candidate: hash }) }
pure def canObserveHash(p: Prompt, slot: Slot, hash: str, authenticated: bool): bool = p.opened and authenticated
  and hash != "" and entry(p.store, slot) != noEntry and entry(p.store, slot).hash != hash
pure def observeHash(p: Prompt, slot: Slot, hash: str, authenticated: bool): Prompt =
  { ...p, store: writeEntry(p.store, slot, { ...entry(p.store, slot), hash: hash }) }
pure def canObserveEmpty(p: Prompt, slot: Slot, externallyResolved: bool): bool = p.opened and externallyResolved
  and entry(p.store, slot) != noEntry
pure def observeEmpty(p: Prompt, slot: Slot, externallyResolved: bool): Prompt = { ...p, store: writeEntry(p.store, slot, noEntry) }
```

### Storage keeps the other leg and never grants settlement authority

Reserving, completing, declining or observing a single nonce leaves the
other slot byte-identical. Checking may add candidate information to both
slots but cannot transfer ownership. Each occupied record belongs to its
validated transaction bytes and a known prompt identity or a legacy
candidate. Each in-flight prompt remains tied to the original mounted view's
identity through departure and completion. The verification call presents
only candidate hashes; the durable receipt journal still checks finality,
exact amounts, replay and independently authorized case action.

```quint
pure def wellScopedEntry(row: Entry, ready: Plan, known: List[str]): bool = row == noEntry
  or (validPlan(ready) and row.bytesId == ready.bytesId
    and (if (row.identity == "") row.candidate != "" else known.includes(row.identity)))
pure def wellScopedView(activeView: View, plans: Plans, known: List[str]): bool =
  wellScopedEntry(activeView.local.first, plans.firstPlan, known) and wellScopedEntry(activeView.local.second, plans.secondPlan, known)
    and (activeView.pending == noPending or (activeView.pending.identity != "" and known.includes(activeView.pending.identity)
      and validPlan(plan(plans, activeView.pending.slot)) and activeView.pending.bytesId == plan(plans, activeView.pending.slot).bytesId))
pure def alwaysScope(p: Prompt): bool = if (p.opened) validScope(p.scope, p.plans)
  else p.store == noEntries and p.firstView == noView and p.secondView == noView and p.used.length() == 0
pure def alwaysStorageOwned(p: Prompt): bool = wellScopedEntry(p.store.first, p.plans.firstPlan, p.used)
  and wellScopedEntry(p.store.second, p.plans.secondPlan, p.used)
pure def alwaysViewOwned(p: Prompt): bool = wellScopedView(p.firstView, p.plans, p.used) and wellScopedView(p.secondView, p.plans, p.used)
pure def stepScopeFixed(before: Prompt, after: Prompt): bool = before.opened implies
  after.opened and after.scope == before.scope and after.plans == before.plans
pure def stepIdsRemainSpent(before: Prompt, after: Prompt): bool = before.used.every(identity => after.used.includes(identity))
pure def stepNoOtherSlotChanges(before: Prompt, via: str, after: Prompt): bool = via != "check" implies
  before.store.first == after.store.first or before.store.second == after.store.second
pure def stepCheckKeepsOwnership(before: Prompt, via: str, after: Prompt): bool = via == "check" implies
  sameEntryOwner(before.store.first, after.store.first) and sameEntryOwner(before.store.second, after.store.second)
pure def keepsStoredResult(before: Entry, after: Entry): bool = before.hash != "" implies after.hash == before.hash
pure def stepCheckKeepsStoredHashes(before: Prompt, via: str, after: Prompt): bool = via == "check" implies
  keepsStoredResult(before.store.first, after.store.first) and keepsStoredResult(before.store.second, after.store.second)
pure def stepCompletionKeepsReplacement(before: Prompt, via: str, after: Prompt): bool = via == "resolve" implies
  ((not(samePrompt(before.store.first, before.firstView.pending)) or before.firstView.pending.slot != FirstLeg)
    and (not(samePrompt(before.store.first, before.secondView.pending)) or before.secondView.pending.slot != FirstLeg)
    implies after.store.first == before.store.first)
  and ((not(samePrompt(before.store.second, before.firstView.pending)) or before.firstView.pending.slot != SecondLeg)
    and (not(samePrompt(before.store.second, before.secondView.pending)) or before.secondView.pending.slot != SecondLeg)
    implies after.store.second == before.store.second)
pure def stepEffectsOnlyVerify(before: Prompt, via: str, after: Prompt, out: List[Verification]): bool =
  via != "check" implies out.length() == 0
pure def sometimesPending(p: Prompt): bool = p.firstView.pending != noPending or p.secondView.pending != noPending
pure def sometimesKnownInMemory(p: Prompt): bool = p.firstView.local.first.hash != "" and p.store.first.hash == ""
  and sameEntryOwner(p.firstView.local.first, p.store.first)
pure def sometimesBothHashes(p: Prompt): bool = p.store.first.hash != "" and p.store.second.hash != ""
pure def sometimesLegacyCandidate(p: Prompt): bool = p.store.first.identity == "" and p.store.first.candidate != ""
pure def sometimesChecked(p: Prompt): bool = p.firstView.checks != noHashes or p.secondView.checks != noHashes
```

### Simulation covers both slots, two views, and conflicting outcomes

These examples guide simulation only. Prompt identity and journal lifetime are
unbounded in the generated model.

```quint
pure val exampleScope: Scope = { caseId: 1, generation: 0, actor: 1, purpose: Pay, payer: "payer", network: "base" }
pure val examplePlans: Plans = { firstPlan: { nonce: 0, bytesId: "first-bytes" }, secondPlan: { nonce: 1, bytesId: "second-bytes" } }
pure val scopeValues = Set(exampleScope).union(Set({ ...exampleScope, actor: 2 })).union(Set({ ...exampleScope, purpose: Cancel }))
pure val plansValues = Set(examplePlans).union(Set({ ...examplePlans, secondPlan: noPlan }))
pure val byValues = Set(1, 2)
pure val identityValues = Set("", "prompt-1", "prompt-2", "prompt-3", "prompt-4")
pure val hashValues = Set("", "first-hash", "second-hash")
pure val candidatesValues = Set({ firstInput: noCandidate, secondInput: noCandidate },
  { firstInput: { supplied: true, hash: "" }, secondInput: noCandidate },
  { firstInput: { supplied: true, hash: "first-hash" }, secondInput: noCandidate })
pure val weight_open = 8
pure val weight_mount = 9
pure val weight_reserve = 24
pure val weight_resolve = 28
pure val weight_check = 10
```
