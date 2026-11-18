# Independent private-report detail references

PRD sections 8 and 12 require private reads and accessible report views. The
legacy `ui_private_report_identity` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` binds each simultaneously
open card and summary to its immutable submission ID. Browser heading text,
DOM linkage and focus need separate shell conformance. Case data and role
authority remain with the private case service. This component holds only
which authorized details are mounted in the active browser lifetime.

## Story: Open two authorized details and close either independently

### Private report IDs scope both heading references

The shell prefixes these numeric references with the report element family.
Each is an immutable private report ID (a submission ID for a receipt, a case
ID for a case detail opened by `?case=`; development `src/SecurityBounty.tsx`
and `tests/e2e/inbox-report-reference.spec.ts` at `67fd54fd4`), which the
shell maps to a positive safe integer. One card and one
summary use distinct families, so their ID segments can be used without
arithmetic on a potentially large identifier.

```quint
type HeadingKind = CardHeading | SummaryHeading
type HeadingRef = { submission: int, kind: HeadingKind }
type DetailSet = { opened: Set[int] }
pure val emptyDetails: DetailSet = { opened: Set() }
pure def cardHeading(submission: int): HeadingRef = { submission: submission, kind: CardHeading }
pure def summaryHeading(submission: int): HeadingRef = { submission: submission, kind: SummaryHeading }
pure def lawHeadingReferencesDistinct(a: int, b: int): bool = cardHeading(a) != summaryHeading(b)
  and (a != b implies cardHeading(a) != cardHeading(b) and summaryHeading(a) != summaryHeading(b))
```

### An individual mount or close changes only its own submission

```quint
pure def canOpenDetail(d: DetailSet, submission: int): bool = submission > 0 and not(d.opened.contains(submission))
pure def openDetail(d: DetailSet, submission: int): DetailSet = { opened: d.opened.union(Set(submission)) }
pure def canCloseDetail(d: DetailSet, submission: int): bool = d.opened.contains(submission)
pure def closeDetail(d: DetailSet, submission: int): DetailSet = { opened: d.opened.exclude(Set(submission)) }
pure def lawCloseKeepsSibling(opened: Set[int], closing: int, sibling: int): bool =
  (closing != sibling and opened.contains(sibling)) implies closeDetail({ opened: opened }, closing).opened.contains(sibling)
```
