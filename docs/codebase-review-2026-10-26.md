# Whole-codebase simplification review — 26 October 2026

Completed implementation removes **24,296 net lines** of source and tests, including 62 non-contract unit/partial suites. The final measured initial homepage JavaScript is **517,645 bytes**, down **33.18%** from 774,729 bytes. All selected findings below are implemented, including the two follow-up findings from validation. Required security, consent and payment distinctions are preserved.

## Scope, authority and review method

The requested result is a complete engineering review followed by implementation of justified reductions. The reviewed starting point is `426950e7c168be4ff3917e24730ce93e177b4532` from `origin/development`. Work is isolated on `codex/codebase-simplification`; the original checkout is unchanged. The owner's direct request authorizes structural, UI, copy and test cleanup for this task, including removal of non-contract unit tests. It does not authorize production deployment, financial transactions, new economic rules, or deletion of historical records.

The review covered every tracked path through an inventory and reference scan, with deeper inspection of application entrypoints, user journeys, dependency boundaries, source generation, authentication, error handling, the test harness, and release orchestration. The appendices distinguish static review from executed acceptance. A listed file is not a claim that every line was formally verified. Runtime evidence and temporary logs remain outside the committed report.

The canonical requirements reviewed were CONTRIBUTING.md and PRD sections 1–11. The main acceptance links are section 3 (accounts), section 4 (project setup and generated skills), sections 5 and 7 (scoring, clear pages and usable workflows), section 6 (payments), section 8 (private security), and sections 9 and 11 (operations and delivery). Existing protocol records, immutable migrations and finalized obligations remain authoritative.

## Summary of the proposed implementation

1. Make the canonical contributor template the sole source of the six shared skill scripts. Remove the mirrored `scripts/skill-kit` tree and its synchronization ceremony. Preserve deterministic template publication, GitHub authorization, the D1 digest and historical installed-skill compatibility.
2. Remove all identified non-contract unit suites, trim unit-only sections from mixed suites, retain complete database/API/CLI/browser/chain workflows, remove obsolete assertion-only browser checks, and prune fixtures only after their last consumer is gone.
3. Consolidate shared login, wallet-chooser and action-state UI in the existing component/hook modules. Automate read-only awards loading and setup refresh after returning from external installation. Show clipboard failures through existing feedback.
4. Combine cohesive Slopbot evidence files and inference persistence; reuse shared cookie/JSON transport; ensure independent scheduled jobs still run when a sibling fails.
5. Fix integration fixture copying so it tests the actual working tree. Clean up temporary E2E workspaces. Simplify redundant build helpers and CI orchestration while preserving exact-source checks, secrets isolation and release locks.
6. Remove confirmed dead styles, redundant footer branding and a dead Python packager. Keep useful navigation, accessible text, required consent, financial terms and explicit unavailable/stale/error states.

## Root audit: source generation, scripts, repository structure and delivery

### R-01 — Eliminate the mirrored skill implementation

**Evidence.** Six files in `scripts/skill-kit/` are byte-identical to files in `skills/project-contributor-template/scripts/`: `live-report.mjs` (3,791 lines), `run-receipt.mjs` (3,093), `skill-authority.mjs` (753), its declaration file (6), `terms-preflight.mjs` (352), and `wallet-claim.mjs` (277). This is 8,272 duplicated source lines. `scripts/sync-skill-scripts.mjs` exists to copy those bytes and `skills:check` exists to detect drift. `src/lib/install-command.ts` and `project-skill-publication.mjs` point at the noncanonical copy. Test fixture overlay also copies that tree.

**Change.** Keep the canonical template tree as the only source. Point source imports, guide provenance paths, fixture overlay and operational documentation to it. Remove the six mirrored files and the copy/check script. Remove obsolete package synchronization commands. Extend the bootstrap's explicit recognized immutable renderer path to the canonical template while retaining recognition of the old historical paths. Do not use symlinks: archive/source authorization rejects them deliberately.

**Acceptance.** Template files remain exact and Git-tracked; generated raw skills and archives still derive from the template plus approved D1 revision. The real installer lifecycle must validate install, update, stale/revoked/untrusted source refusal, locking and rollback. Existing installed scripts remain unchanged in content. Build validates and publishes the canonical tree directly. PRD §§4,11.

**Risk.** Medium because immutable renderer paths are part of the trust contract. A mere search-and-replace that removed historical recognition would be wrong. This is source deduplication, not weakening the trust root.

### R-02 — Remove a dead alternate Python packager

**Evidence.** `scripts/skill-validation/package_skill.py` (192 lines) is referenced only in its own usage text. Production project archives use `storedZip` in `src/lib/project-skill-publication.mjs`; production preparation uses `quick_validate.py`. The installer harness constructs its own archives. `normalize-skill-archive.py` has a real installer consumer and is therefore not classified as dead by a filename-only scan.

**Change.** Delete the unused packager. Keep the actual validator. The test agent may simplify the installer archive fixture further only if it preserves independent malformed-archive coverage and deterministic bytes.

**Acceptance.** No remaining references or invocation; production packaging and installer workflows pass. PRD §§4,11.

### R-03 — Remove redundant nested recursive-delete retries

**Evidence.** `scripts/rm-path-recursive.mjs` wraps `fs.rmSync` with ten outer attempts while already setting `maxRetries: 5`; its only repository caller is `clean`, which always removes `dist`. The generic user-supplied-path API, custom error classification and async delay are unused product capability.

**Change.** Make `clean` invoke Node's built-in recursive removal of the fixed `dist` path with bounded built-in retries; remove the 80-line general-purpose wrapper. There is no new shell-interpolated target.

**Acceptance.** Run clean on a temporary generated dist and run it again when the directory is absent; both succeed. Rebuild normally. No arbitrary directory argument remains. PRD §11.

### R-04 — Remove the no-op source runner from CI

**Evidence.** `.github/workflows/deploy.yml:41–49` starts an Ubuntu job that only echoes `GITHUB_SHA` into an output. Every consumer then checks out and checks that same immutable SHA. This job contributes no approval, source selection, artifact validation or additional evidence; it delays independent preparation and code checks behind runner provisioning.

**Change.** Use `${{ github.sha }}` directly, remove the source-only job/dependencies, and retain all actual checkout comparisons, trusted-event gates, quality dependencies, main equivalence checks and publication locks. The tests agent owns test job naming and test commands; edits must be coordinated.

**Acceptance.** Parse workflow YAML, prove no stale source output references remain, and verify all original quality/release dependencies and source comparisons still exist. No workflow is dispatched and no deployment occurs. PRD §§9,11.

### R-05 — Correct repository instructions after the test/source reduction

**Evidence.** README describes `verify` as running only the Slopbot unit suite despite the package running every domain's Bun suite plus integration drivers; its later paragraph describes `verify:code` as types/format/lint only. The mirrored skill source requires an undocumented edit/sync mental model.

**Change.** Document the actual integration-focused commands and sole canonical template location. Keep the generic contribution/bounty policy unchanged: the user's task-specific authorization does not rewrite contributor policy for future contributors. Keep AGENTS.md and CLAUDE.md byte-identical.

**Acceptance.** Links resolve, script names exist, described checks match package commands, and both instruction mirrors still match. Documentation is validated as prose; browser acceptance applies to changed application behavior, not to prose itself.

### R-06 — Preserve essential source/runtime separation

`backend/` owns Pages-facing API modules; `workers/` contains separate service entrypoints and signer/credential boundaries; `functions/` adapts those modules to Pages. Consolidating all of these into one service would collapse explicit authority boundaries. Root scripts include imports as well as manually invoked operational CLIs: lack of an import is not proof a CLI is dead. `collect-quality-census`, `collect-quality-discussions`, their enrichment commands, `prepare-source-correction`, and `render-social-images` have concrete standalone input/output roles and are retained. Migrations are append-only and never flattened. Historical `cycles/`, legacy-ID inventories and frozen fixtures are not active project registries and must not be rewritten as current data.

### R-07 — Keep contract entrypoints and tests intact

Network deployment scripts are small wrappers over `DeployEscrowFactory`, which already centralizes deployment logic while fixing the expected chain ID. Removing these wrappers would trade an explicit network boundary for a mutable runtime parameter. EVM and Solana protocols differ in token-account/program checks, transaction evidence, finality and upgrade authority. They must not be deduplicated by textual similarity. All Foundry, Rust and contract adapter tests remain. No contract, address, deployed bytecode, activation switch, key or fund is changed by this review.

### R-08 — Keep bounded fallback behavior when it reports uncertainty truthfully

The build's committed-source comparison produces an explicit working-tree provenance state, not success. Registry and leaderboard outages retain last-good data with stale status. Transient HTTP release retries are bounded and fail if bytes cannot be verified. These are useful recovery paths. Removing every catch, optional chain or default mechanically would be a regression. The implementation targets demonstrated swallowed feedback or independent task suppression rather than counting conditionals.

### R-09 — Do not replace accessible operational text with graphics

The site already uses a vector logo, seven agent logos, bars for ranked counts and textual state labels. Provider/model identity, amounts, addresses, fees, deadlines, required consent and failure reasons need selectable accessible text. No new image or chart dependency is justified by this review. Redundant branding is removed; useful graphics are retained. A visual status decoration cannot stand in for an authoritative financial or security state.

## Baseline repository inventory

Counts below are tracked paths at the reviewed revision, not generated node_modules or public build products. Line counts include JSON fixtures and are not a measure of complexity or code quality.

| Area | Files | Text lines | Bytes |
| --- | ---: | ---: | ---: |
| `scripts/` | 195 | 66,810 | 2,267,858 |
| `src/` | 183 | 59,306 | 1,938,180 |
| `backend/` | 95 | 47,280 | 1,703,219 |
| `workers/` | 252 | 75,242 | 2,764,635 |
| `tests/` | 149 | 372,356 | 19,965,303 |
| `contracts/` | 109 | 42,531 | 1,532,286 |
| `.github/` | 17 | 2,962 | 136,343 |
| `docs/` | 10 | 2,304 | 253,931 |
| `protocol/` | 9 | 1,267 | 70,559 |

The baseline has 1,182 tracked paths. The exact duplicate scan found only the required AGENTS/CLAUDE mirror and the six skill mirrors above. App typechecking already enforces unused locals/parameters, so a second test that only checks import inventory is unnecessary. The fixture tree is about 18 MiB and includes large frozen ledgers; tests should share those immutable sources instead of minting more miniature registries.

## Detailed parallel reviews

The following sections preserve the initial review decisions. “Selected” means planned and justified at audit completion, not a claim that runtime validation has already passed. The implementation/validation addendum at the end records final disposition.


## Frontend audit: routes, shared UI, workflow steps, copy and styles

Audit baseline: `426950e7c168be4ff3917e24730ce93e177b4532`, the fetched development head. Scope: all 37 top-level TSX files (36 application modules and one test file), three stylesheets, seven agent SVGs, and supporting browser modules in `src/lib`. Source outlines, imports, request/response boundaries, state transitions, class references and component call sites were inspected. The account, setup, funding, security and discovery paths were traced from route dispatch through their controls. This is source-review evidence, not a claim that live wallets, providers, production authority or every browser path was exercised.

### Findings selected for implementation

