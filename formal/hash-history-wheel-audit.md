# Hash-history wheel audit

The mobile history test sometimes kept `scrollY = 5740` after its final
`wheel(-120)` input. The preceding test setup used a `100000` pixel wheel
gesture to reach the page bottom. The preserved failure is in
`evidence/formal/e2e-c732-preview-6/` in the integration worktree.

The investigation used application source at
`ff076a9fff84e4cb6352878ee3f488c289807da1`, Bun 1.3.14, Node 24.15.0, and
the pinned Chromium. It did not change `src/Link.tsx`.

## Cause and control

A browser-only control used a tall document, a short-document navigation,
native history traversal, and the same final `wheel(-120)`. It loaded no Slop
JavaScript. All five runs with the initial `wheel(100000)` moved from 5740 to
5620 and then returned to 5740. All five runs with direct initial positioning
stayed at 5620. Adding a 200 ms wait after the large gesture still gave an
incorrect final position in all five runs. Five runs with repeated 800 pixel
gestures stayed at 5620.

The application probe recorded the trusted wheel event and the immediate
removal of the hash-restoration listener. After that input, the browser moved
back to the old offset without an application `scrollTo` or `scrollIntoView`
call. This distinguishes the native scroll behavior from a failure to cancel
the application restoration. It does not establish which Chromium internal
animation or history task caused the native movement.

An intentionally faster application probe also read a moving offset too early
and failed a Forward assertion. That diagnostic is not a required-suite pass
or a separate confirmed application defect. The unchanged test with event
instrumentation passed 10/10 mobile runs.

## Test correction

The setup now moves by at most one viewport and never requests more than the
remaining distance to the bottom. Each gesture retains the existing
observable movement and stable-position checks. The final real `wheel(-120)`,
first-gesture cancellation, fragment alignment, Back/Forward offsets,
history-state retention, accessibility check, screenshots, and videos remain.
The test adds no sleep and changes no application transition or Quint model.

The corrected original test passed 40/40 browser cases in 2.2 minutes: the
immediate and loading-page cases, each repeated ten times at both 1440 pixel
desktop and 320 pixel mobile widths. All 40 browser diagnostic attachments
had zero unexpected errors. The existing accessibility check ran in every
case. Desktop and mobile Forward screenshots were also inspected. The
changed test passed the targeted Biome check and `git diff --check`.

Raw control scripts, JSON event logs, source hashes, screenshots, videos, and
browser reports are kept outside Git in the persistent worktree at
`evidence/formal/hash-wheel/`. Browser execution proves these local inputs
and browser versions only; it does not prove all browser timing behavior.
