# Whole-codebase review, third pass — 27 October 2026

This report precedes the implementation. The review baseline is `3e355a33decd513e40d73147425676c2f9648765`; this is a fresh pass after the first two cleanup rounds, not a restatement of their completed changes. The user explicitly requested a detailed audit, then implementation, with parallel agents and a visual review of every non-home route. The homepage is protected.

## Reading this report

- **Selected work:** V01–V17 describe visual/UX/component work; TB01–TB03 cover proven backend error/liveness issues; TT01–TT09 cover tests, fixtures and runners; RR01–RR02 cover repository-level liveness and the live payout driver. RR02 and TT08 are the same task, not two counted fixes.
- **Reuse:** funding presentation/automatic cached refresh from PR1454 and the explicitly approved awards/trace changes from PR1455 are adopted from reviewed development. They are not independently reimplemented or counted as our new deletions. The exact adopted merge and final validation are recorded in the implementation results.
- **Keep:** each rejected simplification records the real boundary it would remove. Contracts, historical money/evidence, genuine integration tests and necessary consent are preserved. Small files, large files, few imports and repeated checks at different trust boundaries are not sufficient grounds for deletion.
- **Evidence:** the visual section links desktop/mobile PNGs and records fixture limitations; the backend section records actual migrated-SQL/HTTP reproductions; the test section inventories every retained or changed test declaration. A source review is not a claim that a live provider, native chain or production deployment passed.
- **Delivery:** the implementation and exact checks are appended after this report is committed. At report time all selected changes remain planned; no source implementation or production modification has occurred.

## User-request coverage and success criteria

| Request | Selected work and criterion |
| --- | --- |
| Combine files and simplify structure | Delete the orphan wallet migration CLI and its exclusive parser; extend the existing presentation vocabulary and browser fixture helper. Keep coherent domain/security boundaries. |
| Reduce feature complexity and human actions | Adopt automatic safe cached funding reads and integrated monthly-awards placement; shorten account/setup/operational paths without removing consent or signatures. No automatic money movement. |
| Deduplicate UI and styles | Small additive, non-home `PageHeader`, `StatusBadge` and metric primitives; shared network marks; scoped cards, status and metadata rather than a new framework. |
| Remove explanatory clutter | Condense education, funding, receipt, account and operational prose. Put advanced metadata and rare closure/classification actions in accessible disclosures. Keep fee/recipient/refund/safety facts before authorization. |
| Replace text with useful graphics | Actual network/brand marks, role/step icons, exact-value metric grids and bars. No invented logos, misleading funded ratios or decoration that replaces required labels. |
| Stop hiding errors | TB01 and TB02 distinguish actual concurrent/expired conditions from operational storage/service failures; TT05 removes a swallowed workflow exception. |
| Delete dead code/scripts/imports | RR01 and TB03 are proven unused. Verify hidden workflow and dynamic entrypoints before removal; preserve the live payout runner and repair it. |
| Delete non-contract units and pointless tests | TT01–03 remove isolated helper-only fragments embedded in workflow suites; TT04/09 remove duplicate assertions/setup. Retained HTTP/SQL/signature/process/browser/native outcomes are listed individually. |
| Minimize fixtures | Deterministic gzip for three large immutable files with identical decompressed bytes and SHA-256; no historical-row rewriting or invented deduplication. |
| Simplify/parallelize E2E/integration | TT06 shares text-zoom setup, TT08 repairs actual live browser payout proof; keep existing isolated 5-driver parallelism and CI shards. No unmeasured concurrency increase across shared state. |
| Review every non-home page visually | Route catalog and actual 1440/320 screenshots plus signed-in/owner/security states; V01–V17. Preserve home source/brand hashes and compare identical-fixture home screenshots. |
| Define other refactor best practices | Criteria below and root/backend/test keep/reject decisions. Every selected edit needs a concrete before/after outcome and appropriate evidence. |

## Additional refactor criteria

1. Fix the demonstrated canonical boundary; do not scatter defensive guards or theoretical parser fixes across callers.
2. A failed operation must remain visibly failed; never synthesize successful empty data, clear uncertain payments, or blame a service outage on a user's session.
3. Use one authoritative source for identities, network definitions, project inventory, schemas and generated artifacts. Do not hand-edit generated registries, history or public build outputs.
4. Prefer deletion and composition over flags, generic configuration layers, new wrapper files and polymorphic mega-components. An extraction must reduce duplication or make one real responsibility clearer.
5. Keep loading, stale, denied, invalid, empty and failed states distinct. A disclosure can hide secondary detail, never the state or next safe action.
6. Keep independent trust-boundary checks and native contract proof. No consolidation may expand signer authority or remove amount, recipient, token, finality or replay verification.
7. Use color and icons with text labels, accessible contrast, keyboard focus and reduced-motion behavior. Test actual 320px content and 200% text; do not truncate exact financial values.
8. Prefer safe reads to buttons where appropriate. Keep explicit consequential writes/signatures and meaningful retry/reconciliation actions.
9. Tests must cross a meaningful runtime boundary and prove persisted/observable behavior, refusal or recovery. Remove literal, shape, export-identity and mocked-call-only assertions; avoid adding replacement units for trivial display code.
10. Report measured reductions separately: source lines, fixture bytes, visible text/page height, steps, runtime and bundle size are different metrics. Do not claim a performance or bundle benefit from a file move.
11. Preserve unrelated work, use the reviewed development→main flow, keep checks enabled, and bind validation to the actual final source. Coordinate overlapping branches instead of resetting or reimplementing their changes.
12. Completion means every selected finding is implemented or explicitly resolved with evidence. It does not mean that an entire codebase has been formally proved defect-free.

## Baseline repository inventory

The complete tracked inventory contains **1,107 paths**. An import/parse pass covered **658 JavaScript/TypeScript modules**, with zero parse failures. Backend/Worker/native scope contains439 tracked paths with inspection-depth labels below. Test/workflow inventory contains126 non-contract entry files and676 source declarations, expanded cases excluded from that count. Every discovered candidate received a liveness or keep/remove disposition; no static graph alone authorized deletion.

| Area | Tracked files | Bytes at baseline |
| --- | ---: | ---: |
| `.github/` | 17 | 143,408 |
| `backend/` | 92 | 1,684,924 |
| `contracts/` | 111 | 1,543,199 |
| `data/` | 6 | 14,958,619 |
| `docs/` | 14 | 904,464 |
| `functions/` | 3 | 26,098 |
| `funding/` | 3 | 4,315 |
| `migrations/` | 105 | 329,899 |
| `protocol/` | 9 | 72,531 |
| `public/` | 13 | 109,600 |
| `scripts/` | 156 | 1,708,918 |
| `skills/` | 9 | 297,011 |
| `src/` | 174 | 1,900,756 |
| `tests/` | 137 | 19,900,863 |
| `workers/` | 233 | 2,616,171 |

Root configuration, lockfiles, repository instructions and deployment entrypoints account for the remaining individual files. Canonical PRD and CONTRIBUTING govern policy. AGENTS and CLAUDE remain byte-identical. Review artifacts are read-only local evidence; no private account data or credentials were captured.

---

## Repository decisions

## Third-pass repository and delivery audit

Baseline: `3e355a33decd513e40d73147425676c2f9648765`, 1,107 tracked paths. This pass is distinct from the previous reviews and does not count their removals again. The user explicitly authorizes broad non-home UI improvements. The homepage, its header/footer, animation, project cards, copy, typography and branding are protected. Native financial/identity policy remains governed by the current PRD.

### Inventory and source method

A fresh Bun import scan parsed658 JavaScript/TypeScript modules without parse failures, using the complete tracked-file list rather than a visible-only directory search. Root also checked runtime registrations, hidden GitHub workflows, package commands and operator usages. Zero static imports is a candidate signal only: discovered Bun/Playwright suites, type-only imports, dynamic native runners and deliberate operator CLIs remain live. `github-pagination.ts` is type-only. `configure-staging-secrets.mjs` is called by the hidden deploy workflow. `test-payout-browser.mjs` is called by escrow CI. Rendered-social-image and historical quality collection commands remain deliberate standalone tools.

The machine-readable file/size inventory is `/tmp/slop-third-inventory.json`; the import evidence is `/tmp/slop-third-import-scan.json`. File sizes are not defects: large schema, money, history and boundary modules are not split merely to reduce a line-count metric.

### RR01 — remove the obsolete wallet-issue migration CLI

`scripts/migrate-wallet-claim-issues.mjs` is282 lines, has no tracked consumer, and contains a deliberately unimplemented `operatorToken` which always throws. Its default `--execute` path cannot run; the remaining migration/receipt/issue-closing implementation is reachable only through injected test options, with no production caller. It also points users to the old `/wallet` location. `backend/trace/README.md` explicitly says the separate issuer is unimplemented and legacy migration is unavailable.

Read-only reproduction: importing the script and calling `main(["--execute"], {claims: [], fetch: observedFetch})` throws the unimplemented-issuer error before any fetch. Observed fetch count0. No credentials, GitHub calls, issue changes or registry mutations were used.

Delete this orphan command; do not implement a new issuer, delete historical claims, or remove current operator wallet recovery. Existing historical wallet validation and the trace/operator API are separate consumers and remain. The removal needs a reference check and normal compilation, not a new unit test. PRD sections2,3,9 and11.


Independent follow-up confirms the same CLI is the exclusive external caller of the obsolete Markdown wallet marker parser in `src/lib/wallets.ts`. Remove `PublishedWallet`, `withoutFencedCode`, `parsePublishedWallets` and `parsePublishedWallet` together (about94 additional lines); keep current address validation, wallet-family helpers and historical schema/receipt support. The complete disposition and proof appear in the wallet appendix.

### RR02 — repair the live payout browser driver, preserving its unique payment proof

`scripts/test-payout-browser.mjs` is not dead: `.github/workflows/escrow-tests.yml` includes it in paths and executes it. It still expects `Your payouts`, four separate network connect buttons, and `Manage payout wallets`, while the current account UI groups EVM networks. Those selectors no longer describe the supported path. Its companion `backend/payments/evm.integration.ts --serve` mode is used only here, but provides a unique real browser signing→challenge/authorization→attester binding/payment→finalized98/2 receipt workflow and separate Base/Robinhood lineage. The ordinary vault-action suite exercises owner funding, not this same contributor path.

Update the driver to the current account and EVM-group flow, preserving actual signing, SQL, on-chain payment and independent lineage assertions. Prefer existing shared fixture/runner behavior when it reduces code, but do not delete this proof or its server mode just because a static import scan cannot see a CI command. The test audit describes the precise runner cleanup and acceptance. PRD sections3,6,7 and11.

### Homepage preservation

The audit saved hashes and exact source for14 homepage/shared rendering regions plus three brand files in `/tmp/slop-third-home-baseline.json`. These cover Header, Footer, HeroHeading, HomePage, project cards/rows, community, the global leaderboard, generic agent prompt/installer rendering and associated helpers. Global brand tokens and Logo are protected. Non-home improvements must use feature classes or scoped component rules; no blanket heading/body/color change may alter the homepage.

Before/after homepage screenshots use the same frozen data, viewport, font readiness and reduced-motion state. Compare both rendering and the protected source regions. A necessary import edit or moving a non-home funding function is not permission to rewrite home behavior.

### Visual criteria for every non-home page

1. Lead with the result/state and next useful action, not an explanation of the implementation.
2. Use a consistent page header and short title. Keep one accessible h1; make section hierarchy quieter than the primary action/data.
3. Give status, network and quantitative data distinct treatments. Use existing chain marks with visible network/testnet identity and accessible full names; never make color the only signal.
4. Reserve bright white for primary information. Secondary descriptions use readable muted text; chosen colors still meet WCAG AA.
5. Use shared cards, chips, action rows and disclosures where behavior is genuinely the same. Avoid a universal configurable component that merely relocates complexity.
6. Put advanced addresses, protocol metadata, long explanations and rare account actions behind keyboard-accessible disclosures. Required consent, gross/fee/net, recipients, restrictions and uncertainty remain visible before the relevant action.
7. Show available/reserved amounts clearly. Do not headline a pledge as funded, sum unlike assets, fabricate a progress ratio, or turn missing data into zero. A decorative network icon is not financial evidence.
8. Prefer automatic safe reads and reconciliation over needless refresh steps; retain explicit consent/signing and useful retry actions on failure. No polling of chain/GitHub per page view.
9. Keep loading, empty, stale, denied, invalid and failed states visually and semantically distinct.
10. Verify320px mobile, desktop, keyboard, reduced motion,200% text and contrast; preserve download/URL behavior and first-party failure visibility.
11. Measure initial visible text and actions where a simplification is claimed; do not label a relocation or new illustration as a code-size saving.
12. Review every route and meaningful owner/member/security state from actual screenshots, not JSX alone. Fixture failures are not product defects.

### Existing work to reuse

PR1454 already implements visual vault cards, Base branding, shared missing-wallet presentation and automatic cached refresh. The coordinator's corrected head958071ab fixes the independently observed empty-success→failed-refresh hidden-error case and merged as ec6e725e. Adopt that reviewed implementation rather than create a competing version; visual review may select further improvements after seeing it.

PR1455 moves monthly controls into Funding and removes operator trace-read routes. These are not inferred from this generic refactor: the coordinator supplied direct owner approval for trace-read removal in PR1455 comment6436246143 and is aligning the canonical PRD. Preserve its upload/retained-record and actual owner-payment behavior. Coordinate any overlapping UI work after that merge.

### Review decisions that prevent false cleanup

- Keep the native proof/finality/identity checks and public compatibility encodings. Removing repeated validation at distinct trust boundaries is not simplification.
- Keep metadata and historical records needed to verify amounts or provenance; shorten their default presentation instead.
- Keep real error states. TB01/TB02 document actual false-conflict/false-expiry defects; arbitrary catch deletion elsewhere is not justified.
- Keep live standalone scripts after checking hidden workflows. The initial visible-only text search missed escrow CI; the corrected tracked/hidden search prevents an incorrect dead-script deletion.
- Preserve and improve complete integration workflows. Remove literal-only/helper-only fragments and duplicate setups only where the actual boundary remains exercised.

---

## Visual, UI and UX review

## Third-pass frontend visual and flow audit

Status: audit only; no application or test source edits. Baseline: `3e355a33decd513e40d73147425676c2f9648765`, branch `codex/visual-simplification-review`. Read the current repository instructions, contribution rules, and canonical PRD. The user's explicit visual request authorizes this review; it does not authorize changing financial, identity, consent, security, or publication policy.

### Evidence and boundaries

- Baseline source was clean before capture. Isolated fixture: `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-bC6cgW`, fixture commit `e08586e8142f`. Built with the existing `prepareE2eFixture` helper, including its frozen registry/history overlay. These are reproducible representative product states, not claims about the current production inventory, balances, or live service readiness.
- Preview: `http://127.0.0.1:4866`. Setup log: `/tmp/slop-third-setup.log`. The preview server belongs to this audit; no production settings or services were changed.
- Evidence root: `/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass`. `before/` contains full-page and viewport PNGs at 1440px desktop and **320px mobile**. `index.html` and `sheets/` are browsing aids, not replacements for the original screenshots. Capture JSON records headings, rendered copy, buttons, links, request paths, overflow, and errors.
- The first public pass covers 46 route instances per width: the home baseline, all fixed route families, 11 frozen project details and their 11 funding routes, and all four frozen cycle records. Follow-up captures cover product-origin reads and signed-in, owner, admin, private case, and deployed vault states. The home baseline is evidence only.
- A preview origin cannot perform product-origin account/direct-payment reads. Those initially captured unavailable states are not product defects. The follow-up harness serves the exact built bytes at the product origin using explicit controlled responses, as existing browser tests do. Some initial advanced fixture objects failed the strict registry validator; those rejected screenshots likewise are **not** product findings. Only corrected, actually rendered states are used below.
- No secrets, real account sessions, real private cases, signing keys, mainnet funds, or production writes are involved. Private case text, actor names, addresses, and amounts in the capture harness are synthetic. Wallet actions are inspected without signing or submitting funds.
- All public contact sheets were inspected. Full-size images were inspected for How it works, Models, Funding, Account, Owner awards, project management, private cases, intake, evidence inventory, and profile. Metrics below are observed fixture layouts, not predicted improvements.

### Hard constraint: homepage stays unchanged

The homepage, shared header/footer, campaign animation, fonts, global tokens and global component styles are out of scope for visual alteration. Root recorded the homepage/shared rendering regions and brand files in `/tmp/slop-third-home-baseline.json`. Use route-specific classes or a non-home route boundary for new styles. Do not globally restyle `h1`, `.button`, `.section`, `.shell`, `.plain-table`, `.pr-bar`, `.stat`, `.wordmark`, `.site-header` or `.site-footer`.

Use current `ChainIcon`, `Logo`, existing agent SVGs, and Lucide icons. No raster generation or new visual dependency is needed. Preserve visible and accessible network names and **Testnet** identification. Color supplements an icon/label; it must never become the only state distinction.

### Existing work to reuse rather than duplicate

Root reported active coordinator work:

1. PR 1454, `claude/vault-funding-visual`, inspected source at `e89ebf88`. It already adds vault balance tiles/meters, network marks, automatic reads and shared missing-wallet copy. Its source changes touch `EscrowFunding`, `AutomaticMonthlyPayment`, `VaultActions`, `Presentation`, `App`, and scoped funding styles. The coordinator is repairing a hidden empty-refresh error. Treat the funding findings below as acceptance/review criteria for that work, not an instruction to implement a second design.
2. PR 1455 moves monthly awards into funding and removes obsolete trace-read routes, with direct human approval reported by the coordinator and a PRD update in progress. Preserve existing links/aliases as required by that approved change. Rebase before implementation; do not independently relocate awards or remove routes from this baseline.

The `e89ebf88` source was inspected, but its final repaired visual/head acceptance is still a separate coordinator checkpoint. No initial-bundle reduction is claimed for moving funding presentation: `App` continues to use `useVaultTotals` for the project summary.

### Route and state inventory

| Route family | Meaningful states inspected or inventoried | Visual/flow decision |
|---|---|---|
| `/` | Desktop/mobile baseline; reduced motion | Frozen. No visual or behavior edit. |
| `/how-it-works` and hashes | Two role paths, Points tiers, example, payment states, collapsed FAQ | Implement V03; retain useful optional disclosures and hashes. |
| `/models` | Model declaration coverage, ranked outcomes, model details, client details, method notes | Implement V04; compact, colorful data rows without weakening uncertainty. |
| `/receipts` | Search, result count, per-run disclosure, provider/model/client, source links | Implement V05; same public records/actions, less visual repetition. PR1455 keeps this route. |
| `/sponsors` | All frozen projects, unfunded/points-only/external-prize states, fees, custody/records details | Implement V06. Preserve external-prize separation and funding facts. |
| `/cycles` | All/project/month/state filters, four historical records, empty/error variants in source | Implement V07; preserve shareable filters and exact totals. |
| `/cycles/:project/:month` | All four frozen records; under review, no awards, external prize; contributor rows and artifact details | Implement V07; historical policy remains intact. |
| `/points` | Period/project/search controls, table, exact source bounds, payout unavailable state, product-origin empty payments | Implement V08. Preserve the shared ranking component and actual data states. |
| `/contributors/:login` | Unverified login, verified contributor with activity/PR/project charts and cycle history; member/wallet read availability | Keep existing useful chart language; apply V08/V09 only. |
| `/login` | Signed-out sign-in, visibility disclosure, redirect/retry paths in source | Implement V10 selectively; preserve public-membership disclosure and return handling. |
| `/account` and anchors | Signed out, signed-in member, empty wallets, mixed confirmed EVM/Solana, connections, sessions, no restrictions, recovery/closure | Implement V10/V11; no additional confirmation layer for ordinary reads. |
| `/earnings` | Signed out, signed in with no awards; reserved/held/unfunded/paid/claim states inventoried in source | Implement V11; preserve financial labels and sign/reconcile boundaries. |
| `/inbox` | Signed out, empty, four mixed read/unread/activity notices, failed email, API failure | Implement V12. Keep acknowledgment distinct from read. |
| `/projects/:id` | Every frozen project: active, paused, points-only, unfunded monthly, external prize, hidden project | Implement V02/V09. No invented readiness, no source-manifest rewrites. |
| `/projects/:id/funding` | Every frozen project; undeployed, deployed Base test vault, stale finalized counters, owner setup and no-wallet states | Reuse PR1454/1455; V01 is its review checklist. |
| `/projects/new` | Signed out; signed-in step 1; contribution rules; rewards; incomplete review; field/consent/source inventory | Implement V13; keep all four steps and exact legal/auth controls. |
| `/projects/:id/manage` | Signed out draft; owner with ready setup panel, legacy funding enablement, rules, optional bounty | Implement V13. Preserve edits typed during save and original manifest terms. |
| `/projects/:id/awards` | Signed out; proposed allocations; finalized underfunded allocations; cutoff/retry/recovery in source | Reuse PR1455 placement; V14 improves presentation within that placement. |
| `/projects/:id/security` | No published terms, intake readiness, signed-in intake, open synthetic published bounty terms, split/scope/disclosure | Implement V15 after rebase. All private/safety/award terms stay accessible before authorization. |
| `/security` | Signed out; empty; synthetic reporter case with detail and next action; maintainer/moderator role/action inventory | Implement V15. Keep role-bound forms; no public case data. |
| `/admin` / `?project=` / legacy application link | Signed out, unauthorized member, project summaries, selected project/open editor screenshots and vetting source inventory | Implement V16. Security operations remain explicit. |
| `/vetting-evidence` with IDs | Signed out, inventory form, synthetic retained run and read-grant form | Implement V16; PR1455 keeps malware-vetting evidence. Preserve reasoned grants and no automatic body reads. |
| Unknown/hidden/legacy paths | Not-found; hidden `heir-elements-sdk`; wallet alias inventoried | Implement V17 small semantic empty-state treatment; preserve routing/redirects. |

### Findings and exact proposed changes

#### V01 — Funding has the largest hierarchy and duplication problem (high value; coordinator-owned)

Evidence: `App.tsx:1156–1276`, `EscrowFunding.tsx:81–126,185–272`, `AutomaticMonthlyPayment.tsx:253+`, `VaultActions.tsx:319+`; `funding-eliza-{1440,320}.png`, `funding-deployed-{1440,320}.png`, `funding-stale-*`, `funding-setup-*`.

The unfunded page presents a very large project-name heading, five same-weight labels, a large dashed empty box, then a second paragraph directing the owner elsewhere. At 320px the five labels become a long single column before the only action. The deployed page separates its monthly target from its actual vault totals by a large vertical gap, uses an unstyled definition list for eight figures, prints full addresses repeatedly and asks for a wallet independently in two adjacent panels. A 1440px deployed fixture is 1,739px tall before any wallet interaction; the mobile equivalent is 2,104px.

Proposed information order: project breadcrumb → compact `Funding` heading + network/Testnet → **Available / Reserved** amounts and meter → one next action → lower-priority cumulative totals → optional contract details. Unfunded state: one amber icon-and-label `Vault not set up`, explicit `0 committed`, target labeled as a target, one `Set up funding` link. Keep `Points only` separate from failed setup. External prize uses a distinct organizer card and original external link, without platform withdrawal/payment controls.

For deployed funds, present current spendable and reserved money together, then deposited/paid/withdrawn totals in a compact grid. A meter is decorative support for exact textual values; use integer arithmetic already present. Group addresses under labeled contract details with copy feedback. Keep the asset and network visible at transaction review. One missing-wallet explanation is enough, but a pending transaction must retain its own reconnect/reconciliation reason. Failed or empty refresh must visibly retain last-known/stale state, never imply zero.

Current owner path: Funding → project settings → enable setup/publish → Funding → connect → review/create. Proposed path retains every required authority and signature step, but makes the existing next action prominent and gives subsequent setup/transaction steps one readable flow. Do not auto-sign, auto-authorize ERC-20 allowance, auto-deposit, merge asset buckets, or substitute a pledged cap for funds.

Implementation disposition: consume/review PR1454 and PR1455; no competing implementation. If residual cleanup is needed, co-locate funding presentation in existing `EscrowFunding.tsx`, leaving `App` orchestration and its summary hook import. PRD §§4,6,7,9; medium financial-display risk. Check fresh/stale/empty/failed counters, fee inclusion, Testnet label, walletless recovery, and gross/net/finality before acceptance.

#### V02 — Establish a small non-home visual vocabulary (high value, low behavior risk)

Evidence: `styles.css:140–156,860,2861–2878,3028–3037,3487+`, `design-system.css:61–67`, all route captures. Most non-home headings, intermediate labels and text are near-white; the orange primary button often supplies the only color. Independent pages vary between 32px utility headings and very large marketing headings. The home styling must remain untouched.

Use route-scoped page headers with an optional decorative Lucide icon, normal-size title, one concise lead and compact metadata row. Existing `ChainIcon` plus a visible network label should become the common network treatment. Use a small reusable labeled status pill for neutral/ready/attention/error, with icons and words. Ready is green only when evidence says ready; not funded/needs action is amber; denied/failed is red; informational metadata can use blue. Retain original text labels for screen readers and color-blind users.

A useful primitive set is `PageHeader`, `StatusBadge`, `MetricTile`/`MetricGrid`, and a scoped detail/metadata row—not a new general framework or another global design-token system. Reuse current buttons, inputs, `DataNotice`, `EmptyState`, `Pager`, `WalletConnection`, `SignInPanel` and brand assets. App-specific semantics remain at each call site. Apply styles only below a non-home route boundary or explicit page class. PRD §7 accessibility and result/next-action rule. Check home byte/style and screenshot invariance separately.

#### V03 — How it works: turn the overview into a readable diagram (medium value)

Evidence: `PublicPages.tsx:38–235`, `styles.css:324+`; `how-it-works-*`. Observed full-page height: 3,382px desktop / 5,071px mobile. The two four-step paths are eight blocks of mostly text; the allocation example, Points table and payment stages repeat the same white-heading/paragraph treatment.

Keep the two actual user paths and their order. Add compact role icons and step icons (`Search`, Git pull request, review/check, wallet), shorter one-sentence descriptions and a connecting line on desktop that becomes a vertical stepper on mobile. Show the Points bands as six concise colored rows or tiles with exact values; the current simple table is already semantically good and can be restyled without replacement. Make the allocation formula a visual three-part equation with 30% / 5,000 / 1,500 emphasized and the label `Projected` visible.

Correct the broad sentence `Only merged work earns points` to acknowledge qualifying reviews, e.g. `Accepted work and useful reviews earn Points.` Keep the minimum-merge, payout-eligible Points, no joining/X awards, exclusions, and optional-evidence rules in the existing disclosure. Do not turn separate projected/under-review/approved/excluded states into a linear claim that payment is guaranteed. The FAQ is already optional; do not add another disclosure layer. PRD §§4,5,6,7.

#### V04 — Models: reduce the 30-row wall without hiding identity (high value)

Evidence: `PublicPages.tsx:868–1100`, `styles.css:1990–2043,2597–2666`; `models-*`. Observed full height: 6,035px desktop / 6,892px mobile. A full provider/model string, two small metrics, a white bar and an almost empty Details disclosure repeat for up to 30 models. Exact identity matters; the typography makes the view difficult to compare.

Use dense outcome rows with rank, an existing applicable brand mark, model display name, exact provider/model identity in secondary text, merged count, accepted reviews and declared share. Color the comparative bar orange (or a controlled brand accent) and keep its exact number beside it. Align all numeric values; reduce row padding. On wide screens, identity and metrics can share a line; on mobile, two lines are enough. Do not add a new pagination step solely to reduce height; the existing 30-row limit remains usable after compacting.

Keep declaration coverage prominent as an amber/information badge with the exact numerator/denominator; absence of a named model must not become `0 outcomes`. Unknown models get a neutral glyph and their original identity, not an invented logo. Existing client and methodology disclosures stay available. PRD §§4,7; no scoring calculation changes.

#### V05 — Receipts: preserve useful search/disclosure, improve visual scanning (medium)

Evidence: `PublicPages.tsx:701–865`, `styles.css:2477–2595`; `receipts-*`. The search and one-disclosure-per-run organization are good. The entry summaries are nearly all white text, repeated provider/model strings and dates; a run type or verification distinction is difficult to see.

