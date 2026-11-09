# Clipboard request ownership

This source-only review adds `ui_clipboard_requests`, with 18 named scenarios.
No parser, model checker, browser test or application check ran for this change.

## Confirmed flow and correction

`ProjectInstallPanel` renders the general agent prompt while clearance loads.
The same mounted `AgentPromptBox` receives the project prompt when the discovery
response permits it. Previously, an outstanding copy of the general prompt could
then mark the project prompt as copied. A completed success also remained visible
across that text change. Overlapping attempts could replace the newer result with
an older success or denial. `CopyButton` used the same unowned promise pattern.

`useCopyFeedback` now owns both callers' feedback. A committed text change or
unmount invalidates pending results. Each click clears old feedback and owns its
own completion; only the latest attempt may publish. Returning to the same text
does not restore an old request's ownership. The agent prompt retains its
1,600-millisecond success timeout and existing `data-copy="error"` styling;
identifier feedback remains visible until another attempt or text change.

## Model and source mapping

| Model transition | Source transition |
| --- | --- |
| `copy` | Click captures text and advances the request generation before `copyText` |
| `changeValue` | A different committed text runs the layout-effect cleanup and setup |
| `complete` | Native success or denial publishes only for the captured generation |
| `leave`, `returnToView` | Effect cleanup invalidates the previous component lifetime |
| `expire` | Success timer compares its captured generation before clearing feedback |
| `persistentFeedback` | `CopyButton` does not request a success timeout |

The invariant binds visible feedback to the latest request, current text version
and live component. Bounds are two text values, three committed text versions,
two component lifetimes and three requests. Timer callbacks include an already
queued callback after cleanup. The model omits React internals, browser permission
implementation and arbitrary operating-system clipboard changes. It does not
promise that clipboard contents cannot change after a successful write.

Five browser regression definitions in `tests/e2e/clipboard-feedback.spec.ts`
exercise the real routed prompt with controlled clipboard promise completion:
clearance during old success or failure, reversed overlapping completions, and
repeat-copy feedback reset/expiry. They are unexecuted and are not native clipboard
acceptance. Existing native copy cases remain in onboarding, wallet-picker and
admin-evidence suites. Desktop/mobile, keyboard, zoom, accessibility and uploaded
walkthrough evidence remain required before this UI change can be accepted.
