# Pagination

Long lists (projects, standings, Inbox, payment history) page through results
the owning read returned. The current page is always one that exists, and the
controls to move are offered only where there is somewhere to go.

## Story: Move through pages without leaving the list

### The page stays within the pages that exist

```quint
type Pages = { page: int, pages: int }
pure val initial: Pages = { page: 1, pages: 1 }
pure val countValues = Set(0, 1, 2, 3)
pure def canResize(p: Pages, count: int): bool = count >= 0
pure def resize(p: Pages, count: int): Pages =
  val pages = if (count < 1) 1 else count
  { page: if (p.page > pages) pages else p.page, pages: pages }
pure def canBack(p: Pages): bool = p.page > 1
pure def back(p: Pages): Pages = { ...p, page: p.page - 1 }
pure def canForward(p: Pages): bool = p.page < p.pages
pure def forward(p: Pages): Pages = { ...p, page: p.page + 1 }
pure def alwaysPageExists(p: Pages): bool = p.pages >= 1 and p.page >= 1 and p.page <= p.pages
pure def stepMovesOnePage(before: Pages, after: Pages): bool =
  after.pages == before.pages implies (after.page - before.page <= 1 and before.page - after.page <= 1)
pure def sometimesLastPage(p: Pages): bool = p.pages > 1 and p.page == p.pages
pure def sometimesMiddlePage(p: Pages): bool = p.page > 1 and p.page < p.pages
```
