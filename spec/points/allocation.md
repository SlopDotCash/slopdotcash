# Implementation Points allocation

This library formalizes PRD section 7's 13 November 2026 line-weight decision.
Recipients are immutable actor IDs associated with unique accepted non-merge
commits. The source adapter must exclude synchronization merges and already
credited work, verify retained copies, and obtain complete line evidence.
The returned allocation contains whole Points. Ties use increasing actor ID.

## Story: Divide one work unit's fixed value between its implementation authors

Changing recipients never increases the work unit's value. Complete zero-line
changes use equal weights. Missing line evidence holds a multiple-recipient
allocation. A sole verified author receives the entire score.

### Eligible recipients have unique positive actor IDs and complete nonnegative line evidence

```quint
type Recipient = { actor: int, lines: int }
type PointShare = { actor: int, points: int }
pure def validRecipients(recipients: List[Recipient]): bool =
  recipients.length() > 0 and recipients.every(r => r.actor > 0 and r.lines >= 0 and
    recipients.select(other => other.actor == r.actor).length() == 1)
pure def eligibleAllocation(total: int, recipients: List[Recipient], completeLines: bool, frozen: bool): bool =
  total >= 10 and validRecipients(recipients) and not(frozen) and
  (recipients.length() == 1 or completeLines)
pure def lineTotal(recipients: List[Recipient]): int = recipients.foldl(0, (acc, r) => acc + r.lines)
pure def allocationWeight(r: Recipient, recipients: List[Recipient]): int =
  if (lineTotal(recipients) == 0) 1 else r.lines
pure def weightTotal(recipients: List[Recipient]): int =
  if (lineTotal(recipients) == 0) recipients.length() else lineTotal(recipients)
```

### Largest remainder preserves the fixed pool and resolves equal remainders by actor ID

Only the remaining whole Points follow remainder order. A zero-line recipient
receives no Points when another recipient has positive lines.

```quint
pure def floorShare(total: int, r: Recipient, recipients: List[Recipient]): int = {
  val denominator = weightTotal(recipients)
  if (denominator > 0) total * allocationWeight(r, recipients) / denominator else 0
}
pure def pointRemainder(total: int, r: Recipient, recipients: List[Recipient]): int = {
  val denominator = weightTotal(recipients)
  if (denominator > 0) total * allocationWeight(r, recipients) % denominator else 0
}
pure def floorTotal(total: int, recipients: List[Recipient]): int =
  recipients.foldl(0, (acc, r) => acc + floorShare(total, r, recipients))
pure def remainderRank(total: int, r: Recipient, recipients: List[Recipient]): int =
  recipients.select(other => pointRemainder(total, other, recipients) > pointRemainder(total, r, recipients) or
    (pointRemainder(total, other, recipients) == pointRemainder(total, r, recipients) and other.actor < r.actor)).length()
pure def allocatePoints(total: int, recipients: List[Recipient]): List[PointShare] =
  recipients.listMap(r => { actor: r.actor, points: floorShare(total, r, recipients) +
    (if (remainderRank(total, r, recipients) < total - floorTotal(total, recipients)) 1 else 0) })
pure def pointTotal(shares: List[PointShare]): int = shares.foldl(0, (acc, share) => acc + share.points)
pure def lawSingleRecipient(total: int, actor: int, lines: int): bool =
  (total >= 0 and actor > 0 and lines >= 0) implies
  allocatePoints(total, List({ actor: actor, lines: lines })) == List({ actor: actor, points: total })
pure def lawEqualTwo(total: int): bool = total >= 0 implies
  allocatePoints(total, List({ actor: 1, lines: 0 }, { actor: 2, lines: 0 })) ==
  List({ actor: 1, points: total / 2 + total % 2 }, { actor: 2, points: total / 2 })
pure def lawTenPointSplit(total: int): bool = total == 10 implies
  allocatePoints(total, List({ actor: 1, lines: 1 }, { actor: 2, lines: 3 })) ==
  List({ actor: 1, points: 3 }, { actor: 2, points: 7 })
```

### Source eligibility and fixed financial history are checked before any allocation is written

The writer verifies conservation at its input boundary. This protects the
journal even while general largest-remainder proof obligations are reviewed.
This check does not substitute for proving the allocation function.

```quint
pure def canWriteAllocation(total: int, recipients: List[Recipient], completeLines: bool, frozen: bool): bool =
  eligibleAllocation(total, recipients, completeLines, frozen) and
  pointTotal(allocatePoints(total, recipients)) == total
pure def sizePoints(band: int): int =
  if (band <= 0) 10 else if (band == 1) 30 else if (band == 2) 90 else
  if (band == 3) 240 else if (band == 4) 450 else 750
pure def lawAcceptedMinimum(band: int): bool = sizePoints(band) >= 10
pure val totalValues = Set(0, 10, 30, 90)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val bandValues = Set(0, 1, 2)
pure val linesValues = Set(0, 1, 2)
```
