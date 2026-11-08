# Admin editor save ownership

This source-only correction starts from `e4ee8a3c`. No tests, syntax/type/lint/
format checks, browser runs, simulations or model verifiers were executed.
The implementation and seven model scenarios remain unvalidated.

`ProjectEditor` in `src/Admin.tsx` previously removed its project/revision
draft key and called `onSaved` whenever the manifest PUT resolved. The parent
callback reloads the project list and calls `backToOverview`, whose URL guard
does not identify which editor instance submitted the request. Meanwhile,
`useProjectSession` hides the admin subtree during a focus identity check.

A pending save can therefore outlive its editor. A remounted editor for the
same project/revision restores that shared draft and accepts new edits before
the older save completes. The older response deleted the newer stored draft
and could close the current editor. The same editor also permits editing most
fields while saving, so an unconditional success callback could discard newer
in-memory work even without remounting.

The save now captures the complete serialized submitted draft. Successful
completion removes storage only when that slot still contains those exact
bytes. A departed editor does not deliver success, failure or navigation
callbacks to the current view. A mounted editor with newer edits exits its
busy state and explains that only the submitted revision was saved; its newer
local draft stays open. This comparison also works when storing those newer
edits failed: the latest committed draft is tracked separately from storage.
An unchanged current editor keeps the existing save/reload/overview flow.

`ui_admin_editor_lifetime.qnt` models two instances, three draft values, one
save per instance, persistence/removal failure, current and departed replies,
and success navigation. Named scenarios cover remount plus new draft, edits
during save, newer edits with failed persistence, ordinary success, current
and departed failure, and failed removal after a successful server save.
API authority and revision compare-and-swap remain external predicates; the
model does not prove browser scheduling or backend acceptance.

The adjacent admin delist, enforcement and exemption callbacks update their
old component/parent state rather than calling this global navigation helper.
Their complete mutation protocols were not changed. The existing
`ui_admin_review` model still covers revision refusal and `ui_focus_session`
covers session-check visibility; neither previously represented this draft
slot and save-response lifetime composition. Layout and styles are unchanged.