| ID | Priority | Baseline evidence | Problem and concrete reduction | Acceptance / safeguards |
| --- | --- | --- | --- | --- |
| FE-01 | P1 | `src/SecurityBounty.tsx:23`, `src/OperatorTraces.tsx:2`, `src/Admin.tsx:37–66` | Both security intake and private trace pages import the shared sign-in panel from the 989-line admin page. This couples unrelated routes to project editing, vetting and enforcement. Move `SignInPanel` into the existing `Presentation.tsx` shared UI module. No new component framework is needed. | All three call sites preserve checking, denied/error and sign-in markup. No admin-only module is imported merely to show a sign-in button. PRD §§3,7. |
| FE-02 | P2 | `src/Points.tsx:56–63`; imports in `Admin`, `Inbox`, `InboxEmail`, `OwnerAwards`, `OwnerVaultSetup`, `ProjectProposalPage` | The small login URL helper lives in the 1,854-line Points feature, making other features depend on account/ranking UI to build URLs. Move it beside `browserDeployment` in the existing `lib/browser-deployment.ts`; update all imports. This also lets FE-01 avoid a Presentation→Points cycle. | Preserve environment-specific product origin, encoded return location and root `/login` behavior byte for byte. PRD §§3,9. |
| FE-03 | P2 | `src/App.tsx:886`, compared with `App.tsx:820–830` | Agent deep-link clicks attempt to copy the prompt and silently swallow clipboard rejection. The neighboring Copy action already has explicit copied/error feedback. Reuse the same `copyPrompt` action for both paths. | Agent still opens; clipboard success/failure appears in the existing visible, accessible copy control; no unhandled promise or fabricated success. PRD §§4,7. |
| FE-04 | P2 | `src/ProjectSetupStatus.tsx:112–123`, `143–175` | After opening Slopbot installation in another tab, returning to the project leaves setup stale until the user presses Check again. Recheck pending setup on window focus or visible-tab return. Keep manual retry for failure recovery. | No extra installation/approval step. Do not change consent or automatically request a fresh scan. Existing ready/restricted states remain untouched. PRD §§4,7. |
| FE-05 | P2 | `src/OwnerAwards.tsx:67`, `116–133`, `197–212` | The monthly awards screen defaults to the previous month but stays blank until Load awards is pressed. Load the selected valid month automatically, and keep a retry/refresh action. | A read-only GET is automated; allocation changes, early finalization and payment settings still require explicit actions. Changing month cannot allow a stale response to replace the new month. PRD §§6,7. |
| FE-06 | P2 | `src/AutomaticMonthlyPayment.tsx:93–121`, `src/VaultActions.tsx:104–137`, `src/OwnerCommitment.tsx:123–143` | Three transaction UI modules independently implement busy/error/reset/catch/finally logic that the existing `lib/use-action.ts` already provides. Extend that hook to accept an initial recovered error, use it in these callers, and retain each caller's notice-reset behavior and specific fallback message. | Never clear an unreadable local transaction record or change signing/reconciliation logic. Busy and visible errors remain the same. PRD §§6,7. |
| FE-07 | P2 | `src/AutomaticMonthlyPayment.tsx:289–328`, `src/VaultActions.tsx:357–400`, `src/OwnerCommitment.tsx:262–311` | Wallet chooser fieldset/button/connected-address rendering is copied three times. Add one shared presentational `WalletConnection` in `Presentation.tsx`, receiving the filtered providers, connected address, legend, disabled state, empty message and connect callback. | Keep provider eligibility, original wallet matching, ownership checks and actual connections in each feature. Do not auto-connect or auto-sign. Keyboard and names remain explicit. PRD §§3,6,7. |
| FE-08 | P3 | `src/styles.css:3164–3167`, `3184`, `3264–3267` | `.funding-records-note` and `.wallet-picker-note` have no source markup or dynamically constructed class use. Remove their blocks and the dead selector from the shared link rule. Other regex-discovered absent class strings are dynamic and must remain. | No computed-style change on any reachable element; class-reference scan repeated. PRD §7. |
| FE-09 | P3 | `src/App.tsx:439–462`; `.site-footer` / `.footer-brand-row` rules | The footer repeats the domain as large text below a 104px mark even though the site header already presents the brand. Remove the duplicate domain text and dead footer-wordmark styling, retaining the mark and useful links. This reduces the footer's vertical burden without removing navigation or contact. | Desktop/mobile, keyboard access and color contrast remain. No legal/payment text is removed. PRD §7. |
| FE-10 | P2 | `src/App.tsx:1496–1819`, `2023–2196`, `2200–2606` | The root App module contains 300+ lines of How it works, sponsor content, receipts and model views. Extract coherent route bodies into feature modules only where it produces a lazy-load boundary and cuts initial code, not one new file per helper. Preserve route URLs and shared data props. | Route smoke and functional filtering/download behavior remain. Compare initial bundle before/after. PRD §§7,9. This is structural refactoring, not permission to replace the router. |

### Workflow decisions: what can become automatic, and what must stay explicit

| Path / source | Current sequence | Decision |
| --- | --- | --- |
| Setup, `ProjectSetupStatus.tsx` | Submit → external Slopbot install → return → Check again | Implement FE-04: returning to the page can perform the existing setup check. The server remains the authority and scan requests remain explicit where required. |
| Monthly awards, `OwnerAwards.tsx` | Navigate → choose/default month → Load awards | Implement FE-05: reads should start when the page/month becomes available. Preserve owner actions on allocation and finalization. |
| Deposit/withdraw, `VaultActions.tsx` | Choose wallet → enter amount/operation → review finalized state → review gross/fee/net/refund terms → sign → check receipt | Keep financial consent and review. Reusing controls/state is safe; collapsing review into signing would hide required amounts/refund destination and can spend money from stale state. PRD §6. |
| Automatic monthly setting, `AutomaticMonthlyPayment.tsx` | Connect owner wallet → review current/target setting → sign | Keep authorization. The normal monthly executor already runs automatically; a UI cannot sign a changed setting automatically. PRD §6. |
| Award reservation, `OwnerCommitment.tsx` | Connect owner wallet → verify award/funding → authorize exact commitment | Keep verification and signature. Do not treat matching displayed text as finalized proof. |
| Wallet replacement, `Earnings.tsx`, `PayoutConsent.tsx` | Connect wallet → review old/new destination → sign binding → verify result | Keep destination review. Immediate binding activation and attester risk make this a material authority change. PRD §§3,6. |
| Missing transaction hash recovery, four vault modules | Check wallet activity → supply hash or explicitly confirm no send | Keep explicit recovery. Missing RPC evidence does not prove cancellation; automatic local-record clearing risks duplicate transfers. |
| Bounty intake, `SecurityBounty.tsx` | Fresh readiness → review scope/terms → private automatic submission → wait for verified GitHub receipt | Keep scope consent and confirmed receipt. These are privacy and payment boundaries. Do not advertise a successful report while only local submission exists. PRD §8. |
| Email preferences, `InboxEmail.tsx` | View verified destination → turn activity email on/off | Keep explicit opt-in. Security notices remain separate. This action is consent, not needless ceremony. PRD §9. |
| Account closure, `Points.tsx:934–1020` | Explain retained records → type GitHub username → close | Keep the confirmation and the short consequence list. It prevents accidental session revocation and explains retained funds/history. PRD §3. |
| Inbox read state, `Inbox.tsx` | Mark read / acknowledge security notice | Keep separate security acknowledgement. Automatic read state would erase the user's unacknowledged delivery record and change semantics. |
| Project editing, `ProjectProposalPage.tsx` | Four named steps and preview | Keep four steps: explicitly required by PRD §4. Avoid converting to an unreviewable auto-saving settings screen. Preserve draft recovery and revision-conflict checks. |

### Copy, headings, branding and graphics review

1. **Home campaign heading** (`App.tsx:463–516`): keep the stable accessible heading and reduced-motion behavior. The rotating phrases are an explicit owner decision in PRD §7, so deleting them as decorative copy is not authorized by generic simplification.
2. **Home command** (`App.tsx:808–904`): keep the command as selectable text. A screenshot, logo or diagram would make copying and agent installation harder. The seven agent names already use SVG icons with hidden accessible text; no image generation is useful here.
3. **Footer** (`App.tsx:439–462`): remove repeated domain typography (FE-09); retain source/community/contact links because they are actionable navigation. Do not add explanatory footer paragraphs.
4. **Project status** (`ProjectSetupStatus.tsx:131–286`): keep one heading, next-action line and four check rows. Detailed authority/install/scan messages already sit behind one disclosure. There is no reason to replace these with several cards or a second readiness wizard.
5. **Funding review** (`VaultActions`, `OwnerVaultSetup`, `OwnerCommitment`, `OwnerReserveRelease`): keep exact asset/address/amount/fee/destination and finality. These are the transaction the user is consenting to, not optional warnings. Code deduplication should not remove their textual equivalent.
6. **How it works** (`App.tsx:1496–1819`): explanatory content is the purpose of this route. It currently repeats a few points between introductory flow, rules disclosure and FAQs, but includes different timing and exception facts. Consolidate exact repetition only; do not delete canonical instructions merely because they explain a feature. The accepted-work tiers and allocation example are already proper tables/equations, not walls of prose.
7. **Payment stages** (`Presentation.tsx:351–415`): it already uses an ordered visual stage list and definition list. Keep labels and distinctions. A chart can supplement these, but replacing them with icons would conceal state meaning and requires additional accessibility work without a demonstrated benefit.
8. **Models** (`App.tsx:2381–2604`): existing horizontal bars correctly supplement counts with accessible text. Keep provider and exact model text; a provider logo is not a model identifier. Reduce repeated non-financial description, but keep the declaration-coverage denominator and data source because otherwise users can mistake selective, self-declared data for a benchmark.
9. **Sponsors/audience** (`App.tsx:1829–2196`): the large audience report is already collapsed. The table is better than separate decorative chart code because the viewer compares contributors, repositories and PRs. Its dated provenance matters; keep it out of the primary funding path.
10. **Profile activity** (`Profiles.tsx`, `ProfilePage.tsx`): PR outcomes and project-share bars already render visual proportions. Keep accessible counts and links. Avoid a new chart dependency for these short bars.
11. **Source count / freshness** (`Points.tsx:1135–1158`, `Presentation.tsx:10–62`): keep exact periods, source counts and stale/error labels per PRD §§7,9. Move details into a disclosure if the page becomes crowded; do not equate missing data with zero.
12. **Bounty terms** (`SecurityBounty.tsx`, `SecurityProgramEditor.tsx`): keep researcher net, privacy, scope, safe harbor, response targets and withdrawal/funding facts. These directly govern whether someone can safely report and expect an award; they are not removable marketing disclaimers.
13. **Proposal metadata** (`ProjectProposalPage.tsx:1428`, `1569`): immutable repository IDs/license evidence live in details by default and are auto-filled from lookup. That is already the correct progressive-disclosure pattern. Further hiding invalid fields would make recovery worse.
14. **Microcopy candidates**: “Contribution funding Optional” can stay as a small status qualifier; repeated “The project is live” plus Ready should become one result plus View project link if changed. “Points are not money” need not be repeated on every record, but its one methodological occurrence is useful. Avoid replacing exact state names with vague “success”.

### Error-handling findings and boundaries

- **Demonstrated silent failure**: FE-03 is the one unconditional `.catch(() => undefined)` in the frontend. Reuse existing visible feedback rather than create a second notification system.
- `lib/use-action.ts` already turns rejected feature actions into displayed messages and resets busy state in `finally`; use it instead of cloning the same try/catch in transaction components (FE-06).
- `lib/browser-json.ts:52–56` ignores an error only when cancelling a body reader after an earlier read failure. Keeping the original actionable failure is correct; throwing the cancellation error would replace the real cause.
- `main.tsx:48–62` tries the published registry after a live registry failure and marks it stale; if both fail, independent account routes still work and project routes show an explicit error. This is required degraded operation, not hidden success.
- `use-snapshot.ts` retries one read and then preserves the previous snapshot with a visible stale/error signal. Keep the distinction. The public registry, index and snapshot validators are trust boundaries; do not delete them to reduce `if` counts.
- `Link.tsx:12–20` catches malformed URL escaping and treats it as a nonexistent target. That avoids crashing the entire route on a hand-edited fragment; no business result is reported as successful.
- `GeneratedSkillPreview.tsx:50–57,94–124` converts hashing/render failure to an explicit alert; keep this. The draft digest labels previews and must not become a claimed approved digest.
- Transaction pending-state readers (`AutomaticMonthlyPayment`, `VaultActions`, `OwnerCommitment`, `OwnerVaultSetup`, `OwnerReserveRelease`, `ReferralClaims`) fail closed on unreadable state. Keep errors, persisted attempts and explicit recovery controls. Do not use optional chaining to turn damaged JSON into “no pending transaction”.
- Browser draft storage (`ProjectProposalPage`, `intake-drafts`) distinguishes best-effort draft recovery from persisted financial intent. Preserve local-storage limitations visibly where they affect user recovery; no generic wrapper should impose transaction semantics on a harmless draft or vice versa.
- `ProfilePage.tsx:585`, `Points.tsx` and `use-direct-transfers` render unavailable states rather than fabricated balances. Fallback avatar initials remain a valid noncritical image fallback; no need to surface every unavailable third-party avatar as a page-level error.

### Shared component and stylesheet findings

The repository already has a local component library (`Presentation.tsx`), shared action/resource hooks, shared tokens (`brand/tokens.json` → generated `brand-tokens.css`), and shared CSS primitives. No external component library or chart package is necessary.

- `Presentation.tsx` owns `DataNotice`, `NotFound`, `EmptyState`, `Pager`, `ExternalLinkAnchor`, `Avatar`, contributor identity and payment lifecycle. Extend this before introducing parallel Button/Card/Dialog frameworks.
- `TextField`, `SelectField` and `ErrorSummary` in `ProjectProposalPage.tsx:403–536` are shared between create/update in the same feature. Their behavior differs from wallet and private-report inputs; extracting them indiscriminately would create a broad prop surface without deleting much code. Keep feature-local until a second compatible consumer exists.
- `Pager` is already used by receipts and two ranking lists. Home community uses icon-only Previous/Next with different semantics; switching it to Pager would change the design for only ~30 lines saved. Keep or extend Pager deliberately if a measured use warrants it; do not report all pagination as duplicated.
- `styles.css` has 4,331 lines; `design-system.css` has 1,097. Parsing both with PostCSS and comparing unconditional selector/property pairs found **zero** declarations proven overridden by a later exact selector/property. The files look overlapping because base layout and appearance are separated, but a blanket deletion of one would break the design. Preserve load order. A feature stylesheet split is possible later, but cannot be called deduplication merely by moving lines.
- Class-reference analysis found two confirmed dead classes in FE-08. Apparent misses `avatar-*`, `pr-bar-*`, `payout-state-*`, `admin-badge-*`, `setup-badge--*` and `agent-logo-*` are constructed dynamically and are live. Keep all seven SVG logo assets, all fallback-avatar sizes and status variants.
- `Logo.tsx` hand-coded SVG matches the established vector identity. Do not replace it through raster image generation or add duplicate downloaded provider logos.
- `tsconfig.app.json` already turns on `noUnusedLocals` and `noUnusedParameters`. Typecheck is the canonical unused-import gate; redundant lint-only inventory tests are unnecessary.

### Source structure reviewed

