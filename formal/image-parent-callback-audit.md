# Image decoding across a parent publication

This source-only correction addresses a delayed image callback in the project
update form. A file chosen while the draft was empty captured `set("image")`
with the old base revision. The user could edit and publish a headline while
`createImageBitmap` was pending. When decoding later completed, that captured
callback set the image draft's base back to the older revision, creating a false
stale-draft warning after the user's own successful publication.

`ProjectImageField.tsx` now keeps the latest committed `onChange` callback in a
ref updated during the layout effect. Decode completion uses that ref. Its
lifetime flag also changes in layout cleanup, so a departed field cannot
deliver into a discarded or replaced parent. The original crop, encoding,
quality fallback, byte limit, file types, preview and controls are unchanged.

## Source and model relation

`ui_image_decode.qnt` has 15 named source-authored scenarios. It bounds two field
lifetimes, three decode jobs, three draft-edit identities and parent revisions
1 through 3. Parent changes are modeled as committed renders: the callback ref
is updated with the corresponding committed draft/revision. It does not claim
that a queued, uncommitted render already owns the callback.

| Source transition | Model action |
| --- | --- |
| Choose a file; clear prior error; disable input while decoding. | `choose` |
| Refuse an unsupported MIME type before allocating a bitmap; allow retry. | `rejectType`, then `choose` |
| `createImageBitmap` rejects before returning any bitmap; allow retry. | `decodeReject`, then `choose` |
| Decode succeeds and returns a bitmap. | `decode` |
| Canvas/context/encoding/admission fails; dispose the bitmap and allow retry. | `invalidImage`, then `choose` |
| Deliver a valid encoded image to the current committed parent and close it. | `encodeCurrent` |
| A headline draft publishes while decode is pending; the committed callback changes. | `editHeadline`, `beginPublish`, `publishCommit` |
| Image delivery during a save remains a newer draft rebased on the saved revision. | `encodeCurrent`, then `publishCommit` |
| Discard remounts the field; a late bitmap is closed without delivery. | `discardDraft`, `closeDepartedBitmap` |
| Leaving the wizard step still cancels that field's pending selection. | `leaveField`, `returnToField`, `closeDepartedBitmap` |
| Remove the current image through the current parent callback. | `remove` |

The invariant ties each delivered image to a closed bitmap and to the parent
revision current at delivery. The composition includes the existing
`ProjectUpdateForm` behavior that preserves edits made while a publish is in
flight. It does not model server authority, every draft field, external
competing revisions, persistence failures, or the full publication lifecycle;
those remain in the dedicated draft/publication models. The unchanged
`ProjectFormFields.tsx` wrappers synchronously forward controlled values and
add no asynchronous request ownership.

## Authored workflow regression

`tests/e2e/project-save.spec.ts` adds one workflow definition using the existing
project API/native-D1 fixture and a held real `createImageBitmap` call:

1. Choose a PNG while the current revision is 1 and there is no draft.
2. Keep decode pending, edit the headline, and publish it as revision 2.
3. Release the bitmap; check one disposal and the encoded preview.
4. Check that the saved image draft uses revision 2 and no Use this draft
   conflict action appears.
5. Publish the image as revision 3 and read back both the headline and exact
   encoded image from the actual fixture database.

The existing discard-during-decode and JPEG-fallback definitions remain. No
wizard navigation policy changes were made: leaving its image step can still
discard a pending selection. Browser codec behavior, pixels, storage and the
new regression have not been executed in this pass.

## Queued-render source reasoning

No second stale-base defect was established for a decode that finishes after
publication queues its state updates but before the parent render commits.
A valid headline publication first requires a committed changed draft; the
latest committed image callback therefore already sees a non-null draft and
does not assign its captured older revision. If publication has queued the
draft clear, null draft revision, and new base before the image callback runs,
the callback's functional draft update adds the image after that clear. The
null draft revision then falls back to the queued new base when the draft
payload is derived. After the parent commits, the callback ref directly sees
the new base and a null draft. Before the headline edit commits, the earlier
publish handler has no changed draft and cannot perform that publication.

This is source reasoning about the guarded updates, not executed evidence of
concurrent React rendering. Uncommitted render scheduling remains outside the
model's committed-state projection; that limit is not a demonstrated remaining
application defect.

No tests, parser, simulator, prover, type/lint/format checks, browser or service
were run, following the user's instruction to skip checks. All 15 model
scenarios and the new workflow definition are unvalidated source.
