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
