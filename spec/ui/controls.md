# Controls and fields

PRD section 2 requires keyboard use, visible consent and states a person can
tell apart. A control that is disabled or busy refuses activation by pointer
and by key, and says why it is busy. A field that is invalid says what is
wrong next to it and is announced with the control.

## Story: Act only when an action is available

### A disabled or busy control refuses activation and stays named

```quint
type Control = { disabled: bool, busy: bool, named: bool }
pure def activates(c: Control): bool = not(c.disabled) and not(c.busy)
pure def focusable(c: Control): bool = not(c.disabled)
pure def lawBusyRefusesActivation(c: Control): bool = c.busy implies not(activates(c))
pure def lawDisabledRefusesActivation(c: Control): bool = c.disabled implies not(activates(c)) and not(focusable(c))
pure def lawBusyStaysFocusable(c: Control): bool = c.busy and not(c.disabled) implies focusable(c)
pure val cValues = Set({ disabled: false, busy: false, named: true }, { disabled: true, busy: false, named: true },
  { disabled: false, busy: true, named: true }, { disabled: true, busy: true, named: true })
```

## Story: Correct a field where it is

### An invalid field is described by its error, then its hint

```quint
type Field = { invalid: bool, hasError: bool, hasHint: bool }
type Description = ErrorText | HintText
pure def describedBy(f: Field): List[Description] =
  (if (f.invalid and f.hasError) List(ErrorText) else List()).concat(if (f.hasHint) List(HintText) else List())
pure def lawInvalidFieldNamesItsError(f: Field): bool =
  f.invalid and f.hasError implies describedBy(f).nthOr(0, HintText) == ErrorText
pure def lawValidFieldShowsNoError(f: Field): bool = not(f.invalid) implies not(describedBy(f).some(d => d == ErrorText))
pure val fValues = Set({ invalid: false, hasError: false, hasHint: true }, { invalid: true, hasError: true, hasHint: true },
  { invalid: true, hasError: true, hasHint: false }, { invalid: false, hasError: true, hasHint: false })
```

## Story: Sort a table by a column

### A sortable column says its order and asks to sort when activated

A column that can sort the rows tells assistive technology its order, `none`
while another column sorts, and its header is a button that asks for the
sort. A column that cannot sort says nothing about order.

```quint
type Order = Ascending | Descending | Unsorted
type Column = { sortable: bool, order: Order }
pure def announcesOrder(column: Column): bool = column.sortable or column.order != Unsorted
pure def asksToSort(column: Column): bool = column.sortable
pure def lawSortableColumnSaysItsOrder(column: Column): bool = column.sortable implies announcesOrder(column)
pure def lawPlainColumnIsSilent(column: Column): bool =
  not(column.sortable) and column.order == Unsorted implies not(announcesOrder(column)) and not(asksToSort(column))
pure val columnValues = Set({ sortable: true, order: Unsorted }, { sortable: true, order: Descending },
  { sortable: false, order: Unsorted }, { sortable: false, order: Ascending })
```

## Story: Move through links, details and dialogs by keyboard

### The keyboard reaches a row of links in the order shown, and one navigation tab at most is current

`NavTabs` and the logins of a `Leaderboard` are links. Tab moves to the next
in the order shown and Shift+Tab to the one before; past either end, focus
leaves the row. They are links, not an ARIA tab list, so arrow keys do
nothing. A navigation tab is current when it leads to the page shown, so two
tabs to different pages are never both current. PRD section 7 keeps keyboard
navigation; development's `SectionNav` in `src/Presentation.tsx` marks the
page shown with `aria-current="page"` (commit 7acb6d13c). The links of a
`SiteFooter`, the home link, navigation and account control of a
`SiteHeader`, a list of `ProjectCard`s, each card one link as a `Card` with
`asChild` is, and the way back of `NotFound` are rows of the same kind.

```quint
pure def nextInRow(at: int, links: int, forward: bool): int =
  if (forward) (if (at <= links) at + 1 else at) else (if (at > 0) at - 1 else at)
pure def tabCurrent(tab: str, shown: str): bool = tab == shown
pure def lawForwardThenBackReturns(at: int, links: int): bool =
  at >= 0 and at <= links implies nextInRow(nextInRow(at, links, true), links, false) == at
pure def lawRowStaysInOrder(at: int, links: int, forward: bool): bool =
  at >= 0 and at <= links + 1 implies nextInRow(at, links, forward) >= 0 and nextInRow(at, links, forward) <= links + 1
pure def lawOneTabIsCurrent(tab: str, other: str, shown: str): bool =
  tab != other implies not(tabCurrent(tab, shown) and tabCurrent(other, shown))
pure val atValues = Set(0, 1, 2, 3, 4)
pure val linksValues = Set(0, 1, 3)
pure val tabValues = Set("overview", "rewards")
pure val otherValues = Set("overview", "history")
pure val shownValues = Set("overview", "history")
```

