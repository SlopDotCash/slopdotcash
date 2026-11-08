# Private report reflow and keyboard access

The real local Pages/D1 private-intake browser lane found two rendering defects
and a test locator defect. The report and payment state transitions are unchanged.

- At a 320 CSS pixel viewport, enlarging rendered text to 200% made the
  `CaseActions` native Action select grow to 335 pixels. The document grew from
  320 to 366 pixels. The select sits outside the existing `.security-form`
  sizing rules. Its scoped label now uses a grid and its select fits the card.
- The report's preformatted text retains a bounded scroll area. At enlarged text
  size the area could scroll, but keyboard users could not focus it. The report
  is now a named, focusable region with a visible focus outline. The existing
  intake browser journey checks focus and PageDown scrolling when it overflows.
- The cross-tab account test selected every `Read private report` summary in a
  retained Inbox. The selector now uses its immutable submission ID. Its real
  shared-cookie switch and private-content removal assertions are unchanged.

`ui_private_report_scroll.qnt` models the loaded report's open/closed state,
focus and blur, fit/overflow, bounded scroll position, and collapse/account
change. Four named scenarios and 1,000 traces of 30 steps pass. Browser layout,
keyboard event delivery, and pixels are external assumptions; this model does
not prove those browser implementations. The real browser assertions supply
conformance evidence for the exercised boundaries. Existing
`ui_private_intake` and `ui_inbox` models retain the request and account epochs.

Local evidence is kept under `evidence/formal/`. The original full run, the
320-to-366 pixel reproduction, and later attempts are retained separately.
The corrected control measured document width 320 both before and after text
resize. A separate native Chrome review at 200% browser zoom confirmed the
Action control's focus and Tab/Shift-Tab navigation. A later full-lane attempt
exposed the report scroll accessibility defect and a separate desktop timeout
before a report-read click; the timeout had no actionability log or established
product cause. It is not classified as a successful run.

The final full private-intake lane passes 24 cases with zero failures or flaky
results. Both layouts retain their original width after 200% text resize; the
mobile report is keyboard-scrollable and passes the accessibility check. Four
local-chain cases are skipped here and run separately in the disposable
Anvil/Solana browser payment lanes. Raw traces,
session material, and synthetic signing material stay local; only reviewed
synthetic videos, screenshots, and safe receipts may be published.
