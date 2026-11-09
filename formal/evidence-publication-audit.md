# Evidence publication and finalization

This source-only change refines `evidence_capture` around
`beginEvidenceTransaction`, `withEvidenceCleanup` and their callers in
`record-evidence.mjs`. It separates validated evidence, directory publication,
backup cleanup, resource cleanup and successful completion. No parser, checker,
test, application, browser, recorder or service ran for this change. Only
source metadata inventories are regenerated. The new model scenarios and
regression definitions remain unexecuted.

## Confirmed source paths

Previously, a successful staging-to-final rename followed by failed backup
removal threw a generic publication error. The new bundle was already current.
A failed compensating rename could instead hide the original publication error.
Transaction state now changes to `published` at the successful rename. A later
backup-cleanup error reports that committed outcome and its paths. Published
abort is a no-op and cannot remove the new bundle or its retained old backup.

Before publication commits, a failed rename restores the prior bundle when
possible. If restoration fails, or a different directory has occupied the
destination, state becomes `recovery-required`. The aggregate retains the
original publication error as its cause and includes both failures. Both the
old backup and the new staging directory remain available. Abort in that state
is a protected no-op; it is not a claim that either directory was deleted.
Ordinary open-state abort changes state only after removal succeeds, so failed
staging cleanup remains retryable.

The recorder formerly created `.video` after opening the transaction but before
its `try/finally`. Failure there bypassed preview shutdown and staging cleanup.
It now performs that setup inside the owned operation. The former outer
`finally` awaited preview shutdown before aborting the transaction; a shutdown
failure skipped abort. Browser shutdown and early preview cleanup could also
replace the original operation error.

`withEvidenceCleanup` now awaits the operation, then independently awaits each
listed finalizer in order. With no cleanup failure, an operation error is
rethrown unchanged. With cleanup failures, `AggregateError` keeps the original
error first and as its cause, followed by the finalizer errors and labeled
messages. An operation that succeeded can still fail finalization. The recorder
logs successful evidence completion only after this helper returns.

| Source path | Modeled boundary |
| --- | --- |
| `evidence-bundle.mjs` `beginEvidenceTransaction` | `stage`, open-state `abort`, successful activation in `publish`, `restoreOnError`, `cleanupBackup` |
| `evidence-bundle.mjs` `withEvidenceCleanup` | Operation error versus independently attempted cleanup errors; `stopPreview`, `abort`, `closeBrowser` |
| `record-evidence.mjs` early preview/staging failure catches | Same primary-error preservation helper; no transaction cleanup is claimed before a transaction exists |
| `record-evidence.mjs` main capture helper | `.video` setup belongs to the operation; preview shutdown precedes an independently attempted staging abort |
| `record-evidence.mjs` nested browser helper | Capture failure survives browser-close failure; outer cleanup still runs |
| `record-evidence.mjs` `stopPreview` | The final bounded wait after `SIGKILL` must observe exit or throw; the model treats this as a success/failure input |

## Model bounds and publication limits

`evidence_capture` has 18 named scenarios, preserving the original three names.
It contains one prior bundle, one candidate, one possible competing valid
directory before activation, and one capture/finalization attempt with a
separate open-abort retry. It distinguishes `open`, `published`, `aborted` and
`recovery-required`, a retained backup, staging presence, operation and cleanup
errors, attempted finalizers and the final success message.

The invariant permits a current new bundle only after abstract build/browser
validation in the recorder's caller sequence. `beginEvidenceTransaction`
itself does not validate files, browser results or build identity; its bare
`publish` API has no such guard. The model preserves both recovery inputs in `recovery-required`, prevents
abort from deleting published evidence, and prevents a success message after
failed finalization. Nested aggregates retain their original cause chain;
the model preserves the original failure identity category rather than
flattening the JavaScript exception tree.

There is no writer lock or multi-directory atomicity guarantee. A caught failure
must preserve an observed competing winner instead of overwriting it during
restoration. The model includes that one interleaving; it does not model every
possible concurrent publisher or external filesystem mutation. A process crash
between renames can leave the final path absent with the prior backup retained.
A crash after activation can leave a published bundle and old backup. Neither
state is a successful completed capture. Successful local rename is a commit
boundary assumption, not a universal remote-filesystem or power-loss guarantee.

## Authored regression definitions

`scripts/evidence-publication.test.ts` adds 15 native definitions. Each copies
the actual module and its SHA helper into an isolated directory, then imports
them in a Node child. Filesystem hooks target real rename/removal boundaries.
Small marker files distinguish old/new/winning directories; they are not
screenshots, videos or browser-acceptance evidence.

The definitions cover normal/first publication, failed old-directory move,
successful compensation, committed backup-cleanup failure, failed restoration,
a competing winner, retryable abort, successful cleanup return values, original
error identity, multiple finalizer errors, preview failure followed by abort,
nested browser cleanup, `.video` setup failure and a committed publication whose
preview shutdown fails. Every asynchronous helper invocation is awaited. The
tests inspect retained directory contents and exact error/cause identities.

The recorder's actual browser and preview wiring was read, not executed. The
definitions exercise the same exported cleanup helper, but do not launch the
recorder, validate pixels/media, prove native process-group shutdown, or replace
real browser/backend evidence. Bundle validation remains a separate contract
in `validateEvidenceBundle`; the model uses its result as an input. Those runtime
checks and all model execution remain open.
