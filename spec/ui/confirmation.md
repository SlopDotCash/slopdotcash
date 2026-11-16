# Confirmation

PRD sections 3, 4 and 6 require explicit consent before an irreversible step:
removing a project, cancelling an application, signing a deposit or a
withdrawal. A confirmation states the consequence, waits for an explicit
confirm, and cannot be dismissed while the confirmed work is in flight. A
failure keeps the dialog open with its reason, so the person can retry or
cancel.

## Story: Confirm an irreversible step

### Only an explicit confirm starts the work

```quint
type Phase = Closed | Asking | Working | Refused
type Confirmation = { phase: Phase, confirmed: int, completed: int }
pure val initial: Confirmation = { phase: Closed, confirmed: 0, completed: 0 }
pure def canOpen(c: Confirmation): bool = c.phase == Closed
pure def open(c: Confirmation): Confirmation = { ...c, phase: Asking }
pure def canConfirm(c: Confirmation): bool = c.phase == Asking or c.phase == Refused
pure def confirm(c: Confirmation): Confirmation = { ...c, phase: Working, confirmed: c.confirmed + 1 }
pure def canCancel(c: Confirmation): bool = c.phase == Asking or c.phase == Refused
pure def cancel(c: Confirmation): Confirmation = { ...c, phase: Closed }
```

### The work's answer closes the dialog or keeps it open with the reason

```quint
pure def canFinish(c: Confirmation): bool = c.phase == Working
pure def finish(c: Confirmation, succeeded: bool): Confirmation =
  if (succeeded) { ...c, phase: Closed, completed: c.completed + 1 } else { ...c, phase: Refused }
pure def alwaysCompletedWasConfirmed(c: Confirmation): bool =
  c.completed >= 0 and c.completed <= c.confirmed and
  (c.phase == Working implies c.completed < c.confirmed)
pure def stepNoSilentCompletion(before: Confirmation, after: Confirmation): bool =
  after.completed > before.completed implies before.phase == Working
pure def stepWorkIsNotDismissed(before: Confirmation, after: Confirmation): bool =
  before.phase == Working implies after.phase != Asking
pure def sometimesCompleted(c: Confirmation): bool = c.completed > 0 and c.phase == Closed
pure def sometimesRefused(c: Confirmation): bool = c.phase == Refused
pure def sometimesCancelledAfterRefusal(c: Confirmation): bool = c.phase == Closed and c.confirmed > c.completed
```
