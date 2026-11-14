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
pure def lawValidFieldShowsNoError(f: Field): bool = not(f.invalid) implies not(describedBy(f).includes(ErrorText))
```
