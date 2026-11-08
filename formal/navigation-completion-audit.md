# Navigation dispatch and document-head state

This source-only pass read `App.tsx`, `Link.tsx`, `ErrorBoundary.tsx`,
`document-head.ts` and their current model mappings. It adds two bounded models
without changing application code. All fourteen new scenarios are unexecuted.
No tests, parsers, simulators, verifiers, browsers or applications ran.

`ui_navigation` records route/history and display controls;
`ui_hash_navigation` records the hash observer and reader takeover. Neither
explicitly described the separate zero-delay callback in `Link`. The new
`ui_link_dispatch` model records primary/keyboard activation, native modified
clicks, history updates, the optional synchronous menu-close callback, queued
scrolling and a later navigation before an older timer fires. The timer reads
the current URL when it runs. It can scroll after reader input because it is
independent of the longer-lived hash observer. This is observed source order,
not a newly reproduced UX defect or a claim that all scrolls stop on input.

The link model has two plain activations, one modified activation, three
same-origin destinations and abstract target/pixel values. The current call
sites use internal destinations; browser handling of external URLs and errors
thrown by arbitrary callbacks is not proved. It does not make a new external
navigation guarantee. Existing `navigation.spec.ts` and `hash-history.spec.ts`
are conformance references, not new runs of these scenarios.

`ui_document_head` describes the module's route path, mounted not-found count,
canonical element, robots value and optional Open Graph URL element. It covers
the two effect orders, two simultaneous not-found views, last-view cleanup,
null routes and preservation of unrelated existing robots metadata. A
not-found state removes the canonical link and sets noindex; the source leaves
the previous Open Graph URL alone. The model retains that behavior. Element
selection, duplicate metadata inserted by other scripts, URL/title parsing,
React's paired effect lifecycle and search-engine behavior remain external.

The existing `ui_boot` describes the render error boundary and distinct app
chunk/registry failures. This pass found no additional runtime correction in
those inspected branches. The earlier App-shell and frontend audits remain
historical evidence with their recorded source hashes; this mapping update
does not make their browser results current-source acceptance.
