# Slopbot monthly free-review cap

PRD section 5 (operator decision of 16 November 2026) caps free advisory
reviews at 2,000 pull requests or issues per repository per UTC month.
Later reviews of an item already reviewed that month are not limited, and
value assessment is not capped. Source is `workers/slopbot/review-cap.ts`
(`FREE_REVIEWS_PER_REPO_PER_MONTH`, `MONTHLY_REVIEW_CAP_REASON`,
`reviewMonth`, `admitMonthlyReview`), `workers/slopbot/review.ts`
(`runReview`) and `migrations/0129_slopbot_review_month_starts.sql` at
development `df21e37b7`. Development's own model is
`formal/models/slopbot/bot_review_monthly_cap.qnt`.

This library owns the admission decision over the table
`slopbot_review_month_starts`. [Review](./review.md) owns the skipped
outcome of a refused item.

## Story: Keep free advisory review within a monthly item cap

### A review admits its item before any call, and a full month refuses only a new item

The month is the UTC calendar month of the admission, `YYYY-MM`. The item
is the repository, the month, the item kind and its number; one row is
kept per item. After routing allows review and the review claim is held,
and before the deterministic pre-filter, any model call or any GitHub
write, the worker admits the item in one statement: it inserts the row
only while the repository has fewer than 2,000 rows for that month, and
then reads whether the row exists. An item already admitted that month is
admitted again for every later review (a new push, a moved base, a retry)
and adds no row, so parallel reviews never push a repository past the cap.
A new item that meets a full month is refused: the review finishes
skipped with the reason `monthly-review-cap`, with no model call, label,
comment or close, and a later month starts fresh. Value assessment, value
disputes and Points disputes never read or write these rows.

```quint
import routing as R from "./routing"
type MonthItem = { repository: int, month: str, kind: R::ItemKind, number: int }
pure val freeReviewsPerRepositoryPerMonth = 2000
pure val monthlyReviewCapReason = "monthly-review-cap"
pure def admitsReview(alreadyAdmitted: bool, usedThisMonth: int): bool =
  alreadyAdmitted or usedThisMonth < freeReviewsPerRepositoryPerMonth
pure def sameMonth(row: MonthItem, entry: MonthItem): bool =
  row.repository == entry.repository and row.month == entry.month
pure def monthUsed(rows: List[MonthItem], entry: MonthItem): int = rows.select(row => sameMonth(row, entry)).length()
pure def admitsItem(rows: List[MonthItem], entry: MonthItem): bool =
  admitsReview(rows.includes(entry), monthUsed(rows, entry))
pure def admitItem(rows: List[MonthItem], entry: MonthItem): List[MonthItem] =
  if (not(rows.includes(entry)) and admitsItem(rows, entry)) rows.append(entry) else rows
pure def lawAdmittedItemIsAlwaysReadmitted(rows: List[MonthItem], entry: MonthItem): bool =
  rows.includes(entry) implies (admitsItem(rows, entry) and admitItem(rows, entry) == rows)
pure def lawFullMonthRefusesANewItem(rows: List[MonthItem], entry: MonthItem): bool =
  (not(rows.includes(entry)) and monthUsed(rows, entry) >= freeReviewsPerRepositoryPerMonth)
    implies (not(admitsItem(rows, entry)) and admitItem(rows, entry) == rows)
pure def lawAdmissionNeverPassesTheCap(rows: List[MonthItem], entry: MonthItem): bool =
  monthUsed(rows, entry) <= freeReviewsPerRepositoryPerMonth
    implies monthUsed(admitItem(rows, entry), entry) <= freeReviewsPerRepositoryPerMonth
pure def lawOtherRepositoriesAndMonthsAreUnaffected(rows: List[MonthItem], entry: MonthItem, other: MonthItem): bool =
  not(sameMonth(other, entry)) implies monthUsed(admitItem(rows, entry), other) == monthUsed(rows, other)
pure def lawRefusalNeedsAFullMonth(alreadyAdmitted: bool, usedThisMonth: int): bool =
  not(admitsReview(alreadyAdmitted, usedThisMonth))
    implies (not(alreadyAdmitted) and usedThisMonth >= freeReviewsPerRepositoryPerMonth)
pure val firstItem: MonthItem = { repository: 1, month: "2026-11", kind: R::PullItem, number: 1 }
pure val entryValues = Set(firstItem, { ...firstItem, number: 2 }, { ...firstItem, kind: R::IssueItem })
pure val otherValues = Set({ ...firstItem, number: 3 }, { ...firstItem, month: "2026-12" }, { ...firstItem, repository: 2 })
pure val rowsValues = Set(List(), List(firstItem), List(firstItem, { ...firstItem, month: "2026-12" }),
  List({ ...firstItem, number: 2 }, { ...firstItem, repository: 2 }))
pure val usedThisMonthValues = Set(0, 1999, 2000, 2001)
```
