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
Read states look different from one another as
[Status presentation](./status.md) requires.

## Story: One look for every control

> As a contributor, I want every page to offer the same control for the same
> kind of input, at a size I can reach, so that I never relearn a form.

### Each control kind has one primitive, and every component has stories

An application takes each control from `@repo/ui` and never draws its own.
Every exported component has a `.meta.tsx`, so `stories gen` gives it stories
and the browser project checks each story with axe.

```quint
type ControlKind = Action | Text | LongText | Choice | OneOf | Toggle | Check | FileChoice | Paging | Reveal | CopyText | Confirm
pure def primitive(kind: ControlKind): str =
  if (kind == Action) "Button" else if (kind == Text) "Input" else if (kind == LongText) "Textarea"
  else if (kind == Choice) "Select" else if (kind == OneOf) "RadioGroup" else if (kind == Toggle) "Switch"
  else if (kind == Check) "Checkbox" else if (kind == FileChoice) "FileField" else if (kind == Paging) "Pagination"
  else if (kind == Reveal) "Disclosure" else if (kind == CopyText) "CopyButton" else "ConfirmDialog"
pure def lawOnePrimitivePerKind(kind: ControlKind, other: ControlKind): bool =
  kind != other implies primitive(kind) != primitive(other)
```

### Controls are 40px or 48px high, and fields 52px

A small button is the least target, above the 24px of WCAG 2.5.8.

```quint
type ControlSize = Small | Regular | Field
pure val leastTargetPx = 40
pure def heightPx(control: ControlSize): int = if (control == Small) 40 else if (control == Regular) 48 else 52
pure def lawEveryControlIsReachable(control: ControlSize): bool = heightPx(control) >= leastTargetPx
```

### Under reduced motion nothing spins, pulses or slides

A spinner, a skeleton, an unknown progress bar and every transition stand
still when the person asks the system for reduced motion.

```quint
type Motion = FullMotion | ReducedMotion
type Movement = Spin | Pulse | Slide
pure def moves(motion: Motion, movement: Movement): bool = motion == FullMotion
pure def lawReducedMotionStandsStill(movement: Movement): bool = not(moves(ReducedMotion, movement))
```

### Keyboard focus always shows the ring

Every focusable control shows the `ring` token under keyboard focus and no
outline of the browser's own.

```quint
type Focus = Unfocused | PointerFocus | KeyboardFocus
pure def showsRing(focus: Focus): bool = focus == KeyboardFocus
pure def lawKeyboardFocusIsVisible(focus: Focus): bool = focus == KeyboardFocus implies showsRing(focus)
```

### Colors are tokens, except another party's mark

A component names a color by its token. A literal color is allowed only for
another party's published identity, a network or the Slop mark, with its
reason on the line above.

```quint
type ColorSource = RoleToken | PartyMark | Unexplained
pure def colorAllowed(source: ColorSource): bool = source != Unexplained
pure def lawOnlyMarksAreLiteral(source: ColorSource): bool = colorAllowed(source) iff source != Unexplained
```
