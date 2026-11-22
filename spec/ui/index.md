# Interface components

The shared components of `@repo/ui` show what the product machines own. They
hold no business rules: a component receives a state already decided by its
owning spec and renders it, and offers a control exactly when that control's
event is allowed. These specs fix the presentation vocabulary every component
uses and the few interaction machines a component drives itself.

- [Status presentation](./status.md)
- [Controls and fields](./controls.md)
- [Copy feedback](./copy.md)
- [Pagination](./pagination.md)
- [Confirmation](./confirmation.md)

Colors, type, shape and motion are the design tokens of `@repo/design-system`,
whose roles and contrast requirements are [the design system](../designSystem/).
Read states look different from one another by `lawReadStatesAreDistinguishable`
of [Status presentation](./status.md#read-states-show-loading-emptiness-staleness-and-failure-differently),
and `DataState` renders each through `readPresentation`.

## Story: One look for every control

> As a contributor, I want every page to offer the same control for the same
> kind of input, at a size I can reach, so that I never relearn a form.

### Each control kind has one primitive, and every component has stories

An application takes each control from `@repo/ui` and never draws its own.
Every exported component has a `.meta.tsx`, so `stories gen` gives it stories
and the browser project checks each story with axe. `ViewSwitch` chooses a
view of content already shown and takes effect at once, so it is a
`SegmentedControl`; `OneOf` answers a form's question, so it is a
`RadioGroup`. `packages/ui/test/inventory.test.ts` holds the inventory to
this map.

```quint
type ControlKind = Action | Text | LongText | Choice | OneOf | ViewSwitch | Toggle | Check | FileChoice | Paging | Reveal | CopyText | Confirm
pure def primitive(kind: ControlKind): str =
  if (kind == Action) "Button" else if (kind == Text) "Input" else if (kind == LongText) "Textarea"
  else if (kind == Choice) "Select" else if (kind == OneOf) "RadioGroup" else if (kind == ViewSwitch) "SegmentedControl"
  else if (kind == Toggle) "Switch" else if (kind == Check) "Checkbox" else if (kind == FileChoice) "FileField"
  else if (kind == Paging) "Pagination" else if (kind == Reveal) "Disclosure" else if (kind == CopyText) "CopyButton"
  else "ConfirmDialog"
pure def lawOnePrimitivePerKind(kind: ControlKind, other: ControlKind): bool =
  kind != other implies primitive(kind) != primitive(other)
```

### A shown control stands still under reduced motion, and keyboard focus shows its ring

A control is shown to a person who may ask the system for reduced motion,
and is focused by the keyboard or by the pointer. Under reduced motion no
control transitions or animates. Keyboard focus shows the `ring` token and no
outline of the browser's own; pointer focus shows it only in a field that
takes typing, a text field or a select, which a typed letter chooses in, as
the browser keeps it for the keys that follow. The browser, not
`@repo/ui`, holds the motion preference and the focus, so these are laws over
every shown control rather than a machine. `controls.browser.test.tsx` shows
each primitive in every motion and focus in Chromium and compares its
computed style with `moves` and `showsRing`.

```quint
type Motion = FullMotion | ReducedMotion
type Focus = Unfocused | PointerFocus | KeyboardFocus
type Shown = { kind: ControlKind, motion: Motion, focus: Focus }

pure def takesTyping(kind: ControlKind): bool = kind == Text or kind == LongText or kind == Choice
pure def moves(s: Shown): bool = s.motion == FullMotion
pure def showsRing(s: Shown): bool = s.focus == KeyboardFocus or (s.focus == PointerFocus and takesTyping(s.kind))
pure def lawReducedMotionStandsStill(s: Shown): bool = s.motion == ReducedMotion implies not(moves(s))
pure def lawKeyboardFocusShowsRing(s: Shown): bool = s.focus == KeyboardFocus implies showsRing(s)
pure def lawPointerRingOnlyWhereTyping(s: Shown): bool = s.focus == PointerFocus implies (showsRing(s) iff takesTyping(s.kind))
pure def lawUnfocusedShowsNoRing(s: Shown): bool = s.focus == Unfocused implies not(showsRing(s))
pure val sValues = tuples(Set(Action, Text, Choice, Toggle, Paging), Set(FullMotion, ReducedMotion), Set(Unfocused, PointerFocus, KeyboardFocus))
  .map(((kind, motion, focus)) => { kind: kind, motion: motion, focus: focus })
```

A spinner, a skeleton and a progress bar of unknown length stand still under
reduced motion too.

### Buttons are 48px high, 40px small, fields 52px, and every control can be hit in a 44px square

A control drawn smaller than 44px, such as a small button, a checkbox, a
switch or the close button of a dialog, keeps an invisible 44px square
centered on it. A link inside running text keeps the height of its line, as
WCAG 2.5.8 excepts inline targets: `ExternalLink` is that link, and a row of
links such as the footer's gives each its square. The browser test measures
each primitive's hit area.

```quint
type ControlSize = Small | Regular | Field
pure val targetPx = 44
pure def heightPx(control: ControlSize): int = if (control == Small) 40 else if (control == Regular) 48 else 52
```

### Colors are tokens, except another party's mark

A component names a color by its token. A literal color is allowed only for
another party's published identity, a network or the Slop mark, in the
component that draws that mark (`Logo`, `NetworkMark`), with the reason on
the line above naming the mark. `inventory.test.ts` refuses any other
literal.
