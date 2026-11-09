# App view state follow-up

The later source-only [navigation completion](navigation-completion-audit.md)
adds explicit link-dispatch and document-head models. Its new scenarios have
not been executed; the historical receipts below do not validate those bytes.

The source inventory originally mapped `src/App.tsx` to navigation models.
That file also owns independent presentation and discovery state. This review
adds those models without changing application behavior. A file-level mapping
was insufficient evidence that every state family in the file had a model.

| Source state | Model and boundary |
| --- | --- |
| Current URL, history, hash and document head | `ui_navigation`, `ui_hash_navigation`; route parsing and title construction remain pure input transformations. DOM arrival and user takeover are distinct. |
| Hero word, character count, phase and timer | `ui_hero_animation`; hold, delete, gap, type and settle, reduced-motion observation, pending callback and unmount. |
| Failed custom image and owner avatar | `ui_project_images`; custom URL failure, owner fallback, initial fallback, URL replacement and project-key reset. |
| Project page selection, history disclosure and coarse copy outcomes | Existing `ui_navigation`; bounded pages, filter reset, toggle and coarse copy success/error. |
| Clipboard request ownership and expiry | `ui_clipboard_requests`; source-only refinement for changing displayed prompts, latest attempts, component lifetime and stale timers. See `clipboard-feedback-audit.md`. |
| Project-specific agent prompt | `ui_project_discovery`; loading, valid listed result, valid absent result, request/schema error, project-key replacement, departed response and unmount. |
| Public data and contract values passed to child views | The source hooks and financial models retain those transitions. App rendering does not create a second authoritative record. |

The hero model uses two representative words of lengths two and three instead
of four literal campaign strings. Browser timer delay and React scheduling are
abstract: the model checks transition ordering, not elapsed-time precision. A
media-query change alone does not trigger this source effect. An already
scheduled callback can finish before the next effect observes reduced motion;
the model retains that behavior rather than inventing immediate cancellation.
The accessible heading remains constant while its visual text animates.

The discovery model bounds two project keys and one request for each mount.
Changing the project key destroys the prior panel before the new read settles.
An old response cannot grant the new project's specific prompt. The generic
agent prompt remains available during loading, refusal and failure. That prompt
is advice; it grants no work, API or payment authority. The HTTP deadline and
bounded JSON reader remain separately reviewed transport contracts.

The image model bounds two custom URLs and one owner avatar. It preserves a
failed custom URL when another URL is displayed and resets hook state on a new
project key. An owner image failure remains until that avatar subtree remounts.
The model assumes the browser's error event concerns the rendered DOM image;
it does not prove image-decoder behavior or every canceled network event.
Fallback initials and images are decorative and do not affect project identity.

Existing real-browser conformance workflows are
`tests/e2e/hero-typewriter.spec.ts`, `tests/e2e/onboarding-clearance.spec.ts` and
`tests/e2e/home-cache.spec.ts`. They exercise animation and reduced motion,
project clearance failure/absence/success, held reads during history navigation,
and blocked owner-avatar fallback. Custom-URL replacement is a model scenario,
not an additional claimed browser pass. Final run counts and source hashes
belong to the combined verification receipt and `formal/STATUS.md`.

These finite models close the identified App view coverage gaps. They do not
prove that the React implementation refines every model, that all possible DOM
and network schedules were explored, or that an inventory link is such a proof.

Quint 0.33.1 typechecking, all 16 named scenarios and 500 seeded traces of at
most 60 transitions per model passed. Safe local-translation TLC exhausted
96 hero states (depth 33), 27 discovery states (depth 5), and 28 image states
(depth 6). Each receipt records unchanged source and model hashes. The first
hero attempt used a reserved name, and the first image translation used an
unsupported init-action alias; both failed before verification and are retained
separately from the corrected passes. These were specification/tooling issues,
not evidence of an application defect.

The existing three browser files passed 20/20 Chromium desktop/mobile cases
with no skips, flakes or unexpected failures. This source-specific run covered
the unchanged App runtime in its frozen built fixture. Other integration files
changed while it ran, so it is not a final whole-head validation claim. The
ignored `evidence/formal/app-state-followup/` receipt retains that boundary.
