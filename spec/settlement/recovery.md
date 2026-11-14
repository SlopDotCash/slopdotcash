# Private-award destination recovery

PRD sections 3, 6, 8 and 10 require a successor request and renewed reporter consent after a wallet change. Source models include `direct_payment_recovery`, `direct_recovery_completion`, `direct_solana_retirement`, `payment_unsigned_retirement`, `payment_reopen_landing` and `unsafe_destination_history`.

This machine tracks one unfinished leg and one previous signable attempt. Separate instances preserve already-paid legs. Chain cancellation, expiry and finalized failure evidence are explicit retirement outcomes. Database deletion and elapsed wall-clock time do not retire a request.

## Story: Change a destination without paying twice

### A request keeps its original destination until renewed consent and retirement

```quint
type RecoveryPhase = Original | ChangeRequested | Consented | Retired | Successor | Paid
 type Retirement = NoEvidence | FinalizedCancellation | ProvenExpiry | FinalizedFailure
 type Recovery = { phase: RecoveryPhase, oldRequest: int, newRequest: int,
  oldWallet: str, newWallet: str, oldConsent: int, newConsent: int,
  retirement: Retirement, evidenceHeight: int, paidLeg: bool, canonicalRequest: int }
pure val initial: Recovery = { phase: Original, oldRequest: 1, newRequest: 0,
  oldWallet: "old", newWallet: "", oldConsent: 1, newConsent: 0,
  retirement: NoEvidence, evidenceHeight: 0, paidLeg: false, canonicalRequest: 0 }
pure val byValues = Set("reporter", "wrong")
pure val walletValues = Set("new", "old", "")
```

### The reporter requests a successor and renews exact destination consent

```quint
pure def canRequestChange(r: Recovery, wallet: str, by: str): bool = r.phase == Original
  and not(r.paidLeg) and wallet != "" and wallet != r.oldWallet and by == "reporter"
pure def requestChange(r: Recovery, wallet: str, by: str): Recovery =
  { ...r, phase: ChangeRequested, newWallet: wallet }
pure def canConsent(r: Recovery, wallet: str, consentRevision: int, by: str): bool = r.phase == ChangeRequested
  and wallet == r.newWallet and consentRevision > r.oldConsent and by == "reporter"
pure def consent(r: Recovery, wallet: str, consentRevision: int, by: str): Recovery =
  { ...r, phase: Consented, newConsent: consentRevision }
```

### Every prior signable attempt must be retired before the successor is presented

Discovered by the proof: the retired phase must carry a recorded retirement,
renewed consent and an evidence height before a successor can become available.
A phase marker alone cannot stand in for that evidence.

The external retirement verifier must bind this exact request and every retained attempt. Solana expiry requires independent full-history absence evidence. EVM nonce replacement requires its canonical finalized winner. A missing receipt never supplies either proof.

```quint
pure def canRetire(r: Recovery, request: int, retirement: Retirement, height: int): bool =
  r.phase == Consented and request == r.oldRequest and r.newConsent > r.oldConsent
    and retirement != NoEvidence and height > 0
pure def retire(r: Recovery, request: int, retirement: Retirement, height: int): Recovery =
  { ...r, phase: Retired, retirement: retirement, evidenceHeight: height }
pure def canPresentSuccessor(r: Recovery, request: int): bool = r.phase == Retired
  and request > r.oldRequest and r.newConsent > r.oldConsent and r.evidenceHeight > 0
pure def presentSuccessor(r: Recovery, request: int): Recovery =
  { ...r, phase: Successor, newRequest: request }
```

### A finalized old winner ends recovery without a successor payment

Retirement and old success are mutually exclusive external facts. A paid leg never changes its destination or pays again.

```quint
pure def canOldWins(r: Recovery, request: int, height: int): bool =
  (r.phase == Original or r.phase == ChangeRequested or r.phase == Consented)
    and request == r.oldRequest and height > 0
pure def oldWins(r: Recovery, request: int, height: int): Recovery =
  { ...r, phase: Paid, paidLeg: true, canonicalRequest: request, evidenceHeight: height }
pure def canSuccessorPaid(r: Recovery, request: int, wallet: str, height: int): bool =
  r.phase == Successor and request == r.newRequest and wallet == r.newWallet and height > r.evidenceHeight
pure def successorPaid(r: Recovery, request: int, wallet: str, height: int): Recovery =
  { ...r, phase: Paid, paidLeg: true, canonicalRequest: request, evidenceHeight: height }
pure def alwaysSuccessorRetired(r: Recovery): bool = (r.phase == Retired or r.newRequest > 0) implies
  r.retirement != NoEvidence and r.newConsent > r.oldConsent and r.evidenceHeight > 0
pure def alwaysPaidCanonical(r: Recovery): bool = r.paidLeg implies r.phase == Paid
  and (r.canonicalRequest == r.oldRequest or r.canonicalRequest == r.newRequest)
pure def stepPaidUnchanged(before: Recovery, after: Recovery): bool = before.paidLeg implies after == before
pure def sometimesSuccessor(r: Recovery): bool = r.phase == Successor
pure def sometimesOldWinner(r: Recovery): bool = r.phase == Paid and r.canonicalRequest == r.oldRequest
pure def sometimesSuccessorWinner(r: Recovery): bool = r.phase == Paid and r.canonicalRequest == r.newRequest
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val consentRevisionValues = Set(0, 1, 2)
pure val heightValues = Set(0, 1, 2)
pure val requestValues = Set(0, 1, 2)
```