| Area | Files / notable size at baseline | Assessment |
| --- | --- | --- |
| Bootstrap/routing | `main.tsx`, `App.tsx` (2,763), `Link.tsx`, `ErrorBoundary.tsx` | Preserve registry boot, crash boundary, history/hash/skip-link behavior. App route extraction can cut root scope. |
| Discovery/profile/rankings | `Points.tsx` (1,854), `Profiles.tsx` (711), `ProfilePage.tsx` (650), `ProjectLeaderboard.tsx` | Shared ranking path already present. Preserve identity-by-ID and period/filter URL behavior. Remove test-only wrappers with test cleanup only if no runtime consumer exists. |
| Project setup/management | `ProjectProposalPage.tsx` (2,765), `GeneratedSkillPreview.tsx`, `ProjectSetupStatus.tsx`, `ProjectRiskFlag.tsx` | Four-step create and owner revision editor belong to one domain. Main value is auto-refresh after external install and more isolated shared presentation. |
| Funding/payout | `Earnings.tsx` (818), `EscrowFunding.tsx`, `PayoutConsent.tsx`, `OwnerAwards.tsx`, `OwnerVaultSetup.tsx` (620), `OwnerCommitment.tsx`, `OwnerReserveRelease.tsx`, `OwnerBountyVault.tsx`, `VaultActions.tsx`, `AutomaticMonthlyPayment.tsx`, `ReferralClaims.tsx` | Different contracts/states justify separate feature files; deduplicate action/chooser presentation only. Keep all signing/uncertain-send rules and ordinary/private fee splits. |
| Security/admin | `SecurityBounty.tsx` (2,882), `SecurityProgramEditor.tsx`, `Admin.tsx` (989), `AdminVetting.tsx`, `AdminProjectEnforcement.tsx`, `VettingEvidence.tsx`, `OperatorTraces.tsx`, `AccountAppeals.tsx` | Roles are security boundaries, not one generic management form. Remove cross-feature import caused by SignInPanel. Private evidence controls stay separate from public display. |
| Inbox | `Inbox.tsx`, `InboxEmail.tsx` | Email consent, read state and security acknowledgement are different actions. Shared state hook already reduces core repetition. |
| Cycles | `CyclePages.tsx` (590) | Historical reader has necessary legacy state labels. Do not rewrite committed history to current monthly semantics. |
| Presentation | `Presentation.tsx` (415), `Logo.tsx`, three CSS files, seven SVGs | Reuse existing primitives and remove verified dead rules. No new dependency needed. |
| Browser support | `browser-json`, `browser-deployment`, `copy-text`, `errors`, `identity-flow`, `use-action`, `use-public-resource`, `use-snapshot`, `use-cycle-index`, `use-direct-transfers`, `use-payout-wallets`, payment action modules | Canonical trust/transport modules; no broad permissive fallback. Separate cryptographic validators from UI simplification. |

### Rejected changes (explicitly not bugs)

- Deleting all `try/catch`, all absent-field guards or all default cases would make invalid/unavailable data indistinguishable from success.
- Replacing the whole router or adding a design-system dependency adds code and risk without a user outcome.
- Combining ordinary funding, private bounty payment and referral claims into one signing flow would blur different fee and authorization contracts.
- Deleting historical cycle rendering or compatibility fields would erase accessible records and URLs required by the PRD.
- Automatically signing wallets, auto-consenting to closure/email, retrying an uncertain send, clearing pending transactions, activating mainnet or enabling referral posting is outside this cleanup.
- Removing license and signed-in identity details from an invalid setup form would hide the recovery path; keep expandable details and field-focused errors.
- Deleting source counts, financial amounts, security conditions or access-denied states as “disclaimers” would conceal actionable constraints.
- Adding image generation for the brand, model identity or numbers duplicates working SVG/table/bar rendering and makes accessibility worse.

### Frontend verification plan

Use the exact resulting source tree. Run strict TypeScript and Biome, then the real-browser suite. Specifically exercise sign-in panels on admin/security/operator routes; generic/project agent copy success and failure; returning from installation with pending setup; monthly automatic load/month changes/read failure/retry; wallet chooser empty/connected/disabled states; existing deposit/withdraw/recovery scenarios. Check desktop, mobile, keyboard and 200% zoom plus axe, console and first-party network errors. Do not claim live wallet, provider, deployment or every requested agent-client acceptance from a local browser pass. Source-only structural changes still require route behavior to be checked.




# Backend, worker, and Pages audit

Audit baseline: `426950e7c168be4ff3917e24730ce93e177b4532` (`origin/development`). Scope: backend APIs, worker entrypoints/services, Pages routing, operational helpers, and service-facing contracts. This is a structural/static audit, not a production security certification or a claim of live provider/chain acceptance. Tests and public UI are reviewed by parallel agents.

## Method and coverage

- Inventoried all 350 tracked files beneath backend/workers/functions. The production/support source slice below contains 226 TypeScript, JavaScript, and Python files and 73,198 lines, excluding filenames marked test, integration, workflow, or qualification.
- Read subsystem entrypoints, shared transports, identity, projects/setup, security intake, notification dispatch, payment dispatch/monthly APIs, fee conversion configuration/native accounting, Slopbot inference/evidence and vetting boundaries. Scanned every source path for imports, repeated function names, catch/fallback patterns, TODOs and inactive stubs.
- Followed relative static import edges and searched configuration/documentation roots before classifying files as unused. No unambiguously dead production module was identified. Worker entrypoints, Python guests, dynamic imports and named RPC classes must not be deleted because a TypeScript importer is absent.
- Distinguished opportunities for mechanical structural simplification from product/financial decisions. Required consent, immutable records, authorization, request-body bounds, separate private/public ledgers, fallback providers explicitly approved by the PRD, safe optional-cache fallback, and uncertain-send journals remain necessary.

## Implementable findings

### B-01 — Combine three single-purpose file-comparison modules

- Evidence: `workers/slopbot/value-rename.ts:1` (30 lines), `value-full-file.ts:1` (56), `value-removed-file.ts:1` (55). The three are imported only by `workers/slopbot/value-evidence.ts:16-35` in production. They are three cases of the same missing-patch recovery stage: identical rename, complete before/after text, and verified removal.
- Result: combine them into `value-file-comparisons.ts`; import the five existing functions through one module. Keep each proof separate inside the module and preserve the existing calls, order and independent reader budgets. Remove the old files rather than leave re-export stubs.
- Why: reduces source navigation and three import paths to one without merging unrelated trust boundaries or altering a scoring rule. `value-blob.ts` stays shared because indirect/accepted-range evidence also uses it.
- Validation: typecheck; current real-fixture evidence collection/integration suite; compare recovery output/limits on full change, removal, unchanged rename and binary/invalid-text cases. Existing isolated unit test deletion is handled by the test audit, not this refactor.
- Risk: low when only moved; medium if reader instances or read order changes, so do not change those.
- PRD: sections 5 and 7, exact-source scoring and no duplicate credit. Acceptance: identical evidence and limitation outcomes with fewer production modules.

### B-02 — Keep retained inference persistence with its only consumer

- Evidence: `workers/slopbot/value-inference-results.ts:1` (68 lines) has one production importer, `value-inference.ts:10-13` (129 lines). It exposes retained inference internals solely to the inference operation.
- Result: move the retained type and read/write helpers into `value-inference.ts`, make single-module helpers private, and delete the former file. Keep immutable hash verification, producer validation and both budget reconciliation calls unchanged.
- Why: source split adds a public-looking module surface and forces navigation for a single cohesive operation; combined size remains under 200 lines.
- Validation: typecheck, D1 inference/consumer integration exercising first inference, retained read, duplicate attempt and malformed retained evidence.
- Risk: low mechanical move. Do not simplify reconciliation into a guessed success.
- PRD: sections 5 and 7. Acceptance: same cache/budget behavior, one less module and narrower exports.

### B-03 — Reuse the existing canonical cookie reader

- Evidence: `workers/identity/handler.ts:107-115` implements cookie parsing locally, while `backend/http.ts:119-126` already supplies `cookieValue`, used throughout related account/payment routes. Identity already imports `backend/http.ts` for `fail`/`ApiError`.
- Result: import `cookieValue` from the existing dependency and remove the local implementation. Both split semicolon fields, trim fields, return the first exact name, and preserve equals signs in cookie values; valid identity-cookie behavior stays the same. The shared helper treats a name without `=` as missing, appropriate for an absent value.
- Why: one parsing contract; no new dependency or generalized helper.
- Validation: identity browser/HTTP flow tests covering start, callback, state cookie and cookie clearing; typecheck.
- Risk: low. Do not change cookie flags, TTLs, origin checks or PKCE.
- PRD: section 3. Acceptance: same valid account login and invalid-state refusal through one cookie implementation.

### B-04 — Use the shared JSON transport in payment endpoints

- Evidence: `backend/payments/handler.ts:122-131` and `backend/payments/solana-funding.ts:15-24` duplicate the same JSON Response builder. The shared `backend/http.ts:41-50` already owns serialization and security headers; most other APIs use it.
- Result: import the shared JSON builder in both payment modules, remove duplicate constructors, and keep their thin route-local configuration only if exact header compatibility requires it. The canonical private/no-store and no-referrer defaults are appropriate for account/payment responses.
- Why: standardizes content type, non-caching and nosniff, and ensures future transport fixes do not diverge.
- Validation: payment HTTP/D1 integration checks, funding plan/check flow, body/status/header inspection; no transaction submission.
- Risk: low; no amount, signature, wallet or settlement logic changes.
- PRD: sections 3, 6, 9. Acceptance: same response bodies and statuses, consistent private JSON headers.

### B-05 — Test-only adapters belong in the test harness

- Evidence: `workers/fee-converter/sqlite-d1.ts` and `workers/referral-accrual/sqlite-d1.ts` are identical 14-line bun:sqlite shims except the return-interface name. Both import `tests/sqlite-d1.ts` and are used by local integration tooling. `backend/security/github-advisories.fake.ts` and `participation-ban.fixture.ts` are also fixture-only artifacts in service directories.
- Result: test agent owns consolidation/removal or relocation according to surviving workflow consumers. Production service source should not look dependent on a test engine.
- Validation: complete remaining integration commands, no stale imports, package/workflow checks.
- Risk: low if all command and dynamic import consumers are updated.
- PRD: section 11; user-directed test simplification.

### B-26 — Let independent scheduled work run despite one failed dispatcher

- Evidence: `workers/slopbot/index.ts:464-466` awaits budget-block retries, maintainer holds and due appeals serially before entering the existing `Promise.allSettled` for value assessment and notifications. A rejected database/queue operation in the first group exits the whole schedule, so unrelated durable work never gets a chance to run.
- Result: put those three independent dispatchers into the existing `Promise.allSettled` list. Keep the aggregate failure after all outcomes settle. Each dispatcher already owns its distinct journal/table and idempotency contract; no sequencing dependency exists between these families.
- Proof: use the retained real-D1 scheduler workflow with a database failure in the retry-dispatch branch and confirm an independent due hold / appeal or value request is processed while the scheduler still rejects. No model result is mocked or required for this orchestration boundary.
- Risk: low to medium, because dispatch runs concurrently. Preserve per-dispatcher sequential queue/checkpoint ordering and all existing leases/duplicate checks; only independent families run together.
- PRD: sections 5, 7 and 9. Acceptance: independent work progresses during a branch failure, scheduler still reports operational failure, and no duplicate job checkpoints are created.

## Additional findings and decisions