### A link to another site opens in a new tab and sends that site no referrer

`ExternalLink` leads to another site, such as a profile on GitHub, in a new
tab, so the page a person was reading stays open, and without a referrer, so
the other site never learns which page of Slop linked to it. It is named by
what it shows, or by `label` where it shows an icon or a short handle.

```quint
type LinkTarget = SameSite | OtherSite
pure def opensNewTab(target: LinkTarget): bool = target == OtherSite
pure def sendsReferrer(target: LinkTarget): bool = target == SameSite
pure def lawOtherSiteGetsNoReferrer(target: LinkTarget): bool =
  target == OtherSite implies opensNewTab(target) and not(sendsReferrer(target))
```

### An exact value scrolls rather than wraps, and the keyboard reaches it to scroll

A command, an address or an amount that has a place of its own is shown
whole on one line. Where it is wider than its place, it scrolls, and it takes
keyboard focus so a person without a pointer can scroll it: the code of a
`CommandBlock`, the value of an `Address` and the exact values of a
`CompareChange`, which names each value `Current` or `Proposed` for a screen
reader. An exact value beside others, such as what a `Checklist` check found,
wraps whole instead, and prose wraps; neither takes focus.

```quint
type ValueKind = ScrolledValue | WrappedValue | ProseValue
pure def wrapsValue(kind: ValueKind): bool = kind != ScrolledValue
pure def takesFocus(kind: ValueKind): bool = kind == ScrolledValue
pure def lawExactValueScrollsByKeyboard(kind: ValueKind): bool =
  kind == ScrolledValue implies not(wrapsValue(kind)) and takesFocus(kind)
pure def lawWrappedValueTakesNoFocus(kind: ValueKind): bool = wrapsValue(kind) implies not(takesFocus(kind))
```

### A disclosure opens and closes from its trigger and never hides what a decision rests on

Enter or Space on the trigger opens a closed `Disclosure` and closes an open
one, and the trigger says which it is through `aria-expanded`. It holds only
optional detail, such as earlier cycles: a required action, consent, an
amount, a restriction or evidence stays visible, as "Preserve the user
interface" in development's `CONTRIBUTING.md` requires (commit 7acb6d13c).

```quint
type Detail = RequiredAction | Consent | Amount | Restriction | Evidence | OptionalDetail
pure def mayHide(detail: Detail): bool = detail == OptionalDetail
pure def toggled(opened: bool): bool = not(opened)
pure def lawToggleTwiceRestores(opened: bool): bool = toggled(toggled(opened)) == opened
pure def lawDecisionsStayVisible(detail: Detail): bool = detail != OptionalDetail implies not(mayHide(detail))
```

### A dialog takes focus when it opens, keeps it inside, and gives it back to its trigger when dismissed

PRD section 7 requires keyboard and screen-reader use. A `Dialog` opened
from its trigger moves focus inside it, and Tab keeps focus
inside while it is open. Escape and its close button dismiss it, and focus
returns to the trigger that opened it. `ConfirmDialog` adds
[confirmation](./confirmation.md) to the same focus behavior.

```quint
type DialogFocus = OnTrigger | InDialog
type DialogKey = OpenKey | TabKey | EscapeKey | CloseButton
pure def focusAfter(focus: DialogFocus, press: DialogKey): DialogFocus =
  if (press == OpenKey) InDialog
  else if (press == EscapeKey or press == CloseButton) OnTrigger
  else focus
pure def lawOpenTakesFocus(focus: DialogFocus): bool = focusAfter(focus, OpenKey) == InDialog
pure def lawTabStaysInside(focus: DialogFocus): bool = focus == InDialog implies focusAfter(focus, TabKey) == InDialog
pure def lawDismissReturnsFocus(focus: DialogFocus, press: DialogKey): bool =
  (press == EscapeKey or press == CloseButton) implies focusAfter(focus, press) == OnTrigger
```