Keep search, result count, original run IDs, PR links and optional details. Use a small client/model mark, a clearly separated contributor/PR row, muted date, and compact labeled evidence badges. Do not label self-reported model/usage as provider-verified. The existing one-line notice explaining this difference is essential enough to retain, possibly shortened to `Model and usage are self-reported.` Keep public receipt checksums/downloads available. PR1455 removes contribution/private-trace read routes, not this public receipt page. Do not expand private trace reading. PRD §§4,7,9; public receipts remain in scope.

#### V06 — Sponsors: action-first project funding overview (medium/high)

Evidence: `PublicPages.tsx:524–697`; `sponsors-*`. The current table repeats `Disabled` and `Not set up` for nearly every fixture row. Long pool strings collide with the table's horizontal-scrolling mobile layout. The useful action is the project funding link; the lower page repeats explanatory fee/custody blocks.

Keep the same project inventory and one direct funding link per project. Use a compact row/card: project/avatar, **monthly target**, a labeled funding state, and `View funding` with a network icon when known. Points-only and externally paid prizes get distinct wording. Move no required fee/refund notice away from transaction review. Keep the shared $100 → $98 / $2 fee example as a compact graphic; keep custody/records explanation in existing details. No new “choose funding type” or intermediate landing route. PRD §§6,7,9.

#### V07 — Cycles: compact historical status, exact amounts intact (medium)

Evidence: `CyclePages.tsx:133–257,260–416,424–567`; `cycles-*`, all four `cycle-*` pairs. Historical detail pages stack a large title, orange amount block, four-step status strip and contributor table. Under-review text and no-funding warnings need distinct roles. The archive itself is already compact; it mainly lacks visual grouping and semantic state color.

Use a smaller period heading beside the amount, an icon-and-label historical-state chip and a compact progress strip. The orange amount tile can keep emphasis but must say `Suggested`, not available/paid. External-prize shares retain percentage units and organizer separation. Use consistent numeric alignment in contributor tables and make the existing horizontal scroll affordance visible on narrow screens. Preserve the frozen archive bytes, original historical review period, source links and downloads. Do not apply the new monthly cutoff retroactively. PRD §§6,7,9.

#### V08 — Standings: keep comparison central, move secondary coverage into detail (medium/high)

Evidence: `Points.tsx:1077–1120,1140–1430`; `points-*` plus product-origin follow-up. Current 320px layout spends a large portion of the first screen on filter labels and a multi-line exact coverage paragraph before the table. The table itself preserves separate Points and money states correctly.

Keep period/project/search visible, but place period controls on one compact row and use a short source summary (`Updated … · N repositories`) plus an existing-style `Source coverage` disclosure containing the exact bounds/counts. Exact scope remains available and must not be discarded. Place true error/stale notices outside optional details. Use selected-control color and the same numeric/identity row language as models and cycles. Preserve equal ranks, URL filters, pagination, earned-versus-historical semantics and money unavailable/zero distinction. This is one shared ranking component, not separate implementations for project/global views. PRD §7.

#### V09 — Project and profile pages: reuse what already works (medium)

Evidence: `App.tsx:894–1035,1156–1185,1277+`, `ProfilePage.tsx:136–284`, `Profiles.tsx:135–285`; all `project-*`, `profile-*`. The verified profile already has good orange activity bars, green/amber PR composition, metric cards and compact project rows. Reuse this language elsewhere. Do not replace it with a mostly decorative new dashboard.

Project pages should put project identity, concise author-maintained summary, a real readiness/funding chip and the primary safe action together. Paused projects currently repeat a text status above empty activity and payment sections; use an amber pause callout with the instruction to stop, then subordinate empty sections. Preserve the generic safe skill fallback and exact project restriction. Use existing project/steward avatars instead of inventing per-project logos. Long names should wrap without arbitrary truncation.

Profiles need only compact heading treatment and consistent historical-state badges; keep their charts and exact data. Do not fabricate a current actor for an unverified/renamed login. The unverified state keeps `Find a contributor`. PRD §§3,4,7,9.

The final 320px verified-profile capture also demonstrates a concrete readability defect: `191,560` total Points breaks between `191,56` and `0` inside the half-width metric tile. Adjust the route-scoped metric layout/font sizing or stack that tile so a number stays intact; do not truncate, round, or change its value. This can share the responsive MetricTile treatment used by funding. The desktop profile is otherwise the useful visual reference, not a redesign target.

#### V10 — Account and login: group common work, disclose closure only when requested (high value)

Evidence: `Points.tsx:765–940,970–1050,1470–1565`, `AccountAppeals.tsx:20–76`; `account-*`, `login-*`. Signed-in account is approximately 1,965px desktop / 2,286px mobile in the captured member state. The top eight-link navigation wraps on mobile. Recovery and the full closure form/consequence list are always visible; no-restrictions text and headings consume space although there is no action. The two wallet cards are a useful existing compact pattern.

Keep the one Account route and anchors. Group account identity/connections and wallet/security sections visually with small semantic icons and consistent cards. Put the current closure form inside a plainly named `Close account` disclosure, with all existing consequences and typed-login confirmation visible **before the actual submit button**. Opening `#recovery` must reveal or focus the relevant section; do not hide a deep-linked action behind an undiscoverable gate. Preserve session revocation, separate sign-out, recovery link and unpaid award retention.

Current X copy says the link will be public “when your Slop membership is public” despite the recorded all-public policy. Use `Connecting X is optional. Your X profile link will be public.` Keep OAuth optional and retain the no-points rule where it informs a choice. Login retains the explicit public-membership/X disclosure before GitHub authorization. For signed-out Account, one prominent sign-in action plus useful recovery access is sufficient; avoid repeated sign-in text in the wallet area.

Sessions already load automatically; an empty fixture is not evidence of a missing initial load. Keep refresh as recovery where useful. For no account restrictions, either omit the empty subsection/navigation link after a successful empty response or render one small neutral `No restrictions` line; do not hide errors/loading or actual appeals. PRD §§3,7,9. No consent or access-control policy change.

#### V11 — Payouts and wallets: a shared financial summary, not more prose (medium/high)

Evidence: `Earnings.tsx:55–165` plus its account/payment sections, `PayoutConsent.tsx`, `OwnerCommitment.tsx`, `ReferralClaims.tsx`. Preserve the two existing wallet-family cards, network-specific proofs, partial-success error visibility and explicit account-change confirmation. Add/standardize `ChainIcon` on payout records, compact labeled status and aligned gross/fee/net values. Pending/reconcile action is primary when a saved transaction exists; do not tempt users into duplicate signing.

For an empty payout account, one friendly empty state with a wallet link is enough; retain distinct `Unavailable` and `No awards` states. No referral announcement while activation is blocked. Do not auto-claim or auto-connect a wallet in the name of fewer clicks. PRD §§3,6,7 and §11 referral program.

#### V12 — Inbox: distinguish event/action/state and reduce duplicate sentences (medium)

Evidence: `Inbox.tsx:129–206,225–317`, `InboxEmail.tsx:135–210`; `inbox-notifications-*`, `inbox-error-*`. Four synthetic notices occupy roughly 1,472px desktop. Each has read/unread, long title, similar detail, email delivery sentence and two large actions. The email preference heading touches the last card visually.

Use an event icon (project, award, wallet/security, appeal), compact title and a muted metadata row. Keep an optional detail only when it adds information beyond the generated title; do not suppress a distinct reason. Render read/unread and email delivery as different labeled badges, not the same color/state. Separate email preferences with a contained section or disclosure; verified destination and explicit opt-in remain visible when enabling email. Keep `Mark as read` and security acknowledgment separate; opening a link must not silently acknowledge a security notice. PRD §9 notifications and §7 accessibility.

#### V13 — Setup/manage: reduce title and spacing overhead, preserve four meaningful steps (high value)

Evidence: `ProjectProposalPage.tsx:1290–1850,1930+`, `ProjectSetupStatus.tsx:190–280`; `new-project-*`, `proposal-step1..4-*`, `manage-owner-*`. Owner manage is 3,308px desktop / 3,637px mobile in the fixture. A huge `Manage project` heading plus a second huge `Setup status: Ready` appear before the first editable field. Setup repeats role prose and uses vertically stacked form geometry even on desktop.

Use a compact page header, small ready/attention setup summary with the existing four checks, and primary next action. `Ready` should not need two explanatory sentences. Keep explicit check detail and funding independence. Apply a two-column layout only to independent short fields, not long textarea/consent content. Use icons/checkmarks for the four existing steps and strong selected state; keep labels and keyboard focus.

Do not collapse Repository, Contribution rules, Rewards and Review into an opaque wizard or remove legal/IP fields based on empty fixtures. Existing optional contributor/IP details can stay disclosures. Keep automatic-closure consent unchecked by default and visible, owner session refresh before review, immutable identity, saved drafts, stale-base refusal and pending-submission controls. Existing `Enable vault setup` should be reviewed alongside PR1454/1455 rather than independently removed. PRD §§3,4,5,6,8.

#### V14 — Owner awards: replace browser-default list geometry (high value; coordinate placement)

Evidence: `OwnerAwards.tsx:239–444`; `awards-proposed-*`, `awards-final-*`. The current allocation list visibly retains bullet markers. Each row repeats a large contributor name, “Proposed”, value, “Award for …”, input and long disabled save button. Two rows plus month/status controls make the desktop fixture 1,248px and mobile 1,423px.

Within the PR1455-approved placement, use a compact month toolbar and a labeled automatic/manual status row. Turn allocations into a semantic list/table with contributor identity, proposed amount, editable amount and a short `Save` action (accessible label still identifies contributor). Place allocated/cap amounts in one aligned summary with a decorative meter. Final rows show gross, fee, net and status with `ChainIcon`/badges, preserving exact values. Keep save/finalize distinct, unsaved changes explicit, automatic cutoff, stale-sequence refusal and recovery controls. No auto-finalize or automatic saving of financial edits. PRD §§6,7.

#### V15 — Security intake/cases: improve hierarchy without hiding safety or authority (high value, medium risk)

Evidence: `SecurityBounty.tsx:175–349,608–781,2699+` and case detail/action components; `security-program-open-*`, `security-reporter-*`, `security-empty-*`. The open terms fixture is 2,527px desktop. The lead and 75/25 bar are useful, but nearly all other terms are white prose and the intake's optional severity/CVSS/CWE fields compete with summary/description. A private case currently shows its status in both selected-row and detailed-card form, plus a large empty verification form below.

Present the public program as identity/status + exact gross/net award + private report action; scope and safety remain accessible before authorization. Use a green/amber/red labeled intake-readiness badge and compact info rows. Optional classification fields may sit in an `Additional classification` disclosure; summary, safe reproduction and the authorization/privacy notice remain primary. The 75/25 split should have two contrasting accessible colors and exact values, never imply automatic payout.

Private cases should have one strong next-step/deadline region, compact receipt/award/payment chips and optional detailed history. Show only action forms the current role can use; do not weaken API enforcement or infer authority from the visible UI. A maintainer's award and a moderator's escalated decision stay separate, with reason/evidence and explicit confirmation. Keep no-public-fallback, visibility/recognition consent, disclosure embargo and private case amounts out of public totals. PRD §§8–10.

#### V16 — Admin and evidence: dense operational hierarchy, no automatic privileged reads (medium)

Evidence: `Admin.tsx:715–960`, `AdminProjectEnforcement.tsx:46–310`, `AdminVetting.tsx:47–90,285+`, `VettingEvidence.tsx:54–128,203+`; admin and evidence captures. Current cards combine large headings, long IDs, explanation and forms in a single white-text stack. The evidence inventory is 1,383px desktop for one object, before the body is read.

Use a compact project list with status/revision/next required decision. Selected project keeps clear context and back link; title/role/restriction need not be repeated in every card. Use warning icons for confirmed-malicious review and do not give ordinary ready rows equal urgency. Group evidence IDs, retention/policy and object metadata into labeled compact rows, with copy affordances for full hashes and visible readable prefixes. Full exact hashes remain available for verification.

The evidence inventory button is deliberate optional privileged work; do not auto-load a private body from URL parameters. Keep the reason field, bounded grant, hash check and hostile/private-content warning. Preserve explicit quarantine/ban/reinstate previews and two-authority rules. PR1455 keeps this malware-vetting evidence route; its separate removal of private contribution-trace reads does not remove these authorized malware-evidence grants. PRD §§2,7,8–10.

#### V17 — Empty/error states: one semantic treatment, preserve distinctions (medium)

Evidence: `Presentation.tsx:13–60,96–132,398–429`, individual route error branches. Generic large empty boxes exaggerate absence; other pages provide plain paragraphs and an unrelated large blank area. Use one non-home semantic empty/error treatment: icon + short heading + next action, compact unless it fills a truly empty primary surface. An error keeps retry, denied access keeps the correct authority action, no data keeps a truthful empty explanation, and stale data retains its last value.

Do not globally change `EmptyState`: it is also used by the homepage. Either pass a compact route-local variant or scope it under a non-home page. Do not introduce “all good” fallback text for failed reads. PRD §7.

### Implementation sequence and acceptance

1. Rebase onto the reviewed PR1454/1455 result. Record exact route and PRD disposition; preserve current links or redirects. Review the repaired empty-refresh state before adopting funding.
2. Add only minimal route-scoped primitives/styles. Freeze homepage/shared header/footer/tokens; no global typography sweep.
3. Apply public discovery/education pages and compact metadata first (V03–V09), then account/inbox/setup/private operational pages (V10–V17). Keep the strongest current profile/wallet design as the reference.
4. For every changed page, compare the matching 1440/320 before image; verify 200% text, keyboard order, focus restoration, reduced motion, and axe AA. Verify no content clipping, hidden action, or touch target regression.
5. Repeat meaningful existing flows: safe login return and cancel/retry; preserved setup/edit drafts; paused project safe skill refusal; exact Points filtering; wallet partial-success retry; owner save/finalize/cutoff; failed/stale vault refresh; security receipt/role/award/disclosure; private evidence grant. Do not add literal-only tests for new colors, labels, or icon existence.
6. Log console and first-party requests at quiescence. Explicit controlled failures must be distinguished from unexpected ones. Preserve old raw Markdown/archive/download contracts and source links unless the approved route disposition supersedes them.

No speculative count of removed components or bytes is offered. The measurable current problem is information hierarchy and page height; actual reductions should be recorded after implementation from the same scenarios. Homepage equivalence must be proved independently, not inferred from a small CSS diff.

### Keep/reject decisions

- Keep exact financial states, network/Testnet labels, gross/fee/net, fees/refund rights, current authority, finalized observations, private grants and consent. They may be grouped visually, never silently removed.
- Keep four setup steps, optional disclosures that contain genuinely secondary material, source coverage, original historical rules, deterministic failures, and current signature/reconciliation gates.
- Keep profile charts, two wallet-family cards, existing icon/brand assets, route aliases and shared data contracts.
- Reject a new dashboard route, new visual library, raster logo generation, per-project hardcoded display data, blanket text deletion, broad global restyles, new auth gates, automatic financial actions, speculative cache behavior, and duplicated funding implementation.
- A sample API response is evidence of layout only. A source merge or successful browser capture is not chain/provider/security qualification.

### Evidence completion

The screenshot catalog below is generated from the retained PNGs. Every listed route capture now has both desktop and 320px mobile images. Initial rejected fixture captures are superseded by corrected renders. Final PR1454 candidate visuals at ec6e725e were separately reviewed below. Remaining source-only transient/privileged states are explicitly listed and are not counted as completed captures.

### Corrected PR1454 candidate visual review (completed)

Candidate source: merged `ec6e725e4cdd1c4fca36f6ce188af927381a8cb0` (reviewed PR head `958071ab`). The clean attached verification checkout was reused after confirming that its only untracked path was the existing dependency symlink. The primary audit branch was not changed. Candidate fixture: `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-YV3NkP`, fixture head `98e85daa60d0`. Setup: `/tmp/slop-third-candidate-setup.log`; captures: `/tmp/slop-third-candidate-capture.log`.

Candidate screenshots and JSON are under `third-pass/candidate-1454/`. Six states were actually rendered at both 1440px and 320px: legacy/no vault, setup, deployed counters, stale counters, empty counters, and failed counters. All twelve had zero axe WCAG A/AA violations and no horizontal page overflow. The two intentional failure renders record their expected 503 console error; that is not a zero-error production claim. No transaction was signed. The candidate's separate regressions, not this screenshot pass, prove its return/focus refresh scheduling and empty-then-failed refresh transitions.

The candidate materially improves the deployed page: exact available/reserved/cumulative tiles, a balance meter, fee chips, labeled finality, network marks and a single missing-wallet message. Matched synthetic deployed state height changes from 1,739px to 1,359px desktop (380px shorter) and 2,104px to 1,944px mobile (160px shorter). Empty snapshots stay unknown (`—`), failed snapshots show an error and Retry, and stale values retain their age. **Adopt this work; do not recreate it.**

Remaining selected scope after adoption:

1. The large `ELIZA FUNDING` heading, distant monthly target and second `PROJECT VAULT` title still consume much of the first mobile screen before the available balance. Use V02's compact route header and put the target beside the financial summary, clearly labeled as a target.
2. Five equal-width desktop tiles become five full-width mobile tiles. Use a tested two-column compact lower-priority metrics grid at 320px, with available/reserved remaining dominant and long exact values wrapping. The goal is density without truncating money or adding clicks.
3. The empty-counters state devotes five full cards to dashes. One compact `Totals not ready yet` state can retain the unknown meaning until real values exist; do not display zero.
4. Full vault/token/owner addresses still take multiple mobile lines in separate panels. Group contract details once, keep full values available, and preserve exact addresses at review/signing. Do not collapse asset/network/finality or warnings needed before the deposit signature.
5. Setup recovery prose and a reload button are appropriate when needed; they should follow the primary setup action. Do not infer a connected wallet or grant authority automatically.

The candidate uses the new official Base mark rather than a new raster asset. Keep the full visible `Base Sepolia (test)` label: the mark alone does not establish chain identity.

### Explicit screenshot completion versus source-only states

Actual screenshots cover every route family, the signed-in primary Account/Payouts/Inbox/Security view, owner project editing, all four setup screens including a populated ready review, selected admin project and open admin editor, private malware-evidence inventory, proposed/final owner allocations, and multiple Base vault states. The selected admin screenshots show an intentionally unconfigured scanner; that visible operational state is real to the fixture, not proof of scanner availability. The open admin editor is rendered with its revision/clearance check visible.

Source-inventoried but **not** claimed as screenshot-complete: every individual ban/reinstatement preview; every security-maintainer/financial/moderator decision form; submitted/mined/reorg/replacement payment variants; all Solana/Ethereum/Robinhood wallet signing states; every transport-failure permutation; completed account closure; each private evidence body's contents; real external provider/GitHub delivery. These are acceptance follow-ups for the changed flows, not missing top-level route screenshots. No screenshot of a blank/error fixture counts as a successful signed-in page.

Initial rejected fixture captures were corrected for funding and bounty manifest validation, the product-origin-only account reads, setup step selection, and admin enforcement metadata. The successful replacements use the same screenshot names. All private content remains synthetic. `/profile`'s public actor sample is `lalalune`, resolved from the frozen profile directory; `shawwalters` in the first preview pass correctly demonstrates the unverified-login state, not a verified-profile assertion.

### Retained screenshot catalog

| Capture | Desktop | Mobile |
|---|---|---|
| account-member | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-member-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-member-320.png) |
| account-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-signed-out-320.png) |
| account-wallets | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-wallets-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/account-wallets-320.png) |
| admin-detail | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-detail-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-detail-320.png) |
| admin-edit | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-edit-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-edit-320.png) |
| admin-list | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-list-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-list-320.png) |
| admin-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/admin-signed-out-320.png) |
| awards-final | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-final-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-final-320.png) |
| awards-proposed | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-proposed-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-proposed-320.png) |
| awards-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/awards-signed-out-320.png) |
| cycle-asi-2026-09 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-asi-2026-09-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-asi-2026-09-320.png) |
| cycle-delta-star-2026-09 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-delta-star-2026-09-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-delta-star-2026-09-320.png) |
| cycle-eliza-2026-07 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-eliza-2026-07-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-eliza-2026-07-320.png) |
| cycle-eliza-2026-09 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-eliza-2026-09-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycle-eliza-2026-09-320.png) |
| cycles | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycles-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/cycles-320.png) |
| earnings-empty | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/earnings-empty-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/earnings-empty-320.png) |
| earnings-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/earnings-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/earnings-signed-out-320.png) |
| funding-asi | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-asi-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-asi-320.png) |
| funding-canonry | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-canonry-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-canonry-320.png) |
| funding-darling-arm64 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-darling-arm64-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-darling-arm64-320.png) |
| funding-delta-star | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-delta-star-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-delta-star-320.png) |
| funding-deployed | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-deployed-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-deployed-320.png) |
| funding-eliza | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-eliza-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-eliza-320.png) |
| funding-feed | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-feed-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-feed-320.png) |
| funding-heir-elements-sdk | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-heir-elements-sdk-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-heir-elements-sdk-320.png) |
| funding-nurosos | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-nurosos-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-nurosos-320.png) |
| funding-payzcode-ai | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-payzcode-ai-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-payzcode-ai-320.png) |
| funding-setup | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-setup-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-setup-320.png) |
| funding-slopdotcash | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-slopdotcash-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-slopdotcash-320.png) |
| funding-stale | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-stale-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-stale-320.png) |
| funding-thenetwork | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-thenetwork-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/funding-thenetwork-320.png) |
| home-baseline | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/home-baseline-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/home-baseline-320.png) |
| how-it-works | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/how-it-works-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/how-it-works-320.png) |
| inbox-error | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-error-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-error-320.png) |
| inbox-notifications | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-notifications-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-notifications-320.png) |
| inbox-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/inbox-signed-out-320.png) |
| login | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/login-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/login-320.png) |
| manage-owner | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/manage-owner-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/manage-owner-320.png) |
| manage-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/manage-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/manage-signed-out-320.png) |
| models | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/models-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/models-320.png) |
| new-project-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/new-project-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/new-project-signed-out-320.png) |
| not-found | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/not-found-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/not-found-320.png) |
| points | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/points-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/points-320.png) |
| profile | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/profile-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/profile-320.png) |
| profile-verified | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/profile-verified-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/profile-verified-320.png) |
| project-asi | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-asi-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-asi-320.png) |
| project-canonry | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-canonry-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-canonry-320.png) |
| project-darling-arm64 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-darling-arm64-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-darling-arm64-320.png) |
| project-delta-star | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-delta-star-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-delta-star-320.png) |
| project-eliza | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-eliza-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-eliza-320.png) |
| project-feed | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-feed-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-feed-320.png) |
| project-heir-elements-sdk | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-heir-elements-sdk-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-heir-elements-sdk-320.png) |
| project-nurosos | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-nurosos-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-nurosos-320.png) |
| project-payzcode-ai | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-payzcode-ai-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-payzcode-ai-320.png) |
| project-security | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-security-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-security-320.png) |
| project-slopdotcash | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-slopdotcash-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-slopdotcash-320.png) |
| project-thenetwork | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-thenetwork-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/project-thenetwork-320.png) |
| proposal-review-ready | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-review-ready-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-review-ready-320.png) |
| proposal-step1 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step1-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step1-320.png) |
| proposal-step2 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step2-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step2-320.png) |
| proposal-step3 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step3-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step3-320.png) |
| proposal-step4 | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step4-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/proposal-step4-320.png) |
| receipts | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/receipts-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/receipts-320.png) |
| security-empty | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-empty-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-empty-320.png) |
| security-program-open | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-program-open-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-program-open-320.png) |
| security-reporter | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-reporter-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-reporter-320.png) |
| security-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/security-signed-out-320.png) |
| sponsors | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/sponsors-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/sponsors-320.png) |
| vetting-inventory | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/vetting-inventory-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/vetting-inventory-320.png) |
| vetting-signed-out | [1440px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/vetting-signed-out-1440.png) | [320px](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before/vetting-signed-out-320.png) |

---

## Backend, Worker and contract-boundary review

## Third backend, Worker and contract-adapter simplification audit

Baseline: `3e355a33decd513e40d73147425676c2f9648765`, branch `codex/visual-simplification-review`, 27 October 2026. Workspace: `/Users/shawwalters/.codex/worktrees/codebase-simplification/slopdotcash`.

This is a report-first audit. No repository source, tests, native programs, configuration or public state were changed. No credentials, provider calls, deployed networks, payments or deployments were used. Read the current AGENTS/CONTRIBUTING and PRD, and compared the previous review reports so solved SB01–03, first-pass scheduler/test/HTTP consolidation, and residual test deletion are not proposed again. The current PRD supersedes older prose: in particular immediate referral claims are approved; the historical value import/publication hold, unavailable objective-verifier closure, fixed scanner-evidence access policy, and explicit private-trace/financial boundaries remain intact.

### Outcome

Two new reproducible error-classification defects are selected, both with narrow fixes and no authority/state changes. One truly unused type alias is removable alongside them. No native contract modification, broad service merge, signing simplification, new product gate, or database migration is justified by this pass. The live custom payout browser workflow is separately owned by the root/test auditors: its UI is stale, but its real contributor registration → signing → finalized payout coverage is not redundant with the owner vault-action tests.

#### TB01 — operational monthly write failure is reported as someone else's concurrent edit (P2)

**Evidence.** `backend/payments/monthly.ts:1023–1047` and `1059–1083` catch every exception from allocation/settings INSERT and manufacture `MonthlyPaymentError(409, allocations_changed/setting_changed)`. `backend/payments/handler.ts:606–614` forwards that classified error directly to the browser. Genuine transport/storage errors therefore skip the existing generic `503 payments_unavailable` boundary at lines 1144–1146. The same INSERTs already use write-time ban predicates and immutable sequence constraints, which must stay.

**Reproduction executed against actual migrated SQL and handlers.** `/tmp/slop-third-monthly-readonly.ts` creates the existing monthly fixture with all migrations, seeds a real points session, enables `PRAGMA query_only = ON`, then calls both authenticated HTTP routes. The direct SQLite message is `attempt to write a readonly database`; POST `projects/eliza/monthly-settings` returns 409 `setting_changed`; POST `projects/eliza/monthly/2026-11/allocations` returns 409 `allocations_changed`. Both durable table counts remain 0. Full small output: `/tmp/slop-third-monthly-readonly.log`. This is a real storage fault, not a mocked rejected function. Controlled authority is the existing fixture, and no provider is contacted.

**User effect.** The owner is told allocations or settings changed concurrently when storage is unavailable. Repeated reload/save actions cannot fix this and the backend failure is masked as an ordinary conflict. This is failure misreporting, not a demonstrated unauthorized payment or lost record.

**Implementation.** Narrow only these two catch blocks. Translate the expected sequence uniqueness refusal, and the allocation's known `monthly allocations frozen` trigger refusal, to their current 409. Rethrow other failures so the established payment API error boundary emits 503 and its redacted diagnostic. Reuse `backend/d1.ts:isConstraintFailure` where its actual message contract applies; do not broaden that global helper to match arbitrary business prose. The frozen trigger text is not assumed to include `constraint failed`: prove the actual driver text while exercising the real trigger. Preserve `changed !== 1` and its recheck of participation bans, all authority checks, finality, integer amount and immutable revision behavior.

**Acceptance / verification plan.** Extend an existing meaningful monthly HTTP/D1 scenario instead of adding a helper unit file. Prove the two actual query-only write failures yield 503, preserve every preexisting setting/allocation row byte-for-byte and create no obligation. Retain sequence-race 409, freeze-race 409 and banned-actor 403 under real migrations. Run the retained monthly integration file and appropriate type/lint checks once after the change. No chain call is needed for a storage-classification change. PRD §§2,6,7 (owner controls, distinct error states and immutable financial records).

#### TB02 — identity-service storage failure becomes an expired login (P2)

**Evidence.** `backend/identity-assertion.ts:32` returns `expired` for every non-2xx response, including service 500/503. `backend/points/handler.ts:166–172` maps it to 401 `identity_expired`. The identity Worker itself distinguishes actual invalid/used/expired assertions (`workers/identity/handler.ts:422–437`, 401) from internal storage errors (core catch returns 500). The helper collapses that distinction.