| ID | Evidence | Assessment and disposition | PRD / validation |
| --- | --- | --- | --- |
| B-06 | `backend/security/handler.ts` 3,356 lines; `backend/projects/handler.ts` 2,789; `backend/trace/handler.ts` 1,678; `backend/payments/handler.ts` 1,171 | These are the largest navigation bottlenecks. Splitting each route group further would add files, and extracting a generic framework would obscure concrete permissions/transactions. Existing shared HTTP/session/persistence helpers are the right seam. Apply proven duplicates above; do not produce a wholesale framework rewrite under a cleanup label. | 2,3,6,8,9; full existing HTTP workflows. |
| B-07 | `workers/slopbot/review.ts` 2,425 and `workers/payment-executor/core.ts` 2,286 | Large orchestrators contain explicit source/identity/finality order. Combining or making checks generic is high risk and supplies no demonstrated reduction in product steps. Keep sequence explicit. | 5,6,7; live qualification separate from local refactor. |
| B-08 | `workers/slopbot/*value*` fine-grained modules | Some evidence recovery modules are over-separated (B-01); retain journal, authorization, budget, publication and work-unit boundaries because they implement different evidence/transaction responsibilities. No global megafile. | 5,7; static import map and recovery suite. |
| B-09 | `backend/pages.ts:46-47` | Comment says admins review applications; present admission is self-service and admins handle exceptions. Update stale comment to current role, without altering allowlist semantics. | 4,8; compare PRD and handler route permissions. |
| B-10 | `backend/pages.ts:58-61` | Intake comment says missing config keeps a manual flow. Actual policy requires explicit unavailable/private recovery and never public fallback. Correct the stale comment to avoid suggesting a fallback is active. | 8,9; no runtime change. |
| B-11 | `workers/slopbot/index.ts:238,316` | Public history reads return explicit 503 but their catch bodies lack a fixed diagnostic. This is not silent success: unavailable is correct. Adding sanitized labels could improve operations, but do not include errors, source or identifiers. Optional improvement, no need for a new logging framework. | 9; server failure remains failure. |
| B-12 | `backend/notifications/email.ts:36,79` | Eligibility outages become `null`, then explicit unavailable/503; opt-out remains available. Preserve this purposeful recovery so an email outage cannot trap consent. | 9; consent/opt-out paths. |
| B-13 | `backend/projects/edge-cache.ts:57,76,102`; `backend/vetting/live-pin.ts:61,75` | Optional cache read/write/delete failures fall back to authoritative reads. These catches do not fabricate results and should remain. Removing them would turn a cache outage into a product outage. | 9; cache hit/miss and upstream failure paths. |
| B-14 | `backend/projects/repository-access.ts:61` | App-backed public GitHub read falls back to ordinary GitHub read. Permission checks still use authenticated Slopbot authority. Preserve; this is availability plumbing, not a bypass. | 2,4,8; current authority is still required. |
| B-15 | `workers/payment-executor/core.ts:789`; payment/fee/notify catch blocks | Stored signed bytes, unknown/held states and ambiguous receipts are deliberate. Missing evidence never cancels or releases liability. Do not remove catches or retry based on guessed failure. | 6,8,9,11; restart and uncertain-send integration. |
| B-16 | `backend/security/submissions.ts:730`, `backend/security/report-analysis.ts:109` | Deterministic routing analyzer failure yields explicit unknown hints and normal routing; report receipt survives. It does not approve an award or produce a successful model qualification. Keep receipt independent of advisory hints. | 8,9; receipt and analysis outcomes distinct. |
| B-17 | `functions/api/v1/[[path]].ts:463,481` | Invalid network config disables served vaults; invalid schedule leaves owner control and Worker cron fails separately. This is an explicit fail-closed deployment policy, not authority to auto-enable payments or infer config. Keep. | 6,9,11. |
| B-18 | `workers/identity/handler.ts:86-105` | Separate read-size/UTF-8/JSON errors distinguish invalid/oversized input before admission. Keep rather than one broad error catcher. | 3,9. |
| B-19 | `workers/slopbot/models.ts` | Approved provider fallback remains Surplus then GPT-6.1 Sol. Model failures require real calls to qualify; mocked fixtures cannot establish provider behavior. No route/prompt/model changes in this cleanup. | 5,11. |
| B-20 | `backend/security/analysis.ts` | Private report analysis is Surplus-only, with explicit refusal/no alternate provider. Do not merge with public Slopbot model fallback. | 8. |
| B-21 | `workers/slopbot/*-service.ts`, `*-entrypoint.ts`, `functions/[[path]].ts`, `workers/security-payments/index.ts` | Small files are platform build/binding entrypoints, not automatically dead or pointless. Their removal can change Worker bundling, binding exports or public routing. Retain unless a deployment binding is also intentionally changed. | 9,11. |
| B-22 | `workers/vetting/{guest,guest_ingress,vm,artifacts,dependencies,provenance}.py` | Separate VM guest, ingress, provenance and dependency capture are isolation/retention boundaries, not duplicates of TypeScript scanning. A universal rewrite would expand scope. | 8. |
| B-23 | `workers/operator-keeper/index.ts`, `workers/payment-executor`, `workers/fee-converter`, `workers/referral-accrual` | Four execution services have separate principals and authority. Do not combine daemons merely because each schedules/broadcasts: signer role isolation is required. | 6,11. |
| B-24 | `backend/projects/setup.ts`, `backend/projects/vault-setup.ts`, `backend/vetting/flags.ts` | Automatic admission, optional funding and flag-only recovery already exist. GitHub authority, App installation and scan/explicit exemption are necessary gates, not extra human approvals to delete. | 4,8. |
| B-25 | `backend/payments/monthly.ts`, `monthly-attestation.ts`, `monthly-publication.ts`, `monthly-reserve-release.ts` | Proposed/immutable admitted allocation, signing, publication and exceptional reserve release differ in authority. Keep those files and state machines separate. | 6,11. |

## Controls that must remain visible in the UI/API contract

Wallet signatures and account proof establish different identities. Project closure consent is opt-in and not implied by App installation. Vault deposit/refund terms and gross/fee/net review precede signature. Bounty decisions and escalated disputes stay human. Delivery acceptance is not inbox receipt. Scan exemptions are not passed scans. Confirmed receipt is not settlement. Fresh finalized counters cannot be replaced by zero on refresh failure. These distinctions are deliberately not streamlined into one success state.

## Source inventory

The following records the complete non-test source/support slice used for the structural scan; listed does not mean every line has independently undergone a security proof. Operational qualification/test files are retained in the separate test inventory.

| File | Lines |
| --- | ---: |
| `backend/d1.ts` | 34 |
| `backend/fee-conversions/handler.ts` | 205 |
| `backend/github.ts` | 100 |
| `backend/http.ts` | 147 |
| `backend/identity-assertion.ts` | 54 |
| `backend/notifications/email.ts` | 139 |
| `backend/notifications/events.ts` | 591 |
| `backend/notifications/handler.ts` | 278 |
| `backend/pages.ts` | 175 |
| `backend/payments/chain-awards.ts` | 49 |
| `backend/payments/dispatch.ts` | 118 |
| `backend/payments/evm-adapter.ts` | 57 |
| `backend/payments/handler.ts` | 1171 |
| `backend/payments/ledger.ts` | 297 |
| `backend/payments/monthly-attestation.ts` | 418 |
| `backend/payments/monthly-publication.ts` | 162 |
| `backend/payments/monthly-reserve-release.ts` | 115 |
| `backend/payments/monthly.ts` | 1271 |
| `backend/payments/possession.ts` | 126 |
| `backend/payments/solana-funding.ts` | 105 |
| `backend/payments/vault-snapshots.ts` | 202 |
| `backend/payments/wallet-registration.ts` | 108 |
| `backend/points/handler.ts` | 440 |
| `backend/points/x.ts` | 353 |
| `backend/projects/account-bans.ts` | 24 |
| `backend/projects/cloudflare-persistence.ts` | 816 |
| `backend/projects/contracts.ts` | 81 |
| `backend/projects/edge-cache.ts` | 105 |
| `backend/projects/enforcement.ts` | 736 |
| `backend/projects/github-lookup.ts` | 384 |
| `backend/projects/handler.ts` | 2789 |
| `backend/projects/repository-access.ts` | 67 |
| `backend/projects/setup.ts` | 501 |
| `backend/projects/skill-publication.ts` | 301 |
| `backend/projects/token-metadata.ts` | 179 |
| `backend/projects/vault-setup.ts` | 557 |
| `backend/referrals/cache.ts` | 406 |
| `backend/referrals/claims.ts` | 152 |
| `backend/referrals/handler.ts` | 107 |
| `backend/security/advisories.ts` | 197 |
| `backend/security/analysis.ts` | 806 |
| `backend/security/github-advisories.fake.ts` | 299 |
| `backend/security/github-advisories.ts` | 741 |
| `backend/security/handler.ts` | 3356 |
| `backend/security/intake-grant.ts` | 385 |
| `backend/security/participation-ban.fixture.ts` | 56 |
| `backend/security/payment-database.ts` | 15 |
| `backend/security/payments.ts` | 290 |
| `backend/security/program-funds.ts` | 107 |
| `backend/security/project-access.ts` | 48 |
| `backend/security/report-analysis.ts` | 129 |
| `backend/security/reporting-readiness.ts` | 177 |
| `backend/security/submissions.ts` | 1281 |
| `backend/slopbot/summary.ts` | 92 |
| `backend/slopbot/value-import.ts` | 101 |
| `backend/trace/auth.ts` | 173 |
| `backend/trace/cloudflare-persistence.ts` | 1251 |
| `backend/trace/contracts.ts` | 249 |
| `backend/trace/handler.ts` | 1678 |
| `backend/trace/validation.ts` | 166 |
| `backend/vetting/evidence-chunks.ts` | 115 |
| `backend/vetting/evidence.ts` | 1612 |
| `backend/vetting/flagger-standing.ts` | 107 |
| `backend/vetting/flags.ts` | 673 |
| `backend/vetting/handler.ts` | 800 |
| `backend/vetting/live-pin.ts` | 104 |
| `backend/vetting/persistence.ts` | 660 |
| `backend/vetting/result.ts` | 546 |
| `backend/vetting/scan-result.ts` | 580 |
| `functions/[[path]].ts` | 36 |
| `functions/api/v1/[[path]].ts` | 587 |
| `functions/index.ts` | 136 |
| `workers/fee-converter/config.ts` | 332 |
| `workers/fee-converter/core.ts` | 1095 |
| `workers/fee-converter/dry-run.ts` | 54 |
| `workers/fee-converter/evm.ts` | 1293 |
| `workers/fee-converter/index.ts` | 206 |
| `workers/fee-converter/jupiter-route-schema.ts` | 1017 |
| `workers/fee-converter/jupiter-route.ts` | 148 |
| `workers/fee-converter/jupiter-wire.ts` | 126 |
| `workers/fee-converter/native-gas.ts` | 416 |
| `workers/fee-converter/solana-accounts.ts` | 284 |
| `workers/fee-converter/solana-expiry.ts` | 282 |
| `workers/fee-converter/solana-route-accounts.ts` | 370 |
| `workers/fee-converter/solana-route-receipt.ts` | 174 |
| `workers/fee-converter/solana.ts` | 1428 |
| `workers/fee-converter/sqlite-d1.ts` | 14 |
| `workers/fee-converter/store.ts` | 478 |
| `workers/identity/configure-test.mjs` | 104 |
| `workers/identity/contracts.ts` | 99 |
| `workers/identity/crypto.ts` | 129 |
| `workers/identity/handler.ts` | 583 |
| `workers/identity/index.ts` | 500 |
| `workers/identity/persistence.ts` | 270 |
| `workers/identity/rate-limit.ts` | 88 |
| `workers/notify/activity.ts` | 167 |
| `workers/notify/cloudflare-email.d.ts` | 9 |
| `workers/notify/contracts.ts` | 65 |
| `workers/notify/handler.ts` | 406 |
| `workers/notify/index.ts` | 219 |
| `workers/notify/security.ts` | 457 |
| `workers/operator-keeper/index.ts` | 144 |
| `workers/operator-keeper/sql.d.ts` | 4 |
| `workers/operator-keeper/storage.ts` | 57 |
| `workers/payment-executor/assert-fresh-test-stack.mjs` | 88 |
| `workers/payment-executor/binding-recovery.ts` | 314 |
| `workers/payment-executor/configure.mjs` | 470 |
| `workers/payment-executor/core.ts` | 2286 |
| `workers/payment-executor/entrypoint.ts` | 40 |
| `workers/payment-executor/index.ts` | 835 |
| `workers/payment-executor/mainnet-execution.mjs` | 39 |
| `workers/payment-executor/monthly-release.ts` | 328 |
| `workers/payment-executor/monthly.ts` | 200 |
| `workers/payment-executor/prepare-inactive.mjs` | 162 |
| `workers/payment-executor/signer-stacks.mjs` | 49 |
| `workers/payment-executor/solana-monthly.ts` | 548 |
| `workers/payment-executor/solana.ts` | 746 |
| `workers/payments/deployments.ts` | 167 |
| `workers/payments/index.ts` | 677 |
| `workers/payments/reconcile.ts` | 140 |
| `workers/payments/registry-database.mjs` | 77 |
| `workers/payments/scanner.ts` | 292 |
| `workers/referral-accrual/chain-logs.ts` | 21 |
| `workers/referral-accrual/config.ts` | 229 |
| `workers/referral-accrual/core.ts` | 970 |
| `workers/referral-accrual/dry-run.ts` | 138 |
| `workers/referral-accrual/gas.ts` | 40 |
| `workers/referral-accrual/index.ts` | 113 |
| `workers/referral-accrual/merkle.ts` | 94 |
| `workers/referral-accrual/poster.ts` | 443 |
| `workers/referral-accrual/sqlite-d1.ts` | 14 |
| `workers/referral-accrual/store.ts` | 474 |
| `workers/security-payments/index.ts` | 29 |
| `workers/slopbot/appeal-publication.ts` | 149 |
| `workers/slopbot/appeals.ts` | 209 |
| `workers/slopbot/budget-blocks.ts` | 87 |
| `workers/slopbot/closure-eligibility.ts` | 93 |
| `workers/slopbot/cloudflare-workers.d.ts` | 5 |
| `workers/slopbot/contracts.ts` | 417 |
| `workers/slopbot/entrypoint.ts` | 3 |
| `workers/slopbot/failure-alerts.ts` | 74 |
| `workers/slopbot/github.ts` | 300 |
| `workers/slopbot/index.ts` | 527 |
| `workers/slopbot/maintainer-holds.ts` | 146 |
| `workers/slopbot/models.ts` | 321 |
| `workers/slopbot/penalties.ts` | 184 |
| `workers/slopbot/persistence.ts` | 492 |
| `workers/slopbot/quality.ts` | 323 |
| `workers/slopbot/registry.ts` | 203 |
| `workers/slopbot/reopen-source.ts` | 119 |
| `workers/slopbot/reporting-readiness-service.ts` | 12 |
| `workers/slopbot/reporting-readiness.ts` | 45 |
| `workers/slopbot/repository-access-entrypoint.ts` | 16 |
| `workers/slopbot/repository-access.ts` | 319 |
| `workers/slopbot/review.ts` | 2425 |
| `workers/slopbot/routing.ts` | 88 |
| `workers/slopbot/spend-alerts.ts` | 79 |
| `workers/slopbot/value-accepted-range.ts` | 140 |
| `workers/slopbot/value-blob.ts` | 66 |
| `workers/slopbot/value-branch-policy.ts` | 83 |
| `workers/slopbot/value-budget.ts` | 95 |
| `workers/slopbot/value-commit-hints.ts` | 65 |
| `workers/slopbot/value-consumer.ts` | 347 |
| `workers/slopbot/value-consumption.ts` | 161 |
| `workers/slopbot/value-context.ts` | 134 |
| `workers/slopbot/value-evidence.ts` | 1039 |
| `workers/slopbot/value-full-file.ts` | 56 |
| `workers/slopbot/value-group-collection.ts` | 138 |
| `workers/slopbot/value-import-service.ts` | 12 |
| `workers/slopbot/value-import.ts` | 238 |
| `workers/slopbot/value-indirect-retention.ts` | 113 |
| `workers/slopbot/value-indirect.ts` | 249 |
| `workers/slopbot/value-inference-results.ts` | 68 |
| `workers/slopbot/value-inference.ts` | 129 |
| `workers/slopbot/value-journal.ts` | 265 |
| `workers/slopbot/value-manifest-identity.ts` | 82 |
| `workers/slopbot/value-merge-profile.ts` | 81 |
| `workers/slopbot/value-merge-resolution.ts` | 64 |
| `workers/slopbot/value-patch.ts` | 149 |
| `workers/slopbot/value-processing.ts` | 136 |
| `workers/slopbot/value-producer.ts` | 116 |
| `workers/slopbot/value-publication.ts` | 233 |
| `workers/slopbot/value-removed-file.ts` | 55 |
| `workers/slopbot/value-rename.ts` | 30 |
| `workers/slopbot/value-requests.ts` | 61 |
| `workers/slopbot/value-retained-copy.ts` | 445 |
| `workers/slopbot/value-retained-reference.ts` | 166 |
| `workers/slopbot/value-review.ts` | 99 |
| `workers/slopbot/value-settings.ts` | 38 |
| `workers/slopbot/value-source-leases.ts` | 66 |
| `workers/slopbot/value-tree.ts` | 125 |
| `workers/slopbot/value-work-unit-consumption.ts` | 303 |
| `workers/slopbot/value-work-unit-journal.ts` | 353 |
| `workers/slopbot/value-work-unit-publication.ts` | 186 |
| `workers/slopbot/value-work-unit-review.ts` | 213 |
| `workers/slopbot/value-work-unit.ts` | 460 |
| `workers/vetting/acquire.ts` | 276 |
| `workers/vetting/artifacts.py` | 231 |
| `workers/vetting/assembly-manifest.ts` | 108 |
| `workers/vetting/assembly.ts` | 699 |
| `workers/vetting/bounded-scan.ts` | 690 |
| `workers/vetting/dependencies.py` | 326 |
| `workers/vetting/events.ts` | 378 |
| `workers/vetting/filesystem-capture.ts` | 53 |
| `workers/vetting/fixtures/artifact_probe.py` | 57 |
| `workers/vetting/fixtures/syscall_probe.py` | 41 |
| `workers/vetting/guest.py` | 471 |
| `workers/vetting/guest_ingress.py` | 214 |
| `workers/vetting/isolated-inspection.ts` | 105 |
| `workers/vetting/provenance-report.ts` | 165 |
| `workers/vetting/provenance.py` | 131 |
| `workers/vetting/publication-journal.ts` | 132 |
| `workers/vetting/publication.ts` | 106 |
| `workers/vetting/queue.ts` | 324 |
| `workers/vetting/run.ts` | 500 |
| `workers/vetting/sandbox.ts` | 94 |
| `workers/vetting/scanners.ts` | 402 |
| `workers/vetting/service.ts` | 141 |
| `workers/vetting/vm.py` | 305 |
| `workers/vetting-backup/core.ts` | 494 |
| `workers/vetting-flags/build.ts` | 94 |
| `workers/vetting-sandbox/index.ts` | 126 |
| `workers/vetting-sandbox/merge-job.ts` | 104 |
| `workers/vetting-sandbox/merge.ts` | 112 |
| `workers/vetting-sandbox/probes.ts` | 129 |
| `workers/vetting-sandbox/supervise.py` | 181 |




