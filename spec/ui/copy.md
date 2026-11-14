# Copy feedback

PRD sections 4 and 9 require working copy feedback for commands, prompts,
addresses and identifiers. Copying is a request to the browser that may be
refused. The value always stays visible and selectable, so a refusal leaves a
manual path, and the result is announced without moving focus.

## Story: Copy a value and know whether it worked

### Copying starts from ready and reports the browser's answer

```quint
type CopyStatus = Ready | Copying | Copied | CopyFailed
type Copy = { status: CopyStatus, copies: int }
pure val initial: Copy = { status: Ready, copies: 0 }
pure def canCopy(c: Copy): bool = c.status != Copying
pure def copy(c: Copy): Copy = { ...c, status: Copying }
pure def canAnswer(c: Copy): bool = c.status == Copying
pure def answer(c: Copy, written: bool): Copy =
  if (written) { status: Copied, copies: c.copies + 1 } else { ...c, status: CopyFailed }
```

### Success settles back to ready; failure stays until the next attempt

A failure keeps its message so the person can select the text by hand.

```quint
pure def canRest(c: Copy): bool = c.status == Copied
pure def rest(c: Copy): Copy = { ...c, status: Ready }
pure def copyAnnouncement(c: Copy): str =
  val status = c.status
  match status {
    | Ready => ""
    | Copying => ""
    | Copied => "Copied"
    | CopyFailed => "Copy failed. Select and copy the text."
  }
pure def alwaysCopiesCount(c: Copy): bool = c.copies >= 0 and (c.status == Copied implies c.copies > 0)
pure def stepFailureKeepsCount(before: Copy, after: Copy): bool =
  after.status == CopyFailed implies after.copies == before.copies
pure def sometimesCopied(c: Copy): bool = c.status == Copied
pure def sometimesFailed(c: Copy): bool = c.status == CopyFailed
pure def sometimesSettled(c: Copy): bool = c.status == Ready and c.copies > 0
```