**Reproduction executed through both real handlers.** `/tmp/slop-third-identity-unavailable.ts` creates two independently migrated SQLite databases, enables query-only on the identity store, and connects the actual `handleIdentityRequest` + `D1IdentityPersistence` to actual `handlePointsApi` through its service dependency. The identity UPDATE/RETURNING cannot write, the Worker emits 500, and the site emits 401 `identity_expired`. There are 0 membership and 0 session rows. `/tmp/slop-third-identity-unavailable.log` records only redacted status/counters, no secret or assertion bytes. No OAuth/provider call is used; this directly demonstrates the internal storage boundary.

**User effect.** A service failure is attributed to the user's login/assertion. No credential bypass occurs; the incorrect classification obscures diagnosis and directs unnecessary sign-in actions.

**Implementation.** Preserve the existing terminal result for the actual 401 assertion refusal. Treat upstream 5xx and unexpected non-success responses as a generic service failure, without logging the assertion or upstream response body. Let `handlePointsApi`'s existing 503 `points_unavailable` boundary report it. Do not retry the one-time assertion, relax its audience/node-ID validation, extend its lifetime, or synthesize identity from cached data. The helper comment must describe its exact classified responses rather than every HTTP refusal.

**Acceptance / verification plan.** Extend the retained real identity/points workflow rather than create parser or status-table unit cases: actual identity-store write failure → Worker 500 → Points 503, no identity publication or session. Actual absent/expired/wrong-audience/reused assertion must remain 401; successful consume still creates exactly one session and follows closed-account/reopen policy. Run affected retained identity + points integration files. PRD §§2,3,7: permanent authenticated identities and distinct error/unavailable states.

#### TB03 — one unused scanner policy type alias (P3, optional same-patch deletion)

`backend/vetting/evidence.ts:89` exports `type EvidencePolicy = typeof EVIDENCE_POLICY`, but the identifier occurs nowhere else in tracked source, tests, configuration, scripts or docs, and is not used internally. It survived the approved fixed-in-source policy change. Remove that line only; keep `EVIDENCE_POLICY`, the exact operator IDs, caps, retention, grant times and authorization logic unchanged. This produces no runtime benefit and does not merit a standalone PR or test. Typecheck is sufficient. PRD §9 recorded Scanner evidence policy decision.

### Structure, gates, error paths and automation decisions

| Subsystem/candidate | Evidence and decision | Required acceptance boundary |
| --- | --- | --- |
| Shared HTTP/D1/identity/encoding utility layer | `backend/http.ts`, `backend/d1.ts`, `backend/identity-assertion.ts`; crypto already re-exports the one async SHA-256 implementation from `src/lib/async-sha256.mjs`. Keep the existing layers; TB01/02 fix actual classifications in place. | No second hash implementation, no unsafe identity defaults. |
| Project authority/setup/repository access | `backend/projects/setup.ts`, `repository-access.ts`, `github-lookup.ts`, `handler.ts`, `enforcement.ts`; current setup reports authority, installation, scan and funding separately and auto-activates only after the approved conditions. GitHub read fallback is limited to public facts; authority still depends on permanent repository/actor IDs. Keep. | PRD §§2,4,8. Do not merge retry with denied or remove consent. |
| Project cache | `edge-cache.ts`: public 200 responses only, generation-keyed invalidation, cache failure falls through to D1; write/delete cache failures are optional acceleration failures. Keep these catches. | Unavailable source data is not an invented successful empty registry. |
| Backend domain json wrappers | Trace adds contract headers/no-store; private security adds noindex/private cache headers; project adds its own API contract header; points supplies a session cookie. They delegate to common HTTP. Replacing all with one argument-heavy helper makes distinct privacy policies easier to confuse. Keep. | PRD §§3,8,9. |
| Large handlers | `projects/handler.ts`, `security/handler.ts`, `trace/handler.ts` are substantial, but separate route families already share validation/persistence/services. File size alone does not justify a mechanical split or premature class layer. No demonstrated defect or behavior reduction supports one now. | A future extraction needs a coherent responsibility and measurable review/build benefit, while retaining route and permission behavior. |
| Public/private payments | `security/payment-database.ts` is a 15-line explicit SQL-table mapping; `security/payments.ts` and `workers/security-payments/index.ts` reuse the engine under separate ledgers/signers. Keep. | Private awards never leak through ordinary account balances; signer scopes cannot merge. |
| Monthly owner, attester and executor flows | Proposal, owner changes, freeze, authorization, admission, execution, finality remain separate proofs; one is not redundant because another completed. TB01 addresses error classification only. | PRD §6; keep consent, whole-month coverage, exact amounts, newest reservation ordering, no duplicate payment. |
| Payment scheduler and bounded snapshot reads | `workers/payments/index.ts:600–677`; `backend/payments/vault-snapshots.ts:158–195`. The snapshot barrier precedes ledger scans; payout steps remain in dependency order. Four independent vault reads already run concurrently and aggregate errors in input order. Keep. | Monotonic counters, correct decimals before ledger admission, retained uncertain attempts. No new concurrency over shared financial writes. |
| Attester schedule | `workers/payment-executor/index.ts:805–823` invokes scoped monthly then binding steps inside per-step try blocks and retains failures. Synchronous throws are caught; private/public scopes preserve separate deployment/key boundaries. Keep. | A monthly failure cannot suppress binding reconciliation; no Promise.all over nonce-bearing signer work. |
| Fee converter | Exact token/native caps, same-wallet outputs, reviewed route/account validation, retained uncertain reservations, per-network modes and Robinhood retention are not redundant gates. `index.ts` continues other networks while retaining failed outcomes. Keep. | PRD §6; do not merge all send/reconcile states or free missing-receipt reservations. |
| Referral cache after immediate-claim change | `backend/referrals/cache.ts` accepts deployed delay 0 or legacy 604800, checks event receipt/block canonicality, journal/root/cumulative totals, final block and monotonic cache updates; failed refresh retains prior data with error timestamp. Keep both versions while old deployed evidence can be read. | PRD §11. No claim/refund/finality change. |
| Referral read latency | Per-event receipt then block reads at `cache.ts:198–202` are independent and could overlap. Not selected: no measured active workload or bottleneck, changing concurrency solely from static pattern is not a demonstrated simplification. No per-block cache or new map framework. | If later selected, measure identical event set before/after and retain sequential event application/canonical reread. |
| Slopbot RPC entrypoints | `reporting-readiness-service.ts`, `value-import-service.ts`, `entrypoint.ts`, `repository-access-entrypoint.ts` are small, but distinguish named Workers bindings and read/import authority. Folding them into the large Worker couples deployment/authority without removing logic. Keep. | PRD §§4,5,8. |
| Slopbot value subsystem | All value-* source paths were indexed for exports/callers, error outcomes and journal/publication layers. Evidence acquisition, retained copy/reference, work-unit journal, review, publication and consumption are different proof stages. Historical publication hold remains. No credible orphan module found; no graph flattening from filename count alone. | No duplicated credit, no skipped source verification, no inference output promoted to acceptance proof. |
| Vetting and retained evidence | Scanner acquisition, isolated inspection, publication journal, backup/restore and read-grant modules represent durable/failure boundaries. `.catch(() => false)` during retention feeds explicit incomplete/retry outcomes; it never marks clean without complete retained evidence. Keep. | PRD §§8,9; scanners cannot access signing/service credentials, source policy stays fixed. |
| Native contracts and adapters | Read current native state/authority/token boundaries and the immediate-claim contract diff; checked Solana PDA and token adapters remain canonical after SB03. No new justified native change. Preserve contract tests. | Native requalification is required for economic/ABI/role changes; this audit authorizes none. |
| Infrastructure pins | `contracts/evm/factories.ts`, `contracts/solana/programs.ts` are reviewed public network deployments, not an alternative D1 project registry. Keep. | Project vaults/revisions remain in D1; static reviewed code pins are independent evidence. |
| Custom payout browser driver | `scripts/test-payout-browser.mjs` is invoked by `.github/workflows/escrow-tests.yml:200`, not dead. `backend/payments/evm.integration.ts --serve` is its only fixture consumer and includes real signed personal-message authorization, binding/payment, finalized receipt/index, 98/2 split, separate Base/Robinhood lineage. `vault-actions.spec.ts` uses API pre-registration in its real owner tests, so not equivalent coverage. | Fix stale UI via root/test work. Keep real contributor signing and paid reconciliation before removing/migrating fixture. |

### Export and file liveness audit

The static identifier pass read all tracked textual consumers and found 172 exported names without an occurrence outside their declaring file. This is not 172 dead implementations: almost all are interfaces/types used internally, exported internal helpers still invoked by their own module, or native/workflow harness surfaces. Removing their `export` keyword is superficial and does not remove runtime code; it is not selected as a broad cleanup. The one alias with no internal use is TB03. Candidate details are saved in `/tmp/slop-third-backend-export-candidates.json`.

A relative-import + literal-path graph produced 27 candidate modules without static incoming imports (`/tmp/slop-third-backend-module-candidates.json`). Follow-up checking resolves them as executable package/workflow/CLI entrypoints, Wrangler main files, ambient type declarations, or subprocess scripts. Examples missed by a TS-only import graph: Solana `program-genesis.mjs` and `token-2022-preload.mjs` are called by `scripts/test-e2e.sh`; `failure-evidence.mjs` is called by `run-test-stage.sh`; signer `assert-fresh-test-stack.mjs` is emitted by `configure.mjs`; Worker `entrypoint.ts` files are selected by Wrangler `main`. Do not delete them based on static import absence. There is no proven whole dead production module in this scoped pass.

### Evidence and scope limits

- 439 tracked paths under backend/workers/contracts/functions were inventoried. Current categories: 238 TS/JS runtime or CLI source, 73 test/workflow drivers, 44 native source/test paths, 32 guides, 52 configuration/lock/fixture/other paths.
- Every tracked path is listed below with inspection depth. Every supported TS/JS source was included in import/export and catch/default/control-pattern scans. This is a complete file/candidate inventory, **not** a claim that every line of all native/vendor/test code has been manually proved correct.
- `D` means a focused current source-body/contract read (including relevant surrounding error/authority/state paths); large files were read in relevant ranges, not represented as complete formal line review. `S` means automated full-text/structure/caller scan with selected search context. `T` test/qualification artifact inventoried; detailed test deletion assessment belongs to the test auditor. `N` native source/test preserved and contract/ABI boundaries inspected; no heavy native execution was run. `C` configuration/docs/fixture surface inventoried for callers and policy, retained.
- Two small actual-DB reproductions were executed (~0.2s each). No full tests, E2E, builds, provider qualification or chain simulation were run during report-first work. Those remain implementation validation, not implied green checks.
- No visual/text/logo proposal is made here; frontend auditor owns rendered UI evidence. No on-chain economic/security-policy decision is inferred from a preference to reduce code.

### Complete tracked-file inspection ledger

#### backend (5 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/d1.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/github.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/http.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/identity-assertion.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/pages.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/fee-conversions (2 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/fee-conversions/handler.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/fee-conversions/handler.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/notifications (6 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/notifications/email.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/notifications/email.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/notifications/events.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/notifications/exception-events.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/notifications/handler.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/notifications/notifications.test.ts` | T — retained/inventoried; test auditor owns consolidation |

#### backend/payments (19 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/payments/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/payments/chain-awards.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/dispatch.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/evm-adapter.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/evm.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/payments/handler.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/ledger.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/migration-0021.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/payments/migrations.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/payments/monthly-attestation.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/monthly-publication.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/monthly-reserve-release.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/monthly.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/payments/monthly.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/possession.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/solana-funding.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/vault-snapshots.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/payments/vault-snapshots.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/payments/wallet-registration.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/points (4 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/points/handler.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/points/publication.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/points/x.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/points/x.ts` | S — caller/error/structure scan; retain |

#### backend/projects (14 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/projects/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/projects/account-bans.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/cloudflare-persistence.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/projects/cloudflare-persistence.ts` | S — caller/error/structure scan; retain |
| `backend/projects/contracts.ts` | S — caller/error/structure scan; retain |
| `backend/projects/edge-cache.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/enforcement.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/github-lookup.ts` | S — caller/error/structure scan; retain |
| `backend/projects/handler.ts` | S — caller/error/structure scan; retain |
| `backend/projects/repository-access.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/setup.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/skill-publication.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/token-metadata.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/projects/vault-setup.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/referrals (4 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/referrals/cache.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/referrals/claims.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/referrals/claims.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/referrals/handler.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/security (17 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/security/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/security/advisories.ts` | S — caller/error/structure scan; retain |
| `backend/security/analysis.ts` | S — caller/error/structure scan; retain |
| `backend/security/github-advisories.ts` | S — caller/error/structure scan; retain |
| `backend/security/handler.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/security/handler.ts` | S — caller/error/structure scan; retain |
| `backend/security/intake-grant.ts` | S — caller/error/structure scan; retain |
| `backend/security/payment-database.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/security/payments.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/security/payments.ts` | S — caller/error/structure scan; retain |
| `backend/security/program-funds.ts` | S — caller/error/structure scan; retain |
| `backend/security/project-access.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/security/report-analysis.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/security/reporting-readiness.ts` | S — caller/error/structure scan; retain |
| `backend/security/reporting-readiness.workflow.mjs` | T — retained/inventoried; test auditor owns consolidation |
| `backend/security/submissions.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `backend/security/submissions.ts` | S — caller/error/structure scan; retain |

#### backend/slopbot (2 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/slopbot/summary.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/slopbot/value-import.ts` | D — retained; TB01/02/03 only where identified above |

#### backend/trace (8 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/trace/PRIVATE_INTAKE_RECOVERY.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/trace/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/trace/auth.ts` | S — caller/error/structure scan; retain |
| `backend/trace/cloudflare-persistence.ts` | S — caller/error/structure scan; retain |
| `backend/trace/contracts.ts` | S — caller/error/structure scan; retain |
| `backend/trace/handler.ts` | S — caller/error/structure scan; retain |
| `backend/trace/validation.ts` | S — caller/error/structure scan; retain |
| `backend/trace/workflow.mjs` | S — caller/error/structure scan; retain |

#### backend/vetting (11 files)

| Path | Depth / disposition |
| --- | --- |
| `backend/vetting/EVIDENCE.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/vetting/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `backend/vetting/evidence-chunks.ts` | S — caller/error/structure scan; retain |
| `backend/vetting/evidence.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/vetting/flagger-standing.ts` | S — caller/error/structure scan; retain |
| `backend/vetting/flags.ts` | S — caller/error/structure scan; retain |
| `backend/vetting/handler.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/vetting/live-pin.ts` | S — caller/error/structure scan; retain |
| `backend/vetting/persistence.ts` | D — retained; TB01/02/03 only where identified above |
| `backend/vetting/result.ts` | S — caller/error/structure scan; retain |
| `backend/vetting/scan-result.ts` | S — caller/error/structure scan; retain |

#### contracts (2 files)

| Path | Depth / disposition |
| --- | --- |
| `contracts/DEPLOY-MAINNET.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/vault-totals.ts` | S — caller/error/structure scan; retain |

#### contracts/evm (55 files)

| Path | Depth / disposition |
| --- | --- |
| `contracts/evm/.gitignore` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/evm/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/evm/adapter.integration.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/adapter.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/evm/factories.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/evm/foundry.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/evm/integration/MockReferralToken.sol` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/integration/TestDollar.sol` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/integration/mainnet-upgrade-rehearsal.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/integration/upgrade.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/monthly-reserve.integration.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/monthly-reserve.ts` | S — caller/error/structure scan; retain |
| `contracts/evm/script/DeployBase.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployBaseSepolia.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployEscrowFactory.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployEthereum.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployEthereumSepolia.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployReferralDistributorRobinhoodTestnet.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployRobinhood.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployRobinhoodTestnet.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/script/DeployUpgradeImplementations.s.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/scripts.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/evm/src/ProjectEscrow.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/src/ReferralDistributor.sol` | D — retained; TB01/02/03 only where identified above |
| `contracts/evm/test/AnyToken.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/BindingLifecycle.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/BoundedAttester.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/DeployFactory.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/FableEscrow.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/FeeConverterFixture.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/MonthlyCommitment.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/MonthlyReserveV2.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/MonthlyTree.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/OpusBase.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/OpusFindings.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/OpusInvariant.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/OpusTokens.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/ReferralDistributor.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/SonnetParity.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/UpgradeLifecycle.t.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/test/WideToken.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/LICENSE` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/evm/vendor/openzeppelin/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/evm/vendor/openzeppelin/contracts/interfaces/IERC1967.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/interfaces/draft-IERC1822.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/Proxy.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/beacon/IBeacon.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/utils/Initializable.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/utils/Address.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/utils/Errors.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/utils/LowLevelCall.sol` | N — preserve native program/test and authority rules |
| `contracts/evm/vendor/openzeppelin/contracts/utils/StorageSlot.sol` | N — preserve native program/test and authority rules |

#### contracts/solana (54 files)

| Path | Depth / disposition |
| --- | --- |
| `contracts/solana/.gitignore` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/Anchor.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/Cargo.lock` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/Cargo.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/adapter.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/adapter.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/solana/commitment.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/funding.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/idl/slop_escrow.json` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/integration/confirmation.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/deployment.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/escrow.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/executor.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/keeper.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/legacy-project.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/monthly-preload.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/owner-instructions.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/owner-plan.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/production-delay.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/program-genesis.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/token-2022-preload.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/integration/token-2022.e2e.mjs` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/monthly-commitment.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/monthly-commitment.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/monthly-reserve.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/owner-creation.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/owner-instructions.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/package-lock.json` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/package.json` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/programs.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/solana/programs/slop-escrow/Cargo.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/programs/slop-escrow/src/lib.rs` | N — preserve native program/test and authority rules |
| `contracts/solana/programs/slop-escrow/src/token_policy.rs` | N — preserve native program/test and authority rules |
| `contracts/solana/scripts/acceptance-extended.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/acceptance.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/bootstrap-linux.sh` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/scripts/build-local.sh` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/scripts/config-plan.mjs` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/deploy-testnet.sh` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/scripts/failure-evidence.mjs` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/owner-plan.mjs` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/prepare-test-program.mjs` | S — caller/error/structure scan; retain |
| `contracts/solana/scripts/run-test-stage.sh` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/scripts/test-e2e.sh` | C — configuration/guide/fixture caller and policy inventory; retain |
| `contracts/solana/test-program.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/token-extensions.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/token-extensions.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/solana/token.test.ts` | T — retain contract acceptance/integration coverage; no deletion selected |
| `contracts/solana/token.ts` | S — caller/error/structure scan; retain |
| `contracts/solana/transactions.ts` | D — retained; TB01/02/03 only where identified above |
| `contracts/solana/wallet-transactions.ts` | S — caller/error/structure scan; retain |

#### functions (2 files)

| Path | Depth / disposition |
| --- | --- |
| `functions/[[path]].ts` | D — retained; TB01/02/03 only where identified above |
| `functions/index.ts` | D — retained; TB01/02/03 only where identified above |

#### functions/api (1 files)

| Path | Depth / disposition |
| --- | --- |
| `functions/api/v1/[[path]].ts` | D — retained; TB01/02/03 only where identified above |

#### workers/fee-converter (23 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/fee-converter/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/fee-converter/config.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/core.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/dry-run.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/evm.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/fee-converter.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/fee-converter/fork.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/fee-converter/index.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/fee-converter/jupiter-route-schema.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/jupiter-route.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/jupiter-wire.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/native-gas.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/fee-converter/native-gas.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/solana-accounts.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/solana-expiry.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/solana-local.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/fee-converter/solana-route-accounts.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/solana-route-prepare.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/fee-converter/solana-route-receipt.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/solana.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/store.ts` | S — caller/error/structure scan; retain |
| `workers/fee-converter/wrangler.staging.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/fee-converter/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/identity (11 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/identity/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/identity/configure-test.mjs` | S — caller/error/structure scan; retain |
| `workers/identity/contracts.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/identity/crypto.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/identity/handler.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/identity/index.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/identity/loopback.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/identity/persistence.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/identity/rate-limit.ts` | S — caller/error/structure scan; retain |
| `workers/identity/wrangler.staging.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/identity/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/notify (9 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/notify/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/notify/activity.ts` | S — caller/error/structure scan; retain |
| `workers/notify/cloudflare-email.d.ts` | S — caller/error/structure scan; retain |
| `workers/notify/contracts.ts` | S — caller/error/structure scan; retain |
| `workers/notify/handler.ts` | S — caller/error/structure scan; retain |
| `workers/notify/index.ts` | S — caller/error/structure scan; retain |
| `workers/notify/security.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/notify/security.ts` | S — caller/error/structure scan; retain |
| `workers/notify/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/operator-keeper (5 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/operator-keeper/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/operator-keeper/index.ts` | S — caller/error/structure scan; retain |
| `workers/operator-keeper/sql.d.ts` | S — caller/error/structure scan; retain |
| `workers/operator-keeper/storage.ts` | S — caller/error/structure scan; retain |
| `workers/operator-keeper/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/payment-executor (23 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/payment-executor/.gitignore` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payment-executor/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payment-executor/assert-fresh-test-stack.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/bind-trigger.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payment-executor/binding-cancellation.workflow.mjs` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payment-executor/binding-recovery.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/binding-recovery.workflow.mjs` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payment-executor/bootstrap-workflow.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/configure.d.mts` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payment-executor/configure.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/core.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/entrypoint.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/index.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/payment-executor/mainnet-execution.d.mts` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payment-executor/mainnet-execution.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/monthly-release.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/monthly.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/prepare-inactive.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/signer-stacks.d.mts` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payment-executor/signer-stacks.mjs` | S — caller/error/structure scan; retain |
| `workers/payment-executor/solana-monthly.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/solana.ts` | S — caller/error/structure scan; retain |
| `workers/payment-executor/wallet-rotation.test.ts` | T — retained/inventoried; test auditor owns consolidation |

#### workers/payments (9 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/payments/deployments.ts` | S — caller/error/structure scan; retain |
| `workers/payments/index.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/payments/reconcile.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payments/reconcile.ts` | S — caller/error/structure scan; retain |
| `workers/payments/recovery.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payments/registry-database.d.mts` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/payments/registry-database.mjs` | S — caller/error/structure scan; retain |
| `workers/payments/registry.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/payments/scanner.ts` | S — caller/error/structure scan; retain |

#### workers/referral-accrual (14 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/referral-accrual/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/referral-accrual/anvil.integration.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/referral-accrual/chain-logs.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/referral-accrual/config.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/core.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/dry-run.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/gas.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/index.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/referral-accrual/merkle.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/poster.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/referral-accrual/poster.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/referral-accrual.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/referral-accrual/store.ts` | S — caller/error/structure scan; retain |
| `workers/referral-accrual/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/security-payments (1 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/security-payments/index.ts` | S — caller/error/structure scan; retain |

#### workers/slopbot (74 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/slopbot/QUALITY.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/slopbot/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/slopbot/appeal-publication.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/appeal.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/appeals.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/budget-blocks.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/closure-eligibility.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/cloudflare-workers.d.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/contracts.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/entrypoint.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/slopbot/failure-alerts.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/github.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/history-registry.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/index.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/maintainer-hold.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/maintainer-holds.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/models.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/penalties.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/penalty-appeal.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/persistence.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/quality.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/registry.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/reopen-source.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/reopen-source.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/reporting-readiness-service.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/slopbot/reporting-readiness.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/repository-access-entrypoint.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/slopbot/repository-access.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/review-scope.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/review.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/routing.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/spend-alerts.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/spend-alerts.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-accepted-range.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-blob.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-branch-policy.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-budget.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-commit-hints.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-consumer.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-consumption.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-context.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-evidence.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-file-comparisons.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-group-collection.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-import-service.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/slopbot/value-import.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-indirect-retention.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-indirect.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-inference.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-journal.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-live-registry.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/value-manifest-identity.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-merge-profile.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-merge-resolution.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-patch-replay.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-patch.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-processing.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-producer.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-publication.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-requests.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-retained-copy.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-retained-reference.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-review.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-settings.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-source-leases.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-tree.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-work-unit-consumption.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-work-unit-journal.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-work-unit-publication.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-work-unit-review.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/value-work-unit.ts` | S — caller/error/structure scan; retain |
| `workers/slopbot/webhook-installation.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/slopbot/wrangler.repository-access-staging.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/slopbot/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/vetting (40 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/vetting/ACQUISITION.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/ASSEMBLY.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/DEPENDENCIES.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/EVENTS.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/PROVENANCE.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/PUBLICATION.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/QUEUE.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/SCANNERS.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/VM.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/acquire.test.ts` | T — retained/inventoried; test auditor owns consolidation |
| `workers/vetting/acquire.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/artifacts.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/artifacts_workflow_test.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/assembly-manifest.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/assembly.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/bounded-scan.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/dependencies.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/dependencies_workflow_test.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/events.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/filesystem-capture.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/filesystem_workflow_test.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/fixtures/artifact-gate.apparmor` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/fixtures/artifact_probe.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/fixtures/syscall_probe.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/guest.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/guest_ingress.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/isolated-inspection.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/provenance-report.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/provenance.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/provenance_workflow_test.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/publication-journal.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/publication.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/queue.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/run.ts` | D — retained; TB01/02/03 only where identified above |
| `workers/vetting/sandbox.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/scanners.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/service.ts` | S — caller/error/structure scan; retain |
| `workers/vetting/vm.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting/vm_workflow_test.py` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/vetting-backup (10 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/vetting-backup/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-backup/core.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/qualification-access.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/qualification-entry.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/qualification-retention.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/qualification-workflow.mjs` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/qualification.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/workflow.mjs` | S — caller/error/structure scan; retain |
| `workers/vetting-backup/wrangler.staging.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-backup/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |

#### workers/vetting-flags (4 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/vetting-flags/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-flags/build.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-flags/qualification.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-flags/workflow.ts` | S — caller/error/structure scan; retain |

#### workers/vetting-sandbox (10 files)