# Test and integration audit — 26 October 2026

## Scope and criteria

Reviewed every tracked `.test`, `.spec`, explicit `.integration`, `workflow` and fixture path, package scripts, the Bun preload, Playwright configuration, integration launcher, browser launcher, fixture assembler, and workflow references. Baseline is `426950e7c168be4ff3917e24730ce93e177b4532`. The owner's instruction to delete non-contract unit tests controls this pass. File names do not establish test quality: many `.test.ts` files run production routes with real SQL and durable state. These remain integrations; giving them a new extension would add churn without reducing complexity.

Retain: complete real browser interactions; API-to-real-SQL workflows; command-line/file pipelines; local-chain settlement; Miniflare bindings; genuine Git/release behavior. Controlled external network responses can verify protocol controls but do not qualify an LLM, wallet, provider, mainnet, or deployment. Delete: isolated function/schema/component assertions; mocked-only partial paths; lower-level fragments duplicated by complete retained flows. Remove pure unit sections from mixed files. Keep all smart-contract tests under the explicit exception.

## Findings and planned changes

### T01 — remove non-contract units and incomplete duplicate fragments (high, owner-directed)

The inventory below names every removal. Typical examples are `src/lib/funding-reminders.test.ts` (22 lines of a single helper), `src/lib/use-direct-transfers.test.ts` (28 lines), `scripts/github-actor.test.ts` (36 lines), `scripts/project-x-link.test.ts` (30 lines), and `workers/payment-executor/mainnet-execution.test.ts` (31 lines). Large matrices such as `scripts/value-scoring-policy.test.ts` (1,868 lines) still mostly construct in-memory records and call helpers; size does not make them end-to-end. Their presence does not justify keeping units after an explicit instruction to remove them.

`backend/security/advisories.test.ts`, `github-advisories.test.ts`, `workers/slopbot/repository-access.test.ts`, and `webhook-body.test.ts` test one function/handler with synthetic state. Full private submission, real webhook-plus-SQL, registry, and browser integrations remain. `scripts/generate-points.test.ts` mixes pure journal transforms and lower-level persistence replay already exercised through `scripts/points-import.test.ts`; keep the import workflow. `workers/slopbot/review.test.ts` mixes numerous pure guard tests with one small persistence lifecycle; keep the complete queue/appeal/persistence workflows instead. `scripts/qualification-deployment-recovery.test.ts` replaces platform behavior with preload mocks and cannot verify a deployed qualification run; retain the real qualification drivers.

Acceptance: no isolated non-contract unit suite remains; complete integration workflows still execute. PRD sections 2, 5–9 and 11 govern retained evidence and controls.

### T02 — remove unit-only blocks from retained integration files (high)

Retain database and full-worker flows, trim standalone config/calendar/Merkle/client-parser assertions in `workers/referral-accrual/{referral-accrual,poster}.test.ts`, standalone classification/parser/client-response sections in `workers/fee-converter/fee-converter.test.ts`, the wrapped-SOL arithmetic unit in `native-gas.test.ts`, static deployment configuration checks in `scripts/staging-release.test.ts`, and deterministic source-surface classifier assertions in `scripts/vetting-bounded-scan.test.ts`. Do not remove migration preservation, exact-amount, authorization, durable unknown-send, replay, or failure-recovery integration assertions simply because they are strict.

### T03 — delete copy-only browser assertions (medium)

`tests/e2e/score-penalties.spec.ts:51` mostly locks exact paragraphs, including a list of retired phrases. This is a prose snapshot, not a product outcome. Remove that test; keep the subsequent profile/cycle penalty and exclusion flow. `tests/e2e/earnings-monthly-awards.spec.ts` seeds one response then checks row text without any action, actual backend, or recovery; remove it. The backend monthly suite, owner-awards flow, and payments lifecycle suites preserve actual awards behavior. `tests/e2e/site.spec.ts` has isolated static guidance/value checks; trim those while retaining discovery, cross-route navigation, API errors/retry, downloads, keyboard, reflow and accessibility tests. Avoid removing user-visible status assertions from real workflows; they prove the outcome of actions.

### T04 — duplicated SQLite adapters and misplaced fixtures (medium)

`workers/fee-converter/sqlite-d1.ts` and `workers/referral-accrual/sqlite-d1.ts` are the same wrapper with only a return type difference. Both delegate to `tests/sqlite-d1.ts`, which already centralizes actual migrations, statement execution, transaction rollback and cached database images. Replace wrappers with the shared helper; default its migration argument to the full migration set and permit a typed database result. Keep explicit partial migration sets where those tests verify migration history. Relocate `backend/security/{github-advisories.fake,participation-ban.fixture}.ts` into `tests/` and rebase imports. This removes testing-only files from runtime directories without hiding their behavior.

### T05 — stale-source fixture checkout (high)

`tests/fixture-checkout.ts:25` calls `git archive HEAD`; it therefore ignores uncommitted fixes in the current working tree. Several tests copy individual source files back afterward, a symptom of the inconsistency. `scripts/prepare-e2e-fixture.mjs:46` already enumerates tracked and unignored working-tree files and skips deleted files. Share that one implementation, use it from both fixture paths, and retain clean synthetic fixture Git history only where a generator requires provenance. Acceptance: changing a tracked implementation before commit is visible in both CLI and browser fixture workspaces; deleted tracked files stay absent.

### T06 — fixture workspace leak (medium)

`runFixturePhases` in `scripts/run-e2e.mjs` copies reports in `finally` but never removes its entire scratch repository. Each run leaves generated sites, copied fixtures and `.git` under the OS temp directory. Remove the workspace after diagnostic copies, including when a phase fails. Preserve diagnostics in `test-results` and `playwright-report`.

### T07 — test scripts duplicate suite selection (medium)

`package.json:test:escrow-policy` manually lists now-deleted parser/helper units alongside contract tests and monthly integrations. Replace its list with retained contract and real integration suites, remove `./src` from `test`, and ensure specialized commands do not reference deleted files. Existing `test:integration` runs five independent Miniflare drivers concurrently. Existing E2E runs preview/Pages/registry phases concurrently and CI shards them. Keep those parallel boundaries. Increasing registry workers above one would race shared mutable registry/account/security fixture state; each CI shard already owns a separate D1. Local-chain scenarios intentionally run serially because they mutate a shared chain.

### T08 — minimize fixture tree through reference closure (medium)

The fixture tree includes historical registry projects, original cycle snapshots, legacy skills, evaluator awards and a compressed leaderboard. They are restored by `fixture-overlay.mjs` and consumed by genuine historical-compatibility, browser and installer workflows. Do not remove all fixtures based on direct text searches: directory-copy and path construction are real consumers. Remove the qualification-deployment preload after its only test is deleted, any now-unreferenced test helper, and unused copies of scripts once root's canonical-template consolidation lands. Keep one frozen historical corpus rather than generating another registry, so immutable historical results and empty-live-registry browser behavior remain deterministic. Preserve contract mint fixtures.

### T09 — useful existing architecture to retain

`tests/sqlite-d1.ts` caches a migrated serialized image per migration set and returns a fresh DB for each test. Reusing one mutable global DB would make tests order dependent. `scripts/run-integration.mjs` uses Promise.all; test failures retain a failing status. `scripts/run-e2e-phase.mjs` prefixes concurrent output, kills timed-out processes, and returns failure on launch errors. Playwright retries are deliberately zero so flaky evidence cannot become a release success. The Pages worker count differs from preview because the Pages proxy can terminate under concurrency. These are useful boundaries, not needless gates.

### T10 — acceptance limits

Deleting unit tests reduces fast local diagnostic coverage by explicit owner choice. Retained integration success is not proof of actual model qualification or deployed behavior. Real provider, mainnet signing, external account/client interaction, deployment and production credentials are outside this cleanup's execution scope. Do not activate any production service or weaken release checks. PRD sections 5, 6, 8, 9 and 11 remain controlling.

## Complete executable-test inventory

