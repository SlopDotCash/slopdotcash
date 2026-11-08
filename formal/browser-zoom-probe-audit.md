# Text resizing and reflow probe correction

The previous browser tests contained 22 `style.zoom = "2"` assignments across
11 specs. These changed an author CSS property, not native browser zoom. Twelve
sites had no local viewport guard, nine required at least 640 pixels, and one
expanded a narrow viewport to 640 pixels first. A settled 320-pixel run of the
admin probe overflowed to 640 pixels because the site's existing 320-pixel body
minimum was also scaled. A geometry read before that layout completed could
produce a false pass. This is a test-method correction; product CSS is unchanged.

The probes now reuse `enlargeText` for 200% typography at their actual viewport.
The helper waits two animation frames after changing or restoring styles.
The nine existing explicit reset points still restore the exact original
inline styles. Other probes keep their previous navigation/context teardown
boundaries. Geometry and accessibility assertions remain; the private-settlement
probe's former 640-pixel allowance is tightened to the actual viewport.
Screenshots identify text enlargement. Two wallet-picker loops retain their
stronger 160-CSS-pixel fixtures and are labelled layout approximations.

[WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) addresses
320-CSS-pixel vertical layouts, with specified two-dimensional-content
exceptions. [Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
addresses text enlargement through 200%. The existing site matrix keeps these
separate and also includes combined narrow/enlarged-text stress. None of these
fixtures establishes native browser-zoom behavior. The text helper affects the
currently mounted subtree; replacement content needs its own settled check.

An isolated frozen-registry fixture built from the modified test tree passed
26 desktop/mobile admin-retention, onboarding, home-cache and session/wallet
checks. The existing reflow and wallet-picker group passed 19 checks; four
desktop duplicates were skipped by the existing run-once mobile guard. This
includes the 160-pixel cases and all 15 route/method combinations in the reflow
matrix. Typecheck and changed-file formatting passed. No full native-zoom,
hosted or registry-backed acceptance is claimed.

The 16 changed probe sites in admin-fee-conversions, bounty-full-flow,
bounty-solana-flow, email-preferences, evidence-download, registry and
security-bounty still require the separate registry/private-intake/local-chain
lanes. Their source compiles, but the static preview fixture cannot validate
those operations. Their geometry and accessibility checks were not removed.
Logs, JSON results and screenshots are retained under ignored
`evidence/formal/browser-probes-*` and `browser-probe-reflow-*`.