| Path | Depth / disposition |
| --- | --- |
| `workers/vetting-sandbox/Dockerfile` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-sandbox/README.md` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-sandbox/index.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-sandbox/merge-job.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-sandbox/merge.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-sandbox/probes.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-sandbox/supervise.py` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-sandbox/workflow.ts` | S — caller/error/structure scan; retain |
| `workers/vetting-sandbox/wrangler.staging.toml` | C — configuration/guide/fixture caller and policy inventory; retain |
| `workers/vetting-sandbox/wrangler.toml` | C — configuration/guide/fixture caller and policy inventory; retain |


---

## Test, fixture and runner review

## Third test, fixture and runner audit

Baseline: `3e355a33decd513e40d73147425676c2f9648765`, branch `codex/visual-simplification-review`. Audit only: no source edits, test/browser executions, deployments, provider calls, or PRs. Current AGENTS, CONTRIBUTING and canonical PRD were read. Prior cleanup reports are history only; previously deleted helper suites remain deleted. PRD sections 3–9 and 11 define the preserved account, project, evidence, reward, notification, isolation and delivery boundaries.

### Inventory and criteria

126 non-contract test/workflow entry files, 74,125 source lines, 676 declared test expressions/methods. `test.each`, loops and browser projects expand at runtime, so this is not a claimed executed-case total. Standalone workflow entrypoints have no Bun/Playwright declaration and are listed as complete scenario groups. The inventory includes hidden `.workflow.mjs`, `*-workflow`, Python, `test-payout-browser.mjs` and local acceptance runners, not only `.test.ts` and `.spec.ts`. Contract tests are outside deletion scope and remain untouched.

K retains an actual CLI/artifact/process/HTTP/SQL/browser/chain boundary; M retains the complete workflow but removes identified helper fragments; C consolidates duplicate complete outcomes; R removes a helper-only declaration. Loading captured bytes then calling a parser, a string/shape check, or a mocked-call count alone is a unit. A real SQL constraint/atomicity failure, signature verification, process tree, browser action, or persisted request outcome is a valid boundary even when external transport is controlled. Synthetic provider outputs qualify routing/state only; they never qualify real model behavior.

### Action table

| ID | Exact change | Retained useful outcome / acceptance |
|---|---|---|
| TT01 | Remove `tests/integration/installer.e2e.ts` declarations at1615 and1673 (through1693): generated-command host strings/options and repository literal checks only. | Existing executed file/loopback installs, repository transfer, candidate/rollback, header confinement and same-origin tamper paths remain. Run retained installer lifecycle; generator import remains used by its real command helpers. |
| TT02 | In `scripts/vetting-assembly-workflow.ts`, remove177–223: direct wrong-digest/index parser probe; `reindex`; synthetic truncated/resumed/invalid/unknown/dense byte matrices. Remove dense-only output fields231–232. | Actual retained raw trace → assembled syscall index/manifest/review byte bindings, actual observed trace inventory, and tampered/missing filesystem/VM/dependency/artifact closure remain. `indexSyscalls`/`syscallEvidence` imports still serve that actual workflow. Verify real qualified component-assembly workflow when its retained Linux evidence is available; do not claim it ran locally. |
| TT03 | Remove `workers/payment-executor/bootstrap-workflow.mjs` initial direct config-shape/literal/invalid-input checks31–53. | Preserve generated config → real Wrangler dry-run, checked-in release preflight/absence proof, and native Workerd/SQLite-DO refusing signing routes and accidental cron with zero external activity. Run existing bootstrap driver, not a replacement unit. |
| TT04 | Consolidate `backend/payments/migrations.test.ts` success case92 and duplicate transaction case170: perform the first complete migration inside BEGIN/COMMIT. Remove duplicate standalone case170 and empty-schema-only case190. Apply the same consolidation to `migration-0021.test.ts` first success98 and transaction-only181. | Preserve every row/child/column/FK/immutable constraint/new-network assertion, unknown-network rollback and vault-counter monotonicity. Full migrations already run in every real migrated fixture. Keep the migration parser's final statement check: it prevents accidentally skipping SQL, and is not an isolated test declaration. |
| TT05 | In `workers/payment-executor/wallet-rotation.test.ts` helper125–153, replace the blanket ignored first dispatch rejection132–134 with explicit expected success or expected lost-response outcome; close the owned SQL database in finally. | Preserve all4 real old-wallet award → indexed finality → new-wallet authorization variants, including unpaid uncertainty. Do not convert meaningful rows/signatures into mock-only tests. Run this suite with existing payment integration coverage. |
| TT06 | Extract the repeated 200%-text mutation into the existing browser fixture module. It appears across owner-awards, site, funding-wallet-qa, profiles, evidence-download, payout-wallet-picker twice, points, vault-actions, plus assembly browser capture. | One helper acts on the caller's actual root locator, snapshots font+line height before mutation, and returns a restoration operation where required. Preserve subtree versus body, original inline styles and actual browser assertions. Keep native zoom distinct. No unit tests for this helper; run affected actual desktop/mobile flows. |
| TT07 | Store the3 largest immutable historical JSON fixtures with deterministic gzip and transparently decompress at copy/read boundaries. | Exact original bytes and all historical SHA-256 bindings remain identical after decompression. Measured17,416,533→1,235,803bytes, saving16,180,730bytes (92.9%). Only3 direct script readers plus `copyFixtureHistory` require changes. Do not reserialize JSON or change recorded history. |
| TT08 | Repair live `scripts/test-payout-browser.mjs` stale selectors, or move its actual scenario into canonical Playwright only if smaller while retaining `--serve` fixture until proved equivalent. | Backend confirmed unique browser personal_sign→real challenge/authorization→background attester→finalized98m principal/2m fee, Base and Robinhood lineages plus mobile/keyboard/a11y. Current `/earnings` heading `Your payouts`98, `Manage payout wallets`100/145 and network-specific buttons102–109/118/149 are obsolete against Account/aggregate-EVM UI. It is a live CI call at escrow-tests.yml200, not dead code. Actual local-chain rerun required. |
| TT09 | Remove duplicated `expect(() => validate(manifest)).not.toThrow()` at `tests/e2e/project-proposal.spec.ts:894`. | The intercepted actual browser POST already runs the identical validator at862; preserve actual form completion and exact submitted identity assertion. Run existing project-proposal browser cases. |

No new non-contract unit tests or speculative parser/edge-case suites should be introduced. TT01–03 remove isolated tests inside genuine lifecycle files; they do not delete the actual installer, evidence or release workflow. TT04 is consolidation, not removal of database migration acceptance. TT05 fixes a test helper which can hide an unexpected first-step failure, not application behavior.

### Fixture evidence and structure

All79 tracked files under `tests/fixtures` total19,021,282bytes. Hash grouping found no identical duplicate files. Generic script bytes already come from the canonical template via `copyFixtureSkills`; do not recreate a second kit. Old per-project skill files are intentional frozen historical fixtures consumed by the real installer and fixture build, not current public project inventory. `copyFixtureHistory` materializes omitted identical source snapshots from the single same-month Eliza copy. Keep immutable proposals/evaluations/disclosures/funding/profile history; no row is being rewritten or removed.

Compression was checked in memory with gzip mtime0 and exact decompression equality (no source changed):

| Fixture | Raw bytes | gzip bytes | Original-byte SHA-256 |
|---|---:|---:|---|
| history/cycles/eliza/2026-09/source-snapshot.json |7420435|495340|2b1bd80aef96961667aa5ac83af631807e07fa41dfe5450a741d3b0e11c0663f|
| history/cycles/eliza/2026-07/source-snapshot.json |5431520|365227|20bcb8a987be7c6da59138fb9e73335af361a471a03cffb67db5f2223a22fa72|
| history/data/profiles/seed.json |4564578|375236|b6ccc46d62a711901dd583449b5f15b6c0561ea9a0914873b77667544b0011c3|

The three direct readers are scripts/quality-payment-ledger.test.ts, prepare-monthly-rewards.test.ts and collect-quality-census.test.ts. Scratch historical readers and built pages consume `copyFixtureHistory` outputs. Compressed leaderboard fixture already uses this storage pattern. Report storage reduction only; no test-time gain has been measured.

Shared support graph: sqlite-d1 supplies63 observed source references and all real migrated fixtures; project-application-manifest supplies26; fixture-overlay13; participation-ban10; vetting-fixtures9; vetting-evidence-fixture8. Native R2 transport stays with evidence closure tests. account-closure-fixture feeds server/account/publication workflows; monthly-allocation fixture also feeds retained contract integration; penalty-score fixture feeds points/payout/identity flows; install-authority fixture feeds executed installer. No support file is proven dead. `.d.mts` siblings are implicit type-resolution companions, not dead because literal filename search has zero hits. No fixture deletion is justified merely by low fan-in.

### Runner and CI topology

- Default Bun command runs scripts/workers/backend/contracts. Many tests replace global fetch or use shared process state; enabling same-process concurrent cases blindly would corrupt isolation. Preserve process boundaries.
- `run-integration.mjs` already runs5 independently isolated native drivers concurrently with deadlines and status aggregation.
- `run-e2e.mjs` already overlaps fixture and registry lanes, uses separate ports/storage and retained process-tree cleanup. Playwright has0 retries; preview defaults to at most2 workers; native-chain and Pages lanes use1. CI splits preview2shards, registry2shards, and a dedicated Pages lane. Preserve these tested defaults; no unmeasured increase is justified.
- Site breakpoint coverage already uses representative layout families; ordinary desktop/mobile routes remain complete. This audit does not repeat earlier removed laptop/tablet duplication.
- Linux artifact, provenance, dependency and filesystem workflow steps are serial after a shared native package setup. They have separate private inputs and could run as a bounded same-runner group, but no timing/resource measurement supports extra orchestration yet. Keep current scheduling unless measured total time improves without losing individual failure logs.
- Windows runs real process lifecycle and installer; Linux runs sandbox/VM, private DNS/TLS, artifact, Anvil and Solana lanes. Conditional ordinary-preview skips are qualification boundaries, not evidence that those native workflows passed.
- TT08 is the concrete live runner defect. Do not delete that driver or its fixture merely because its UI selectors are stale.

### Every file and declaration

K means retained. M/R/C below are only the exact proposed dispositions above; everything else is retained for the stated observed boundary. This section inventories source declarations, not claimed test execution.

#### `backend/fee-conversions/handler.test.ts` — 93 lines — K

Production API handler with real migrated persistence, authentication, exact private/public state and failure/refusal outcomes; see test titles for subsystem-specific transactions.

- **L34 K** `test("signed-out and non-admin sessions are refused", async () => {`
- **L50 K** `test("admins get recent records and exact per-token totals without signed bytes", async () => {`

#### `backend/notifications/email.test.ts` — 414 lines — K

Real notification/mail journal, consent changes, bounded retries and attempt-bound independent evidence; transport is controlled to qualify state, not email delivery.

- **L112 K** `test("verified opt-in sends future activity once; opt-out cancels queued mail and is independent of essential notices", async () => {`
- **L150 K** `test("unverified and changed destinations cannot inherit activity consent", async () => {`
- **L194 K** `test("optional-mail ambiguity retries only with attempt-bound independent evidence and remains bounded", async () => {`
- **L230 K** `test("an essential notice retries a not-yet-effective destination on a bounded schedule; optional mail does not", async () => {`
- **L276 K** `test("an essential notice exhausts after five non-send attempts and an absent record is suppressed", async () => {`
- **L317 K** `test("opt-out cancels optional mail that is waiting for a reconciled retry", async () => {`
- **L356 K** `test("scheduled drains finish activity delivery and report a failed security queue", async () => {`

#### `backend/notifications/exception-events.test.ts` — 293 lines — K

Real project/security/installation state transitions emit exact recipient event rows once and omit routine/self notices.

- **L67 K** `test("setup completion is one project_ready notice, never sent to its publisher", async () => {`
- **L127 K** `test("a self-service first revision reports ready only when it is active", async () => {`
- **L154 K** `test("a scan that cannot finish reaches the owners once; other results write nothing", async () => {`
- **L186 K** `test("losing the Slopbot installation reaches each affected project's owners once", async () => {`
- **L237 K** `test("a verified report receipt reaches only its reporter, once, with no acknowledgment", async () => {`

#### `backend/notifications/notifications.test.ts` — 794 lines — K

Real notification journal and authenticated inbox APIs; read state, privacy, event deduplication and roles are persisted.

- **L50 K** `test("self-service listing sends no routine notice; later revisions notify once each", async () => {`
- **L156 K** `test("project enforcement records notify the project and independent reviewers once", async () => {`
- **L260 K** `test("wallet changes and finalized payment events notify the contributor once", async () => {`
- **L444 K** `test("a notification changes only from unread to read and is never deleted", () => {`
- **L486 K** `test("older unread notifications remain reachable when new events arrive", async () => {`
- **L557 K** `test("lists only the signed-in recipient's rows, newest first", async () => {`
- **L571 K** `test("marks the recipient's own rows read once and refuses other writes", async () => {`
- **L592 K** `test("each notice reports its own email outcome without delivery details", async () => {`
- **L645 K** `test("a signed-out request gets 401 and other paths are not handled", async () => {`
- **L698 K** `test("one notice per moderator from the committed penalty, never to the author", async () => {`
- **L718 K** `test("a penalty without moderator review writes no notice", async () => {`
- **L729 K** `test("moderator access is rechecked on every list, open and read mark", async () => {`

#### `backend/payments/evm.integration.ts` — 2116 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `backend/payments/migration-0021.test.ts` — 225 lines — M

Real pre-migration payment rows and child tables migrate to named-asset integer amounts, preserve obligations, enforce immutability, and reject unknown network atomically. Consolidate the duplicate success setup.

- **L98 K** `test("keeps rows and children, names the reviewed asset, and copies amounts as 6-decimal base units", () => {`
- **L168 K** `test("a row on a network without a reviewed asset fails the migration", () => {`
- **L181 C** `test("applies inside one transaction with child rows present (the D1 path)", () => {` — TT04: fold transaction into complete first migration outcome.
- **L190 K** `test("vault snapshots keep uint128 text, NULL counters, a fixed asset and a monotonic block", () => {`

#### `backend/payments/migrations.test.ts` — 196 lines — M

Real historical row/child/column/FK/trigger preservation and new-network inserts. Consolidate success paths into D1-style transaction; standalone empty-schema case duplicates every full migrated fixture.

- **L92 K** `test("keeps rows, children and column order; then accepts robinhood", () => {`
- **L170 C** `test("applies inside one transaction with child rows present (the D1 path)", () => {` — TT04: fold into complete transactional migration; empty-schema repeats shared fixture setup.
- **L190 C** `test("the full migration set applies cleanly on an empty database", () => {` — TT04: fold into complete transactional migration; empty-schema repeats shared fixture setup.

#### `backend/payments/monthly.test.ts` — 2234 lines — K

Real production boundary with migrated persistence or actual process/network/filesystem state; declaration names below identify the distinct success/refusal/recovery outcome.

- **L177 K** `test("Solana refuses a monthly cap above its token range before storing an allocation", async () => {`
- **L191 K** `test("the amount-range migration preserves funded months, exclusions and authorization history", async () => {`
- **L259 K** `test("an 18-decimal token month keeps exact amounts through owner review, freeze and attestation", async () => {`
- **L388 K** `test(`a ${racing ? "concurrent" : "current"} owner ban refuses monthly ${action}`, async () => {`
- **L435 K** `test("a ban after freeze excludes only the unfunded award and preserves the snapshot", async () => {`
- **L494 K** `test("a ban that races monthly funding makes the coordinator retry before creating awards", async () => {`
- **L524 K** `test("a later ban preserves monthly awards that are already funded", async () => {`
- **L554 K** `test("freezes the current private allocations once at the cutoff and creates each obligation once when funded", async () => {`
- **L656 K** `test("a funding-time excluded award is not advertised as awaiting payment", async () => {`
- **L695 K** `test("a contributor's account shows the approved monthly award from the freeze until the vault reserves it", async () => {`
- **L775 K** `test("without a defined cutoff nothing is frozen automatically, but the owner can finalize", async () => {`
- **L785 K** `test("an owner who turns the default off, a restricted project and an unserved vault are not distributed automatically", async () => {`
- **L815 K** `test("an award reserved earlier needs no new funds and cannot be planned twice", async () => {`
- **L881 K** `test("a Solana hand reservation waits until automatic monthly payment is off", async () => {`
- **L914 K** `test("a Solana month needs its full total free, even for an award reserved earlier", async () => {`
- **L943 K** `test("an underfunded month has no obligation to reserve, and earlier unreserved obligations hold their funds", async () => {`
- **L987 K** `test("after the cutoff the automatic default fixes the allocations until they are frozen", async () => {`
- **L1008 K** `test("a month before the first automatic period is never frozen automatically", async () => {`
- **L1018 K** `test("private changes stay within the cap, never pay their author and are serialized", async () => {`
- **L1064 K** `test("an open month cannot be finalized", async () => {`
- **L1132 K** `test(`an obligation for ${label} under a frozen award's source is a conflict left out of the month`, async () => {`
- **L1181 K** `test("a contributor sees a conflicting award, and a month of only conflicts signs nothing", async () => {`
- **L1207 K** `test("uses only the frozen owner-adjusted awards, even after a later funding observation", async () => {`
- **L1227 K** `test("refuses the root before the cutoff, after its window, and when the whole month is unfunded", async () => {`
- **L1240 K** `test("signs a frozen month after a later revision that keeps its payment terms", async () => {`
- **L1284 K** `test("rechecks restrictions and the owner's opt-out after the month was frozen", async () => {`
- **L1298 K** `test("omits funding-time exclusions while preserving awards funded before a later ban", async () => {`
- **L1318 K** `test("accepts a month frozen before fees rounded up, and no other fee", async () => {`
- **L1374 K** `test("rejects a forged frozen payload even when its metadata still names the real project", async () => {`
- **L1404 K** `test("monthly signing preserves its first intent through retry and refuses a changed root", async () => {`
- **L1531 K** `test("V2 monthly signing publishes permanent source-bound attempts and resumes the selected admitted month", async () => {`
- **L1769 K** `test("monthly signing never publishes when the signer fails or an opt-out arrives during signing", async () => {`
- **L1833 K** `test("monthly dispatcher resumes an older Solana reservation after opt-out and retires only finalized completion", async () => {`
- **L1921 K** `test("monthly dispatcher sends a new EVM V2 reservation before an older month's leaves", async () => {`
- **L1984 K** `test("Solana v3 retries preserve the first signed freeze time after a signer outage", async () => {`
- **L2053 K** `test("reserve release requires current authority and refuses a revision changed during the request", async () => {`
- **L2154 K** `test("account keeps an award visible when a reservation is indexed during its read", async () => {`

#### `backend/payments/vault-snapshots.test.ts` — 472 lines — K

Real production boundary with migrated persistence or actual process/network/filesystem state; declaration names below identify the distinct success/refusal/recovery outcome.

- **L43 K** `test("refreshes both chain caches and preserves the last verified public totals after invalid reads", async () => {`
- **L149 K** `test("serves cached rows with public edge caching and never reads a chain", async () => {`
- **L224 K** `test("an unindexed project returns no rows, not zero totals", async () => {`
- **L256 K** `test("requires the finalized vault snapshot and records its asset and decimals", async () => {`
- **L293 K** `test("re-indexing stored evidence for the adapter's deployment makes no chain call", async () => {`
- **L329 K** `test("concurrent finalized refreshes cannot decrease cumulative vault counters", async () => {`
- **L371 K** `test("concurrent initial refreshes preserve asset identity and report superseded blocks", async () => {`
- **L401 K** `test("bounded refresh advances healthy vaults while earlier reads wait and reports every failure", async () => {`

#### `backend/points/publication.test.ts` — 240 lines — K

Real sign-in transaction publishes only intended membership/link rows; injected database write failures prove rollback.

- **L69 K** `test("only sign-in publishes an existing private membership and connected X link", async () => {`
- **L136 K** `test(`sign-in publication rolls back when the ${failure} write fails`, async () => {`
- **L166 K** `test("sign-in cannot publish another numeric identity's existing membership or X link", async () => {`
- **L184 K** `test("new memberships are public and sign-in never recreates a disconnected X link", async () => {`
- **L221 K** `test("legacy hide requests fail explicitly without changing either public record", async () => {`

#### `backend/points/x.test.ts` — 115 lines — K

Real identity reservation/connection/disconnection and points journal preservation; no welcome or reconnection awards.

- **L8 K** `test("X connection and reconnect reserve identity without granting points", async () => {`

#### `backend/projects/cloudflare-persistence.test.ts` — 219 lines — K

Real project persistence → repository-key SQL → Slopbot registry capability lookup; current/old aliases, transfer and competing key claim are persisted outcomes.

- **L78 K** `test("renamed repository (alias is the current name) resolves in the live registry", async () => {`
- **L111 K** `test("a legal transfer revision (alias append) keeps the repository resolvable", async () => {`
- **L161 K** `test("a repository path acquired by another project before commit refuses the whole revision", async () => {`

#### `backend/referrals/claims.test.ts` — 191 lines — K

Real referral filing/cache/API proof isolation; epochs, stale data, absent activation and void state remain distinguishable.

- **L115 K** `test("claim API maps contract epoch through its filed period and keeps another actor's proof private", async () => {`
- **L137 K** `test("cache failure and expiry preserve last verified totals; never-activated is hidden and first failure is unknown", async () => {`
- **L169 K** `test("a paused pending window never matures, and a void retains the preceding root", async () => {`

#### `backend/security/handler.test.ts` — 1691 lines — K

Production API handler with real migrated persistence, authentication, exact private/public state and failure/refusal outcomes; see test titles for subsystem-specific transactions.

- **L527 K** `test("a maintainer imports direct GitHub reports and settles older links", async () => {`
- **L610 K** `test("listing cases records only the cases disclosed and refuses an unaudited response", async () => {`
- **L642 K** `test("a failed or missing analysis can be run again by the owner", async () => {`
- **L675 K** `test("a stale triager change grants or revokes nothing", async () => {`
- **L757 K** `test("a banned researcher keeps funded awards and appeals but receives no new bounty award", async () => {`
- **L799 K** `test(`a banned maintainer cannot create a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => {`
- **L810 K** `test("a ban that arrives during bounty approval prevents its reservation", async () => {`
- **L819 K** `test("large program balances keep every minor unit after approved awards", async () => {`
- **L837 K** `test("the owner chooses the amount, and approval reserves exactly that amount", async () => {`
- **L936 K** `test("no award is a decision the reporter can appeal", async () => {`
- **L969 K** `test("a concurrent reservation cannot overspend the program", async () => {`
- **L1010 K** `test("reservations follow the vault's finalized free balance, not the published terms", async () => {`
- **L1073 K** `test("a pledge reserves nothing", async () => {`
- **L1083 K** `test("an award reserved before discretionary awards is approved at its amount", async () => {`
- **L1110 K** `test("a proposed related-party award reserves only after independent approval", async () => {`
- **L1148 K** `test("an appealed related-party refusal cannot be re-reviewed by the same reviewers", async () => {`
- **L1259 K** `test("a co-maintainer who decides an award or an earlier technical decision cannot review the case as dispute", async () => {`
- **L1316 K** `test("report analysis and appeal triage keep the scope recorded at receipt", async () => {`
- **L1365 K** `test("a pending-revision quarantine blocks new awards but preserves reporting until reinstated", async () => {`
- **L1432 K** `test(`a restricted or retired program cannot start a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => {`
- **L1460 K** `test("private reporting remains available for a registered quarantined project", async () => {`
- **L1474 K** `test.each(["pending", "applied", "unproved"])( "existing appeal triage follows quarantine revision evidence: %s", async (revision) => {`
- **L1512 K** `test.each(["none", "quarantine", "ban"] as const)( "an owner retirement closes a failed appeal triage retry after %s", async (restriction) => {`
- **L1544 K** `test("a receipt check imports no new report after an applied quarantine", async () => {`
- **L1560 K** `test("a previously funded award remains accessible while quarantined", async () => {`
- **L1578 K** `test(`repository-bound ${identity} restriction blocks a new award (race: ${racing}, related: ${relatedParty})`, async () => {`
- **L1656 K** `test(`an ${fault} enforcement read cannot approve an award and can retry`, async () => {`

#### `backend/security/payments.integration.ts` — 2009 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `backend/security/reporting-readiness.workflow.mjs` — 476 lines — K

Native Miniflare Pages, D1 and scheduled refresher with controlled GitHub; actual readiness/intake writes, failed renewals and stale cache.

- **K workflow entrypoint**: Native Miniflare Pages, D1 and scheduled refresher with controlled GitHub; actual readiness/intake writes, failed renewals and stale cache.

#### `backend/security/submissions.test.ts` — 2006 lines — K

Real private-intake state machine, SQL, authenticated grants and controlled GitHub transport; races/uncertainty/receipts/privacy are real persisted outcomes, not real-provider qualification.

- **L501 K** `test.each([false, true])( "failed or stale public observations do not authorize or permanently block submission (no program: %s)", async (noProgram) => {`
- **L573 K** `test("creation replays one key and refuses a second submission in flight", async () => {`
- **L601 K** `test("replaying creation on a finished or abandoned submission refuses instead of re-authorizing", async () => {`
- **L683 K** `test("the repository comes from the program terms, never from the request", async () => {`
- **L691 K** `test.each([false, true])( "a grant for another GitHub account is refused and sets no grant cookie (no program: %s)", async (noProgram) => {`
- **L715 K** `test("the grant cookie is encrypted, HttpOnly, Strict and scoped to the submission routes", async () => {`
- **L749 K** `test("a missing, tampered, expired or rebound grant never reaches GitHub", async () => {`
- **L781 K** `test("an unrelated authority outage preserves the reporter's own case list with a generic retry notice", async () => {`
- **L799 K** `test("a moderator cannot discover an un-escalated reporting-only project from the private list", async () => {`
- **L810 K** `test("a sent report survives a contact lookup outage and reconciles without sending again", async () => {`
- **L837 K** `test(`a verified ${origin} report with no passing approver recovers after 24 hours with fresh reporter consent`, async () => {`
- **L909 K** `test("private intake accepts a report without inventing an award", async () => {`
- **L1027 K** `test("a report is filed as the reporter and its receipt is verified with GitHub", async () => {`
- **L1150 K** `test("definite GitHub refusals fail with a code, and a fixed report can be resent", async () => {`
- **L1176 K** `test("a 404 maps to app-not-installed when the intake App is missing", async () => {`
- **L1188 K** `test("an interrupted send is uncertain, never resent, and reconciled to the one copy", async () => {`
- **L1214 K** `test("a complete empty listing reopens the draft for exactly one new send", async () => {`
- **L1247 K** `test("an incomplete or failed listing keeps the submission uncertain", async () => {`
- **L1279 K** `test("duplicate copies adopt the earliest and tell only the technical approvers", async () => {`
- **L1312 K** `test("a marker match authored by someone else is ignored", async () => {`
- **L1338 K** `test("a send that never returned becomes uncertain after 60 seconds and is not resent", async () => {`
- **L1363 K** `test("a concurrent double send makes one POST", async () => {`
- **L1391 K** `test("an empty listing right after the attempt keeps it uncertain, and a late copy is then adopted", async () => {`
- **L1434 K** `test("a resend that races a late copy adopts the earliest and records the duplicate", async () => {`
- **L1473 K** `test("a submitted report GitHub never lets Slop verify stops blocking new reports", async () => {`
- **L1495 K** `test("a 201 that is not the reporter's well-formed advisory is uncertain", async () => {`
- **L1506 K** `test("an unreadable advisory after creation retries the read only", async () => {`
- **L1561 K** `test("the reporter's own advisory is verified with GitHub's original time", async () => {`
- **L1596 K** `test("a reporter credit on someone else's advisory is not authorship, and the author can still verify", async () => {`
- **L1633 K** `test("an advisory that is not a live private report is never an automatic receipt", async () => {`
- **L1651 K** `test("two concurrent verifications of one submission both answer with the one verified case", async () => {`
- **L1680 K** `test("another user's advisory fails as author-mismatch with no case", async () => {`
- **L1690 K** `test("an advisory GitHub cannot find fails as not-found", async () => {`
- **L1709 K** `test("an advisory already recorded for another case returns 409 without leaking it", async () => {`
- **L1751 K** `test("only the reporter can reach a submission", async () => {`
- **L1774 K** `test("an idle draft is abandoned after 24 hours", async () => {`
- **L1794 K** `test("report content and tokens never reach D1, logs or responses", async () => {`
- **L1851 K** `test("with intake off every submission route is closed, the list is empty and readiness says off", async () => {`
- **L1883 K** `test("readiness reports automatic intake only when the App is installed and PVR is on", async () => {`
- **L1916 K** `test("a participation ban stops new private reports and sending an existing draft", async () => {`
- **L1929 K** `test("a ban before the send commits prevents the private GitHub request", async () => {`
- **L1940 K** `test("a concurrent ban leaves no new private submission or creation event", async () => {`
- **L1956 K** `test("a banned reporter can reconcile a report GitHub already received", async () => {`
- **L1985 K** `test("an accepted private report still reconciles after quarantine", async () => {`
- **L2001 K** `test("registered researcher can start a private report on a quarantined project", async () => {`

#### `backend/trace/workflow.mjs` — 590 lines — K

Native Pages/D1/R2 plus Chromium sign-in and operator-only evidence access, bounded grant and private trace workflow.

- **K workflow entrypoint**: Native Pages/D1/R2 plus Chromium sign-in and operator-only evidence access, bounded grant and private trace workflow.

#### `scripts/account-closure.test.ts` — 358 lines — K

Migrated SQL account/session/trace/obligation closure and explicit reopen, not return-shape-only closure stubs.

- **L70 K** `test("closing an account ends every session, removes optional connections and keeps records", async () => {`
- **L216 K** `test("a closed account signs in again only through an explicit reopen", async () => {`
- **L272 K** `test("closure needs a signed-in session and a same-origin JSON request, and a repeat is safe", async () => {`
- **L322 K** `test("retired Telegram routes reveal no links and preserve historical records", async () => {`

#### `scripts/account-sessions.test.ts` — 82 lines — K

Authenticated session revocation reaches real rows and invalidates the revoked session.

- **L7 K** `test("account sessions revoke only the authenticated actor and invalidate the revoked cookie", async () => {`

#### `scripts/collect-quality-census.test.ts` — 263 lines — K

Actual collection CLI paginates controlled GitHub transport, writes a census and feeds the quality CLI; rejects a pre-reward month.

- **L216 K** `test("a mid-month reward start excludes earlier closures and the census reconciles", () => {`
- **L256 K** `test("a month before the project's reward start is refused", () => {`

#### `scripts/cycle-index-review-excluded.test.ts` — 189 lines — K

Real scratch checkout and sync command preserve an excluded reviewed row; actual command output and persisted index are observed.

- **L172 K** `test("the sync script accepts an excluded row end to end", () => {`

#### `scripts/e2e-runner.test.ts` — 207 lines — K

Real child/descendant processes, PID and heartbeat termination, exit codes, occupied TCP bind refusal/reuse, and independent PUT/GET socket lifecycle.

- **L11 K** `test("a timed-out launcher stops its descendant server before returning failure", async () => {`
- **L77 K** `test("a completed phase preserves successful and failed child exit codes", async () => {`
- **L92 K** `test("an occupied fixture port rejects startup and lets the caller release and reuse it", async () => {`
- **L145 K** `test("registry fixture writes survive idle-socket closure without replay", async () => {`

#### `scripts/enrich-contribution-quality.test.ts` — 107 lines — K

Actual CLI reads independently supplied census/diffs and writes resulting per-actor evidence; complete/incomplete/stale and duplicate PR outcomes differ.

- **L70 K** `test("all merge-credit actors receive diff evidence without a false duplicate group", () => {`
- **L81 K** `test("inspection failures remain visible for every merge-credit actor", () => {`
- **L95 K** `test("matching patches on different PRs flag every actor once", () => {`

#### `scripts/escrow-acceptance/local.ts` — 456 lines — K

Actual isolated funded local/fork chains exercise approved acceptance scenarios; do not remove as a helper wrapper.

- **K workflow entrypoint**: Actual isolated funded local/fork chains exercise approved acceptance scenarios; do not remove as a helper wrapper.

#### `scripts/escrow-acceptance/upgrade.integration.ts` — 635 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `scripts/fee-converter-release-preflight.test.ts` — 118 lines — K

Executes the checked-in release shell preflight against actual Worker configuration; unsafe settings stop before the controlled publication command.

- **L89 K** `test.each([ [ "an unreviewed Worker secret", "live", "base", ["FEE_WALLET_KEY_BASE", "UNREVIEWED_SECRET"], ],`
- **L109 K** `test("the release continues when every enabled live network has its key", () => {`

#### `scripts/historical-cycle-registry.test.ts` — 75 lines — K

Real proposal builder/validator process in modified scratch checkouts; archive bytes and frozen proposal digest survive registry edits, tampered proposal refuses.

- **L17 K** `test("a frozen owner proposal survives registry copy and primary changes", () => {`

#### `scripts/identity-maintenance.test.ts` — 59 lines — K

Real maintenance job must expose renewal failure while completing independent database cleanup.

- **L7 K** `test("a failed intake renewal fails the job, preserves evidence, and still cleans expired state", async () => {`

#### `scripts/legacy-repository-registry.test.ts` — 82 lines — K

Actual project creation handler and migrated SQL refuse reuse of a legacy repository under a new project id.

- **L73 K** `test("a project for a legacy repository must reuse its historical id", async () => {`

#### `scripts/owner-award-authority.test.ts` — 168 lines — K

Pages monthly handler with real session and registry rows checks fresh external GitHub authority; outsiders/transfers cannot access private awards.

- **L14 K** `test("organization maintainers reach private monthly awards through their own session; other actors and transferred repositories do not", async () => {`

#### `scripts/payment-keeper/evm.integration.ts` — 1157 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `scripts/payout-exclusion.test.ts` — 217 lines — K

Real snapshot/reward proposal/import/owner-review boundaries preserve score but exclude an owner from payable allocations.

- **L87 K** `test("an excluded owner keeps the score, receives nothing, and the other share is not reduced", async () => {`

#### `scripts/points-import.test.ts` — 515 lines — K

Production journal generation → SQL batch execution → actual HTTP points API. Prefix, coverage, identity, retired X awards, debit correction and failed import atomicity are observed.

- **L73 K** `test("journal debit corrections preserve the checkpoint, other months, projects and payout recognition", async () => {`
- **L201 K** `test("points publication retains the exact permanent history prefix", async () => {`
- **L273 K** `test("a staged coverage list is served whole and an incomplete one publishes nothing", async () => {`
- **L316 K** `test("journal reads select the complete prefix before generation-time tie breakers", async () => {`
- **L357 K** `test("member lookups fail closed when a stale public login collides with a private member", async () => {`
- **L433 K** `test("X-connection awards recorded from 24 October 2026 report no points", async () => {`

#### `scripts/prepare-monthly-rewards.test.ts` — 88 lines — K

Production monthly SQL executes on real migrations; repeated and changed proposals cannot replace frozen recipient rows.

- **L25 K** `test("a month's proposal is stored once; a later ledger never adds or replaces rows", async () => {`

#### `scripts/project-application-github-check.test.ts` — 418 lines — K

Production Pages setup handler plus real migrations; controlled GitHub response is an external authority boundary, not the sole assertion.

- **L180 K** `test("an owner whose write access Slopbot reads creates the project at once", async () => {`
- **L197 K** `test.each([ ["missing", { installation: "missing" }, 409, "slopbot_required"], [ "suspended", { installation: "suspended", installationId: 5151 }, 409, "slopbot_required",`
- **L229 K** `test("a new project lists exactly one repository", async () => {`
- **L240 K** `test("an alias must lead to the repository it names", async () => {`
- **L260 K** `test.each(["unchanged", "changed", "unavailable"])( "publishing a stored application rechecks its alias facts: %s", async (state) => {`
- **L332 K** `test("the repository owner is accepted as steward in any login case, from the App response alone", async () => {`
- **L344 K** `test.each([ ["login", { login: "microsoft", profileUrl: "https://github.com/microsoft" }], ["node id", { nodeId: "MDEyOk9yZ2FuaXphdGlvbjY4OTg0Mzc=" }], ] as const)( "another account's %s with the owner's id is refused", async (_name, github) => {`
- **L359 K** `test("a project cannot claim a different GitHub owner account type", async () => {`
- **L370 K** `test.each([ ["old Worker reply", undefined, 503], [ "private repository", { ...(repositories["example/open-registry"] as object), private: true }, 422, ],`

#### `scripts/project-registry-api.test.ts` — 2022 lines — K

Real registry/security/referral handlers and migrated SQL, cache invalidation, immutable revisions, generated artifact publication and restriction races.

- **L298 K** `test("serves a newly approved project at once, purging the cached list", async () => {`
- **L332 K** `test("an owner revision publishes at once and appends only its expected revision", async () => {`
- **L408 K** `test("owners publish bounty terms and open only with current verified vault funds", async () => {`
- **L666 K** `test("reads token decimals from chain once, stores the amount in base units and keeps them on later revisions", async () => {`
- **L805 K** `test("refuses an unverifiable or malformed token and stores nothing", async () => {`
- **L826 K** `test("refuses a project id too long for its reviewer skill name", async () => {`
- **L839 K** `test("refuses activation when historical clean metadata lacks canonical closure", async () => {`
- **L874 K** `test("creates a project only for current GitHub authority and refuses contradicted facts", async () => {`
- **L967 K** `test("serves the exact approved bytes of a revision", async () => {`
- **L982 K** `test("looks up GitHub only for a signed-in visitor and caches the facts", async () => {`
- **L1093 K** `test("discovery lists only active cleared projects", async () => {`
- **L1152 K** `test("historical clean metadata cannot publish skills without canonical closure", async () => {`
- **L1231 K** `test("an ordinary ban preserves the owner's project appeal for independent review", async () => {`
- **L1269 K** `test("quarantines and bans while refusing an appeal with only historical clean metadata", async () => {`
- **L1592 K** `test("a revision of another project cannot claim a banned repository", async () => {`
- **L1650 K** `test("a ban closes the public routes of another project listed for the repository", async () => {`
- **L1717 K** `test("another project listed for a banned repository can still be retired", async () => {`
- **L1791 K** `test("a revision fails when a restriction lands after its read", async () => {`
- **L1835 K** `test("cached skill and public clearance cannot survive loss of retained evidence", async () => {`
- **L1936 K** `test("records the referrer once and leaves omitted referrals unset", async () => {`
- **L1972 K** `test("a recycled login cannot attribute the applicant to an older cached member", async () => {`
- **L1996 K** `test("refuses the applicant, the steward, team accounts and unknown logins", async () => {`

#### `scripts/project-self-service.test.ts` — 2644 lines — K

Real owner/admin/project/account restriction/appeal workflows and SQL lineage. Independent account/project decisions and reviewer conflicts remain distinct cases.

- **L181 K** `test("a new project cannot reuse a listed project id or repository", async () => {`
- **L197 K** `test("an admin revision still replaces the listed project with that id", async () => {`
- **L219 K** `test("creation requires the Slopbot installation, then queues the first scan and returns one status", async () => {`
- **L261 K** `test("setup activates a project only with installation write access and a clean scan", async () => {`
- **L345 K** `test("an owner records and revokes explicit closure consent with current authority and immutable revisions", async () => {`
- **L426 K** `test("owner revisions publish presentation at once, rescan skill inputs and apply money prospectively", async () => {`
- **L556 K** `test("an owner revision cannot record a vault; a reviewed admin revision can", async () => {`
- **L627 K** `test("a payout exclusion starts with the next UTC month on every revision path", async () => {`
- **L727 K** `test("an application stored before self-service setup publishes once, by its applicant", async () => {`
- **L812 K** `test("an explicit moderator ban blocks new contribution intake without blaming the original applicant", async () => {`
- **L1509 K** `test("account-ban appeals after project appeal or reinstatement resolve role, refusal and independent reviewer notices", () =>`
- **L1512 K** `test("a concurrent project appeal refuses the stale account request and a fresh retry uses the account role", () =>`
- **L1515 K** `test("denying the project appeal leaves a banned account's appeal for its own decision", async () => {`
- **L1606 K** `test("an open account appeal survives later project restrictions and needs an independent account reviewer for each decision", async () => {`
- **L1931 K** `test("a malicious decision that closes a kept project appeal needs an independent moderator while an account appeal is open", async () => {`
- **L1950 K** `test("an account release leaves the kept project appeal for an independent malicious decision", async () => {`
- **L1968 K** `test("a banned owner or moderator separates its project appeal from its account appeal in both filing orders", async () => {`
- **L2143 K** `test("account-reinstatement upgrade preserves prior releases and separates future project decisions", async () => {`
- **L2208 K** `test.each(["vault verification", "owner update"])( "a ban issued during %s blocks the owner revision", async (flow) => {`
- **L2355 K** `test("only the steward or a repository admin can register the project vault", async () => {`
- **L2434 K** `test("a ban issued during the authority check prevents automatic activation", async () => {`
- **L2532 K** `test("an account-page appeal from a banned owner survives reload without opening a project appeal", async () => {`

#### `scripts/quality-external-evaluation.test.ts` — 263 lines — K

Actual quality command consumes approved external-evaluation files and writes the evaluation evidence artifact.

- **L239 K** `test("prepare-contribution-quality keeps the award as an evaluation", () => {`

#### `scripts/quality-payment-ledger.test.ts` — 261 lines — K

Actual quality command consumes historical/current payment-ledger preparations; no removed correction-helper cases remain.

- **L240 K** `test("prepare-contribution-quality builds evidence from the payment review ledger", () => {`
- **L253 K** `test("prepare-contribution-quality accepts the archived September cycle", () => {`

#### `scripts/release-registry.test.ts` — 359 lines — K

Registry API → snapshot command → protected release fragment → attester setup preserves approved exact registry/history bytes and rejects stale inputs.

- **L71 K** `test("release carries the checked D1 registry and history into canonical attester setup", async () => {`

#### `scripts/solana-token-2022-browser-review.test.ts` — 452 lines — K

Migrated registry/wallet state, production handlers, local RPC, browser-side message reconstruction and genuine Ed25519 signature verification. Not validator or actual-browser qualification.

- **L307 K** `test("browser vault setup and funding reviews preserve the verified Token-2022 program", async () => {`

#### `scripts/solana-vault-setup-network-failure.test.ts` — 280 lines — K

Production setup service uses local RPC and persisted project state; an unavailable RPC permits retry but mismatched program refuses.

- **L241 K** `test("an unreadable Solana RPC is a retry, while a program mismatch still refuses", async () => {`

#### `scripts/staging-release.test.ts` — 238 lines — K

Real Git histories and checked-in release command with stateful provider transport exercise ancestor/current-head/rollback/history refusal boundaries.

- **L130 K** `test("a verified ancestor can progress while development advances; old guard rejects it", () => {`
- **L143 K** `test("a newer attempted deployment prevents rollback regardless of success", () => {`
- **L150 K** `test.each([ ".github/workflows/vetting-recovery-qualification.yml", ".github/workflows/vetting-sandbox-qualification.yml", ".github/workflows/vetting-controller.yml", ])("a newer %s record does not block an older release", (path) => {`
- **L193 K** `test("a divergent deployment prevents overwriting unknown staging state", () => {`
- **L198 K** `test("a force-pushed development branch cannot authorize an abandoned candidate", () => {`
- **L204 K** `test("history pagination cannot hide a newer attempt on the second page", () => {`
- **L211 K** `test("unavailable, malformed or unknown deployment provenance fails closed", () => {`
- **L225 K** `test("history beyond the bound fails rather than trusting an incomplete scan", () => {`
- **L233 K** `test("wrong checkout, repository or branch cannot reach the staging gate", () => {`

#### `scripts/terms-preflight.test.ts` — 92 lines — K

Actual publication handler emits terms which the installed skill preflight consumes from a file authority.

- **L83 K** `test("acknowledges the terms.json slop.cash serves for a project without a bounty program", async () => {`

#### `scripts/test-payout-browser.mjs` — 271 lines — M

Live CI custom browser runner is stale, not dead: preserve browser personal_sign→real challenge/authorization→background attester→finalized paid98m/fee2m; update selectors/adapter (TT08).

- **K workflow entrypoint**: Live CI custom browser runner is stale, not dead: preserve browser personal_sign→real challenge/authorization→background attester→finalized paid98m/fee2m; update selectors/adapter (TT08).

#### `scripts/trace-upload-attachable.test.ts` — 481 lines — K

Authenticated intent/upload/finalize paths use migrated SQL and bounded create-only object transport; reservations/overlap/bans are actual state transitions, not native R2 claims.

- **L243 K** `test("a second trace for a run is refused at the intent, and its bytes are never written", async () => {`
- **L257 K** `test("an intent issued before another trace attached cannot write its bytes", async () => {`
- **L276 K** `test("an intent issued before finalization cannot write its bytes afterwards", async () => {`
- **L298 K** `test("overlapping different uploads retain only the reserved trace", async () => {`
- **L314 K** `test("a failed storage write retains its reservation and permits a same-byte retry", async () => {`
- **L337 K** `test("an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims", async () => {`
- **L381 K** `test("a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write", async () => {`

#### `scripts/value-merge-sdk.workflow.mjs` — 280 lines — K

Actual Linux SDK/container boundary, pinned public Git objects and child-pipe lifecycle. No assessment or provider output is fabricated.

- **K workflow entrypoint**: Actual Linux SDK/container boundary, pinned public Git objects and child-pipe lifecycle. No assessment or provider output is fabricated.

#### `scripts/vault-setup-network-failure.test.ts` — 276 lines — K

Production EVM setup service uses local RPC and persisted state; missing network evidence remains retryable while factory mismatch refuses.

- **L238 K** `test("an unreadable RPC is a retry, while a factory mismatch still refuses", async () => {`

#### `scripts/vetting-api.test.ts` — 1119 lines — K

Signed production vetting handlers plus real D1/native local R2 evidence closure, chunked grants and access/refusal state.

- **L240 K** `test("the trusted publisher journals one signed intake attempt", async () => {`
- **L327 K** `test("a signed clean claim without canonical closure cannot activate the revision", async () => {`
- **L358 K** `test("the queue binds commits and templates without accepting an unsupported clean claim", async () => {`
- **L402 K** `test("an incomplete result quarantines the revision and blocks activation", async () => {`
- **L501 K** `test("an unavailable model review can never produce a clean result", async () => {`
- **L521 K** `test("confirmed malice bans the project; a model label alone cannot", async () => {`
- **L618 K** `test("forged, stale, mismatched and unconfigured requests fail closed", async () => {`
- **L682 K** `test("private retained bytes remain inspectable without granting clean clearance", async () => {`
- **L801 K** `test("a clean result cannot omit a referenced retained artifact or replace an immutable inventory", async () => {`
- **L836 K** `test("historical metadata-only clean results have no retained-evidence exemption", async () => {`
- **L854 K** `test("missing storage pauses acquisition while harmless queue registration remains available", async () => {`
- **L871 K** `test("large retained evidence uses bounded chunks, immutable completion and actor-bound native downloads", async () => {`

#### `scripts/vetting-assembly-workflow.ts` — 510 lines — M

Retained acquisition/artifact/VM/dependency inputs → on-disk assembled closure and missing/tampered input refusals. Remove embedded synthetic syscall parser matrix (TT02).

- **K workflow entrypoint**: Retained acquisition/artifact/VM/dependency inputs → on-disk assembled closure and missing/tampered input refusals. Remove embedded synthetic syscall parser matrix (TT02).

#### `scripts/vetting-evidence-assembly-workflow.ts` — 709 lines — K

Actual retained component bytes → authenticated native evidence upload/chunks/closure → operator browser download/accessibility; fake clean claim is deliberately refused.

- **K workflow entrypoint**: Actual retained component bytes → authenticated native evidence upload/chunks/closure → operator browser download/accessibility; fake clean claim is deliberately refused.

#### `scripts/vetting-publication-journal.test.ts` — 101 lines — K

Real SQLite publication journal with concurrent/lost-response reservations, immutable metadata and exact once receipts.

- **L54 K** `test("a restarted controller preserves an intent even when its reservation reply is lost", async () => {`
- **L67 K** `test("only one concurrent controller can reserve a publication and its metadata stays immutable", async () => {`
- **L83 K** `test("a receipt must match the reserved result and remains exactly once", async () => {`

#### `scripts/vetting-queue.test.ts` — 346 lines — K

Signed queue endpoint → migrated registry → real Git/template acquisition; changed pins cannot complete a bundle.

- **L273 K** `test("signed real queue and SQLite revision acquire exact Git and template bytes without finishing assessment", async () => {`
- **L322 K** `test("changed revision/template bytes and wrong signer leave queue pending and no completed bundle", async () => {`

#### `scripts/vetting-release-dispatch.test.ts` — 122 lines — K

Runs checked-in shell dispatcher with stateful gh transport and observed queue/dispatch outcomes; Windows explicitly skips the Bash workflow.

- **L53 K** `test.skipIf(process.platform === "win32")( "release completion dispatches only a current deployed branch with no active scan", () => {`

#### `scripts/vetting-scan-flags.test.ts` — 1270 lines — K

Real scan/flag/revision SQL workflow, activation clearance, two-reporter pause, permanent exemptions, fresh scan and concurrent ban guards.

- **L396 K** `test("a clean supported scan lets activation proceed without an admin scan request", async () => {`
- **L444 K** `test("changed executable content is rescanned; identical content reuses the cached scan", async () => {`
- **L476 K** `test("an incomplete or legacy result never clears", async () => {`
- **L497 K** `test("two distinct flags pause atomically with one moderator notice; a clean fresh scan reinstates", async () => {`
- **L615 K** `test.each([0, 30_000])( "a flag filed during a scan waits for a newer scan (offset %i)", async (offset) => {`
- **L656 K** `test("withdrawn flags stop counting and owners cannot flag", async () => {`
- **L699 K** `test("only established contributors outside the project may flag", async () => {`
- **L730 K** `test("a flag stops counting 90 days after it was filed", async () => {`
- **L754 K** `test("a confirmed malicious result after a flag pause stays with a moderator", async () => {`
- **L803 K** `test("the database refuses a flag pause without two distinct active reporters", async () => {`
- **L829 K** `test("a banned account cannot add a flag but can withdraw its earlier flag", async () => {`
- **L858 K** `test("a concurrent account ban cannot supply the flag that pauses another project", async () => {`
- **L870 K** `test("the existing-project exemption is permanent but cannot clear reinstatement or later projects", async () => {`
- **L951 K** `test("an exempt owner edit stays active without a scan, while flags still require fresh reinstatement", async () => {`
- **L1084 K** `test("a non-exempt owner executable edit still pauses and queues its new content", async () => {`
- **L1123 K** `test("withdrawing a flag after the 90-day lifetime expires it by lifetime and returns 404", async () => {`
- **L1151 K** `test("a cached scan from before a two-flag pause is refused and cannot reinstate the project", async () => {`
- **L1178 K** `test("a completed scan for a superseded commit pin records without lifting a flag pause until the live pin is scanned", async () => {`
- **L1232 K** `test("a live-pin outage while a fresh clean scan lands defers the flag reinstatement to the next refresh", async () => {`

#### `scripts/vetting-scan-service.test.ts` — 1217 lines — K

Real coordinator acquires local Git, persists signed assessment/evidence state, calls controlled external transports, notifies owners and retries. Native sandbox case is conditional; no model qualification claimed.

- **L588 K** `test("authenticated source acquisition exceeds the public quota without sharing its credential", async () => {`
- **L629 K** `test("a template update replaces stale queued work without changing its retained assessment", async () => {`
- **L656 K** `test("a provider outage leaves the scan pending; the next pass clears the project with one Surplus review", async () => {`
- **L704 K** `test("an ambiguous primary review runs the Surplus specialist once before publication", async () => {`
- **L726 K** `test("a failed specialist is a service failure: nothing is published and the scan retries", async () => {`
- **L785 K** `test("a clean result is never published without its retained evidence; the next pass retries", async () => {`
- **L812 K** `test("an incomplete result is published although the evidence store fails, so the models are not called again", async () => {`
- **L839 K** `test("malicious-code detection: risky new content is flagged, escalated to the specialist and kept quarantined", async () => {`
- **L888 K** `test("a two-flag pause is reinstated automatically after the service's clean fresh scan", async () => {`
- **L963 K** `test("an unpinned endpoint or model fails closed before the queue or any provider is contacted", async () => {`
- **L998 K** `test("unsupported artifacts produce an incomplete scan rather than aborting the scan pass", async () => {`
- **L1067 K** `test.skipIf(!SANDBOX_URL)( "a native artifact runs only in the real disposable sandbox and stays quarantined", async () => {`
- **L1137 K** `test(`an acquisition ${scenario.source} policy refusal completes as incomplete and notifies each owner once (evidence available: ${scenario.evidenceUp})`, async () => {`

#### `scripts/wallet-possession.test.ts` — 200 lines — K

Real challenge records, cryptographic signatures and server window checks reject shifted/expired proofs and persist valid proof.

- **L151 K** `test("refuses an expired challenge re-signed over a later window", async () => {`
- **L170 K** `test("refuses a live challenge signed over a shifted window", async () => {`
- **L182 K** `test("records a proof over the window the server issued", async () => {`

#### `tests/e2e/account-closure-integration.spec.ts` — 250 lines — K

Actual browser plus account SQL closure/reopen, with and without obligations/private case; retained records and explicit consent.

- **L13 K** `test(`account closure ${withObligations ? "with unpaid awards and a private case" : "without awards"} requires an explicit authenticated reopen`, async ({`

#### `tests/e2e/account-sessions.spec.ts` — 99 lines — K

Identity wait, other/current session revocation and sign-out through browser interaction.

- **L10 K** `test("Account waits for identity, revokes another session and signs out the current session", async ({`

#### `tests/e2e/email-preferences.spec.ts` — 93 lines — K

Native registry lane verified activity email consent persists and can be withdrawn.

- **L4 K** `test("verified activity email preference persists and can be withdrawn @registry", async ({`

#### `tests/e2e/evidence-download.spec.ts` — 277 lines — K

Native private large evidence retention, one-use grants, browser byte download and access/zoom.

- **L9 K** `test("large private evidence downloads with a single-use browser grant @registry", async ({`

#### `tests/e2e/funding-wallet-qa.spec.ts` — 173 lines — K

Compatibility wallet navigation, keyboard focus, modal dismissal and 200% text on actual UI.

- **L6 K** `test("legacy wallet links open Account Wallets on direct navigation and reload", {`
- **L109 K** `test("funding and wallet keyboard flows remain accessible at 200 percent text size", async ({`

#### `tests/e2e/hero-typewriter.spec.ts` — 64 lines — K

Deterministic paused browser clock checks complete type/delete cycle, stable geometry and reduced-motion behavior.

- **L9 K** `test("hero types, deletes and cycles all original campaign phrases without moving the layout", async ({`
- **L52 K** `test("reduced motion keeps the hero static", async ({ page }) => {`

#### `tests/e2e/home-cache.spec.ts` — 279 lines — K

Actual UI cache fallback/empty-error distinction/retry with controlled source failures; live provider access is blocked intentionally.

- **L11 K** `test("renders bundled projects with data stalled and GitHub blocked", async ({`
- **L85 K** `test("an unavailable registry with no last good copy shows an error, never an empty list", async ({`
- **L124 K** `test("a failed registry read keeps the last good projects with a stale label", async ({`
- **L215 K** `test("a failed snapshot refresh keeps the last good scores with a stale label", async ({`

#### `tests/e2e/login.spec.ts` — 304 lines — K

Direct/reload navigation, safe return destinations, header context and closed popup recovery.

- **L10 K** `test( "serves GitHub login on direct navigation and reload",`
- **L67 K** `test(`login returns ${next} to a safe destination`, async ({`
- **L188 K** `test("the header login link keeps the current page as the return route", async ({`
- **L226 K** `test("closing a pending sign-in window lets the user start again", async ({`

#### `tests/e2e/onboarding-clearance.spec.ts` — 74 lines — K

Generic setup remains usable while project-specific clearance/discovery withholds executable installation.

- **L4 K** `test("project agent setup falls back to the general prompt until cleared", async ({`
- **L58 K** `test("home agent setup stays usable when discovery is unavailable", async ({`

#### `tests/e2e/owner-awards.spec.ts` — 369 lines — K

Actual UI request/edit/finalize/reload and reserve repair; no simple label-only tests.

- **L6 K** `test("owner edits monthly allocations privately, finalizes them and keeps sign-in context", async ({`
- **L242 K** `test("owner reserve repair keeps healthy and unknown states held and restores a submitted transaction after reload", async ({`

#### `tests/e2e/payment-availability.spec.ts` — 120 lines — K

Navigable public unavailable-funding states do not promise invented balances or settlement.

- **L12 K** `test("disabled payouts are visible from discovery through the project page", async ({`
- **L94 K** `test("a cycle record offers a funding check without inventing a vault balance", async ({`

#### `tests/e2e/payout-consent.spec.ts` — 392 lines — K

Actual browser review/signing/consent/failure/recovery and modal keyboard; controlled wallet implementation is transport, not chain qualification.

- **L133 K** `test("a recipient reviews the exact vault and signs consent without claiming payment", async ({`
- **L167 K** `test(`payout consent preserves the award after ${fault} failure`, async ({`
- **L188 K** `test("Solana recipient co-signs only the prepared binding and waits for payment finality", async ({`
- **L373 K** `test("payout consent remains readable with enlarged text and Escape restores the initiating control", async ({`

#### `tests/e2e/payout-wallet-picker.spec.ts` — 945 lines — K

Actual discovered-provider selection, rejection/account-change/confirmation/focus/reflow; wallet request effects observed.

- **L211 K** `test("modal routes EVM to MetaMask and Solana to Backpack despite Phantom globals", async ({`
- **L275 K** `test("Escape and close cancel without wallet requests and return focus", async ({`
- **L298 K** `test("wallet rejection stops registration and permits reopening the modal", async ({`
- **L313 K** `test("repeated announcements do not duplicate options and removed Solana wallet disappears", async ({`
- **L344 K** `test("no wallets offers official install links in either network modal", async ({`
- **L372 K** `test("legacy wallet browser remains connectable through the modal", async ({`
- **L398 K** `test("conflicting EIP-6963 UUID removes both providers without wallet requests", async ({`
- **L433 K** `test("mixed standard and legacy discovery keeps every distinct wallet", async ({`
- **L575 K** `test(`open modal reflows at ${scenario.name}`, async ({ page }, info) => {`
- **L665 K** `test("changing a confirmed EVM wallet opens the account picker and asks before registering the new account", async ({`
- **L721 K** `test("keeping the saved address registers nothing and returns focus to the wallet button", async ({`
- **L746 K** `test("connecting with an unconfirmed saved address asks before registering a different active account", async ({`
- **L761 K** `test("connecting the saved address confirms it without an extra step", async ({`
- **L778 K** `test(`a rejected EVM signature ${rejectedSignature} stays visible after partial confirmation and can resume`, async ({`
- **L838 K** `test("a wallet without an account picker falls back to its connected account", async ({`
- **L870 K** `test("rejecting the account picker stops the change", async ({ page }) => {`
- **L889 K** `test(`wallet change confirmation reflows at ${scenario.name}`, async ({`

#### `tests/e2e/points-social.spec.ts` — 235 lines — K

Actual account social-membership flow preserves old awards while current connections publish without new awards.

- **L10 K** `test("social membership preserves past points and discloses public connections without new awards", async ({`

#### `tests/e2e/points.spec.ts` — 213 lines — K

Actual standings filtering/history/navigation, unavailable payment distinction and archived settlement months.

- **L6 K** `test( "points history is usable, accessible and independent of payments",`
- **L136 K** `test("shows archived payments in their settlement month independently of points", async ({`

#### `tests/e2e/profile-rename.spec.ts` — 810 lines — K

Actual navigation/fetch/cache/identity reconciliation across rename/recycled/stale/ambiguous/current identities; preserved historical wallet isolation.

- **L92 K** `test("a renamed contributor keeps archived cycles", async ({ page }, info) => {`
- **L126 K** `test("a different actor reusing an old login does not inherit its history", async ({`
- **L145 K** `test("an inactive new owner does not inherit archived records or wallet lookups", async ({`
- **L180 K** `test("a directory-verified historical contributor keeps archived links", async ({`
- **L193 K** `test("historical names alone do not identify a current contributor or wallet", async ({`
- **L212 K** `test("a new owner listed without activity uses only its own identity and wallet", async ({`
- **L236 K** `test("conflicting current names withhold history and wallet lookups", async ({`
- **L256 K** `test("a stale activity login cannot override a directory rename", async ({`
- **L286 K** `test("an unavailable identity directory hides historical records until retry succeeds", async ({`
- **L339 K** `test("profile payment totals stay unavailable until direct transfers recover", async ({`
- **L460 K** `test( staleMembership ? "a stale public membership cannot override a known rename"`
- **L533 K** `test(`directory-only membership identity: ${scenario}`, async ({ page }) => {`
- **L740 K** `test("an unavailable session preserves an unconflicted cached profile", async ({`
- **L767 K** `test( "membership lookup terminates at the shared request deadline",`

#### `tests/e2e/profile-review-exclusions.spec.ts` — 190 lines — K

Actual directory and score-history rendering reject recycled review-only identity; incomplete coverage never reports zero.

- **L155 K** `test("the current directory vetoes a renamed or recycled review-only login", async ({`

#### `tests/e2e/profiles.spec.ts` — 121 lines — K

Actual profile coverage rendering and archive navigation, keyboard/zoom and request diagnostics.

- **L5 K** `test("profiles preserve legacy coverage and a valid census", async ({`

#### `tests/e2e/project-payment-navigation.spec.ts` — 378 lines — K

History navigation and delayed/retried real UI requests keep each project payment and flag draft separate.

- **L127 K** `test(`direct payments keep project identity through ${navigation}`, async ({`
- **L211 K** `test("a late previous payment request cannot overwrite a retried project", async ({`
- **L317 K** `test("a flag draft does not follow browser history to another project", async ({`

#### `tests/e2e/project-proposal.spec.ts` — 906 lines — M

Actual multistep form and intercepted request contract, failed lookup/draft/retry/network choices; remove duplicate validate call TT09 only.

- **L188 K** `test("drafts a project through the setup steps and creates it without an admin", async ({`
- **L514 K** `test("failed or partial GitHub lookups never fill unknown facts", async ({`
- **L604 K** `test("Robinhood Chain drafts a USDG escrow manifest", async ({`
- **L669 K** `test("a signed-in maintainer picks an owned repository and gets suggested text", async ({`
- **L820 M** `test(`submits a valid project identity for ${name}`, async ({` — TT09: remove only second identical validation.

#### `tests/e2e/project-save.spec.ts` — 121 lines — K

Actual edits typed during pending revision survive response/reload and subsequent publication.

- **L12 K** `test("retains edits typed while a project revision is being published", async ({`

#### `tests/e2e/project-standings-navigation.spec.ts` — 251 lines — K

Actual URL/history/project filters and failed-payment retry preserve identities and metric availability.

- **L84 K** `test("Money received standings preserve unavailable data and recover on retry", async ({`
- **L150 K** `test("history navigation keeps contributor standings scoped to the current project", async ({`
- **L200 K** `test("global standings still accept project, sort and contributor filters", async ({`

#### `tests/e2e/referral-claims.spec.ts` — 357 lines — K

Actual browser review/sign/request persistence/reload and chain-state/blocked-storage refusal.

- **L154 K** `test("referrer reviews, signs once, and waits for verified claim status", async ({`
- **L197 K** `test("unactivated referrals stay hidden; stale, paused and unknown claims cannot sign", async ({`
- **L235 K** `test("blocked claim storage keeps amounts visible and refuses a wallet send", async ({`
- **L261 K** `test("refresh retains an unverified claim when storage becomes unreadable", async ({`
- **L298 K** `test("an unreadable pending marker does not hide amounts or permit an unchecked retry", async ({`
- **L327 K** `test("an older stored claim cannot confirm the newer request on this page", async ({`

#### `tests/e2e/registry.spec.ts` — 2388 lines — K

Native Pages/D1/Workers registry workflow: creation, setup, revision, moderation, evidence, inbox, flags and stale authority.

- **L318 K** `test("an empty registry shows the empty state, never stale build data @registry", async ({`
- **L341 K** `test("a signed-out visitor must sign in to look up GitHub and submit @registry", async ({`
- **L373 K** `test("an owner creates a paused project without admin approval @registry", async ({`
- **L418 K** `test("an owner creates and updates directly; an admin can delist by exception @registry", async ({`
- **L586 K** `test("an admin cannot activate or publish skills without canonical scan closure @registry", async ({`
- **L759 K** `test("the applicant's inbox lists each decision and revision once and keeps the read state @registry", async ({`
- **L815 K** `test("moderators restrict a project and refuse reinstatement without canonical scan closure @registry", async ({`
- **L1151 K** `test("a moderator decides a confirmed malicious result and bans the project and its maintainer @registry", async ({`
- **L1371 K** `test("an owner installs Slopbot before creation and resumes setup; a failed scan and lost access each show the next action @registry", async ({`
- **L1573 K** `test("an owner publishes while public GitHub is rate limited and recovers only a stale revision @registry", async ({`
- **L1744 K** `test("an owner initializes a legacy monthly project without shortening its accepted policy @registry", async ({`
- **L1911 K** `test("an applicant publishes an application stored before self-service setup without entering it again @registry", async ({`
- **L2040 K** `test("a designated operator inspects retained vetting bytes with reasoned access @registry", async ({`
- **L2159 K** `test("repository lookup failures explain the next action and preserve the draft @registry", async ({`
- **L2231 K** `test("two contributors flag through the form, pause the project and notify moderators @registry", async ({`

#### `tests/e2e/security-bounty.spec.ts` — 3036 lines — K

Native private case/terms/award/role/funding/appeal workflow. Private intake is explicitly opt-in; no model quality claim.

- **L517 K** `test("owners publish and control bounty programs with verified funding @registry", async ({`
- **L694 K** `test("private security bounty programs keep cases restricted from intake to award @registry", async ({`
- **L1904 K** `test("private settlement requires visibility consent and produces an unsigned request @registry", async ({`
- **L2081 K** `test("private bounty obligations continue through role loss, approver replacement, and a ban @registry", async ({`
- **L2370 K** `test("automatic private intake files as the reporter and verifies receipt @registry @private-intake", async ({`

#### `tests/e2e/site.spec.ts` — 1785 lines — K

Built UI discovery/forms/inbox/artifact HTTP/reflow/a11y/route/hash workflows; layout matrices retain distinct template families.

- **L43 K** `test("funding opens without downloading contribution snapshots", async ({`
- **L70 K** `test("project setup shares one sign-in read with its owner inventory", async ({`
- **L103 K** `test("security reports recover a failed list and share one session across submissions", async ({`
- **L192 K** `test("security sign-in returns directly to the selected project", async ({`
- **L232 K** `test("token amounts keep asset precision when publishing an unrelated project edit", async ({`
- **L356 K** `test("discovers projects and one points-ranked homepage leaderboard", async ({`
- **L465 K** `test("shows agent setup and keeps contribution records available", async ({`
- **L504 K** `test("never presents Delta Star's external prize as platform money", async ({`
- **L520 K** `test("renders contributor and cycle records from validated public data", {`
- **L643 K** `test("makes the public project draft boundary unmistakable", async ({`
- **L684 K** `test("publishes criteria changes directly and stops a stale maintainer draft", async ({`
- **L870 K** `test("reaches and reads older inbox notifications without losing the page", async ({`
- **L932 K** `test("the inbox keeps read, acknowledged and email outcomes distinct and puts email settings after the notices", async ({`
- **L1037 K** `test("an admin leaves an unset reward asset unchanged until choosing it", async ({`
- **L1120 K** `test("serves byte-consistent bootstrap and read-only site artifacts", {`
- **L1276 K** `test("shows an explicit error for invalid data and retries", async ({`
- **L1330 K** `test(`reflows ${path} with ${scenario.name}`, async ({ page }) => {`
- **L1397 K** `test("finds a receipt and opens its full evidence and GitHub contribution", async ({`
- **L1499 K** `test(`keeps ${route} accessible and inside the viewport`, {`
- **L1569 K** `test("opens the models page directly and through keyboard navigation", async ({`
- **L1644 K** `test("opens the sponsors page directly and through keyboard navigation", async ({`
- **L1697 K** `test("lands direct and lazy cross-route hash links on their section", async ({`
- **L1778 K** `test("refuses prototype paths", async ({ page }) => {`

#### `tests/e2e/slopbot-appeal-inbox.spec.ts` — 105 lines — K

Native moderator inbox opens actual escalated appeal and reaches its resolution UI.

- **L7 K** `test("an escalated contribution appeal opens from the moderator Inbox and shows resolution @registry", async ({`

#### `tests/e2e/solana-vault-actions.spec.ts` — 1662 lines — K

Explicit native Solana-validator browser transaction workflow; ordinary preview skip is intentional and chain CI executes it.

- **L414 K** `test("Solana wallet deposits, recovers after reload, and owner withdraws with verified fee", async ({`
- **L1656 K** `test( bounty ? "owner creates, recovers and funds a private Solana bounty vault through the API"`

#### `tests/e2e/vault-actions.spec.ts` — 2006 lines — K

Explicit Anvil/browser funding/withdrawal/setup/monthly/bounty transaction workflow; ordinary preview skip intentional.

- **L254 K** `test("depositor funds a real vault, recovers a submitted transaction and owner withdraws only free funds", async ({`
- **L772 K** `test("owner turns automatic monthly payment on by default, then opts out", async ({`
- **L991 K** `test("owner creates, registers and funds a vault through the real API", async ({`
- **L1595 K** `test("owner funds a separate bounty vault with private balances and no monthly reward", async ({`

#### `tests/e2e/wallet-readback.spec.ts` — 131 lines — K

Actual Account wallet persistence after reload and unavailable/expired-session retry/navigation.

- **L31 K** `test("Account Wallets restores all saved networks and public records after reload", async ({`
- **L86 K** `test("unavailable wallet readback retries without inventing an empty account", async ({`
- **L116 K** `test("expired wallet sessions require sign-in with an Account return path", async ({`

#### `tests/integration/installer.e2e.ts` — 2708 lines — M

Actual generated installer executed in subprocesses with scratch Git/file/HTTP authorities, symlink/lock/update/rollback and exact-byte artifacts. Remove only two pure generated-string cases (TT01).

- **L347 K** `it("falls back when python3 has no usable HTTPS trust store", () => {`
- **L399 K** `it("uses a qualified python3 without probing python", () => {`
- **L435 K** `it("uses python3 when trust roots are discovered lazily from a hashed CA directory", () => {`
- **L480 K** `it("fails closed when neither Python candidate is qualified", () => {`
- **L506 K** `it("installs current develop, no-ops at the same revision, and atomically advances to an ancestor", () => {`
- **L581 K** `it("advances from the exact pre-transfer repository identity without modifying the retained version", () => {`
- **L642 K** `it("rejects unregistered and divergent retained repository identities", () => {`
- **L688 K** `it("rejects modified canonical bytes under the registered legacy identity", () => {`
- **L730 K** `it("rejects a downgrade or divergent update and leaves the active symlink untouched", () => {`
- **L768 K** `it("keeps an unchanged deployed skill available across unrelated develop commits", () => {`
- **L811 K** `it("rejects changed ancestor skills even after a successful release and rejects revocation", () => {`
- **L859 K** `it("revalidates an installed run and write gate without invalidating historical receipts", () => {`
- **L1005 K** `it("accepts only an exact open labeled same-repository non-draft PR head", () => {`
- **L1150 K** `it("transitions a labeled candidate to its merged result without reviving it on rollback", () => {`
- **L1223 K** `it("rolls back only to a retained, remotely reverified, unmodified revision", () => {`
- **L1362 K** `it("rejects stale develop rollback until identical current bytes reauthorize it", () => {`
- **L1426 K** `it("reauthorizes a historical candidate receipt through byte-identical develop ancestry", () => {`
- **L1525 K** `it("rejects working-tree provenance and same-origin bytes that differ from GitHub", () => {`
- **L1563 K** `it("rejects unbounded or non-regular canonical GitHub Contents entries", () => {`
- **L1615 R** `it("permits test-only file authorities but fixes production authority hosts", () => {` — TT01: direct command-generator string/option unit only.
- **L1673 R** `it("uses the current Slop repository for GitHub authority and local provenance", () => {` — TT01: direct command-generator string/option unit only.
- **L1695 K** `it("uses a process-bound lock that recovers after an interrupted holder", async () => {`
- **L1774 K** `it("refuses unmanaged or broken install targets", () => {`
- **L1919 K** `it("recovers a valid update from one slow comparison within bounded attempts", async () => {`
- **L1953 K** `it("updates across a comparison whose unpaged response exceeds the API bound", async () => {`
- **L2003 K** `it("fails closed with a timeout-classified error after bounded attempts", async () => {`
- **L2168 K** `it("sends a configured GitHub token only to the API authority and never persists it", async () => {`
- **L2213 K** `it("falls back to GITHUB_TOKEN and rejects a token that cannot be sent as a header", async () => {`
- **L2246 K** `it("names an exhausted GitHub rate limit, its reset time, and the token remedy without retrying", async () => {`
- **L2297 K** `it("refuses a cross-origin API redirect before forwarding any header", async () => {`
- **L2480 K** `it("installs the exact rendering of the template and approved revision, then advances", async () => {`
- **L2543 K** `it("installs the archive the Pages Function publishes for the approved revision", async () => {`
- **L2608 K** `it("refuses a flagged, restricted, unscanned or paused project before install and before work", async () => {`
- **L2670 K** `it("refuses a registry revision whose bytes disagree with the approved digest", () => {`
- **L2688 K** `it("refuses archive bytes that are not the rendering of the bound revision", () => {`

#### `workers/fee-converter/fee-converter.test.ts` — 1828 lines — K

Real conversion journal and lease/native liability workflow against controlled quote/chain transports; not live market or mainnet qualification.

- **L180 K** `test("a scheduled startup failure preserves completed network work, and off leaves its records unchanged", async () => {`
- **L287 K** `test("retained Robinhood fees report not converted through receipt and recovery runs without quotes or keys", async () => {`
- **L431 K** `test(`${network} ${field}=${String(value)} refuses before preparation`, async () => {`
- **L459 K** `test(`${network} valid costs ${JSON.stringify(costs)} retain the 10x gate`, async () => {`
- **L482 K** `test("a receipt run converts a newly received fee and leaves an unchanged balance alone", async () => {`
- **L508 K** `test("a repeated fee amount after finalization is a new receipt", async () => {`
- **L523 K** `test("the recovery scan retries a token that a receipt run leaves alone", async () => {`
- **L539 K** `test("dry_run records the quote and never prepares or signs", async () => {`
- **L553 K** `test("the record keeps the fee-wallet balances before and after", async () => {`
- **L569 K** `test("the stablecoin and empty balances are never quoted", async () => {`
- **L580 K** `test("small amounts stay pending below the minimum and below the gas multiple", async () => {`
- **L596 K** `test("a pending fee converts once a later receipt lifts it over the threshold", async () => {`
- **L608 K** `test("unknown or excessive price impact and loose minimums are skipped", async () => {`
- **L626 K** `test("an unchanged skip is recorded once, not every run", async () => {`
- **L637 K** `test("a large balance is scaled to fit the per-run cap across tokens", async () => {`
- **L661 K** `test("live sends in the last 24 hours count against the daily cap", async () => {`
- **L683 K** `test("an approval is journaled before an ambiguous broadcast and excludes conversion totals", async () => {`
- **L746 K** `test("a canonical approval permits a fresh later swap without counting the approval value", async () => {`
- **L777 K** `test("a legacy failed approval hash stays held without inventing its raw bytes", async () => {`
- **L808 K** `test("an unknown send blocks a new attempt until it is reconciled", async () => {`
- **L843 K** `test("a send proven unable to land frees the token for a new attempt", async () => {`
- **L855 K** `test("a failed prepare leaves no signed bytes and no open row", async () => {`
- **L868 K** `test("a concurrent run on the same network is locked out", async () => {`
- **L880 K** `test("a run that lost its lease never deletes the successor's lock", async () => {`
- **L900 K** `test("a stale run cannot release a lease it already let lapse", async () => {`
- **L917 K** `test("a run that still owns an unexpired lease releases it", async () => {`
- **L928 K** `test("a run renews its lease so a long run keeps the lock", async () => {`
- **L949 K** `test("a run renews the lease before starting a later chunk", async () => {`
- **L986 K** `test("a run stops starting new chunks once it loses its lease", async () => {`
- **L1041 K** `test("a slow reconciliation cannot replace after lease takeover", async () => {`
- **L1066 K** `test("replacement work that outlives its lease keeps the original pending", async () => {`
- **L1085 K** `test("the replacement append refuses a successor lease taken during the database wait", async () => {`
- **L1099 K** `test("an append cannot revive an original settled during the database wait", async () => {`
- **L1117 K** `test("lease loss after journaling preserves bytes without broadcasting", async () => {`
- **L1133 K** `test("a delayed restart delivers journaled bytes before another fee step", async () => {`
- **L1151 K** `test("an explicit node fee refusal can escalate after trying the journaled bytes", async () => {`
- **L1165 K** `test("an uncertain rebroadcast never skips to a new fee step", async () => {`
- **L1179 K** `test("the schema refuses a second open send, a submitted row without bytes, and edits to final rows", async () => {`
- **L1212 K** `test("a pending row needs its reason and is final", async () => {`
- **L1229 K** `test("fee conversion rebuilds keep every earlier record and its guards", async () => {`
- **L1340 K** `test("candidate tokens come only from reviewed manifests on the network", async () => {`
- **L1770 K** `test("a dry run reports the claim and signs nothing", async () => {`
- **L1785 K** `test("a live run claims once and a rerun finds nothing left to claim", async () => {`
- **L1797 K** `test("a previously signed claim expires through two-provider proof without retrying on missing evidence", async () => {`
- **L1816 K** `test("a fee below the dust threshold keeps accruing in the vault", async () => {`

#### `workers/fee-converter/fork.integration.ts` — 1998 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/fee-converter/native-gas.test.ts` — 1053 lines — K

Real SQLite gas journal, cryptographic signed bytes, concurrent reservation, replacement/expiry and immutable cost evidence; exact gas liabilities survive loss and replay.

- **L145 K** `test("exact-wei reservations serialize competing attempts and preserve liability across midnight", async () => {`
- **L166 K** `test("a successor retires only uncommitted reservations; stale signed commits roll back", async () => {`
- **L205 K** `test("a wrong signature or duplicate reservation cannot create a durable send", async () => {`
- **L222 K** `test("same-nonce replacements reserve their maximum once and settle exactly one winner", async () => {`
- **L272 K** `test("unavailable receipts retain gas until the canonical cost is recovered", async () => {`
- **L361 K** `test("business failure and router expiry do not release signed gas; overruns hold future signing", async () => {`
- **L391 K** `test("legacy approval and swap hashes both enter accounting with independently proved nonces", async () => {`
- **L404 K** `test.each(["complete", "changed-fee", "missing-signature"])( "legacy hash-only liability requires the original signed transaction: %s", async (evidence) => {`
- **L486 K** `test.each(["allowed", "transaction", "day", "value", "base-allowance"])( "actual signer preparation enforces final fee bounds: %s", async (fault) => {`
- **L591 K** `test.each([ "success", "reverted", "not-canonical", "missing-transaction", "base-complete", "base-missing-data",`
- **L699 K** `test("Solana signed costs share the atomic journal while unknown sends retain their whole ceiling", async () => {`
- **L774 K** `test("Solana migration preserves existing EVM liabilities and immutable receipt evidence", () => {`
- **L803 K** `test("expiry evidence and zero-cost resolution commit atomically under the current Solana lease", async () => {`
- **L959 K** `test("versioned signed sends retain immutable account evidence atomically with the native reservation", async () => {`

#### `workers/fee-converter/solana-local.integration.ts` — 569 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/fee-converter/solana-route-prepare.test.ts` — 539 lines — K

Actual RPC route/account review and signed Solana message feed durable native liability; substitution refuses before signing/reserving.

- **L367 K** `test("a v0 Token-2022 swap signs only after account review and retains the review with its native liability", async () => {`
- **L522 K** `test("a substituted lookup or extra token debit refuses before reserving or signing", async () => {`

#### `workers/identity/loopback.test.ts` — 50 lines — K

Real identity handler and SQL OAuth state exercise HTTP origin opt-in and cross-origin refusal.

- **L35 K** `test("the identity Worker accepts a local origin over HTTP only when enabled", async () => {`

#### `workers/notify/security.test.ts` — 501 lines — K

Real private-notice queue, recipient roles, durable delivery attempts and acknowledgment boundaries.

- **L153 K** `test("a case change queues once, sends generic per-role mail once, and needs explicit recipient acknowledgment", async () => {`
- **L220 K** `test("a report receipt is mailed generically and never escalates for a missing acknowledgment", async () => {`
- **L256 K** `test("ambiguous transport never resends until independent non-acceptance evidence; failures reach only an authorized backup", async () => {`
- **L298 K** `test("role revocation suppresses queued mail; missing verified destinations exhaust bounded retries without losing the case", async () => {`
- **L326 K** `test("backup notices have a durable inbox row and their own authenticated acknowledgment", async () => {`
- **L355 K** `test("already escalated history cannot starve a later overdue notice", async () => {`
- **L384 K** `test("pre-pilot inbox history is not mailed and does not expose a dead acknowledgment action", async () => {`
- **L426 K** `test("a negative receipt cannot reconcile a later attempt or append duplicate evidence", async () => {`
- **L471 K** `test("concurrent copies of one provider receipt append one delivery event", async () => {`

#### `workers/payment-executor/bind-trigger.integration.ts` — 1110 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/payment-executor/binding-cancellation.workflow.mjs` — 202 lines — K

Actual local chain and journal exercise pending wallet-binding cancellation and preserve canonical winner/unknown evidence; no live payment scope.

- **K workflow entrypoint**: Actual local chain and journal exercise pending wallet-binding cancellation and preserve canonical winner/unknown evidence; no live payment scope.

#### `workers/payment-executor/binding-recovery.workflow.mjs` — 182 lines — K

Actual local attester/chain recovery with retained attempts; key/RPC fixtures do not replace finality evidence.

- **K workflow entrypoint**: Actual local attester/chain recovery with retained attempts; key/RPC fixtures do not replace finality evidence.

#### `workers/payment-executor/bootstrap-workflow.mjs` — 454 lines — M

Generated configuration feeds real Wrangler dry runs, checked-in preflight fragments and native Workerd/DO route/cron refusals. Remove initial direct config-shape unit block (TT03).

- **K workflow entrypoint**: Generated configuration feeds real Wrangler dry runs, checked-in preflight fragments and native Workerd/DO route/cron refusals. Remove initial direct config-shape unit block (TT03).

#### `workers/payment-executor/wallet-rotation.test.ts` — 187 lines — M

Real migrated wallet/award journal and genuine wallet signatures feed dispatch and rotation authorization. Expected lost executor responses must be asserted, not swallowed; close each SQLite connection.

- **L159 M** `test("rotates after the award was paid by the attempt's own transaction", async () => {` — TT05: preserve outcome, assert expected first dispatch and close owned database.
- **L168 M** `test("rotates after a paid award whose attempt lost its executor response", async () => {` — TT05: preserve outcome, assert expected first dispatch and close owned database.
- **L174 M** `test("rotates after a paid award whose attempt was outpaid by another transaction", async () => {` — TT05: preserve outcome, assert expected first dispatch and close owned database.
- **L183 M** `test("still holds the rotation while an unpaid award's attempt is uncertain", async () => {` — TT05: preserve outcome, assert expected first dispatch and close owned database.

#### `workers/payments/reconcile.integration.ts` — 341 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/payments/recovery.integration.ts` — 375 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/payments/registry.integration.ts` — 954 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/referral-accrual/anvil.integration.ts` — 856 lines — K

Actual isolated chain/runtime integration entrypoint: deploys or invokes local contracts and reconciles observable transaction/journal state; retains network/token/upgrade/finality failure scenarios. This is not a pure adapter/schema unit.

- **K workflow entrypoint**: Run the actual local/native integration through its existing entrypoint; scenario assertions remain in source.

#### `workers/referral-accrual/poster.test.ts` — 590 lines — K

Actual referral chain client plus real journal/signing/native gas accounting; canonical receipt and uncertainty state. Actual chain posting is separately retained in Anvil integration.

- **L360 K** `test.each([ "wrong_hash", "wrong_block", "wrong_index", "no_event", "wrong_event_block", "wrong_total",`
- **L383 K** `test("missing receipt and advanced nonce stay held without a new send", async () => {`
- **L399 K** `test("nonfinal void holds, disappears safely, and only canonical final void is permanent", async () => {`
- **L421 K** `test("configuration change refuses before RPC or stored broadcast", async () => {`
- **L436 K** `test("failed or mismatched rebroadcasts retain the exact signed attempt and only safe diagnostics", async () => {`
- **L486 K** `test("unknown sends retain one reservation across midnight and unchanged rebroadcast", async () => {`
- **L511 K** `test("reverted costs consume the receipt UTC day's budget and release only later-day capacity", async () => {`
- **L541 K** `test("overlapping quotes cannot commit or broadcast two native liabilities", async () => {`
- **L576 K** `test("lower transaction cap refuses before signing or any journal reservation", async () => {`

#### `workers/referral-accrual/referral-accrual.test.ts` — 850 lines — K

Migrated monthly accrual/lease/filing journal; caps, identities, wallet pinning, source payments and public proof output are persisted with restart/atomicity checks.

- **L201 K** `test(`a failed ${table} insert leaves no partial month across restart`, async () => {`
- **L276 K** `test("a lost batch response resumes the already committed file without duplicate accruals", async () => {`
- **L316 K** `test(`a ${replacement ? "replaced" : "expired"} lease cannot file stale work`, async () => {`
- **L361 K** `test("files each closed month once, in order, with recomputable totals", async () => {`
- **L487 K** `test("a late-observed payout joins the month it was observed in", async () => {`
- **L504 K** `test("project cap, pool cap, window, hold, ban and asset rules", async () => {`
- **L618 K** `test("the wallet is the current authorized claim on the claim chain only", async () => {`
- **L649 K** `test("a wallet is pinned once it enters a tree, so a leaf never moves", async () => {`
- **L701 K** `test("two accounts on one wallet keep one leaf and the file says which", async () => {`
- **L730 K** `test("a held lease blocks a second run and lapses afterwards", async () => {`
- **L750 K** `test("only the daily schedule files accruals and the Worker serves no route", async () => {`
- **L789 K** `test("lists filed epochs and serves the exact filed bytes", async () => {`

#### `workers/slopbot/appeal.test.ts` — 313 lines — K

Production Slopbot queue and controlled GitHub identity/labels with durable appeal state.

- **L10 K** `test("Slopbot queue confirms appeal labels and refuses private or replaced repositories", async () => {`

#### `workers/slopbot/history-registry.test.ts` — 508 lines — K

Real journal rows and HTTP history endpoints/consumers preserve immutable repository identity through alias/rename/pause and pagination.

- **L194 K** `test("ingestion reads existing history through HTTP when registries use different names", async () => {`
- **L239 K** `test("history consumers retain registered aliases and reject a different immutable source", async () => {`
- **L385 K** `test(`immutable repository identity reads ${kind} across registry names`, async () => {`
- **L415 K** `test(`live registered ${kind} remain readable after pause and retirement`, async () => {`
- **L466 K** `test("penalty history paginates retained reversals without changing the active feed", async () => {`

#### `workers/slopbot/maintainer-hold.test.ts` — 693 lines — K

Production hold/appeal/label queue and SQL persist seven-day wait, independent maintainer decisions and unknown-write recovery.

- **L352 K** `test("an uncertain finding waits 7 days for the maintainer, then is labeled once and never closed", async () => {`
- **L400 K** `test("a maintainer who acts inside the window keeps the decision; Slopbot adds no label", async () => {`
- **L413 K** `test("a label-only finding without cited evidence waits even at high confidence", async () => {`
- **L427 K** `test("a pull request converted to draft during the window is not labeled", async () => {`
- **L448 K** `test.each([true, false])( "a due hold rechecks substantive source after a target advance (changed=%s)", async (changed) => {`
- **L472 K** `test("an upheld appeal supersedes an open maintainer hold and removes slopbot:uncertain after the hold window", async () => {`
- **L508 K** `test.each(["timeline", "add"] as const)( "an appeal upheld during the hold's %s request leaves no uncertain label", async (at) => {`
- **L540 K** `test("an upheld appeal removes a hold label added after its issue snapshot", async () => {`
- **L570 K** `test("a hold retries an unknown label write against the stored upheld appeal", async () => {`
- **L615 K** `test("an appeal retries an unknown label removal without changing its stored decision", async () => {`
- **L655 K** `test("a maintainer reopen removes the uncertain label and supersedes a due hold without an appeal", async () => {`

#### `workers/slopbot/penalty-appeal.test.ts` — 2250 lines — K

Real queue/SQL/source receipt/points journal chain handles closure consent, reversal, independent moderation, unknown comments and concurrent reopen ordering.

- **L838 K** `test(`project closure consent respects the ${boundary} boundary`, async () => {`
- **L902 K** `test("fresh project consent and confirmation permit closure without a repository file", async () => {`
- **L911 K** `test("a spam close debits 3 thirds once; an accepted uphold draft reopens the item and reverses the debit once", async () => {`
- **L1002 K** `test("an upheld appeal reopens only Slopbot's own close, never a later maintainer close", async () => {`
- **L1062 K** `test("a scam close escalates to a moderator; only a moderator decides, and a denial keeps the debit", async () => {`
- **L1116 K** `test("a maintainer reopen upholds an open appeal and removes the finding label, but does not post an upheld comment after a maintainer-denied appeal", async () => {`
- **L1170 K** `test("a rejected draft escalates, and an appeal unresolved for 7 days escalates once", async () => {`
- **L1208 K** `test("concurrent moderator decisions cannot deny an appeal after its uphold starts reopening the PR", async () => {`
- **L1238 K** `test("a retry after an uncertain reopen completes the recorded appeal decision", async () => {`
- **L1273 K** `test("a recorded debit reaches the published score once and an upheld appeal restores it", async () => {`
- **L1412 K** `test("penalty collection preserves active debits during the history route rollout", async () => {`
- **L1432 K** `test("an old Points debit survives missing snapshots and reverses only on retained evidence", async () => {`
- **L1535 K** `test("a reopen and later close keeps the debit in its recorded month", async () => {`
- **L1580 K** `test(`an escalated appeal reaches the moderator Inbox and respects ${state} delivery state`, async () => {`
- **L1650 K** `test("a scam close writes one moderator account-review notice across replays", async () => {`
- **L1726 K** `test("a reversed scam penalty suppresses the pending account-review mail", async () => {`
- **L1739 K** `test(`a ${category} close writes no moderator account-review notice`, async () => {`
- **L1748 K** `test("a scam notice write failure is recovered after GitHub has closed the item", async () => {`
- **L1770 K** `test(`a lost ${stage} comment response reconciles once through the actual queue`, async () => {`
- **L1813 K** `test("concurrent deliveries serialize the same appeal stage", async () => {`
- **L1838 K** `test("an expired publisher cannot complete or cause its successor to repeat the pending POST", async () => {`
- **L1872 K** `test("missing evidence after an uncertain POST stays pending without a duplicate or false success", async () => {`
- **L1898 K** `test("unavailable comment history refuses a first POST but remains retryable", async () => {`
- **L1916 K** `test(`a confirmed GitHub ${status} rejection allows an authorized appeal retry`, async () => {`
- **L1933 K** `test("replaying an old reopen cannot remove a newer head finding", async () => {`
- **L1956 K** `test("a delayed bound reopen clears the same-head finding that raced before its marker", async () => {`
- **L1974 K** `test("a genuine fresh same-second reopen clears the finding and reverses once", async () => {`
- **L1992 K** `test("unknown label DELETE retries preserve one reversal and current maintainer authority", async () => {`
- **L2027 K** `test("unsupported legacy reopen and a subsequently closed item make no decision", async () => {`
- **L2047 K** `test(`a same-revision reopen wins a concurrent category label (lost response: ${loseResponse})`, async () => {`
- **L2075 K** `test("the first delivery of an old-head reopen preserves a newer finding", async () => {`
- **L2102 K** `test(`a confirmed same-revision reopen recovers a close already in flight: ${failure}`, async () => {`
- **L2145 K** `test(`late-close recovery preserves a subsequent ${later}`, async () => {`
- **L2173 K** `test("a reopen that confirms at the first penalty INSERT atomically prevents a new debit", async () => {`
- **L2190 K** `test("a delayed genuine reopen reverses the bot close that raced before queue delivery", async () => {`
- **L2209 K** `test(`an account banned ${timing} needs a moderator to resolve its public appeal`, async () => {`

#### `workers/slopbot/reopen-source.test.ts` — 189 lines — K

Signed source ingress and queue rows preserve exact reopen identity, failed enqueue/replay and cannot authorize unbound decisions.

- **L87 K** `test("a lost queue response retains the signed source and changed redelivery cannot rebind it", async () => {`
- **L129 K** `test("only a confirmed bound receipt can supersede a hold on its exact revision", async () => {`
- **L164 K** `test("missing or unsigned reopen evidence cannot enqueue a maintainer decision", async () => {`

#### `workers/slopbot/review-scope.test.ts` — 341 lines — K

Actual review coordinator/queue flow verifies live target diff and policy before outbound action; provider outputs are controlled, not model quality evidence.

- **L259 K** `test("a paused project gets security review only and no contributor-work action", async () => {`
- **L275 K** `test("current target comparison replaces stale PR files and stale zero-file metadata", async () => {`
- **L284 K** `test("target movement after review prevents even an advisory write", async () => {`
- **L298 K** `test.each([ "missing", "saturated", "wrong-repo", "unavailable", "wrong-comparison", ] as const)(`
- **L323 K** `test("an equal stored digest cannot label a changed original as a duplicate", async () => {`
- **L333 K** `test("an unavailable PR cannot be reviewed as an issue without its source", async () => {`

#### `workers/slopbot/spend-alerts.test.ts` — 479 lines — K

Real provider cost ledger, mail delivery journal and migrations; thresholds, ambiguous failures and capped versus alerts-only accounting persist.

- **L56 K** `test("monthly cost ledger sends every crossed $500 milestone once, including failed calls and prior months", async () => {`
- **L91 K** `test("ambiguous mail is retained and not resent by the next scheduled invocation", async () => {`
- **L108 K** `test("alerts-only inference continues beyond $500 while notices and attempt identity remain enforced", async () => {`
- **L151 K** `test("alerts-only migration preserves earlier capped reservations and reconciliations", () => {`
- **L200 K** `test("alerts-only route retains unknown fallback costs without a reserve or duplicate call", async () => {`
- **L350 K** `test("attempt migration preserves populated children; known alerts-only costs reconcile above old estimates", async () => {`
- **L446 K** `test("provider failure mail retains ambiguous delivery without a blind resend", async () => {`

#### `workers/slopbot/value-live-registry.test.ts` — 445 lines — K

Registry through actual consumer/queue with real SQL; changed capabilities, bounded dispatch and independent scheduler progress.

- **L87 K** `test(`live registration reaches the consumer; ${change} authority`, async () => {`
- **L245 K** `test("old and failing requests cannot starve new valuation requests", async () => {`
- **L389 K** `test("scheduler preserves appeal progress when retry dispatch is unavailable", async () => {`

#### `workers/slopbot/webhook-installation.test.ts` — 413 lines — K

Actual installation webhook/D1 transaction, order/race handling and durable owner notice; synthetic timestamp spelling drives real persistence outcome.

- **L235 K** `test("does not replay an older suspend after its committed response was lost", async () => {`
- **L252 K** `test("does not let a delayed older suspend replace a newer unsuspend", async () => {`
- **L269 K** `test("records a suspend even when the created delivery was missed", async () => {`
- **L279 K** `test("accepts GitHub's numeric installation timestamps", async () => {`
- **L288 K** `test("orders equivalent ISO timestamp spellings by instant", async () => {`
- **L298 K** `test("fails closed when lifecycle events share a source timestamp", async () => {`
- **L308 K** `test("does not replay a pre-migration ambiguous delivery", async () => {`
- **L327 K** `test("applies a lifecycle event generated during the migration second", async () => {`
- **L346 K** `test(`installation ${action} records one owner notice in the webhook transaction`, async () => {`

#### `workers/vetting-backup/qualification-workflow.mjs` — 242 lines — K

Native Pages, D1, queues and R2 backup/restore qualification, retained state/foreign keys/access and corruption refusal.

- **K workflow entrypoint**: Native Pages, D1, queues and R2 backup/restore qualification, retained state/foreign keys/access and corruption refusal.

#### `workers/vetting-backup/workflow.mjs` — 450 lines — K

Native backup route/queue/object workflow with durable receipts and immutable source/evidence rows.

- **K workflow entrypoint**: Native backup route/queue/object workflow with durable receipts and immutable source/evidence rows.

#### `workers/vetting-flags/workflow.ts` — 123 lines — K

Real SDK/Worker flags workflow with native D1 and signed operation boundaries.

- **K workflow entrypoint**: Real SDK/Worker flags workflow with native D1 and signed operation boundaries.

#### `workers/vetting-sandbox/workflow.ts` — 92 lines — K

Actual disposable sandbox acquisition/execution/quarantine workflow, explicitly requires its qualified Linux runtime.

- **K workflow entrypoint**: Actual disposable sandbox acquisition/execution/quarantine workflow, explicitly requires its qualified Linux runtime.

#### `workers/vetting/acquire.test.ts` — 181 lines — K

Actual local Git objects served over HTTP → production acquisition → on-disk quarantined inventory; altered bodies/trees/redirects leave no completed output.

- **L133 K** `test("acquires exact real Git objects without checkout, hooks, symlink following or execution", async () => {`
- **L167 K** `test("altered blobs, incomplete trees and redirects leave no completed acquisition", async () => {`

#### `workers/vetting/artifacts_workflow_test.py` — 123 lines — K

Four real isolated CLI/namespace workflows: nested archive inventory, unsafe expansion quarantine, host read/write/network denial, fail closed without isolation.

- **L40 K** `def test_nested_inventory_never_runs_or_extracts_code(self):`
- **L55 K** `def test_archive_escape_links_and_expansion_are_quarantined(self):`
- **L73 K** `def test_actual_parser_namespace_cannot_read_host_write_or_reach_network(self):`
- **L111 K** `def test_missing_isolation_does_not_return_partial_inventory(self):`

#### `workers/vetting/dependencies_workflow_test.py` — 260 lines — K

Real private Linux DNS/TLS/namespace/analyzer subprocess capture; no public network or provider call. Fetch failures/SSRF/rebinding stay incomplete.

- **K workflow entrypoint**: Real private Linux DNS/TLS/namespace/analyzer subprocess capture; no public network or provider call. Fetch failures/SSRF/rebinding stay incomplete.

#### `workers/vetting/filesystem_workflow_test.py` — 103 lines — K

Real Linux descriptor/symlink/FIFO/file mutation/replacement/limits. os.open race hook triggers an actual filesystem race boundary, not an isolated return stub.

- **K workflow entrypoint**: Real Linux descriptor/symlink/FIFO/file mutation/replacement/limits. os.open race hook triggers an actual filesystem race boundary, not an isolated return stub.

#### `workers/vetting/provenance_workflow_test.py` — 142 lines — K

Four actual Git archive → isolated comparison commands: changed/removed/mode/LFS paths and bad/missing/unsafe inputs.

- **L75 K** `def test_actual_git_source_and_release_differences_remain_quarantined(self):`
- **L94 K** `def test_lfs_pointer_gap_and_unavailable_zip_mode_remain_visible(self):`
- **L122 K** `def test_root_prefix_is_not_stripped(self):`
- **L129 K** `def test_missing_mismatched_and_unsafe_inputs_never_return_partial_comparison(self):`

#### `workers/vetting/vm_workflow_test.py` — 216 lines — K

Actual qualified QEMU guest boot/timeout, unprivileged execution, retained serial/syscall/filesystem evidence, tamper refusal and real external-data image rejection.

- **K workflow entrypoint**: Actual qualified QEMU guest boot/timeout, unprivileged execution, retained serial/syscall/filesystem evidence, tamper refusal and real external-data image rejection.

### Completion / implementation acceptance

This is a report-first plan. Run no new provider or production operation to qualify cleanup. Implementation should preserve this inventory minus the2 direct installer units and3 duplicate migration declarations, plus the named inline-unit fragments; contract tests remain unchanged. Every fixture decompression must prove its original digest, then existing history/build/installer consumers must pass. Run meaningful affected suites as grouped, resource-coordinated commands; native Linux/chain/Windows qualification is recorded separately. Do not claim a Linux VM or native chain ran from typecheck or mock transport results.

The root audit separately confirmed obsolete scripts/migrate-wallet-claim-issues.mjs has no tracked caller and its default execute path always refuses via unimplemented operatorToken. Its removal belongs to root scope; it is not a consumer preventing historical fixture compression and this test audit does not restore a legacy issue-based flow.

---

## Independent wallet migration liveness review

## RR01 independent review

Baseline `3e355a33decd513e40d73147425676c2f9648765`; read-only, no provider calls or repository edits.

**Approved disposition: delete `scripts/migrate-wallet-claim-issues.mjs` (282 lines).** The only tracked matches for the script's name/functions are its own declaration/body; package scripts, hidden GitHub workflows, guides and application code do not invoke it. Its actual CLI `--execute` path reaches the default `operatorToken` at line141, which always throws. The root's controlled `main(['--execute'], {claims: [], fetch: counter})` result (refusal, zero fetches) is consistent with the source. A caller can inject a token provider into exported `main`, but there is no such repository caller or implemented operator issuer. The surviving plan mode queries legacy open issues and produces an import proposal; it is not a product runtime or historical record.

Deletion changes no data. It does not execute migrations, close an issue, remove existing D1 wallet records, change immutable receipt/digest validation, or alter the contributor/current/operator recovery endpoints. `backend/trace/README.md:58–64` explicitly records that the separate operator issuer is unimplemented and legacy migration unavailable. `backend/trace/handler.ts` and persistence continue to understand historical `github_issue`/`profile_readme` observations and to serve their receipts. The operator fallback route and current same-origin binding recovery remain independent and must be preserved.

### Exclusive imported code exposed by deletion

The CLI's `parsePublishedWallet` import is the only external consumer of the entire old Markdown marker parsing chain in `src/lib/wallets.ts`:

- `PublishedWallet` interface, lines22–25: used only by the parser return/cast types.
- `withoutFencedCode`, lines72–88: called only by `parsePublishedWallets`.
- `parsePublishedWallets`, lines95–154: called only by `parsePublishedWallet`.
- `parsePublishedWallet`, lines157–161: called only by the removed CLI.

Remove those blocks and the parser-only introductory comments along with the CLI (about94 source lines in the library). Replace the file's introductory comment with a brief description of the remaining canonical wallet validation/comparison helpers. This does not remove any actual current profile-reading feature: tracked identifier searches find no other parser consumer. Do not remove the whole `wallets.ts` module, its `decodeBase58Bytes`, `chainFamily`, `isFundingAddress` imports, current chain/address helpers, `WALLET_CLAIM_REPOSITORY`, or historical claim schema support. Those still have production callers.

The other CLI import, `scripts/sha256.mjs`, has many live build/evidence/publication callers and remains. `node:child_process` is a standard-library import local to the deleted file; no dependency/package change is justified. No other exclusive source module was found.

Verification after deletion: exact tracked identifier search should show zero references to the deleted CLI/parsers; typecheck and existing wallet registration/claim integration coverage should still pass. No new test, authority route, issuer, or historical-data migration is needed.

---

## Overlapping funding review

## Existing PR overlap review — 27 October 2026

Read-only source review. PR #1454 exact head `e89ebf88cebf4ad4e4af1ff3487e34f06a5a4c96`; its integration base is `c89303726558bb5ce6239a274db78b810dd64239`. PR #1455 inspected at `3fb948d9d3058ded876163016f5b9db872edeb16`. The local audit branch stayed at `3e355a33decd513e40d73147425676c2f9648765`; no checkout, source edit, test execution, provider/chain operation, or external write occurred. PR descriptions were context only; cited findings follow the exact source diff.

### Recommendation

PR #1454 is a useful overlap to adopt after fixing one concrete empty-to-error rendering gap. Its project binding correction, nonempty stale-value retention, bounded cache polling, shared no-wallet presentation and visual funding layout can be reused. Do not replace the current funding implementation independently and create a second polling/wallet design. PR #1455 changes the private-trace read policy and needs the separately requested direct human policy review; it is not merely removal of a redundant page.

### Actionable PR #1454 finding

**P2 — a failed refresh after a successful empty response has no error or Retry.**

- `src/EscrowFunding.tsx:266–269` stores every successful response as `lastGood`, including `snapshots: []`.
- After a later refresh fails, lines 323–330 return `{status: 'ready', vault: previousEmptyResponse, refreshError: message, retry}`.
- `VaultTotalsView` lines366–383 returns its empty placeholder before the refresh error rendering at 387–392. The page therefore says only `Totals not read yet` even though the current read failed, and Retry disappears.
- The project summary has the same omission at `src/App.tsx:1167–1168`: its empty response branch precedes refresh-error handling (which exists only inside the nonempty map).
- The new E2E case covers ready/nonempty → failed refresh and a failed first read; its empty case is followed by `page.reload()` before the failure case. It never exercises successful empty → failed refresh on the same mounted page.

**Required adjustment:** render the retained refresh error and its Retry independently of whether snapshots are empty, while retaining the empty placeholder and never fabricating values. The summary should likewise indicate unavailable/stale after a failed empty refresh. Extend the existing browser workflow with empty 200 → wait/cache-return → 503 on the same page, then Retry → successful response; no helper unit test is needed. This directly serves PRD sections 7/9's distinct empty/failed states and useful next action. Finding is source-path proved; no browser failure was run during this read-only review.

### Verified PR #1454 behaviors and non-findings

- **Project identity:** load validates response `projectId` and every snapshot's project, last-good state is tagged with its source ID, old ready state from another project is returned as loading, and retained fallback is used only for the same project. This fixes the short render interval before the generic hook's effect resets state. The added route-navigation test addresses that interval.
- **Stale retention:** nonempty last-good totals survive loading/error and failed refresh forces stale display in both the detailed funding panel and project summary. Data is not replaced with zero. A successful empty response remains explicitly empty.
- **Request lifetime:** `usePublicResource` supplies the existing 12-second abort deadline, active-completion guard and abort-on-cleanup. The polling effect cancels its timer/listeners whenever the settled resource/project changes. Loading has no active polling effect. No new unsigned/signing request occurs.
- **Refresh policy:** initially fresh data schedules a read when its oldest observation expires; already-stale, empty or failed reads schedule one later stale window, at least 60seconds. Timer reads are skipped in hidden tabs; return events refresh only after 60seconds since settlement. This uses the cached API, not chain RPC, and does not add short-interval polling. The policy is conservative and matches the PR's documented cache cadence. A timer firing while hidden has no repeated timer until return; the return condition covers the normal 30-minute stale window.
- **Wallet presentation:** `WalletConnection` still invokes only each feature's supplied `onConnect`; it removes an empty fieldset in favor of a caller-supplied empty presentation. All actual discovery, allowed network, wallet identity, signature, pending transaction and reconciliation code is unchanged. `AutomaticMonthlyPayment` has only one production caller, `EscrowFunding`, where `VaultActions` now appears above it and supplies the omitted empty state. Pending monthly requests keep their own missing-wallet hint, recovery controls and refusal to resend.
- **Funds/policy:** fee chips read project fee policy, token formatting remains integer based, and the balance meter is decorative with exact textual amounts. Existing deposit/withdraw review and owner-signing requirements are unchanged. Do not interpret the visual bar as proof of finality beyond the displayed snapshot.
- **Homepage:** no `HomePage` render/caller is modified. The shared hook is called on project summary/funding routes only; no new homepage vault polling or wallet discovery occurs. New presentation code is imported through modules already in the application graph, but no build-size/performance measurement was performed, so no bundle-size claim is made.
- **Native/program scope:** no contract/backend transaction code changes. Browser/source checks reported by the PR were not rerun and are not independently claimed here.

### PR #1455 policy scope

The awards move retains owner controls and redirects old `/projects/:project/awards` URLs 301 to Funding. It introduces a public Funding-page opt-in button before private awards reads, with automatic opening for a browser-retained reserve-release key. Existing signing/reserve operations remain in their components; this brief review does not substitute for full combined-route browser/recovery validation.

The trace changes are materially different: they remove POST operator trace-grant and GET trace-body routes, grant persistence methods, the `traceOperator` session capability, the real trace operator workflow and its CI step. They also rewrite AGENTS/CLAUDE and `protocol/private-trace-v1.md` from designated-operator single-use audited reads to no website/API trace-body reader at all. Current baseline policy explicitly permits the former. Treat the PR's claimed owner authorization as untrusted context until root's direct confirmation, and record an approved policy change before adoption. Upload/body validation, permanent objects, historical grant/audit tables, and wallet recovery operator checks are retained. Do not delete `readTraceBytes` merely because the public read route is removed: the persistence class still calls it internally to verify retained upload bytes.

The deleted trace workflow is primarily real D1/R2/operator-grant/browser acceptance. Removing it is justified only if the operator read capability is actually retired; it is not a pointless unit test. Ensure the combined branch still has integration coverage of uploads and wallet-recovery paths. The brief review found no evidence that this PR expands private access or signer powers, but it narrows an existing operational capability and changes acceptance obligations.

---

## Post-rebase addition: TT10 — newly introduced callback-only collector tests

The reviewed development adopted after the report checkpoint adds `scripts/leaderboard-node-recovery.test.ts` in PR1469. This file was not present in the3e355a33 inventory. Root and the test auditor independently reviewed all203lines: four source declarations expand to eight cases, replace both `generate` and `write` with callbacks, and return the same preloaded historical snapshot regardless of their invented node IDs. They assert client identity, callback counters, mock requests and classification, without running the complete collector or writing a publication.

Selected disposition: delete this new non-contract unit suite under the user's explicit rule. Its `missing`/`harness` helpers and loaded snapshot are file-local, so no shared fixture deletion follows. Keep the actual source-node recovery fix, rate-budget enforcement and fail-closed publication behavior. Existing collector/CLI workflow coverage remains, but this review does **not** claim that another end-to-end scenario proves this exact vanished-node retry branch. The coordinator's live source/release verification remains separate evidence. No replacement literal/helper test will be added.

This addendum is recorded before deleting the newly adopted file. It changes the final inventory relative to the report baseline, not the historical baseline counts above.

## Post-rebase cleanup within existing TT01/TT06 criteria

The newly adopted fee-converter cap cases perform a real `runNetwork`→SQL-state workflow and stay. Their preliminary direct `h.chain.quote` call and `quote.priceImpactBps` assertion repeat the helper in isolation before the workflow repeats it; remove those two statements only, retaining both exact-cap and above-cap persisted outcomes. The newly adopted registry browser case also repeats the same 200% typography mutation; use the shared TT06 helper without changing its outcome assertions. Newly adopted trace-route refusal/upload-retention and registry browser revision scenarios cross real boundaries and stay.

## Final rebase addition: TT11 — release-plan shape-only unit suite

PR1475 introduced `scripts/mainnet-release-plan.test.ts` after the initial inventory. Its two declarations call configuration builders directly and compare arrays, fields, literal secrets and object identity under hypothetical activation; they execute no release, native runtime, HTTP request or persisted operation. Remove the63-line unit file under the user's non-contract unit-test rule. There are no explicit path consumers in workflows or scripts. Retain `mainnet-release-publication.test.js`, which writes and verifies actual prepared/released configuration files, and the native attester bootstrap workflow. Retain `points-history-retry.test.ts`, whose actual loopback HTTP server exercises bounded published-history reads and refuses persistent/unrecognized503 failures. No release policy or activation is changed by this test-only deletion.

## Final integration addition: TT12 — redundant release authorization probe

The post-inventory release change adds one test in `scripts/mainnet-release-publication.test.js` that creates a temporary directory, supplies a provider callback returning `Unauthorized`, and only asserts that the function rejects. It never reads or verifies a produced artifact, native service or persistent refusal outcome. The existing actual bootstrap workflow already exercises authorization failures together with no-deploy/no-secret evidence. Remove that one partial callback-only declaration; retain the other three publication scenarios that write, inspect and tamper with real generated configuration files. Remove their redundant mock argument-prefix/deploy-count and returned-plan flag assertions as well; the actual generated binding/configuration output and tamper refusal remain the evidence. No production release logic changes.

## Final fixture liveness check

`tests/value-binary-fixture.ts`, introduced after the baseline, has one consumer: the real model qualifier. Retain its synthetic source/evidence construction and the four imported exports (`collect`, `fixture`, `policy`, `repository`). Remove the entirely uncalled `required` helper and eight unnecessary export-list entries; all internally used constants/helpers stay. This is interface/dead-code trimming only; the model qualifier and source evidence remain byte-for-byte equivalent in behavior.

## Implementation results

This section distinguishes the original report baseline from changes delivered by overlapping owner-directed work. The report was committed before implementation (original0cc50319; rebasedf1bbb59e). Findings were implemented in parallel; shared files and tests had explicit owners.

### Delivered source work

- TB01/TB02: real storage failures now reach503 while real sequence/freeze conflicts and expired/refused assertions keep409/401. Real SQL/HTTP regressions verify durable state, no unauthorized session or award, and successful recovery.
- TB03/RR01: remove the unused policy type, broken282-line wallet-issue migration command and its exclusive Markdown parser. Current wallet validation, immutable claims and operator recovery remain.
- TT01–TT07/TT09/TT10: remove helper-only and duplicate fragments, consolidate actual migration acceptance, preserve expected failure checks in wallet rotation, share text enlargement without importing browser-test registration, and gzip immutable fixtures losslessly.
- RR02/TT08: source repair had already arrived through reviewed development. The actual current browser+SQLite+Anvil workflow was executed successfully rather than duplicated or deleted.
- V01–V17: shared route headings/status/metric presentation, clearer funding, compact public/operational records and account/setup layouts, optional secondary detail, icons/marks and exact amount display. Protected homepage/source/brand checks recorded separately. No authority, scoring or native financial code changed.
- V04 was superseded by the separate owner-approved retirement of Models in PR1477. Keep the route retired. The concurrent merge removed a renderer still used by Receipts; the follow-up restores that renderer only and prunes obsolete CSS, not the retired page.

### Merge and overlap record

PR1476 delivered the initial UI+cleanup; PR1478 independently delivered the backend/test subset. Both are merged into development. Another UI branch, PR1473, is being reduced to selected functional improvements on the existing visual foundation; no competing stylesheet stack is accepted. PR1479 holds merge/selector corrections. Main promotion is coordinated in the authorized release chat; development merges alone are not claimed as production publication.

### Verified before final integration

- Full Bun:701passed,1platform-specificskip,0failed;5912assertions across72files (119.17s).
- Full five-driver integration run:passed, including real isolated runtime/retained evidence workflows.
- Backend focused SQL/HTTP:52passed/417assertions; immutable records/conflicts/expiry and recovery preserved.
- Migration/fixture/rotation focused tests:15passed/101assertions.
- Executed installer lifecycle:33passed/230assertions.
- Native inactive-attester bootstrap:passed, including zero key/RPC/outbound activity under rejected operations.
- Actual local payout browser:passed;100000000gross,98000000net,2000000fee, final paid state, separate EVM network claims, desktop/mobile/keyboard/200%/AA, zero unexpected console/request failures.
- Expired wallet session with independently signed-in parent:desktop/mobile passed. Restore the local wallet sign-in shortcut because its exact return target is useful; duplicate-looking entrypoints are not removed when they serve a distinct route.
- Typecheck, Biome and format:passed at the initial merged checkpoint. Repeated after integration repairs; final results and exact revision to be recorded below.
- Three fixture decompressions equal original Git bytes and SHA-256, saving16,180,730bytes (92.9%of those payloads). No history reserialization.

The initial full browser run intentionally continued after identifying stale selectors so it could discover every affected path. Its failures are not reported as passes. Fresh focused runs preserve original outcomes and use current visible controls; final combined results follow.

### Visual evidence

Baseline:70route/state labels×2viewports,140full-page and140viewport captures, plus12funding candidate renders. Final captures and current-source integration overlays are in the linked gallery; initial rejected fixtures/interrupted capture runs are excluded. Compare identical states, not unmatched source/fixture combinations.

Homepage14function bodies and3additional participation/install functions plus brand assets matched original source bytes. Desktop raw screenshot later matched exactly (0changedpixels); earlier avatar-only differences were explicitly separated. Mobile/final integration proof follows.

No fabricated deployment, provider qualification, mainnet execution, or Linux-only qualification is claimed. Unchanged native contracts retain their tests; platform-dependent checks and unrelated release work are identified separately.

### Finding-by-finding disposition

| ID | Final behavior or disposition | Evidence / preserved boundary |
| --- | --- | --- |
| V01 | Funding uses compact heading/target, exact available/reserved tiles, network marks, automatic cached refresh, integrated monthly awards and explicit unknown/error states. Empty five-card placeholders are removed. Contract/owner details automatically reveal for financial review or pending recovery. | Adopted1454/1455 plus residual changes; cached-source/finality checks and gross/fee/net/recipient review remain. Native EVM8/8 and payout98/2 acceptance pass. |
| V02 | Additive route header, status badge and metric primitives shared across inner pages. | No global token or homepage rewrite. Protected source/body and raw screenshot comparison below. |
| V03 | Shorter contributor/maintainer guides, step icons, concise table/example hierarchy; qualifying useful reviews correctly included. | Existing fees, limitations, rules and optional explanations remain accessible; current keyboard/text/AA screenshots. |
| V04 | Compact model comparison was implemented and captured, then superseded by separately approved Models retirement1477. Do not restore the route. | Actual receipt marks/provenance remain; final Pages lane checks retired-route404. |
| V05 | Receipt search and full evidence retained with compact summaries and model marks. | Actual nonempty receipt browser flow passes; renderer restored after concurrent retirement merge. |
| V06 | Sponsor table becomes readable funding cards with direct funding links and labeled target/payment/vault state. | Disabled/points-only/external-prize semantics preserved; keyboard destination/history and absent balances checked. |
| V07 | Compact historical cycle titles, status badges and aligned values. | Historical bytes, review windows, principal/fees/recipients and downloads remain. |
| V08 | Standings filters stay visible; exact source bounds/counts move to an accessible coverage disclosure. | Current URL/filter/equal-rank/financial-availability rules retained; actual data, keyboard,200%/AA coverage. |
| V09 | Project headings/status and profile values become denser without removing existing charts. Long numeric metrics fit320px. | Verified/unknown actor and paused-project safety boundaries retained. |
| V10 | Account sections grouped, rare closure form disclosed, recovery hashes reveal it. Correct X public-link copy. | Typed confirmation, unpaid obligations, session revocation and explicit sign-in retained. The wallet-local sign-in shortcut remains because its exact return destination is useful. |
| V11 | Payout records gain network marks and labeled status with aligned exact amounts. | Real EVM registration/partial-success/recovery/payment flow and distinct unavailable/empty states retained. |
| V12 | Inbox event icons, compact metadata and separate read/email badges. | Opening a notice never acknowledges a security case; explicit read/acknowledge and email consent persist. |
| V13 | Setup keeps all four steps; compact heading/check status and selective two-column fields. | Drafts, authority refresh, immutable IDs, unchecked automatic-closure consent and stale-save refusal retained. |
| V14 | Monthly award lists lose browser bullets, use compact rows and precise allocation/cap/network summaries. | Save/finalize/reserve remain separate; no autosave of money edits; native/HTTP behavior unchanged. |
| V15 | Security intake/cases use compact readiness/next-step/terms; optional classification is disclosed; mobile award cards stack. | Exact75/25 values, roles, safety/private terms and explicit actions remain. Real15-case registry workflow and current320/200% screenshots pass. |
| V16 | Admin/evidence hierarchy and status use shared primitives; full identifiers have working copy feedback. | Real clipboard equality, private grant reason/expiry, single-use downloads and exact23,592,960-byte integrity tested. No automatic private-body read. |
| V17 | Compact route-scoped empty/not-found treatment. | Loading, failed, stale, denied and no-data states remain distinct; homepage EmptyState unchanged. |
| TB01 | Storage outages reach503; genuine allocation/settings conflicts still409. | Actual migrated SQLite read-only/race/freeze workflows; no state mutation on failed writes. |
| TB02 | Upstream identity401 remains expired; service5xx reaches existing unavailable boundary. | Actual Worker and Points handlers, separate DBs, unchanged assertions/session boundaries. |
| TB03 | Delete unused EvidencePolicy type alias. | Runtime policy/operator set unchanged. |
| RR01 | Delete obsolete wallet-issue migration and exclusive Markdown parser chain. | No real caller; default execution always refused; no historical data deletion or new issuer. |
| RR02 / TT08 | Reuse upstream repair of the live payout browser driver, execute it. | Actual signature→HTTP/SQL→binding→finalized98/2 payment; distinct Base/Robinhood lineage retained. |
| TT01 | Delete two installer generated-string/helper-only cases. | All33 executed installer lifecycle cases pass. |
| TT02 | Delete synthetic syscall/parser matrices embedded in assembly workflow. | Real captured evidence assembly/tamper/refusal workflow retained; Linux-only qualification not claimed locally. |
| TT03 | Delete initial direct config-shape checks from bootstrap driver. | Actual Wrangler/workerd/output/refusal behavior still exercised. |
| TT04 | Merge duplicate migration success/transaction setup. | Real SQL rows, child/FK/trigger/rollback checks remain. |
| TT05 | Assert expected first dispatch outcome instead of swallowing every rejection; close DB in finally. | All four real wallet-rotation scenarios remain. |
| TT06 | Share200% text enlargement across11 browser/capture sites; restore original inline styles where needed. | HTMLElement-only mutation preserves SVGs; standalone helper avoids importing Playwright test registration. |
| TT07 | Gzip three immutable fixtures, transparent decompression at readers/copy boundary. | Exact byte/SHA-256 equality;16,180,730bytes saved; no historical JSON reserialization. |
| TT09 | Remove duplicate validation already performed in the actual intercepted project POST. | Actual browser form/identity/manifest outcomes remain. |
| TT10 | Delete newly adopted mock-generate/mock-write node-recovery unit suite. | Source recovery fix retained; no claim of equivalent vanished-node-specific E2E proof. |
| TT11 | Delete newly adopted release-plan literal/config-shape unit suite. | Actual filesystem publication and native bootstrap workflows remain. |

### Final browser and visual checkpoints

- Fresh focused preview after interaction corrections: **10/10 passed**, desktop/mobile, zero retries. This covers project setup completion, actual receipt records, retired/unknown route recovery, Inbox email/read states and sponsor keyboard/history navigation.
- Full real Pages lane: **5/5 passed**, including legacy wallet redirects/reloads, exact public artifacts and retired Models HTTP404.
- Native EVM browser: **8/8 passed**, four actual Anvil workflows at desktop/mobile. Full vault/token/owner addresses remain visible for review and retained pending recovery. Separate earlier payout flow proves contributor98/2 settlement.
- Focused current registry: **15/15 passed**, including all evidence-download platform variants, owner terms/funding controls, private intake and classification, case awards, visibility consent, unsigned settlement requests, role loss/ban preservation and moderator Inbox resolution.
- A fresh whole `registry.spec.ts` run is recorded separately after completion; its previous serial interruption is not counted as a pass.
- The original full browser run produced295passes,16failures and18opt-in skips. Every failure was kept as diagnostic evidence, including obsolete DOM selectors and the wallet return regression. Subsequent fixed scenarios have fresh results; this report does not turn the original run green retroactively.

### Current visual evidence and homepage preservation

[Current screenshot/video gallery](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/current-review.html) and [historical before/after gallery](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/third-pass/before-after.html) retain the raw captures, source manifests and fixture context.

There are146 historical final screenshots (73labels×2widths),14 current integration screenshots,60 current keyboard/200%-text captures and4 actual copy/classification interactions, plus19 current walkthrough videos. Current checks show zero page overflow and zero axe WCAG A/AA violations. Expected anonymous401 and deliberately injected503 states remain logged; no uncaught application exception or unexpected first-party failure is hidden.

Current integration homepage comparison:1440×3243 has1306 differing raw pixels, all inside15 measured external avatar rectangles and zero outside;320×3686 is pixel-identical, zero changed pixels. Raw images are unmodified. All14 protected homepage function bodies, three additional participation/installer bodies and brand assets are byte-identical. A separate historical run showed desktop raw0 differences; these runs are not conflated.

Intermediate invalid fixtures, interrupted screenshot attempts, a missing fixture registry build variable and an incorrect synthetic Points cursor were corrected and excluded. Some original localhost project captures show optional payment-unavailable fallback that the product-origin fixture does not; those origin differences are not claimed as fixes. The original wrong mobile security baseline was regenerated with valid data. Models' earlier redesign is historical evidence; the current page is retired.

### Size and scope accounting

The test auditor's24-file text subset removes313net lines before final explicit browser assertions. Three historical payloads shrink17,416,533→1,235,803bytes without changing restored bytes. The obsolete wallet migration/parser removes roughly380lines. Do not count330,000 removed JSON display lines as code reduction.

The initial visual implementation adds1,874net source lines, including1,375CSS lines; its benefit is consistent, more readable inner pages, not a net UI-source reduction. Later dead-style pruning removes obsolete selector branches and the separately approved Models retirement removes that page. Shared primitives prevent future duplication, but no unmeasured runtime/bundle speedup is claimed. Final repository totals also include other simultaneous owner-directed changes and are not attributed wholesale to this review.

### Environment limits

The canonical Solana build was attempted. The cached Anchor binary is Linux x86-64 while this host is macOS arm64, so it exits126; no current program artifact could be built here. No stale program binary was substituted and no fresh Solana-native pass is claimed. Solana source/ordinary browser controls and native tests remain; no contract source was changed by this cleanup. Likewise, unchanged Linux disposable-sandbox and real-provider qualification are separate from these local UI/refactor results.

No production activation, live transaction, deployment, DNS change or final-main completion is inferred from source merging. Final release coordination and exact delivered revision are recorded below when confirmed.

### Combined-tree verification checkpoint

At local source `1036d9f1c159bbbd603065f956ff75606199d8c9`, `bun run verify:code` completed successfully: **702 tests passed, one disposable-sandbox-only skip, zero failures, 5,910 assertions**, followed by all five integration drivers. Typecheck/lint and format passed, and AGENTS/CLAUDE remained identical. The production build at the preceding same-application-source checkpoint passed. These are explicit source-bound results, not a claim about a later branch.

The whole30-case registry file was then exercised against the integrated application:22passed,2failed,6were blocked by its serial dependency. One failure was the now-fixed exact Download selector after adding Copy; the other was a local ProxyWorker `Network connection lost` response during mobile legacy setup. All assertions before that transport failure passed. No error allowance or application fallback was added. The release coordinator owns the final serial combined-tree rerun and main promotion; these pending results must not be reported as green before that run completes.

The additional rerun started here was stopped at the coordinator's request to avoid two local registry servers competing during the final run. Its interrupted status is not acceptance evidence. All report and cleanup source work is committed; final delivery confirmation follows the release coordinator's evidence.

### Completed combined verification

The final combined run at `085b271bb730e05b1cfbe94796f4afaf9656f344` supersedes the pending rerun above. `bun run verify` passed: 757 tests, one existing disposable-sandbox skip, all five integration drivers and the production build. Formatting passed, and AGENTS/CLAUDE remained identical.

The full browser matrix passed with no failed or flaky tests: 326 preview cases, 47 serial-registry cases and five Pages cases. The 20 explicit skips cover 14 separate native-chain cases, four duplicate viewport cases and two opt-in private-intake cases. These skips are not counted as acceptance. Screenshots, videos, manifests, fixture-source comparisons and logs are retained with the release review.

Later bounded changes have separate evidence: #1503 passed four desktop/mobile profile-recovery cases; #1504 preserved every parsed ledger value while reducing the prepared artifact from 29,460,889 to 22,652,089 bytes and passing the complete build; #1506 passed an isolated frozen install, typecheck and bundle build after removing unused QR-code dependencies. The original homepage remains unchanged.

The native payout repair in #1505 retains the real payment, amount, fee, network, keyboard and accessibility checks. See [release PR #1493](https://github.com/SlopDotCash/slopdotcash/pull/1493) for native-chain and opt-in private-intake results, final source ancestry, protected real-provider qualification and deployment evidence. This source-verification record does not declare MVP completion or authorize a financial activation.


## Reactivated-goal audit: current integration, 27 October 2026

This is the report-before-implementation checkpoint for the reactivated whole-codebase review. The checked-out baseline is `dfc224d2` (tree-equivalent to the then-current `main` release `a835e47c`). This section supplements the exhaustive file, test and visual review above; it does not reclassify historical failed runs as passes or claim an unrelated live deployment is complete.

### Coverage and source continuity

The current tracked tree has 1,152 paths, including 758 source/script/contract paths with TypeScript, JavaScript, Python, Rust or Solidity extensions. The completed review above remains the baseline for unchanged code. The subsequent receipt/cycle evidence removal and private reporting/vetting/response presentation changes are delivered in PRs #1533 and #1546, with their own exact-source desktop/mobile, clipboard, permission and payment evidence. This pass inventories the complete tree again, runs the application's no-unused-locals/no-unused-parameters compiler check, and individually reviews every integration change since `3b13f9c4` below. Previously reviewed historical fixtures and native contracts remain covered by their retained acceptance workflows; absence of a same-named unit test is not treated as a defect.

The 38 newly changed paths are:

- `.github/workflows/deploy.yml`
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `README.md`
- `backend/notifications/events.ts`
- `backend/pages.ts`
- `backend/projects/handler.ts`
- `backend/security/README.md`
- `backend/security/analysis.ts`
- `backend/security/handler.ts`
- `backend/security/report-intake.test.ts`
- `backend/security/report-intake.ts`
- `backend/security/submissions.test.ts`
- `backend/security/submissions.ts`
- `docs/security/private-reporting-rollout.md`
- `docs/slop-product-requirements.md`
- `functions/api/v1/[[path]].ts`
- `migrations/0101_durable_security_intake.sql`
- `protocol/private-trace-v1.md`
- `scripts/collect-value-evidence.ts`
- `scripts/project-registry-api.test.ts`
- `scripts/qualify-security-screening.ts`
- `skills/project-contributor-template/SKILL.md`
- `skills/project-contributor-template/references/security-report.md`
- `skills/project-reviewer-template/SKILL.md`
- `skills/slop/SKILL.md`
- `src/App.tsx`
- `src/Inbox.tsx`
- `src/SecurityBounty.tsx`
- `src/SecurityProgramEditor.tsx`
- `src/design-system.css`
- `src/lib/security-bounty.d.mts`
- `src/lib/security-bounty.mjs`
- `tests/e2e/evidence-download.spec.ts`
- `tests/e2e/security-bounty.spec.ts`
- `tests/e2e/site.spec.ts`
- `tests/github-api-fixture.mjs`

The new homepage bounty section is already part of this baseline. This audit does not add, remove or restyle it. The earlier homepage comparison belongs to its stated historical revision; it must not be cited as a byte comparison for this later owner-directed feature. All new fixes in this pass must leave the current homepage rendering and brand styles unchanged.

### Findings selected for implementation

| ID | Finding and concrete impact | Required change | Acceptance evidence |
| --- | --- | --- | --- |
| FA01 | `InboxPage.load()` sets notification state to `loading`; the JSX then removes the independently authenticated `SecurityInbox`. Paging notifications or retrying a notification error destroys `RevisePrivateReport`'s unsaved local text and selection. | Keep the private panel mounted during notification refresh, keyed by the authenticated recipient returned with those same notification rows. A confirmed actor change or signed-out result must dispose of the previous private content and drafts; a separate session lookup can race the notification response. Only bootstrap private access from the session when the initial notification request is unavailable; preserve independent private-report availability. Reset the old account’s pagination on identity change. Do not add persistence of private bodies to storage. | Actual browser: open a saved private report, edit its correction without submitting, page notifications and retry a notification failure, and verify the same text survives. Then switch actors while notifications still return 200, switch back, and sign out: verify the old draft and selection are removed and never restored from browser storage. |
| FA02 | `listStoredSubmissions` catches unavailable GitHub authority in its first project-discovery pass, but not in per-candidate role resolution or the repeated resolution inside `decorateSubmission`. A later outage converts the whole list to 503, hiding the actor's own durable receipts. | Handle only recognized retryable authority failures across a complete candidate's authorization/decoration. Omit the unverified foreign candidate, keep owned records, and explicitly return `authorityUnavailable`, and show that partial-access state with the existing retry control in the submissions UI. Unknown and storage failures must remain failures. | Real migrated SQLite and HTTP reproduction: healthy listing 200/two records; authority failure on the second or third old read produces 503 with no records; direct owned-record read still returns 200. Regression must prove owned-record preservation, withheld foreign records and explicit unavailable state. |
| FA03 | `decorateSubmission` loads a case through `rolesFor` and immediately loads it again. Listed foreign candidates also perform role resolution once for selection and again during decoration. | Reuse one freshly loaded case/roles result within this request only. Keep direct reads and mutations independently authorized. Combine this with FA02 at the same canonical boundary rather than introducing a global permission cache. | Existing cross-account, role-revocation, immutable-version and HTTP workflow checks remain. Compare real query/authority calls in the failing listing workflow where useful; do not create a mock-count-only unit suite. |
| FA04 | The asynchronous screening regression sleeps 16 seconds solely to hold a provider answer pending. Measured baseline: one case, four assertions, 16.27 seconds; the case itself takes 16,130 ms. | Replace elapsed sleep with a deferred promise. Prove the HTTP response returns while the provider is still blocked, then release it, drain the actual background task, and inspect the retained report and completed screening state. | Preserve the existing 15-second browser deadline assertion and the real HTTP/SQL response/state assertions. The provider must not resolve before the response; an immediate answer would remove the regression coverage. |

### Test and error-handling dispositions

The new `backend/security/report-intake.test.ts` contains 28 expanded real HTTP/migrated-SQL cases. They exercise immutable report storage, authorization, billing-rate admission, duplicate suppression, interrupted routing, owner decisions, funding and retry. The changed submission tests exercise actual forwarding and durable state. Their injected provider/transport outputs isolate external services; call counts in these workflows enforce limits on paid work and prevent duplicate sends. They are not standalone mocked-call or literal-shape tests and must not be deleted under the unit-test cleanup request. No new unit-only declaration was found in this integration delta. FA04 removes test waiting without removing behavior coverage.

`screenStoredReport` deliberately converts provider/validation failures into a durable unavailable state; the report stays saved and recoverable. The outer scheduler catch retains that receipt when background work fails. No reproduced success claim or lost record was found at that boundary in this pass, so it is not replaced with speculative propagation that could invite duplicate submissions. In contrast, FA02 is a reproduced whole-list outage and is selected for correction. Reconciliation, signature, privacy, failed-refresh and monetary checks remain fail-closed where they determine authority or payment.

### Consolidation, interface and visual dispositions

- The existing API/domain/UI directories still express separate security and deployment boundaries. Moving the new durable intake code into a monolithic handler would increase coupling; no duplicate implementation was found that justifies it.
- The current shared `CopyButton`/`CopyIdentifier`, route heading, status badge, private-operation styling and native disclosure patterns remain the presentation standard. Receipt browsing and monthly Evidence blocks remain removed. Full identifiers remain available for explicit copying.
- New report bodies are escaped and fetched only when an authorized reader opens them. Their privacy, provider-consent, current-state, funding and exact payment information are required; they are not decorative disclaimers to delete.
- New UI work in this pass is limited to FA01 lifecycle preservation. There is no evidence for another blanket restyle, homepage change, new graphic library or additional confirmation screen. The prior full non-home screenshot inventory plus PR #1546's fresh before/after private-page evidence covers the relevant presentation; the new failing path needs a real browser recording and current screenshots.
- Automatic refresh may update notifications, but must not remount an unrelated editor. No report submission, evidence read, financial decision, signature, disclosure or confirmation becomes automatic.

### Additional acceptance criteria used by this pass

1. Use current request-scoped authority; never cache a permission across requests.
2. Keep independent panels mounted through unrelated loading/error states; bind them to the recipient of the same authenticated response and unmount on real sign-out or actor change.
3. Retain explicit partial-unavailable status rather than silently replacing a failing list with empty success.
4. Preserve private unsaved text in memory only; do not add durable browser storage for report bodies.
5. Remove duplicated work at one canonical boundary rather than adding repeated defensive guards.
6. Drive background-work tests with explicit start/release signals, not wall-clock sleeps.
7. Measure actual HTTP, SQL, rendered and clipboard behavior; avoid new helper-inventory or mocked-call-only tests.
8. Preserve raw downloads, immutable data, held awards, current consent and exact payment amounts.
9. Leave the current homepage and all signing/deployment activation settings unchanged.
10. Keep source-bound evidence and final validation results separate from prior baselines and live production claims.

### Completed implementation and verification

All four selected findings are implemented in [PR #1554](https://github.com/SlopDotCash/slopdotcash/pull/1554). The application acceptance checkpoint is `c3935d56a571755c299bad53a1c075c4b54d2a2c`; this report completion is documentation only.

| Finding | Implemented result | Verified outcome |
| --- | --- | --- |
| FA01 | Private report editors and selected cases survive unrelated notification loading/errors. The authenticated recipient travels with the notification response and keys the private subtree. An initial notification outage bootstraps private access from the independent authenticated session. Account changes and sign-out clear old drafts, selection URLs and notification pagination. | Desktop and 320px mobile exercise initial 503, pending paging, later 503/retry, selected case retention, old-cursor account changes `42 → 43 → 42`, and 401. Corrections survive same-account refresh, return to the saved original after switching back, and never enter local/session storage. |
| FA02 | An unavailable authority check withholds that foreign candidate while preserving owned receipts. The submissions list visibly states partial access and provides inline retry; an empty partial list retains the notice. | Real HTTP/migrated-SQL regressions retain owned records and withhold inaccessible records. Browser recovery removes the notice after the recheck without discarding the editor. Database failures remain explicit 500 responses. |
| FA03 | One request-scoped case/roles result supplies each candidate's authorization and displayed permissions. The same helper removes the duplicate case read in direct decoration. | Fresh direct reads and actions refuse revoked authority; no result is cached across requests. Both independent backend reviews found no authority relaxation or foreign-row disclosure. |
| FA04 | Screening uses explicit provider-start/release signals. The response is required before releasing the provider, followed by background draining and persisted-state checks. | The former 16-second sleep is gone. The focused case completed in 8–12 ms in local runs; the complete 30-case intake file passed 264 assertions in 1.13 seconds. This is a test orchestration improvement, not a claim about real provider latency. |

The final rebase includes the 12 paths changed between `dfc224d2` and `4bc2925e`. A separate read-only review covered staging deployment/hash continuity, service binding order, credential and network isolation, the four-network local release fixture, and the admission browser assertion updates. No additional material finding was identified. Their 13 HTTP/release tests passed 91 assertions, and the native staging release workflow exercised all four generated bindings with zero outbound calls. The final tracked inventory is **1,158 paths, including 764 source/script/contract paths**.

The additional exported-symbol scan inspected 696 JavaScript/TypeScript modules and 2,137 exported declarations. Its sole single-occurrence candidate, `ControlPublisher`, is a live Cloudflare RPC entry point named by `tests/fixtures/value-merge-sdk-pages.toml` and launched by the sandbox workflow. It is retained. Textual occurrence count alone is not dead-code evidence. The actual application no-unused-locals/no-unused-parameters compiler check passed.

Final application verification at `c3935d56`:

- **`bun run verify` passed**: 822 tests, one existing disposable-sandbox-only skip, zero failures, 7,013 assertions, all integration drivers, dependency audit and production build. The skip is not counted as acceptance; native isolation has its separate workflow evidence.
- Typecheck, repository formatting, unused-code check and AGENTS/CLAUDE byte equality passed. Existing lint warnings remain warnings; this change introduced no new rule suppression or failure allowance.
- **Six canonical browser cases passed**, with zero failures, skips or flakes: desktop/mobile private lifecycle, historical notification pagination, and delivery/read/acknowledgment distinctions. The lifecycle includes keyboard retry, WCAG AA, 200% text, and no horizontal overflow at either viewport.
- The standalone production build also passed both new private lifecycle cases. An attempted standalone run of the older registry-dependent specs lacked the frozen registry; it is not used as acceptance. Those specs passed through the canonical prepared-fixture runner. The earlier baseline failing browser run demonstrates the lost editor before the fix.
- The retained video run uses canonical fixture `6c99c2bc598979b83f347f868175a1f833d25f3f`. SHA-256 comparison covers **564 application, backend, worker and browser-test source paths**. Only the expected frozen registry and its generated historical promotion projection differ. Every other compared source byte matches the reviewed application head.

[The attached evidence archive](https://github.com/SlopDotCash/slopdotcash/releases/tag/pr-evidence-1554-c3935d56) contains synthetic before/after screenshots, desktop/mobile videos, 200% text captures, browser diagnostics, the six-case results and source comparisons. No real private report content or signing material is included.

The earlier private reporting, vetting and response presentation cleanup remains intact: shared inline copy icons with feedback, normalized controls and panels, compact details, and retained privacy/payment information. This final integration fix does not change the homepage, funding behavior, payout authority, automatic screening policy or activation settings. Main delivery is tracked by PR #1554 and its reviewed integration-to-main promotion; the test-evidence release above is not a production deployment claim.