| Path | Lines | Decision | Evidence class |
| --- | ---: | --- | --- |
| `backend/fee-conversions/handler.test.ts` | 105 | Keep: integration | bun |
| `backend/notifications/email.test.ts` | 414 | Keep: integration | bun |
| `backend/notifications/exception-events.test.ts` | 293 | Keep: integration | bun |
| `backend/notifications/notifications.test.ts` | 826 | Keep: integration | bun |
| `backend/payments/evm.integration.ts` | 2,116 | Keep: workflow | sqlite, child |
| `backend/payments/migration-0021.test.ts` | 225 | Keep: integration | bun, sqlite |
| `backend/payments/migrations.test.ts` | 236 | Keep: integration | bun, sqlite |
| `backend/payments/monthly.test.ts` | 2,162 | Keep: integration | bun, sqlite |
| `backend/payments/vault-snapshots.test.ts` | 440 | Keep: integration | bun |
| `backend/points/x.test.ts` | 110 | Keep: integration | bun |
| `backend/projects/cloudflare-persistence.test.ts` | 219 | Keep: integration | bun |
| `backend/referrals/claims.test.ts` | 298 | Keep: integration | bun |
| `backend/security/advisories.test.ts` | 138 | Remove | bun |
| `backend/security/github-advisories.test.ts` | 200 | Remove | bun |
| `backend/security/handler.test.ts` | 1,702 | Keep: integration | bun |
| `backend/security/payments.integration.ts` | 2,016 | Keep: workflow | sqlite, child |
| `backend/security/reporting-readiness.workflow.mjs` | 476 | Keep: workflow | miniflare, sqlite, child, http |
| `backend/security/submissions.test.ts` | 2,044 | Keep: integration | bun, mock |
| `backend/trace/workflow.mjs` | 595 | Keep: workflow | miniflare, sqlite, child, http |
| `contracts/evm/adapter.integration.ts` | 1,252 | Keep: contract | child |
| `contracts/evm/monthly-reserve.integration.ts` | 1,802 | Keep: contract | child |
| `contracts/evm/scripts.test.ts` | 43 | Keep: contract | bun |
| `contracts/solana/adapter.test.ts` | 386 | Keep: contract | bun |
| `contracts/solana/monthly-commitment.test.ts` | 215 | Keep: contract | bun |
| `contracts/solana/token-extensions.test.ts` | 341 | Keep: contract | bun |
| `contracts/solana/token.test.ts` | 103 | Keep: contract | bun |
| `scripts/account-closure.test.ts` | 358 | Keep: integration | bun |
| `scripts/account-sessions.test.ts` | 82 | Keep: integration | bun |
| `scripts/collect-quality-census.test.ts` | 269 | Keep: integration | bun, child |
| `scripts/commit-credit-owner-any-base.test.ts` | 260 | Remove | bun |
| `scripts/contribution-quality.test.ts` | 85 | Remove | bun |
| `scripts/contributor-template-identity.test.ts` | 85 | Keep: integration | bun, child |
| `scripts/cycle-index-review-excluded.test.ts` | 256 | Keep: integration | bun, child |
| `scripts/direct-payment-disclosure-binding.test.ts` | 71 | Remove | bun |
| `scripts/enrich-contribution-quality.test.ts` | 107 | Keep: integration | bun, child |
| `scripts/escrow-acceptance/evm-resume.test.ts` | 169 | Remove | bun, child |
| `scripts/escrow-acceptance/upgrade.integration.ts` | 635 | Keep: workflow | child |
| `scripts/evaluator-awards.test.ts` | 55 | Remove | bun |
| `scripts/evidence-transport-failure.test.ts` | 238 | Remove | bun |
| `scripts/external-sources.test.ts` | 234 | Remove | bun |
| `scripts/fee-converter-release-preflight.test.ts` | 120 | Keep: integration | bun, child |
| `scripts/generate-points.test.ts` | 857 | Remove | bun |
| `scripts/github-actor.test.ts` | 36 | Remove | bun |
| `scripts/github-token.test.ts` | 48 | Remove | bun, child |
| `scripts/global-leaderboard-reward-start.test.ts` | 133 | Remove | bun, child |
| `scripts/historical-cycle-registry.test.ts` | 101 | Keep: integration | bun, child |
| `scripts/identity-maintenance.test.ts` | 59 | Keep: integration | bun |
| `scripts/legacy-repository-registry.test.ts` | 140 | Keep: integration | bun |
| `scripts/model-provider-alias.test.ts` | 64 | Remove | bun, child |
| `scripts/oauth-completion.test.ts` | 99 | Remove | bun |
| `scripts/owner-award-authority.test.ts` | 170 | Keep: integration | bun |
| `scripts/payment-keeper/evm.integration.ts` | 1,157 | Keep: workflow | child |
| `scripts/payout-exclusion.test.ts` | 217 | Keep: integration | bun |
| `scripts/points-import.test.ts` | 386 | Keep: integration | bun |
| `scripts/prepare-monthly-rewards.test.ts` | 292 | Keep: integration | bun |
| `scripts/profile-activity-reward-start.test.ts` | 21 | Remove | bun |
| `scripts/profile-issue-census.test.ts` | 259 | Remove | bun, mock |
| `scripts/project-application-github-check.test.ts` | 524 | Keep: integration | bun |
| `scripts/project-contributor-skill.test.ts` | 110 | Remove | bun |
| `scripts/project-registry-api.test.ts` | 2,153 | Keep: integration | bun, sqlite |
| `scripts/project-self-service.test.ts` | 2,690 | Keep: integration | bun |
| `scripts/project-x-link.test.ts` | 30 | Remove | bun |
| `scripts/qualification-deployment-recovery.test.ts` | 120 | Remove | bun, child |
| `scripts/quality-external-evaluation.test.ts` | 302 | Keep: integration | bun, child |
| `scripts/quality-payment-ledger.test.ts` | 373 | Keep: integration | bun, child |
| `scripts/release-registry.test.ts` | 360 | Keep: integration | bun, child |
| `scripts/review-credit.test.ts` | 721 | Remove | bun |
| `scripts/review-exclusion-validation.test.ts` | 105 | Remove | bun |
| `scripts/review-points-grouping.test.ts` | 157 | Remove | bun |
| `scripts/reviewer-leaders.test.ts` | 99 | Remove | bun |
| `scripts/reward-token-metadata.test.ts` | 180 | Remove | bun |
| `scripts/run-receipt-codex-usage.test.ts` | 127 | Remove | bun |
| `scripts/score-record-unprivileged-comment.test.ts` | 215 | Remove | bun |
| `scripts/search-recovery.test.ts` | 146 | Remove | bun |
| `scripts/sha256.test.ts` | 159 | Remove | bun |
| `scripts/skill-source-matches-commit.test.ts` | 55 | Keep: integration | bun, child |
| `scripts/slop-attribution-marker.test.ts` | 169 | Remove | bun |
| `scripts/source-correction.test.ts` | 221 | Remove | bun |
| `scripts/staging-release.test.ts` | 389 | Keep: integration | bun, child, mock |
| `scripts/standings-payment-availability.test.ts` | 50 | Remove | bun |
| `scripts/terms-preflight.test.ts` | 112 | Keep: integration | bun |
| `scripts/trace-upload-attachable.test.ts` | 481 | Keep: integration | bun |
| `scripts/value-merge-sdk.workflow.mjs` | 280 | Keep: workflow | child |
| `scripts/value-scoring-policy.test.ts` | 1,868 | Remove | bun |
| `scripts/vault-setup-network-failure.test.ts` | 276 | Keep: integration | bun, mock |
| `scripts/vetting-api.test.ts` | 1,119 | Keep: integration | bun |
| `scripts/vetting-assembly-workflow.ts` | 510 | Keep: workflow | dedicated driver |
| `scripts/vetting-bounded-scan.test.ts` | 328 | Keep: integration | bun |
| `scripts/vetting-evidence-assembly-workflow.ts` | 709 | Keep: workflow | playwright |
| `scripts/vetting-public-key.test.ts` | 157 | Keep: integration | bun, child |
| `scripts/vetting-publication-journal.test.ts` | 101 | Keep: integration | bun, sqlite |
| `scripts/vetting-queue.test.ts` | 346 | Keep: integration | bun, child |
| `scripts/vetting-scan-flags.test.ts` | 1,354 | Keep: integration | bun |
| `scripts/vetting-scan-service.test.ts` | 1,053 | Keep: integration | bun, child |
| `scripts/vetting-scanners.test.ts` | 266 | Keep: integration | bun |
| `scripts/wallet-possession.test.ts` | 300 | Keep: integration | bun |
| `src/ProjectLeaderboard.test.tsx` | 52 | Remove | bun |
| `src/lib/funding-address.test.ts` | 51 | Remove | bun |
| `src/lib/funding-reminders.test.ts` | 22 | Remove | bun |
| `src/lib/intake-drafts.test.ts` | 103 | Remove | bun |
| `src/lib/monthly-commitment-actions.test.ts` | 197 | Remove | bun |
| `src/lib/payments/contracts.test.ts` | 99 | Remove | bun |
| `src/lib/payments/monthly-allocation.test.ts` | 188 | Remove | bun |
| `src/lib/payout-consent.test.ts` | 122 | Remove | bun |
| `src/lib/project-capabilities.test.ts` | 86 | Remove | bun |
| `src/lib/project-schema.robinhood.test.ts` | 96 | Remove | bun |
| `src/lib/use-direct-transfers.test.ts` | 28 | Remove | bun |
| `tests/e2e/account-closure-integration.spec.ts` | 233 | Keep: browser | child |
| `tests/e2e/account-sessions.spec.ts` | 276 | Keep: browser | dedicated driver |
| `tests/e2e/automatic-monthly-payment.spec.ts` | 153 | Keep: browser | dedicated driver |
| `tests/e2e/earnings-monthly-awards.spec.ts` | 88 | Keep: browser | dedicated driver |
| `tests/e2e/email-preferences.spec.ts` | 91 | Keep: browser | dedicated driver |
| `tests/e2e/evidence-download.spec.ts` | 277 | Keep: browser | dedicated driver |
| `tests/e2e/funding-wallet-qa.spec.ts` | 173 | Keep: browser | playwright |
| `tests/e2e/hero-typewriter.spec.ts` | 63 | Keep: browser | dedicated driver |
| `tests/e2e/home-cache.spec.ts` | 279 | Keep: browser | dedicated driver |
| `tests/e2e/login.spec.ts` | 209 | Keep: browser | dedicated driver |
| `tests/e2e/onboarding-clearance.spec.ts` | 74 | Keep: browser | dedicated driver |
| `tests/e2e/owner-awards.spec.ts` | 330 | Keep: browser | dedicated driver |
| `tests/e2e/payment-availability.spec.ts` | 120 | Keep: browser | dedicated driver |
| `tests/e2e/payout-consent.spec.ts` | 392 | Keep: browser | playwright |
| `tests/e2e/payout-wallet-picker.spec.ts` | 848 | Keep: browser | playwright |
| `tests/e2e/points-social.spec.ts` | 229 | Keep: browser | dedicated driver |
| `tests/e2e/points.spec.ts` | 213 | Keep: browser | dedicated driver |
| `tests/e2e/profile-rename.spec.ts` | 643 | Keep: browser | playwright |
| `tests/e2e/profile-review-exclusions.spec.ts` | 396 | Keep: browser | playwright |
| `tests/e2e/profiles.spec.ts` | 362 | Keep: browser | dedicated driver |
| `tests/e2e/project-payment-navigation.spec.ts` | 378 | Keep: browser | playwright |
| `tests/e2e/project-proposal.spec.ts` | 841 | Keep: browser | playwright |
| `tests/e2e/project-standings-navigation.spec.ts` | 251 | Keep: browser | playwright |
| `tests/e2e/referral-claims.spec.ts` | 357 | Keep: browser | playwright |
| `tests/e2e/registry.spec.ts` | 2,388 | Keep: browser | playwright, child |
| `tests/e2e/score-penalties.spec.ts` | 225 | Keep: browser | dedicated driver |
| `tests/e2e/security-bounty.spec.ts` | 3,036 | Keep: browser | playwright, child |
| `tests/e2e/site.spec.ts` | 1,676 | Keep: browser | playwright |
| `tests/e2e/slopbot-appeal-inbox.spec.ts` | 105 | Keep: browser | child |
| `tests/e2e/solana-vault-actions.spec.ts` | 1,663 | Keep: browser | playwright, child |
| `tests/e2e/vault-actions.spec.ts` | 1,997 | Keep: browser | playwright, child |
| `tests/e2e/wallet-readback.spec.ts` | 109 | Keep: browser | dedicated driver |
| `workers/fee-converter/fee-converter.test.ts` | 2,403 | Keep: integration | bun, sqlite |
| `workers/fee-converter/fork.integration.ts` | 1,998 | Keep: workflow | child |
| `workers/fee-converter/jupiter-route.test.ts` | 107 | Remove | bun |
| `workers/fee-converter/jupiter-wire.test.ts` | 125 | Remove | bun |
| `workers/fee-converter/native-gas.test.ts` | 1,110 | Keep: integration | bun |
| `workers/fee-converter/solana-accounts.test.ts` | 165 | Remove | bun |
| `workers/fee-converter/solana-expiry.test.ts` | 289 | Remove | bun |
| `workers/fee-converter/solana-local.integration.ts` | 569 | Keep: workflow | child |
| `workers/fee-converter/solana-route-accounts.test.ts` | 390 | Remove | bun |
| `workers/fee-converter/solana-route-prepare.test.ts` | 539 | Keep: integration | bun |
| `workers/notify/notify.test.ts` | 307 | Remove | bun, mock |
| `workers/notify/security.test.ts` | 501 | Keep: integration | bun |
| `workers/payment-executor/bind-trigger.integration.ts` | 1,111 | Keep: workflow | sqlite, child |
| `workers/payment-executor/binding-cancellation.workflow.mjs` | 202 | Keep: workflow | miniflare, sqlite, child |
| `workers/payment-executor/binding-recovery.workflow.mjs` | 182 | Keep: workflow | miniflare, child |
| `workers/payment-executor/bootstrap-workflow.mjs` | 454 | Keep: workflow | miniflare, sqlite, child, http |
| `workers/payment-executor/mainnet-execution.test.ts` | 31 | Remove | bun |
| `workers/payment-executor/wallet-rotation.test.ts` | 187 | Keep: integration | bun, sqlite |
| `workers/payments/escrow-policy.test.ts` | 292 | Remove | bun |
| `workers/payments/reconcile.integration.ts` | 341 | Keep: workflow | sqlite |
| `workers/payments/reconcile.test.ts` | 82 | Remove | bun |
| `workers/payments/recovery.integration.ts` | 375 | Keep: workflow | sqlite |
| `workers/payments/registry.integration.ts` | 955 | Keep: workflow | sqlite, child |
| `workers/referral-accrual/anvil.integration.ts` | 849 | Keep: workflow | child, mock |
| `workers/referral-accrual/poster.test.ts` | 969 | Keep: integration | bun, sqlite, mock |
| `workers/referral-accrual/referral-accrual.test.ts` | 1,031 | Keep: integration | bun, sqlite |
| `workers/slopbot/appeal.test.ts` | 366 | Keep: integration | bun |
| `workers/slopbot/closure-eligibility.test.ts` | 239 | Remove | bun |
| `workers/slopbot/history-registry.test.ts` | 464 | Keep: integration | bun |
| `workers/slopbot/maintainer-hold.test.ts` | 687 | Keep: integration | bun |
| `workers/slopbot/penalty-appeal.test.ts` | 2,026 | Keep: integration | bun |
| `workers/slopbot/quality.test.ts` | 579 | Remove | bun, sqlite |
| `workers/slopbot/reopen-source.test.ts` | 189 | Keep: integration | bun |
| `workers/slopbot/repository-access.test.ts` | 245 | Remove | bun |
| `workers/slopbot/review-scope.test.ts` | 341 | Keep: integration | bun |
| `workers/slopbot/review.test.ts` | 541 | Remove | bun, sqlite |
| `workers/slopbot/spend-alerts.test.ts` | 479 | Keep: integration | bun, sqlite |
| `workers/slopbot/value-live-registry.test.ts` | 386 | Keep: integration | bun |
| `workers/slopbot/value-patch.test.ts` | 162 | Remove | bun |
| `workers/slopbot/value-retained-reference.test.ts` | 665 | Remove | bun |
| `workers/slopbot/webhook-body.test.ts` | 238 | Remove | bun |
| `workers/slopbot/webhook-installation.test.ts` | 413 | Keep: integration | bun, sqlite |
| `workers/vetting/acquire.test.ts` | 181 | Keep: integration | bun, child |
| `workers/vetting-backup/qualification-workflow.mjs` | 242 | Keep: workflow | miniflare, sqlite, child, http |
| `workers/vetting-backup/workflow.mjs` | 450 | Keep: workflow | miniflare, sqlite, child, http |
| `workers/vetting-flags/workflow.ts` | 123 | Keep: workflow | miniflare, sqlite, child, http |
| `workers/vetting-sandbox/workflow.ts` | 92 | Keep: workflow | dedicated driver |

## Fixture inventory and reachability

Baseline `tests/fixtures` holds 91 files and 19,074,044 bytes.

- `history/`: 23 files, 17,890,350 bytes; restored through `fixture-overlay.mjs` or read by registry/installer/financial history integration.
- `projects/`: 11 files, 46,583 bytes; restored through `fixture-overlay.mjs` or read by registry/installer/financial history integration.
- `skills/`: 49 files, 185,198 bytes; restored through `fixture-overlay.mjs` or read by registry/installer/financial history integration.
- `value-merge-sdk-publisher.toml`: 316 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `value-merge-network-97-117.json`: 20,902 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `project-registry.mjs`: 38,617 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `value-merge-child-pipes.py`: 2,659 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `value-merge-sdk-worker.ts`: 3,337 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `value-merge-sdk-pages.toml`: 328 bytes; retained fixture source; direct consumer or dynamic fixture overlay.
- `qualification-deployment.mjs`: 6,179 bytes; remove with deleted deployment-preload test.
- `leaderboard-2026-10-16.json.gz`: 879,575 bytes; retained fixture source; direct consumer or dynamic fixture overlay.

## Baseline totals

- Keep: integration: 64 files, 36,727 lines.
- Keep: workflow: 23 files, 16,437 lines.
- Remove: 60 files, 12,945 lines.
- Keep: contract: 7 files, 4,142 lines.
- Keep: browser: 32 files, 18,475 lines.

The inventory is a scope ledger, not a claim that every retained assertion must remain. Inline unit-only and copy-only blocks are also removed during implementation; final measured totals and validation results belong in the combined report.

## Installer and native contract coverage (retained)

The extension-based TypeScript inventory above is supplemented by these explicitly invoked installer and native-contract suites/support files. Solidity `.t.sol` and inline Rust tests remain intact under the smart-contract exception.

| Path | Lines | Decision |
| --- | ---: | --- |
| `contracts/evm/integration/mainnet-upgrade-rehearsal.ts` | 1,534 | Keep: contract/local-chain test |
| `contracts/evm/integration/upgrade.ts` | 361 | Keep: contract/local-chain test |
| `contracts/evm/test/AnyToken.t.sol` | 302 | Keep: contract/local-chain test |
| `contracts/evm/test/BindingLifecycle.t.sol` | 203 | Keep: contract/local-chain test |
| `contracts/evm/test/BoundedAttester.t.sol` | 438 | Keep: contract/local-chain test |
| `contracts/evm/test/DeployFactory.sol` | 32 | Keep: contract/local-chain test |
| `contracts/evm/test/FableEscrow.t.sol` | 441 | Keep: contract/local-chain test |
| `contracts/evm/test/FeeConverterFixture.sol` | 93 | Keep: contract/local-chain test |
| `contracts/evm/test/MonthlyCommitment.t.sol` | 539 | Keep: contract/local-chain test |
| `contracts/evm/test/MonthlyReserveV2.t.sol` | 477 | Keep: contract/local-chain test |
| `contracts/evm/test/MonthlyTree.sol` | 54 | Keep: contract/local-chain test |
| `contracts/evm/test/OpusBase.sol` | 111 | Keep: contract/local-chain test |
| `contracts/evm/test/OpusFindings.t.sol` | 184 | Keep: contract/local-chain test |
| `contracts/evm/test/OpusInvariant.t.sol` | 382 | Keep: contract/local-chain test |
| `contracts/evm/test/OpusTokens.t.sol` | 142 | Keep: contract/local-chain test |
| `contracts/evm/test/ReferralDistributor.t.sol` | 667 | Keep: contract/local-chain test |
| `contracts/evm/test/SonnetParity.t.sol` | 273 | Keep: contract/local-chain test |
| `contracts/evm/test/UpgradeLifecycle.t.sol` | 96 | Keep: contract/local-chain test |
| `contracts/evm/test/WideToken.sol` | 37 | Keep: contract/local-chain test |
| `contracts/solana/integration/escrow.e2e.mjs` | 3,508 | Keep: contract/local-chain test |
| `contracts/solana/integration/executor.e2e.mjs` | 1,572 | Keep: contract/local-chain test |
| `contracts/solana/integration/keeper.e2e.mjs` | 711 | Keep: contract/local-chain test |
| `contracts/solana/integration/owner-instructions.e2e.mjs` | 351 | Keep: contract/local-chain test |
| `contracts/solana/integration/owner-plan.e2e.mjs` | 723 | Keep: contract/local-chain test |
| `contracts/solana/integration/production-delay.e2e.mjs` | 335 | Keep: contract/local-chain test |
| `contracts/solana/integration/token-2022.e2e.mjs` | 302 | Keep: contract/local-chain test |
| `tests/integration/installer.e2e.ts` | 2,711 | Keep: real installer workflow |

Rust unit blocks retained in `contracts/solana/programs/slop-escrow/src/{lib,token_policy}.rs`; native runner `contracts/solana/scripts/test-e2e.sh` preserves build, contract, and adapter stages. The installer remains 2,711 lines because its atomic activation, trust, symlink, concurrency, rollback and platform boundaries need complete filesystem/process workflows.




## Completion criteria and evidence ledger

The report is complete before implementation begins. Each selected finding must be implemented or explicitly rejected with a concrete reason. Required final checks include frozen dependency install, source-record checks, typechecking, lint/format, build, meaningful integration/installer tests and real-browser E2E for changed flows. Browser acceptance includes desktop/mobile, keyboard, zoom, accessibility and request/console evidence. No provider inference result, live wallet payment, production release or agent-client compatibility may be claimed from a local fixture.

Implementation results and precise validation outcomes will be appended here. Deployment, DNS, TLS and served-production-byte evidence are N/A — this is not a release. External agent-client/provider/chain acceptance remains separate and must be reported honestly where not run.


### R-10 — Remove orphaned exports found after test pruning

A second reference scan after deleting unit-only consumers found three runtime exports with no callers: `writeNewJsonFile` in `scripts/write-new-file.ts`, `currentProjectPolicy` in `scripts/project-revision-policy.mjs` (plus its declaration), and `MODEL_DISCLOSURE_PREFIX` in the canonical `live-report.mjs`. Remove those unused wrappers/constant; keep the used immutable writer and full policy enumeration. The last change alters one canonical template line and therefore legitimately changes its next template digest; it does not alter the live-report behavior or relax attribution. Repeat installer verification. The scan also found `assertSolanaTestCluster`, `BASE_PLATFORM_FEE_RECIPIENT`, and `OperatorKeeper`, but further reference checks proved real Solana acceptance, contract-test and Wrangler binding consumers, so they remain.


### R-11 — Finish the existing route lazy-loading boundary

After the first measured route extraction, the home page still loads the Solana wallet-action chunk despite rendering no wallet action. The follow-up import trace finds ProfilePage and CyclePages used only as routes; Earnings used only for payout/account views (but eagerly imported in both App and Points); and EscrowFunding eagerly importing its three owner/wallet controls even when App imports only its read-only totals helpers. Extend FE-10 using React's existing lazy/Suspense mechanism: lazy-load the route-only profile/cycle views, Earnings at both consumers, and AutomaticMonthlyPayment/OwnerVaultSetup/VaultActions inside EscrowFunding. Keep shared useProfiles, balance totals and eligibility logic eager where the home page actually needs them. No new router, dependency or source file is required. Verify direct navigation and wallet/owner browser flows, then repeat the identical initial-JavaScript measurement.


## Implemented result

The implementation removes 24,296 net source/test lines excluding this report. The initial audit remains above so each choice can be reviewed against its evidence. All selected changes were implemented; the keep decisions preserve required product behavior, explicit authority and immutable history. No contract, migration, project registry snapshot, points journal or instruction mirror was modified.

### Root and backend disposition

| Finding | Result |
| --- | --- |
| R-01 | Removed six mirrored skill files and the synchronization script/commands; imports and generated renderer paths use the canonical template, with old immutable paths recognized by bootstrap. |
| R-02/R-03 | Removed the dead Python packager and generic recursive-delete script; clean now has a fixed dist target and native bounded retries. |
| R-04 | Removed the SHA passthrough CI job; independent jobs read github.sha and retain their checkout comparisons, real quality dependencies and release protections. |
| R-05 | Updated README to describe the actual integration gate and direct template editing. |
| R-06 through R-09 | Kept separate authority/runtime boundaries, contract network entrypoints, required fallback/uncertainty behavior, and accessible operational text. |
| R-10 | Removed three unreferenced exports. This changes one canonical template constant; generated template digests must change accordingly. |
| R-11 | Deferred route-only profiles/cycles, Earnings at both consumers, and owner/wallet funding controls using existing lazy/Suspense support. |
| B-01/B-02 | Combined three file-comparison modules and made inference persistence private to its sole consumer. Comparison function bodies were preserved. |
| B-03/B-04 | Reused shared cookie and JSON response helpers. Payment JSON now also inherits the shared private-response security headers. |
| B-05 | Consolidated SQLite adapters and moved fixture-only security/archive helpers out of service directories. |
| B-09/B-10/B-11 | Corrected stale role/intake comments and added fixed diagnostics to failed public history reads. |
| B-26 | All independent scheduled work runs even if a sibling fails. The invocation still rejects. A migrated-D1 regression proves an appeal is queued/checkpointed once despite an unrelated dispatcher-table failure. |

# Test cleanup implementation and validation

- Removed 62 non-contract unit/partial suites (13,539 lines of deleted files), including two redundant scanner fragments discovered during mixed-suite pruning.
- Kept 62 substantive non-contract Bun integration suites, 31 browser specs, all smart-contract tests, full installer lifecycle, local-chain scenarios and Miniflare workflows.
- Net non-contract Bun test source: 49,672 → 34,393 lines (15,279 fewer). Removed standalone config/calendar/Merkle/parser/encoding/pure scoring assertions from mixed suites; removed orphan helpers rather than renaming unused code.
- Removed the synthetic earnings-table browser spec and three copy/value-only browser tests. Preserved actual interactions, state transitions, recovery, accessibility, download and amount assertions.
- Replaced duplicate fee/referral SQLite wrappers with shared `tests/sqlite-d1.ts`, with full migrations as the default. Moved GitHub advisory fake and participation-ban fixture to `tests/`; archive normalizer to installer test directory. Removed now-unused deployment mock fixture.
- Shared current-working-tree source copying between CLI and browser fixture creation. This fixes tests silently reading committed HEAD instead of uncommitted candidate edits. Scratch browser trees are now removed after copying diagnostics; failed construction also cleans its scratch tree.
- Parameterized ten security payment scenarios in one runner and run at most two at a time. Each receives a distinct available port through `SLOP_SECURITY_ANVIL_PORT`. Independent native binding-recovery workflow remains included. Every failure remains an error exit; no retry hides it.
- Updated test aliases, TypeScript fixture inclusion, documentation pointers and escrow CI path filters. No security gate or production service activation changed.

## Validation

- Pinned Foundry v1.7.1 downloaded from the official Foundry GitHub release; release SHA-256 check passed. Executables at `/tmp/slop-foundry-v1.7.1`.
- `bun run test:security-payments`: exit 0; all ten real local Anvil scenarios plus native workerd/D1/Durable Object recovery workflow passed. Log `/tmp/slop-security-parallel-fixed.log`.
- First parallel experiment exposed the inherited shared default Anvil port; fixed by unique ports without relaxing any assertion. The failed experiment is not acceptance evidence.
- Broad Bun run: 680 passed, one secure-sandbox test skipped, one module-load error due to a missed canonical terms-preflight import. Fixed the import; six affected suites then passed 25/25. Logs `/tmp/slop-retained-tests.log`, `/tmp/slop-final-target-tests.log`. Root runs final complete verification after source freeze.
- Current TypeScript project check passed.
- Frontend agent reports updated owner-awards browser flow passed 4/4 desktop/mobile tests (`/tmp/slop-frontend-owner-awards.log`). Initial reads require no load-button click; explicit Refresh retains recovery coverage.
- Full installer lifecycle passed 35/35 in root's validation after relocation.

## Honest limits

No mainnet funds, real provider calls, deployment, production activation or external account/client qualification occurs in these cleanup checks. Local synthetic provider responses prove transport/authorization/failure controls only. A secure-sandbox case remains dedicated to its existing configured secure environment, not falsely reported as locally passed.


## Frontend implementation and validation

All ten frontend findings selected in the original report and the documented R11 follow-up are implemented. No new UI dependency, chart framework, raster asset or global router was introduced. The work retains existing project authority, consent, private-report, wallet-signature, recovery and finalized-payment boundaries.

| Finding | Final implementation | Evidence / result |
| --- | --- | --- |
| FE-01 | Moved `SignInPanel` from `Admin.tsx` to `Presentation.tsx`; Admin, SecurityBounty and OperatorTraces reuse it. | Unrelated security/operator views no longer import the Admin page merely for sign-in UI. Checking, errors, purpose and return location remain. |
| FE-02 | Moved `loginHref` from Points to existing `lib/browser-deployment.ts`; all callers import the helper directly. | Product-origin selection and encoded return destination remain unchanged. Strict typecheck passes. |
| FE-03 | Agent shortcut clicks call the existing `copyPrompt` action instead of silently swallowing clipboard failure. | Before/after clipboard-denial reproduction: `Copy agent prompt` becomes `Copy unavailable; select agent prompt`. Screenshots and videos retained below. |
| FE-04 | Pending setup rechecks on browser focus/visibility return. A synchronous in-flight ref prevents duplicate focus/visibility calls before React renders. | Preserves explicit scan requests, restrictions and manual recovery. Independent backend review identified the simultaneous-event race; fixed before final QA. |
| FE-05 | Monthly awards load on route entry and valid month changes. The existing action is now Refresh awards. | Desktop/mobile owner edit/finalize and reserve-recovery workflows passed. Requests retain `/monthly/YYYY-MM` and no-store; no unnecessary cache-busting URL was added. Invalid month input gives a useful message. Abort cleanup prevents a superseded read from replacing the current month. |
| FE-06 | VaultActions, AutomaticMonthlyPayment and OwnerCommitment reuse `useAction`; hook accepts a recovered initial error. | Caller-specific errors and notice clearing remain. Pending storage, wallet matching, signing, fee calculation and reconciliation code are unchanged. |
| FE-07 | Added one shared presentational `WalletConnection` to Presentation and used it in those three wallet flows. | Feature-specific provider filtering and callbacks remain. Owner choice, disabled state, empty-wallet message, connected address and connection errors remain explicit. |
| FE-08 | Removed unreferenced `.funding-records-note`, `.wallet-picker-note` and the dead link selector. | Kept dynamically built avatar, status, agent-logo and PR-bar classes. Parser audit found no justification for a blanket stylesheet purge. |
| FE-09 | Removed repeated footer domain text and its unused typography rule. | Existing SVG brand mark and four useful community/contact links remain. Before/after desktop/mobile footer screenshots inspected. |
| FE-10 | Extracted How it works, sponsors, receipts and models into one coherent lazy `PublicPages.tsx` feature. Shared payment/vault labels live in Presentation. | App falls from 2,763 to 1,631 lines; PublicPages has 1,153 lines. This is lazy route separation, not a claimed net line deletion. Actual initial browser JavaScript falls by 39,412 bytes (5.09%) before R11. |

### Independent review fixes included

The backend reviewer found two concrete regressions in the initial implementation: a monthly refresh could retain another month's action error/success notice, and focus plus visibility events could start duplicate setup checks. Both were fixed. Monthly reads clear the action error and notice; setup uses a synchronous in-flight lock. The review found no changes to wallet authorization/signing behavior.

### Local verification

- Strict TypeScript check passed after all frontend changes.
- Focused Biome checks passed for all changed frontend modules.
- Real Chromium owner-awards suite: desktop and 320px mobile; four tests passed in 13.8 seconds. It exercises private allocation edits, expected-sequence submission, early/automatic finalization state, sign-in return context, healthy/unknown reserve holds and submitted-transaction recovery after reload.
- Before and after captures visit home, How it works, sponsors, models and receipts at 1440×1000 and 320×800. All final route runs reached network idle with zero page exceptions, console errors, failed requests or HTTP error responses.
- Home axe checks found zero WCAG A/AA violations on desktop/mobile before and after. Keyboard first focus is Skip to content. Desktop 200% CSS zoom retains document width 1440 at viewport width 1440.
- The extra 320px-mobile-at-200%-CSS-zoom image clips in both versions because its effective width is below the application's supported 320px minimum. This exploratory capture is preserved and not described as a pass. Native 320px mobile layouts are captured separately.
- Measured initial homepage JavaScript response bodies: 774,729 bytes before, 735,317 bytes after. All measurements use the same frozen registry and public data; no compression assumption is involved.
- The clipboard failure reproduction prevents the external app navigation, denies `navigator.clipboard.writeText`, then clicks the first agent shortcut. Before: no visible error. After: the existing Copy control states that copying is unavailable and text can be selected.

### Evidence locations

- Full evidence inventory and limitations: `/tmp/slop-review-evidence/frontend/README.md`.
- Before screenshots, axe/console/network/asset records and walkthrough videos: `/tmp/slop-review-evidence/frontend/before-final/`.
- After screenshots, axe/console/network/asset records and walkthrough videos: `/tmp/slop-review-evidence/frontend/after-final/`.
- Raw before results: `/tmp/slop-review-evidence/frontend/before-final/results.json`.
- Raw after results: `/tmp/slop-review-evidence/frontend/after-final/results.json`.
- Clipboard result/width measurements: `/tmp/slop-review-evidence/frontend/clipboard-results.json`.
- Clipboard images: `before-final/clipboard-denied.png`, `after-final/clipboard-denied.png`; corresponding videos are under each `clipboard-video/` directory.
- Tested source hashes: `/tmp/slop-review-evidence/frontend/source-sha256.json`.
- Functional browser run: `/tmp/slop-frontend-owner-awards.log`; Playwright HTML/JSON artifacts in `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-wUaeKo/playwright-report/pages/` and `test-results/pages/`.
- Before fixture source: `/private/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-0qNEAO`.
- After fixture source: `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-wUaeKo`.

The principal ten changed frontend modules matched the after fixture byte-for-byte when captures completed. Root subsequently ran safe formatting/import sorting and is responsible for final committed-head verification. These captures prove local fixture behavior, not deployment, live provider qualification, production financial activity or every requested external agent client. No such activity was claimed or performed.


### R11 follow-up: complete route-only lazy boundaries

The report documented R11 before implementation. `App.tsx` now lazy-loads ProfilePage, both CyclePages views and EarningsPage. `Points.tsx` also lazy-loads EarningsPage so the account embed cannot pull wallet UI onto the home page. `EscrowFunding.tsx` keeps its small totals helpers available but lazy-loads AutomaticMonthlyPayment, OwnerVaultSetup and VaultActions. The existing root Suspense and ErrorBoundary handle loading/failure; no new routes, providers, signing behavior or files were added.

Typecheck and focused Biome pass. Fresh fixture build: `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-YNuQK0`. Same browser measurement: initial homepage JavaScript is now **517,628 bytes**, down **257,101 bytes (33.19%)** from the 774,729-byte baseline, and down a further 217,689 bytes from the first implementation.

R11 browser validation: owner-awards and payout-consent scenarios passed 16 cases across desktop/mobile; wallet readback passed 6 cases; profile and cycle route behavior passed 4 cases. The initial combined run's six wallet-readback cases failed only at diagnostics because the external preview run omitted `SLOP_E2E_SERVER=preview`, so expected unavailable preview API responses were treated as real Pages failures. Re-running those six with the correct preview lane passed (4.2 seconds); no application change or weakened assertion was made. The 16 other combined cases passed initially. The four profile/cycle tests passed in 10.7 seconds.

R11 home/How/sponsors/models/receipts captures: zero console errors, page errors, request failures and HTTP errors; zero home axe violations at both widths. Results, new screenshots and videos: `/tmp/slop-review-evidence/frontend/after-r11/`. Logs: `/tmp/slop-frontend-r11-functional.log`, `/tmp/slop-frontend-r11-wallet-readback.log`, `/tmp/slop-frontend-r11-records.log`. Current hashes: `/tmp/slop-review-evidence/frontend/source-sha256-r11.json`. R11 artifacts are also copied to the durable task folder `/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/codebase-review/frontend/after-r11/`.


### R12 follow-up: preserve fragment navigation across lazy routes

The report documented R12 before implementation. The existing bounded hash-scroll observer now restarts for the current destination URL, so both direct entry and client navigation wait for asynchronously mounted fragment targets. Its ten-second bound and reader-input cancellation are unchanged. App passes its destination URL to this existing hook; no second observer system or router was added.

The existing site hash-navigation test now takes the actual ProfilePage “How reviews score” link. It withholds the PublicPages JavaScript until the loading state is visible, then releases it and checks that #points is in the viewport and aligned within one pixel of its expected top. It then repeats the original direct #faq and #leaderboard checks. The fixture uses one existing excluded review with the chosen existing contributor as reviewer; the complete snapshot still passes its validator.

Before the fix the browser test failed on both widths: desktop left the target 974px below the top; mobile left it outside the viewport. After the fix desktop and mobile passed (2/2, 18.8s). A first strict geometry assertion was corrected to tolerate subpixel negative zero; no application code was changed for that test-only issue. Typecheck and focused Biome pass. No-op test initialization was replaced by a definite assignment fulfilled synchronously by the Promise constructor.

Before-failure artifacts and videos: `/tmp/slop-review-evidence/frontend/r12-before/`. After-success artifacts, videos and target screenshots: `/tmp/slop-review-evidence/frontend/r12-after/`. They are copied into the durable frontend evidence directory with the same names. Logs: `slop-r12-before-final.log`, `slop-r12-after-final.log`. `r12-javascript.json` records final initial-home JavaScript **517,645 bytes**, down **257,084 bytes (33.18%)** from baseline. `source-sha256-r12.json` records the exact App/Link/test bytes, all matched to the tested fixture before final report handoff.

R12 tested fixture: `/var/folders/jw/kl71l64x5f9d3glwbgvlw44w0000gn/T/slop-e2e-fixture-oxT8vr`. Root remains responsible for the full final committed-head checks.


### Verification at the combined source boundary

The first combined `bun run verify` completed successfully: 677 tests passed, the existing secure-sandbox-only test was skipped, the five local integration drivers completed, and the application built. Format checking, source-record checks, dependency audit, and strict typechecking passed. The route-only R-11 follow-up is verified separately before final delivery. Final committed-source execution results are retained in the linked validation record below.

Final before/after UI captures have also been copied to `/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/codebase-review/frontend/`, outside Git. The early exploratory baseline test run overlapped test deletions and is not a valid failure baseline; no claim of pre-existing application failure is based on that run. The scheduler and clipboard before/after reproductions are independent, valid local comparisons.


### R-12 — Preserve in-app fragment navigation across lazy routes

Post-change review identified a reachable lazy-navigation race: ProfilePage links to `/how-it-works#points`, but Link's one immediate scroll can run before the deferred PublicPages chunk renders, and the existing hash-settlement observer initializes only on AppContent mount. Extend that existing bounded observer to restart for in-app location/fragment changes while preserving its ten-second limit and cancellation on reader input. Add a browser regression that delays the destination chunk, follows the actual profile link and verifies the Points section becomes the scroll target. Keep direct-link behavior and do not add another scrolling subsystem.


### R-12 implementation and verification

The existing hash observer now accepts the current href and restarts when the rendered destination changes. Before the fix, a delayed PublicPages chunk left the actual profile-to-Points link misaligned (desktop section top 974 pixels; mobile section outside the viewport). The extended existing browser test now exercises that real link, releases the deferred chunk and verifies alignment within one pixel, then repeats direct FAQ and leaderboard links. Both desktop and mobile pass; before-failure and after-success screenshots/videos are retained. The ten-second bound and stop-on-reader-input behavior remain. Final initial JavaScript is 517,645 bytes (33.18% below baseline).

### Final validation record

The final immutable source revision, complete repository and browser results, conditional skips, commands and tool versions are recorded in [the local validation record](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/codebase-review/validation.md). This evidence lives outside Git; no captured browser trace, provider input, credential or private session is committed. The detailed before/after frontend inventory is [here](/Users/shawwalters/.codex/visualizations/2026/10/27/01a17b8b-c2b7-7f22-9204-b99ae13eca9d/codebase-review/frontend/README.md).

The unchanged EVM contracts also passed all 146 tests across 14 suites, including fuzz/invariant campaigns. The local parallel payment runner passed all ten Anvil scenarios and the native binding-recovery workflow. External provider, client, production, DNS/TLS and mainnet acceptance are not claimed by these local checks; no such systems were changed.


### R-13 — Exclude linked runtime directories from fixture source copies

The independent final checkout linked its existing node_modules runtime. Git's directory-only ignore rule does not ignore that symlink, so the shared copier attempted to copy it as a file and failed with ENOTSUP. Resolve file type with stat when deciding whether to skip directories; this includes linked runtime directories while preserving existing file-copy behavior. Create the browser fixture's root dependency symlink only after its source commit as well, matching the existing Solana dependency setup, so Git never records an external runtime path. The actual full integration run in the linked-runtime checkout verifies the fix; no synthetic existence-only unit test is added.
