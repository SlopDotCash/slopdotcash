# Whole-codebase simplification review — second pass, 26 October 2026

## Review status and scope

This report was completed before implementation, against `67e183f88120282bc0008e22f20f5262ee0e77cc` on `codex/codebase-second-pass`, from current `origin/development`. It follows the first completed review in [codebase-review-2026-10-26.md](codebase-review-2026-10-26.md); that work reached main through PRs #1400 and #1401. Previous reductions are not counted again.

The user requested another whole-codebase pass, an extremely detailed report, all justified implementation, parallel work, fewer steps/duplicated code/tests, and explicit best-practice criteria. Four review streams inspected repository infrastructure, frontend, services/adapters, and tests. The baseline has1,110 tracked paths. This is source review plus targeted reproductions, not a claim of formal verification of every line or every external provider. Historical records, native contract tests, canonical security/economic policy and generated outputs are retained.

Concrete changes selected: six frontend flow/data/action fixes (SF-01–06); three backend/adapter changes (SB-01–03); three script/dead-code changes (SR-01–03); the test/fixture/runner/CI reductions described by ST-01–15. Conditional candidates are resolved by evidence: SF-07/09 retain current optional preload/manual operator behavior because there is no demonstrated user defect; SF-10/11 retain explanatory scoring context and formatters; SF-12 may combine only provably equivalent CSS rules. ST-10 shares real R2 setup only if the implementation is smaller and preserves independent per-case namespaces with measured gain; otherwise the report records a justified keep. ST-11 retains each distinct layout family's desktop/mobile, keyboard, axe, reflow and200% checks while reducing repeated intermediate widths. ST-13 removes duplicated subset execution, not the required full code or chain jobs.

All changes serve the existing MVP in PRD sections3–9 and11. No mainnet deployment, economic parameter selection, signer expansion or enforcement activation is authorized by this refactor. The prior user instruction to merge without waiting did not delete or disable production release controls.

## Report navigation

1. Repository structure, dead code, scripts, error handling and explicit best-practice criteria.
2. Frontend user journeys, data ownership, components, styles, copy and graphics.
3. Backend/worker/adapter correctness, concurrency, authority boundaries and full source inventory.
4. Test value, deduplication, fixture reduction, runner lifecycle and per-test inventories.
5. Implementation results and verification (appended after the report-first commit).

# Second-pass repository structure, build, script and dead-code audit

Baseline: `67e183f88120282bc0008e22f20f5262ee0e77cc`. Audit performed before implementation. The first cleanup is already merged to main; none of its prior savings are counted as new results.

## Scope and method

Git lists 1,110 tracked paths at this baseline. A Bun parser scan successfully examined exports/imports of 656 JavaScript/TypeScript modules (excluding generated fixture copies and declaration-only files), with 1,916 named exports and 251 exports with no textual reference in another tracked source/document. Those 251 are **candidates**, not 251 dead functions: most are used inside their own module, exposed through declaration files, or are runtime entrypoints. Type-only imports are elided by Bun, so the import graph was reconciled against exact-path text searches. `src/lib/wallet-proof.ts`, runtime registry substitution in `vite.config.ts`, `src/main.tsx`, and worker entrypoints are examples that must not be deleted on graph evidence alone. Compiler unused-local/parameter checks passed for the complete existing Node project before changes.

Root additionally inspected all 202 paths under scripts, workflows, skills, protocol and docs listed in the audit inventory; dynamic shell/CI entrypoints were reconciled with package scripts and operational runbooks. The catch/default scan returned270 candidates across all application/script/service source. Ownership was partitioned: browser candidates to frontend audit; services to backend audit; root read build/ingestion/artifact/operational candidates. Existing historical records, frozen fixture history, native contracts, canonical templates and generated sources were classified separately.

## Selected changes

### SR-01 — Remove the unused immutable-file writer

- `scripts/write-new-file.ts:1-31` exports `writeNewFile` and `ExistingFileError` but has no consumer, script invocation, workflow entry, or type reference. The old JSON writer consumer disappeared in the first cleanup; this31-line remainder has no CLI behavior.
- Delete the module. Preserve every actually used append-only writer, D1 trigger and historical record.
- Acceptance: no source import or workflow reference remains; normal compiler/build paths still resolve. No replacement abstraction or test is needed for removing unreachable code.
- PRD sections2 and9: retain only actual record and publication paths.

### SR-02 — Remove the abandoned PR-evidence CLI and its private dead branches

- `scripts/check-pr-evidence.mjs` is a278-line CLI/compatibility barrel; only `scripts/generate-leaderboard.ts:67-71` imports it, for three real artifact-verification functions. No package alias, workflow, runbook or shipped skill invokes this CLI.
- The CLI's help and failure path refer to nonexistent `scripts/pr-evidence.mjs`, `evidence:doctor`, `packages/app` and `packages/ui`, and a different repository's worked example. The current Slop PR template does not even carry the HTML markers this CLI expects. This is abandoned local tooling, not a live release gate.
- Its copied policy branches (`inspectEvidenceHead`, file/label UI classification, inline-transcript eligibility, `evaluatePrEvidence`, duplicate-row enforcement and `artifactVerificationRows`) are reachable only through that CLI or each other. The remaining real consumer asks the artifact verifier to fetch bounded, trusted references and preserve verified digests for ingestion. Do not weaken that behavior.
- Replace the generator's barrel import with direct imports from `pr-evidence-artifacts.mjs` and `pr-evidence-policy.mjs`. Put the existing TypeScript interfaces alongside those two implementation modules, split by actual ownership. Remove the abandoned CLI and the policy code used exclusively by it.
- Preserve trusted-URL classification, bounded reads, image/video/document inspection, structured trajectory inspection, digest binding, retry classification, row extraction, duplicate artifact identities and the generator's permitted artifact kind checks. Do not alter `.github` gates, deployed workflow requirements or scoring policy.
- Acceptance: compare before/after exported live-verifier results on valid image bytes, unreachable artifact, row extraction and artifact-count samples. Build/typecheck confirm direct imports. No replacement unit suite or new command is added. Existing real ingestion/integration paths remain.
- PRD sections5,7,9 and11: actual evidence and deterministic scoring/publication remain authoritative; broken explanatory instructions and unused gates disappear.

### SR-03 — Reuse the exact canonical JSON implementation for historical cycle comparison

- `scripts/sync-cycle-index.ts:79-89` repeats the exact recursive array/object traversal, `localeCompare` key ordering and scalar serialization already owned by `src/lib/canonical-json.ts`.
- Import `canonicalJson as canonical` and remove the local body. This reduces one independently maintained definition of the byte-comparison algorithm without changing all existing call sites or historical bytes.
- Do not change `src/lib/project-policy.mjs`'s differently ordered serializer: it uses code-unit `.sort()` and has a separate history contract. Do not substitute ordinary JSON.stringify for either canonical representation.
- Acceptance: historical cycle verification and fixture publication produce identical cycle/index content apart from existing generated timestamps. A one-time comparison of the old and shared function on representative historical structures verifies byte identity. No new unit suite is needed for an exact implementation reuse.
- PRD sections2,6 and9: immutable historical obligations retain their original interpretation.

## Deliberately retained structure and behavior

| Area | Review decision and reason |
| --- | --- |
| Canonical contributor/reviewer templates | Keep exactly one generic source per role; first pass removed the duplicate script tree. Do not split into per-project copies or change installation trust/rollback merely to shorten code. |
| Live registry versus historical fixtures | Preserve D1 as current inventory, generated snapshot as derived input, and frozen legacy IDs/history as historical compatibility. Test fixtures can be deduplicated only by the test audit. |
| `collect-quality-census`, `collect-quality-discussions`, `enrich-quality-discussions`, `prepare-source-correction` | Standalone operator programs with concrete explicit input/output roles, even though not default npm scripts. Do not delete based on absence of imports. Their outputs do not authorize payments. |
| `scripts/github-pagination.ts` | Type-only shared connection contract; runtime import scanner does not see it. Keep. |
| `scripts/render-social-images.mjs` | Real manual brand asset generator with embedded usage and actual output images. Keep; lack of a package alias is not dead code. |
| Escrow acceptance/rehearsal drivers | Keep explicitly invoked test-chain/operator entrypoints, fixed signer scopes and real chain checks. Native contract tests are exempt from requested unit-test deletion. |
| Canonical JSON variants | Merge the byte-identical cycle implementation only. Different key ordering can change history digests and is not a cosmetic duplicate. |
| Hash helpers | Keep local streaming hash instances and incremental evidence hashing. A two-line wrapper alone is not sufficient reason for a broad risky churn. |
| `tsconfig.node.json` | Long explicit contract list is inelegant but defines the checked host boundary. Compiler reports no unused locals; widening it to all platform scripts just for fewer lines changes scope and adds host mismatches. Keep. |
| Publication pipeline | `prepare-site` writes endpoints/skill artifacts and cycle index; points generation depends on those cycles; profile generation has separate history inputs. Keep the ordering where dependencies exist. Do not parallelize shared-output stages indiscriminately. |
| Main/staging workflows | Keep distinct storage, secrets, deployment identity, publication locks, tested SHA and final served-byte verification. The user asked to merge without waiting; that does not require deleting live CI or release controls. |
| API/chain request bounds | Keep explicit timeout, byte/cost/rate/pagination limits and fail-closed proof handling. A long check at a hostile or financial boundary is useful complexity. |
| Last known values on fetch failure | Preserve honest stale cached values and explicit unavailable states. Never turn an ingestion exception into an empty leaderboard or zero funds. |
| Historical policy/records | Do not rewrite migrations, awards, legacy cycle amounts, old attribution, retained traces or settled obligations as cleanup. |
| Keys and production changes | No credential reads, payment broadcasts, mainnet deployment, activation, DNS mutation or signer expansion is part of this pass. |
| Root documentation | Existing PRD/runbooks are authority/history, not explanatory UI to delete. Correct doc references affected by actual code moves; preserve policy mirrors byte-for-byte. |

## Catch/default review

Build metadata parsers convert malformed source into a hard build failure; this is not success masking. `skillSourceMatchesCommit` preserves exact byte and complete-tree checks. A missing committed source intentionally records working-tree provenance, which cannot masquerade as an authorized release. `pythonCommand` probes supported pinned runtimes and then fails explicitly. GitHub ingestion retries only classified transport/secondary-limit failures and caps cost and attempts; bad data still blocks publication. `loadPublishedPoints` retains append-only history and validates complete batch digests, refusing bootstrap when published records may exist. Cycle review catches reject invalid monetary comparisons. Optional raw artifact format parsing can try structured alternatives, but only an actual successful parse yields verified evidence. The stale copied CLI parser path is removed under SR-02 instead of repaired into a new feature.

## Explicit refactoring criteria for this and later work

| Criterion | Accept when | Reject when |
| --- | --- | --- |
| Observable usefulness | A reachable action becomes correct, shorter, faster, recoverable or easier to maintain at an actual shared boundary | Only a metric, coverage percentage, filename count or generic preference changes |
| Single authority | Multiple consumers truly share identical rules/bytes and one existing module can own them | Similar names hide distinct security/economic/historical contracts |
| Scope | The approved MVP already requires the behavior and the change preserves its policy | A new feature, economic choice, enforcement switch or future-phase requirement is invented |
| State integrity | Loading/empty/stale/invalid/error states remain distinguishable, and one logical read is internally consistent | Failure maps to zero, missing evidence maps to success, or two reads can lose a lifecycle item |
| Parallelism | Independent read-only work is bounded and failures remain explicit | Shared signer/nonces/storage outputs are raced, or Promise.all silently changes failure semantics |
| Automatic actions | Refresh/recovery is reversible, safe and preserves a visible result | Consent, signing, money movement or destructive choices are hidden or auto-approved |
| React/data ownership | The nearest common parent owns page-lifetime session/data state and passes it down | Global caches introduce cross-user staleness or every child repeats the same request |
| Component extraction | Repeated structure has the same behavior/accessibility and a small stable interface | A large configurable universal component replaces straightforward distinct flows |
| Copy and visuals | Remove prose that repeats a heading/action; reuse real marks/charts only where meaning improves | Required refund, fee, irreversible signature, privacy or authority information disappears |
| Dead code | No import, runtime registration, CLI/workflow/doc consumer or retained compatibility role exists | A runtime-only or type-only entrypoint is deleted because a simplistic graph misses it |
| Error handling | Translate a known failure at its boundary with a useful visible outcome; retain original cause where appropriate | Catch-all success, unclassified retries, nullable defaults or swallowed failures conceal a defect |
| Test value | Real handler+DB, process, browser or chain interactions prove a contract and fail on a meaningful regression | Export inventories, literals, mock call assertions or shallow text checks duplicate implementation |
| Fixtures | Shared immutable source is cloned for per-test mutation; fixture scope is the minimum required | Repeated project JSON becomes a second registry or shared mutable data couples tests |
| Delivery evidence | Record baseline, actual reproduction, exact-head result and limits | Claim live/provider/mainnet or exhaustive security acceptance from local fixtures alone |

Implementation status: this audit precedes source edits. Post-change measurements and exact validation will be recorded in the combined report.


---

# Second-pass frontend review

Baseline: `67e183f88120282bc0008e22f20f5262ee0e77cc`, branch `codex/codebase-second-pass`. This pass is distinct from the first review: the canonical skill source, shared login URL/panel, shared wallet chooser, first action-hook migrations, route lazy loading, clipboard feedback and delayed fragment navigation have already shipped. They are not counted as new findings here.

Scope: 173 frontend source/assets/declaration files; 36 top-level application TSX modules, three CSS files, seven SVG agent icons, and the browser/domain helpers under `src/lib`. Every path was inventoried and statically referenced; state transitions, route data dependencies, network calls, form parsers and repeated UI were inspected more deeply. “Reviewed” means source review, not formal proof or a claim that every deployment/provider/wallet was exercised. Implementation has not begun.

## New findings selected for implementation

### SF-01 — Stop downloading the leaderboard on the funding route

- **Evidence:** `src/App.tsx:230` sets `ROUTES['funding-project'].snapshot` to true. `AppContent` calls `useSnapshot(needsSnapshot)` at line 1523, but the funding dispatch at lines 1594–1597 passes only `project` to `ProjectFundingPage`. That page never consumes the snapshot or cycle index; it obtains independent finalized vault totals through `EscrowFunding`.
- **Reachable effect:** opening `/projects/:id/funding` downloads, parses and validates `/data/leaderboard.json` plus `/data/cycles/index.json` without a consumer. The prior matching frozen fixture has approximately 14 MiB of leaderboard JSON and 52 KiB of cycle JSON. Exact current byte counts should be recorded during before/after browser verification.
- **Change:** set this route's `snapshot` flag to false. Keep its `registry: 'current'` gate and independent vault/funding reads untouched. Do not disable snapshots on the actual project, profile, receipt, models or cycle routes, which use them.
- **Acceptance:** navigate to funding with a valid project and the existing wallet fixture; verify funding/status/deposit controls and current-registry refusal behave identically. Record zero leaderboard/cycle requests on this route, including when those endpoints fail; verify ordinary project/cycle pages still load their real data.
- **PRD:** §§6,7,9. This removes unused public-data work and preserves financial authority. **Risk:** low; one route dependency setting.

### SF-02 — Make a failed private-submission list recover on Retry

- **Evidence:** `src/SecurityBounty.tsx:1460–1488`. `SubmissionsPanel.load()` stores a failure in `error`, but neither its next attempt nor its success path clears that state. Rendering returns the alert whenever `error` is non-null, before considering successfully loaded `submissions`.
- **Reproduction:** signed-in Security cases → first GET `/api/v1/security-submissions` returns 503 → change the same endpoint to a valid list → press Retry. The second request succeeds and updates the array, but the alert remains and the actual private reports stay hidden. Full page reload is the only current recovery.
- **Change:** reset the error at the canonical list-load boundary (or move this list to the existing security-resource state machine if that produces a genuinely smaller implementation). Preserve private drafts, the availability signal and manual fallback semantics. Use the existing error/resource machinery; do not add a generic notification framework.
- **Acceptance:** an existing security browser workflow should fail then recover in the same document and show its actual submission. A subsequent failure must still show an error. Ensure retry does not create/send a submission or change its revision.
- **PRD:** §§7–9: explicit failed state with a working next action. **Risk:** low. This is a real recovery bug, not a request to hide errors.

### SF-03 — Remove N+1 session reads inside already-authenticated page trees

- **Evidence:** `ProjectProposalPage` reads its project session at `ProjectProposalPage.tsx:860`; `OwnerProjects` reads it again at 2621, and `SubmitProject` again at 669. The parent already passes that session to `RepositoryPicker`. In `SecurityBounty.tsx`, `SecurityCasesPage` reads the session at 2696, while every `SubmissionCard` reads it again at 1289. `IntakeHandoff` reads it at 177 and its child `AutomaticReportForm` reads it again at 543.
- **Reachable effect:** the project form makes two same-session reads immediately and another on Review. A private case list makes one additional `/api/v1/project-session` request per displayed submission, even for submitted/read-only records. A list of 25 records can produce 26 session requests before accounting for the header. The replicas can transiently disagree after one request fails.
- **Change:** pass the page's actual `ProjectSessionState` to its children. Pass the signed-in identity from `SecurityCasesPage` through `SubmissionsPanel` to `SubmissionCard`, and pass the `IntakeHandoff` session to `AutomaticReportForm`. Do the same for `OwnerProjects` and `SubmitProject` from ProjectProposalPage. Remove child session hooks and related “fresh read” comments; do not install a global or indefinite authentication cache. API mutations still authenticate on every request.
- **Acceptance:** record request counts with one and several submissions; they stay constant in list length. Move through all four setup steps without another session fetch. Check signed-out, error, and signed-in states and verify the exact GitHub identity shown in consent. A server 401 still fails the action regardless of inherited UI state.
- **PRD:** §§3,4,8,9. **Risk:** low to medium because identity copy must use the existing parent state, not infer it from Points membership. The Points session and project session are deliberately not merged.

### SF-04 — Sign in directly from the project private-report form

- **Evidence:** `src/SecurityBounty.tsx:546–554`: `AutomaticReportForm` renders “Sign in with GitHub” as a Link to `/security`, which then renders a second sign-in action to `/login`. The first control therefore does not start GitHub login, and the eventual return location becomes the generic case inbox instead of the project program where the user started.
- **Reproduction:** signed-out visitor on `/projects/:id/security` with automatic intake configured → click “Sign in with GitHub” → generic Security cases page → click sign in again. This is one extra page and click, with lost project context.
- **Change:** render the existing `SignInPanel` with the actual session state and `next: /projects/${project.slug}/security`, or use the existing `loginHref` directly. The same panel must distinguish checking/error/signed-out and preserve the return destination. Do not sign the user in automatically or bypass reporting consent.
- **Acceptance:** one activation navigates to `/login?next=<project security path>`; completed sign-in returns to that project. Checking does not show a misleading login button; failed session reads remain visible.
- **PRD:** §§3,8 and §7 shortest complete journey. **Risk:** low; existing login helper/panel, no new auth protocol.

### SF-05 — Remove the USDC-cent gate from project-token monthly amounts

- **Evidence:** `ProjectProposalPage.tsx:349–353` validates every monthly amount with `monthlyPoolValue`, and the edit flow repeats this at 2054–2074. That helper (`lib/project-proposal.ts:90–112`) accepts at most two decimals, scales by six and caps using the legacy stablecoin policy. The backend instead calls `parseAssetAmount(amount, verifiedAsset.decimals)` (`backend/projects/handler.ts:629–658`), and `parseAssetAmount` supports the exact allowed token precision (`lib/project-schema.mjs:145–160`). `rewardFields` already deliberately leaves unverified token amounts at zero until the server reads their decimals.
- **Reachable failure:** a supported 18-decimal project token with a monthly amount `0.001` is valid under the canonical asset parser (`1000000000000000` base units) but the UI rejects it as “up to two decimals.” An existing project created through the supported API with this cap is also unable to save unrelated owner text edits because its unchanged initial amount fails the legacy validator.
- **Change:** keep the existing cent-precision stablecoin policy where it applies. For tokens, use the canonical exact decimal parser with verified decimals on existing assets, and plain allowed decimal syntax when creating a token whose decimals are intentionally server-verified. Display the typed token units directly in the preview; do not send a guessed six-decimal amount as the token cap. Keep the existing server verification and maximum base-unit bounds. Avoid a second money parser.
- **Acceptance:** existing 18-decimal token project with cap `0.001` can publish a text-only revision without changing its cap; changing the cap submits the exact decimal string and produces correct integer units. New token setup accepts the same amount but leaves chain decimals to the server. Overprecision for a known token, unsupported token, zero monthly amount and stablecoin invalid precision still fail visibly.
- **PRD:** §6 exact integer asset units and standard project-token rewards; §4 self-service changes. **Risk:** medium. This is removal of a client-only rejection, not a new economic parameter.

### SF-06 — Finish the remaining identical transaction-action wrappers

- **Evidence:** `OwnerReserveRelease.tsx:60–71` and `OwnerVaultSetup.tsx:162–180` still independently maintain boolean busy, string error, try/catch/finally and reset notice. The existing `useAction(initialError)` now supports these exact states; the first pass moved three sibling wallet flows to it. The reserve release wrapper is otherwise identical. Vault setup adds a specific `vault_creation_failed` classification which can remain in its failure mapper.
- **Change:** use the existing hook in these two wrappers, preserving initial unreadable-record errors, notice resets, vault-creation failure classification, and all financial intent storage/signature logic. Do not force phase-based or chain-based busy state into a boolean hook elsewhere.
- **Acceptance:** run existing reserve-repair and owner-vault browser paths; assert a failed request is visible, controls re-enable, successful retry works, and unreadable pending state stays blocked until the same explicit recovery action.
- **PRD:** §§6,7. **Risk:** low mechanical reuse. Expected savings are small; this is one consistent action-error contract across related transaction UI, not a claim of significant runtime speedup.

## Additional review outcomes and decisions

| ID | Evidence | Decision |
| --- | --- | --- |
| SF-07 | `ProjectProposalPage.tsx:1314`, `2620–2649` | “Your projects” starts loading its list even while its details element is closed. Deferring the list until first opening would save an optional request, but may remove useful preloading for common repeat maintainers. Include with SF-03 only if measured request reduction is useful; preserve loading/error/retry on opening. No hidden write occurs. |
| SF-08 | `OwnerVaultSetup.tsx:130–157`, `ProjectRiskFlag.tsx:68–95` | Both session preflights avoid ordinary signed-out requests producing 401 browser errors. Do not delete them mechanically. Prefer passing an existing project-session result where one is already known; no global authentication cache. |
| SF-09 | `VettingEvidence.tsx:33–96` | Linked evidence pages prefill assessment/run IDs but require “Inspect evidence inventory.” That read could be automatic only when both validated IDs are present and current operator state is signed in. The operator reasoned grant/download action must remain explicit. This is a valid optional reduction, but lower priority than broken submission retry and the 14MiB unused funding fetch; no new evidence access grant is implied. |
| SF-10 | `Points.tsx:1078–1110`, `PublicPages.tsx:117–198` | The leaderboard repeats point-band explanations already on How it works. A future compact link could reduce prose, but the small list also explains an otherwise opaque metric on the page. Keep in this pass unless usability evidence shows it displaces the actual list; do not replace raw-data download links with a graphic. |
| SF-11 | `Presentation.tsx:68–94,115–124,186–193` | Date/number formatters are recreated per cell. Module-level formatters can save allocations without semantic change, but no meaningful slow user path has yet been measured. Do not present microbenchmarks of arbitrary helper loops as a product performance result. Keep pending measured render evidence. |
| SF-12 | `styles.css:156,304`; `739,1171`; `1250,2966,3362`; `1394,1604`; `design-system.css:107,204` | PostCSS found five groups of identical multi-declaration rules, including disabled-button colors and metadata text. These can be grouped mechanically only after checking cascade order/specificity. Savings are a few declaration blocks, not hundreds of dead styles. Prefer one bundled cleanup if proven computed-style equivalent; do not reorder broad CSS casually. |
| SF-13 | `Presentation.tsx`, 69 alert/error JSX sites | A universal Alert component would mostly replace already-short markup with imports and a prop matrix. Do not create a new design-system framework solely to reduce the count of `<p role='alert'>`. Keep semantic error distinctions; move only actually shared rendering with two compatible consumers. |
| SF-14 | `Earnings.tsx:216`, `AdminProjectEnforcement.tsx:89`, `OperatorTraces.tsx:12`, `ReferralClaims.tsx:151–212` | Their custom async state is meaningful: per-chain busy identity, phase-specific review/apply, cancellation/byte zeroing, or uncertain signed-send storage. Keep these wrappers; a boolean `useAction` refactor would discard behavior or need more indirection than it removes. |
| SF-15 | `GeneratedSkillPreview.tsx` | Existing generated-skill preview intentionally uses the one canonical renderer and registry digest. Do not cache by incomplete keys or replace it with handwritten prose. Hidden textarea previews are a useful explicit reviewer control. |
| SF-16 | `App.tsx:193–233`, `use-snapshot.ts`, `use-cycle-index.ts` | Most route data flags are justified. Home/Points load their snapshot in the ranking child; cycle archive uses its independent index; project/profile/receipts/models genuinely consume complete data. Only SF-01 is a demonstrated unused read. |
| SF-17 | `Link.tsx:41–72` | First-pass delayed route-fragment recovery now works and remains bounded/cancelable by reader input. Do not replace history handling with a new router or add scrolling listeners. No new defect was shown in this audit. |
| SF-18 | `Earnings.tsx:280`, `use-payout-wallets.ts:113` | A superficial scan suggested case-sensitive wallet comparison; the provider normalizes EVM addresses to lowercase at the canonical boundary. No reproduced extra-wallet-confirmation defect exists; keep. |
| SF-19 | All three CSS files and SVG assets | The first-pass class scan's apparent misses are dynamic avatar/PR/status/logo variants. All seven logos remain used. Generated brand tokens remain generated. No additional dead asset is proven by filename absence. |
| SF-20 | `SecurityBounty.tsx` private case action forms; `OwnerAwards`, `VaultActions`, `PayoutConsent` | Consent, exact gross/fee/net/destination, current authority, uncertain send recovery, and moderation reasons remain necessary. Automating these decisions is outside cleanup; only unused reads, repeated session reads and the misrouted sign-in action are streamlined. |

## Component and style inventory

The inventory below explicitly records every top-level application module and style group reviewed; the separate appendix records every supporting path. Their unchanged status is a conclusion, not missing work.

| Module / group | Review focus | Result |
| --- | --- | --- |
| `App.tsx` | route data needs, lazy boundaries, Home/project/funding layout | SF-01 unused funding snapshot; other route dependencies retained. |
| `Points.tsx` | provider vs project session, auth actions, ranking, membership and social connection | No global session merge; keep consent; optional formatter/prose items SF-10/11. |
| `Profiles.tsx`, `ProfilePage.tsx` | shared census/membership reads, identity and history, pagination | Existing profile children already receive shared census/member state; no duplicate-fetch regression selected. |
| `PublicPages.tsx` | how/sponsors/receipts/models, prose vs tables/bars | Existing tabular/graphic rendering remains; public policy text is optional disclosure where appropriate. |
| `CyclePages.tsx`, `ProjectLeaderboard.tsx` | historical/live allocations, ranks and state labels | Historical cycle meanings remain; no cosmetic ranking rewrite. |
| `ProjectProposalPage.tsx` | four steps, owner list, review, exact funding inputs | SF-03 session reuse; SF-05 token amount gate; SF-07 optional list load. |
| `ProjectSetupStatus.tsx` | focus refresh, status checks and retry | First-pass in-flight guard remains; no polling loop added. |
| `GeneratedSkillPreview.tsx` | canonical rendering, digest, loading/error | Keep trust logic and exact preview bytes. |
| `ProjectRiskFlag.tsx` | report/withdraw, session preflight, error recovery | Keep explicit flag actions and current-session preflight unless shared parent state becomes available. |
| `Earnings.tsx` | saved wallet vs connection, account picker, network cards and balances | Keep chain-specific async state and current approval/replacement flow. |
| `EscrowFunding.tsx` | snapshot freshness and owner controls | Actual vault reads are independent and retained while SF-01 removes only the unused ledger load. |
| `AutomaticMonthlyPayment.tsx`, `VaultActions.tsx`, `OwnerCommitment.tsx` | existing shared chooser/action hook, signed intent recovery | Already standardized in pass one; signatures and unknown-state handling retained. |
| `OwnerVaultSetup.tsx`, `OwnerReserveRelease.tsx` | remaining action wrapper, recovery, optional extra reads | SF-06 exact hook reuse; do not simplify transaction-state contracts. |
| `OwnerAwards.tsx` | automatic monthly read, edit/finalize, error reset | First-pass cancellation/reset fix retained; no new read button introduced. |
| `OwnerBountyVault.tsx` | private totals and recovery | Keeps stale totals with explicit failure; no merge into public balances. |
| `PayoutConsent.tsx`, `ReferralClaims.tsx` | modal accessibility, review/signature and unknown sends | Keep independent consent and program lifecycle. |
| `SecurityBounty.tsx` | intake routing, session multiplicity, lists, report drafts, owner actions | SF-02 persistent error; SF-03 session reuse; SF-04 direct sign-in. |
| `SecurityProgramEditor.tsx` | immutable terms, split, scope, response targets | Keep distinct public terms form; no broad generic field schema needed. |
| `Admin.tsx`, `AdminVetting.tsx`, `AdminProjectEnforcement.tsx` | exception-only controls, phase errors, setup and moderation | Keep human decisions and explicit phases; generic action hook only where no phase semantics would be lost. |
| `AccountAppeals.tsx` | persisted appeal, reason/evidence, retry | Keep successful-send state and explicit account restrictions. |
| `Inbox.tsx`, `InboxEmail.tsx` | cursor reads, security acknowledgement, email consent | Keep separate read/acknowledge/email semantics; no auto-consent or auto-acknowledge. |
| `OperatorTraces.tsx`, `VettingEvidence.tsx` | explicit reasoned access, bytes/digest, private inventory | Keep access grant and byte verification; SF-09 optional auto inventory read only. |
| `Presentation.tsx` | shared semantic primitives, formatters, monetary labels | Reuse existing chooser, sign-in and resource presentation; do not add a prop-heavy generic UI layer. |
| `Link.tsx`, `Logo.tsx`, `ErrorBoundary.tsx`, `main.tsx` | navigation/hash, accessible brand, boot failure, registry fallback | Keep existing boundaries and reviewed graphics. |
| `styles.css`, `design-system.css`, `brand-tokens.css` | dead selectors, duplicate declarations, shared controls, cascade | Five small identical-rule groups; no proven broad dead CSS; token file remains generated. |
| `agent-logos/*.svg` | dynamic icon mapping and accessible names | All seven are live. |

## Best-practice rubric applied

1. Start at a user outcome and trace the actual state/request path. File count, line count and coverage counts are not proof of improvement.
2. Keep immutable IDs, current authorization, user consent, exact asset units and finalized evidence at their existing canonical boundary.
3. Share already-read identity down a page tree. Do not make every row refetch it; do not invent a global cache that outlives a login or privilege change.
4. A route should fetch data only if its rendered subtree consumes it. Measure actual requests/bytes and parsing work before and after.
5. Every retry must be capable of leaving its error state. Test failure then recovery in the same document, not only a fresh successful page load.
6. Keep security/transaction mutation errors distinct from optional public-data unavailability. Reuse action machinery only when phase/cancellation/unknown-send behavior matches.
7. Local preview validation must not be stricter than the canonical approved server/asset contract. Never use stablecoin precision as a token parser.
8. Automate unambiguous reads and preserve manual financial actions, moderation decisions and external consent. A button labelled sign in should start sign-in with the relevant return destination.
9. Use the existing component library for identical semantics. Do not add abstractions just because markup looks similar.
10. Group CSS only with proof that source order, specificity, media conditions and interaction states remain equivalent. A dynamic class is not dead because literal search misses it.
11. Avoid new runtime dependencies for tables, icons or forms that already work. Keep textual equivalents of all graphics and financial identifiers.
12. Keep loading, absent, stale, denied, invalid, failed, submitted and finalized states distinct. An empty array is not a fallback for a failed read.
13. Preserve validated historical views and immutable source data. Cleanup must not reissue scores or convert old financial meaning.
14. Verify the exact built source in desktop/mobile browsers, using real event paths and before/failure/retry sequences. Retain explicit conditional skips; do not call a provider fixture a real provider qualification.
15. Measure render optimizations on a meaningful path; do not use arbitrary helper microbenchmarks to manufacture product value.
16. Keep docs and implementation matched, with new findings documented before implementation. Do not recycle fixes already shipped in the first pass.

## Proposed acceptance work

Use current frozen browser fixtures to record the funding request/byte baseline; exercise the private-submission 503→200 retry; record session-request counts with several submissions and the full setup journey; test direct private-program sign-in; test exact token amount edit/create validation; run existing reserve and vault setup workflows after hook reuse. Add assertions to these real workflows rather than create standalone helper/unit suites. Full repository verification and the retained browser matrix remain required after implementation. No deployment, live provider or financial transaction is part of this audit.

## Complete supporting-path inventory

| Path | Review classification |
| --- | --- |
| `src/AccountAppeals.tsx` | Application module; detailed component inventory above |
| `src/Admin.tsx` | Application module; detailed component inventory above |
| `src/AdminProjectEnforcement.tsx` | Application module; detailed component inventory above |
| `src/AdminVetting.tsx` | Application module; detailed component inventory above |
| `src/App.tsx` | Application module; detailed component inventory above |
| `src/AutomaticMonthlyPayment.tsx` | Application module; detailed component inventory above |
| `src/CyclePages.tsx` | Application module; detailed component inventory above |
| `src/Earnings.tsx` | Application module; detailed component inventory above |
| `src/ErrorBoundary.tsx` | Application module; detailed component inventory above |
| `src/EscrowFunding.tsx` | Application module; detailed component inventory above |
| `src/GeneratedSkillPreview.tsx` | Application module; detailed component inventory above |
| `src/Inbox.tsx` | Application module; detailed component inventory above |
| `src/InboxEmail.tsx` | Application module; detailed component inventory above |
| `src/Link.tsx` | Application module; detailed component inventory above |
| `src/Logo.tsx` | Application module; detailed component inventory above |
| `src/OperatorTraces.tsx` | Application module; detailed component inventory above |
| `src/OwnerAwards.tsx` | Application module; detailed component inventory above |
| `src/OwnerBountyVault.tsx` | Application module; detailed component inventory above |
| `src/OwnerCommitment.tsx` | Application module; detailed component inventory above |
| `src/OwnerReserveRelease.tsx` | Application module; detailed component inventory above |
| `src/OwnerVaultSetup.tsx` | Application module; detailed component inventory above |
| `src/PayoutConsent.tsx` | Application module; detailed component inventory above |
| `src/Points.tsx` | Application module; detailed component inventory above |
| `src/Presentation.tsx` | Application module; detailed component inventory above |
| `src/ProfilePage.tsx` | Application module; detailed component inventory above |
| `src/Profiles.tsx` | Application module; detailed component inventory above |
| `src/ProjectLeaderboard.tsx` | Application module; detailed component inventory above |
| `src/ProjectProposalPage.tsx` | Application module; detailed component inventory above |
| `src/ProjectRiskFlag.tsx` | Application module; detailed component inventory above |
| `src/ProjectSetupStatus.tsx` | Application module; detailed component inventory above |
| `src/PublicPages.tsx` | Application module; detailed component inventory above |
| `src/ReferralClaims.tsx` | Application module; detailed component inventory above |
| `src/SecurityBounty.tsx` | Application module; detailed component inventory above |
| `src/SecurityProgramEditor.tsx` | Application module; detailed component inventory above |
| `src/VaultActions.tsx` | Application module; detailed component inventory above |
| `src/VettingEvidence.tsx` | Application module; detailed component inventory above |
| `src/agent-logos/chatgpt.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/claude.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/cursor.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/grok.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/hermes-agent.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/meta-ai.svg` | Live dynamically selected accessible icon |
| `src/agent-logos/openclaw.svg` | Live dynamically selected accessible icon |
| `src/brand-tokens.css` | Cascade/class-reference review; SF-12/19 |
| `src/design-system.css` | Cascade/class-reference review; SF-12/19 |
| `src/lib/allocation-funding-basis.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/allocation-funding-basis.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/allocation-funding.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/async-sha256.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/async-sha256.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/base-units.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/base-units.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/base58.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/browser-deployment.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/browser-json.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/byte-encoding.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/canonical-json.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/commit-credit.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/contact.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/contribution-fields.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/contribution-quality.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/contributor-standings.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/copy-text.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/cycle-index.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/deployment.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/errors.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/escrow-policy.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/escrow-policy.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/evaluator-awards.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/evm-vault-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/external-sources.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/fenced-record.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/funding-address.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/funding-address.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/funding-reminders.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/funding-review-data.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/github-actor.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/github-icon.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/github-ids.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/global-leaderboard.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/home-projects.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/identity-flow.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/install-command.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/intake-drafts.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/leaderboard-types.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/leaderboard.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/legacy-projects.json` | Generated/immutable data contract; do not hand-edit |
| `src/lib/model-identity.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/model-outcomes.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/monthly-commitment-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/monthly-release-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/network-names.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/notifications.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/owner-commitment-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payments/contracts.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payments/escrow-cycle.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payments/escrow-review.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payments/monthly-allocation.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payments/vault-amount.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payout-consent.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payout-exclusions.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/payout-exclusions.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/payout-points.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/platform-fee-recipients.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/platform-fee-recipients.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/points.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/profile-activity.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/profiles.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-api.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/project-capabilities.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/project-capabilities.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-contracts.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-policy.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/project-policy.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-promotion.generated.json` | Generated/immutable data contract; do not hand-edit |
| `src/lib/project-proposal.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-registry-boot.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-registry.generated.mjs` | Generated/immutable data contract; do not hand-edit |
| `src/lib/project-registry.ingested.mjs` | Generated/immutable data contract; do not hand-edit |
| `src/lib/project-registry.runtime.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-revision-changes.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-revisions.generated.json` | Generated/immutable data contract; do not hand-edit |
| `src/lib/project-schema.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/project-schema.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-skill-publication.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/project-skill-publication.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-skill.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/project-skill.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/project-view.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/projects.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/projects.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/record-validation.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/record-validation.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/referral-claims.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/repositories.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/repositories.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/review-records.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/reviewer-leaders.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/reward-asset.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/reward-asset.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/reward-cap.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/reward-cap.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/reward-cycle.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/reward-finalization.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/rewards.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/run-receipts.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/score-penalties.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/score-records.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/scoring-policy.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/security-bounty.d.mts` | Declaration/type contract; kept with its implementation |
| `src/lib/security-bounty.mjs` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/sha256.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/site-routes.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/solana-commitment-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/solana-signature.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/solana-vault-actions.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/source-repository.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/use-action.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/use-cycle-index.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/use-direct-transfers.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/use-payout-wallets.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/use-public-resource.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/use-snapshot.ts` | Browser request/state/authority boundary reviewed |
| `src/lib/value-assessment.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/vault-setup.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/vetting-contracts.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/wallet-possession.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/wallet-proof.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/wallets.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/lib/who-builds.ts` | Referenced domain/parser/format helper; source/consumer scan, preserve canonical policy |
| `src/main.tsx` | Application module; detailed component inventory above |
| `src/styles.css` | Cascade/class-reference review; SF-12/19 |
| `src/vite-env.d.ts` | Declaration/type contract; kept with its implementation |


---

# Second-pass backend, worker and contract-adapter audit

Baseline: `67e183f88120282bc0008e22f20f5262ee0e77cc` (`origin/development`). Branch at audit: `codex/codebase-second-pass`. This pass follows the implemented first-pass review in `docs/codebase-review-2026-10-26.md`; it does not count those resolved findings again. This is an audit report and implementation proposal, not production deployment or financial activation evidence.

## Method, scope and confidence

The inventoried service/adapter source slice contains **235 files and 77,706 lines**: backend 67/30,345; workers 149/41,677; Pages functions 3/759; direct EVM/Solana adapter modules 16/4,925. Test drivers, qualification programs and native contract program source are outside that count and are not treated as unused merely because they have no TS import. Source bodies were searched for relative imports, repeated exported functions, catch/default behavior, state transitions and sequential I/O. Targeted deep reads followed account/payment projection, finalized vault cache refresh, Solana address derivation and wallet preparation, project authority/enforcement, private reporting/funds, referral views, worker schedules and shared HTTP/D1 adapters.

An export-reference scan found no single-use-or-declaration-only exported function/class/constant in this backend/worker/contract slice. That is evidence against indiscriminate deletion, not proof that every runtime branch is reachable. Root owns script orphans discovered elsewhere. Source comparison and explicit reachable reproductions are stronger acceptance than file or line counts. All code remains unchanged during this audit.

## Selected findings

### SB-01 — Read the payment-account projection from one database snapshot

**Priority:** P2 correctness and latency. **Files:** `backend/payments/handler.ts:1052-1156`, especially the payment query at approximately 1060 and the later monthly-award query at approximately 1075. **Affected journey:** contributor opens Payouts while a finalized chain event turns a monthly award into a reserved payment.

The route performs five independently awaited account-data reads: current wallet claims, ordinary payment obligations, approved monthly awards, direct-transfer history and public wallet observations. The payment and monthly-award queries overlap semantically: the latter excludes an award once a matching ordinary obligation exists. The queries do not share a SQLite snapshot. If the chain indexer inserts the obligation after the payments read and before the monthly-awards read, neither query returns that award. The endpoint returns HTTP 200 with an apparently empty account even though the award existed throughout the request.

**Actual reproduction (local, real migrations and actual API handler):** `/tmp/slop-second-account-race.ts`. A migrated SQLite fixture creates a funded November allocation and authenticated member. A controlled interleaving inserts the real `payment_obligations` row immediately after the account's payment SELECT completes, while leaving all returned rows and parsing untouched. Results:

```json
{"before":{"status":200,"monthlyAwards":1,"payments":0,"balances":0},"during":{"status":200,"monthlyAwards":0,"payments":0,"balances":0},"after":{"status":200,"monthlyAwards":0,"payments":1,"balances":1}}
```

The control is the next identical request, which returns the reserved payment. This is not an invented malformed-input edge case: the writer is the normal finalized reservation projection.

**Implementation:** issue one SELECT that produces the five account datasets as subqueries (or a transactional D1 batch with result rows), then map the same state/amount logic. Prefer the single SELECT here because the repository's shared `sqliteD1.batch` currently models write batches and exposes no SELECT result rows; a single query both works through the existing production/test boundary and avoids widening the harness. Keep auth and the immutable GitHub actor lookup before the account read. Keep private bounty tables entirely absent from the query. Keep the public direct-transfer endpoint if it has its own caller; factor only an already-shared SQL expression when doing so actually avoids duplicate source.

**Alternatives rejected:** Promise.all alone removes latency but still permits inconsistent database snapshots. A new account cache adds freshness and invalidation complexity and leaves the race. Hiding the missing award with a UI placeholder invents state. Two retries can still race. Updating or locking payment data from the read route is unnecessary.

**Best-practice acceptance:**

- One authoritative snapshot for fields that define mutually exclusive lifecycle representations.
- Exactly one occurrence of the contribution across `monthlyAwards` and `payments` throughout reservation, with unchanged gross/fee/net and integer arithmetic.
- Five account-data database boundary calls reduced to one; authentication remains its own prerequisite query.
- A failed database projection returns the existing explicit unavailable response, never guessed empty arrays.
- The same real-D1 interleaving reproduction no longer loses the award. Retain ordinary empty-account, signed-out, cross-account, token-decimal, underfunded, reserved and paid-path integration checks.
- No disclosure of case identifiers, bounty amounts, signing material, wallet-control claims or new authority.

**PRD:** sections 3 (account/payout view), 6 (distinct award/payment state and finalized evidence), 7/9 (missing data is not zero; cached authoritative reads). **Expected useful outcome:** an award does not disappear while reserving, and a private account load uses fewer database round trips.

### SB-02 — Bound parallel finalized vault-cache refreshes

**Priority:** P2 measured performance/availability. **Files:** `backend/payments/vault-snapshots.ts:158-182`, caller `workers/payments/index.ts:607-629`. **Affected journey:** fresh finalized vault totals are cached for public funding pages and the payment event indexer.

`refreshVaultSnapshots` waits for each independent vault's entire RPC read and D1 update before starting the next vault. A slow RPC for an early project delays all later projects even when they use different networks and have valid responses. The function correctly continues after errors, but does so only once each preceding wait ends. These are observations; no signing/broadcasting occurs in this function.

**Measured baseline:** `/tmp/slop-second-snapshot-timing.ts`, eight distinct project/vault cache keys, migrated SQLite, a controlled 30 ms finalized-read dependency per vault. All eight rows are stored. Baseline **254 ms**, peak **1** in-flight read. This is a controlled dependency-latency measurement, not a claim about live RPC performance.

**Implementation:** two to four fixed worker loops inside this existing function; choose four to match the repository's existing bounded evidence-read convention. Claim the next array index synchronously, await its existing read/store operation, retain its error at that index, then continue. After all loops finish, filter errors in input order and raise the same aggregate failure. Do not add a configurable concurrency API or a generic package solely for this function.

**Alternatives rejected:** unbounded Promise.all may overload RPC/D1 for a large registry. Parallelizing payment submissions shares wallet nonce/gas authority and is not this change. Moving event scans ahead of required snapshots breaks their asset/decimals dependency. Skipping a failed vault silently turns stale into success.

**Best-practice acceptance:**

- Peak active reads never exceeds four, and is below or equal to the number of deployments.
- Existing monotonic/asset/cumulative-counter write checks remain unchanged.
- Independent healthy vaults complete while another vault's read is blocked.
- Every failure is still surfaced after the healthy work is attempted; input-order error reporting stays deterministic.
- Same eight-row fixture and 30 ms latency method improves materially from 254 ms (target near two latency waves rather than eight); report actual values after implementation.
- Duplicate/stale concurrent refreshes cannot decrease or replace stored counters or asset identity (existing integration controls).
- No change to the later event-scan barrier, keeper execution order, gas budget, transaction cadence, provider selection or production activation.

**PRD:** sections 6/9 (finalized cached counters, stale data on failure); section 11 (evidence and actual tested source). **Expected useful outcome:** unrelated vault pages gain fresh totals without waiting behind every prior RPC.

### SB-03 — One Solana PDA derivation and public-key byte boundary

**Priority:** P3 maintainability at a cryptographic boundary. **Files:** `contracts/solana/adapter.ts:115-145`, `contracts/solana/transactions.ts:10-15,32-49`. **Affected paths:** reader verifies Config/project/vault addresses; unsigned owner instructions and ATA creation derive those same addresses.

The adapter implements `publicKeyBytes` and `programAddress`; transactions independently implements `bytes` and `pda`. Both decode Base58 to exactly 32 bytes, append the same Solana PDA domain separator and bump, hash with SHA-256, reject on-curve hashes with the same Ed25519 library, and select the first valid bump. `transactions.ts` already imports from the adapter for Base58 encoding, so the duplicate is not an isolation requirement.

**Implementation:** export the adapter's existing functions under named Solana aliases and import those aliases as `bytes` and `pda` in `transactions.ts`. Preserve all existing transaction-module exports and call signatures. Remove its duplicate function bodies and now-unused Ed25519/Base58-decoder import. Keep `concat`, short-vector encoding, little-endian values, instruction assembly and message signer ordering where they are. This creates no new module and no new dependency cycle.

**Alternatives rejected:** adding a third crypto utility file expands module surface unnecessarily; adding the full Solana SDK to production increases dependency/bundle size; changing seed policy, curve checks, address validation or program layout is outside scope. Removing the on-curve try/catch would break the required PDA search.

**Best-practice acceptance:**

- One implementation of address derivation serves readers and unsigned builders.
- Existing exported transaction helpers (`bytes`, `pda`) retain behavior and remain valid import sites.
- Invalid Base58/length still refuses; legitimate all-zero System Program keys remain valid public keys (do not substitute the payout-address validator).
- Existing Config/vault derivation fixtures and complete owner-instruction/message tests remain byte-identical.
- Run native/local-validator owner creation/funding workflow if that toolchain is available; otherwise explicitly report the boundary not exercised. No production signature, program upgrade or fund movement.
- No change to native Rust program, instruction discriminator, signer set, token program, mint restrictions, amount encoding or gas/cap.

**PRD:** sections 6/11 (exact reviewed vault identity, correct token program, byte-bound evidence). **Expected useful outcome:** no future reader/writer drift from two handwritten copies of the same address algorithm.

## Subsystem decisions and non-findings

| Subsystem | Fresh assessment | Decision and acceptance boundary |
| --- | --- | --- |
| Shared HTTP and session transport | First-pass JSON/cookie consolidation is present; route-specific headers still express different privacy contracts. | Keep `backend/http.ts`; do not merge error strings or media policies across private and public APIs. |
| Private account projection | Reproduced cross-query lifecycle hole and five account-data round trips. | Implement SB-01; preserve member auth and all lifecycle values. |
| Finalized vault cache | Asset checks, monotonic counters and write-time concurrency checks are strong; independent reads are serial. | Implement SB-02; preserve existing write logic verbatim. |
| Monthly allocation coordinator | Freeze, underfunding, reserve, exclusion and cutoff transitions are separate economic facts. | Keep existing ordered state machine; no parallel signers or default toggles. |
| Wallet binding/rotation | Current wallet and account consent are separate; immutable claims/attempts must survive uncertain sends. | Keep co-signature, exact intent and old-attempt recovery checks. |
| EVM adapter | Canonical receipt validation combines hash, block, index, chain and finality; readers depend on different facts. | Keep; consolidation into receipt-status-only tests would weaken payment truth. |
| Solana adapter/builders | Duplicate PDA and public-key byte logic is removable without changing instruction policy. | Implement SB-03; preserve transaction bytes and domain separator. |
| Solana owner preparation | Recently merged typed RPC-unavailable handling distinguishes no evidence from mismatched evidence. | Keep; do not collapse error into an invalid creation or automatically retry a signature. |
| Payment event scans | Snapshot refresh precedes scans because snapshots supply reviewed token/decimals. | Keep barrier; parallel reads only, not lifecycle steps. |
| Project registry/publishing | D1 remains the only project inventory; immutable revisions and GitHub identity checks are required. | Keep; no static second inventory or direct snapshot edits. |
| Project enforcement | Full records carry cross-project immutable repository restrictions, account bans and appeal lineage. | Do not optimize to latest-row-only: older records contain current appeal/identity meaning. |
| Setup activation | Slopbot installation, current authority and scan/explicit permanent exemption are distinct. | Keep automatic normal admission and required evidence gates. |
| Private reporting | Receipt, technical analysis, notice and award decisions have independent state and privacy. | Keep separate modules/ledgers; no public fallback or inferred award. |
| Private bounty funds | Read finds one usable reviewed vault, subtracts outstanding reservations and installs SQL snapshot guards. | Keep guards; do not sum unrelated vault balances or turn unavailable into zero. |
| Private evidence/R2 | Grant/retention/recovery flows use separate roles and exact-byte proofs. | Keep; no broad error logger or transcript publication. |
| Notification delivery | Queued/provider-accepted/delivered/ambiguous differ; email consent names a destination version. | Keep durable journals and bounded retry behavior; no blind resend. |
| Slopbot schedule | First-pass independent dispatch fan-out is present and regression-covered. | Do not recount as a new finding. |
| Slopbot value provenance | Source, group, budget, inference, publication and correction represent separate claims. | Keep boundaries. Resolved one-consumer helper/PDA-like file moves from pass one are not repeated. |
| Fee conversion | Execution journal, native budget and route-account validation protect a separate signer principal. | Keep; no global concurrency over a shared fee wallet/nonce. |
| Referral accrual | Append-only epochs and bounded poster are independent of project payouts. | Keep dry-run/activation gate; do not infer mainnet authorization. |
| Referral account view | Cached ready/stale/unknown values avoid per-view RPC; payout wallet pinned to root. | Keep; no speculative address fallback. |
| Operator keeper | Per-wallet Durable Object serializes nonce and gas state. | Keep; do not combine with identity/fee/referral principal. |
| Vetting scan/sandbox | Bounded analysis, independent evidence, isolated execution and backups have distinct roles. | Keep; no universal runner rewrite or bypass of missing evidence. |
| Catch/default inventory | Scanned 176 catch patterns in services. Optional cache fallback, explicit unavailable response, conservative unknown state and cryptographic probe catches differ. | Only modify a demonstrated wrong outcome; no blanket catch/default deletion. |
| Dead source/export scan | No declaration-only exported function/class/constant found in the scanned backend/worker/adapter slice after first pass. | No production deletion justified from this scan. Root script orphan findings are handled separately. |

## Verification plan after report approval

1. Keep the baseline repro and timing outputs outside Git; do not commit ephemeral evidence.
2. Add the real account-reservation interleaving case to the existing monthly/account integration suite, using actual migrations. Assert lifecycle continuity, not only values or mock calls.
3. Extend existing vault snapshot integration for bounded concurrent progress, all-errors reporting and preserved monotonic counters. Use controlled read latencies only for before/after measurement, not as fake finalized-provider qualification.
4. Run contract adapter byte checks and available native/local workflows for SB-03. Preserve all smart-contract unit tests.
5. Run scoped tests/typecheck after each change, then the full repository `verify`, real-browser E2E and exact-head checks together with root. A local pass is neither a provider/chain qualification nor deployment acceptance.

## Source inventory used for this pass

This inventory records the static audit boundary. Deep-read/proven observations are described above; an inventory row does not itself claim exhaustive line-by-line security validation.

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
| `backend/payments/handler.ts` | 1161 |
| `backend/payments/ledger.ts` | 297 |
| `backend/payments/monthly-attestation.ts` | 418 |
| `backend/payments/monthly-publication.ts` | 162 |
| `backend/payments/monthly-reserve-release.ts` | 115 |
| `backend/payments/monthly.ts` | 1271 |
| `backend/payments/possession.ts` | 126 |
| `backend/payments/solana-funding.ts` | 95 |
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
| `backend/projects/vault-setup.ts` | 563 |
| `backend/referrals/cache.ts` | 406 |
| `backend/referrals/claims.ts` | 152 |
| `backend/referrals/handler.ts` | 107 |
| `backend/security/advisories.ts` | 197 |
| `backend/security/analysis.ts` | 806 |
| `backend/security/github-advisories.ts` | 741 |
| `backend/security/handler.ts` | 3356 |
| `backend/security/intake-grant.ts` | 385 |
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
| `contracts/evm/adapter.ts` | 1519 |
| `contracts/evm/factories.ts` | 80 |
| `contracts/evm/monthly-reserve.ts` | 549 |
| `contracts/solana/adapter.ts` | 955 |
| `contracts/solana/commitment.ts` | 182 |
| `contracts/solana/funding.ts` | 257 |
| `contracts/solana/monthly-commitment.ts` | 153 |
| `contracts/solana/monthly-reserve.ts` | 275 |
| `contracts/solana/owner-creation.ts` | 153 |
| `contracts/solana/owner-instructions.ts` | 128 |
| `contracts/solana/programs.ts` | 34 |
| `contracts/solana/token-extensions.ts` | 248 |
| `contracts/solana/token.ts` | 30 |
| `contracts/solana/transactions.ts` | 157 |
| `contracts/solana/wallet-transactions.ts` | 170 |
| `contracts/vault-totals.ts` | 35 |
| `functions/[[path]].ts` | 36 |
| `functions/api/v1/[[path]].ts` | 587 |
| `functions/index.ts` | 136 |
| `workers/fee-converter/config.ts` | 332 |
| `workers/fee-converter/core.ts` | 1095 |
| `workers/fee-converter/dry-run.ts` | 55 |
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
| `workers/fee-converter/store.ts` | 478 |
| `workers/identity/configure-test.mjs` | 104 |
| `workers/identity/contracts.ts` | 99 |
| `workers/identity/crypto.ts` | 129 |
| `workers/identity/handler.ts` | 574 |
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
| `workers/slopbot/index.ts` | 529 |
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
| `workers/slopbot/value-evidence.ts` | 1037 |
| `workers/slopbot/value-file-comparisons.ts` | 136 |
| `workers/slopbot/value-group-collection.ts` | 138 |
| `workers/slopbot/value-import-service.ts` | 12 |
| `workers/slopbot/value-import.ts` | 238 |
| `workers/slopbot/value-indirect-retention.ts` | 113 |
| `workers/slopbot/value-indirect.ts` | 249 |
| `workers/slopbot/value-inference.ts` | 190 |
| `workers/slopbot/value-journal.ts` | 265 |
| `workers/slopbot/value-manifest-identity.ts` | 82 |
| `workers/slopbot/value-merge-profile.ts` | 81 |
| `workers/slopbot/value-merge-resolution.ts` | 64 |
| `workers/slopbot/value-patch.ts` | 149 |
| `workers/slopbot/value-processing.ts` | 136 |
| `workers/slopbot/value-producer.ts` | 116 |
| `workers/slopbot/value-publication.ts` | 233 |
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


---

# Second-pass test, fixture and CI audit

Baseline: `67e183f88120282bc0008e22f20f5262ee0e77cc`. Audit only; no source edits. The earlier cleanup is not treated as proof that every retained assertion is useful.

## Current measured baseline

`bun run test` on this exact source completed with **678 passed, 1 intentional secure-sandbox skip, 0 failed**, 5,693 assertions across 679 expanded cases / 68 files, in **38.99 seconds**. This includes 5 contract TypeScript test files; their tests remain protected by the user's exception. The new Solana owner-network regression is present in this baseline. Runtime: Bun 1.3.14, Node 24.19.0, local dependency lockfile, no live provider or mainnet execution. Log: `/tmp/slop-second-baseline-tests.log`.

The retained source has 63 non-contract Bun test files, 31 Playwright specs, a separate 35-case installer suite, dedicated local-chain workflows, native contract suites and Miniflare integration drivers. The inventory below includes individual test source declarations and the expanded baseline execution list; `test.each` and loops explain why declaration count differs from executed count.

## Classification used

- **Keep complete integrations** when an actual entry point or multi-service workflow produces or refuses a persisted/user-visible outcome using real SQL, filesystem, browser, signed request, or chain behavior. Controlled external provider responses establish transport/control behavior only, never model qualification.
- **Remove units and partial doubles** that stop at a helper return, schema shape, literal marker, or isolated component value. A subprocess wrapper or unused SQLite instance does not turn a unit into an integration.
- **Consolidate duplicates** by retaining one complete owner of the behavioral assertion, including its failure/recovery path. Do not keep both a mocked fragment and the same complete path without a distinct demonstrated failure.
- **Retain required proof** of consent, authorization, immutability, denied writes, uncertain sends, exact amounts, finalized evidence and failed-vs-empty state. Delete lower-level duplicates only after the retained workflow proves the boundary.

PRD references: sections 3–4 account/project flows; section 5 Slopbot; section 6 funds; section 7 clear pages/accessibility; section 8 private evidence; sections 9/11 operational and exact-source verification.

## Findings and implementation actions

### ST-01 — an actual helper unit is hidden in the browser suite (high; delete)

`tests/e2e/profiles.spec.ts:197`, **"issue census records a hidden transition as incomplete history"**, never receives a browser fixture. It fabricates a GraphQL response, calls `collectProfileIssues`, `profileIssueOutcomes` and `assertProfiles`, then enumerates schema mutations. It is a roughly 166-line unit test, merely registered with Playwright. It is repeated for desktop and mobile even though no viewport is read. Delete it and its exclusive imports. Keep the preceding real profile navigation/history UI test. This directly satisfies the owner's non-contract-unit deletion requirement and removes bogus browser workload.

### ST-02 — two residual command/helper smoke suites (medium; delete)

- `scripts/contributor-template-identity.test.ts` (43 lines) restores every legacy skill, launches `run-receipt disclose`, and checks three marker literals. It does not install a skill or bind the result to a real submission. This is a subprocess-shaped unit/smoke check. Delete it; the canonical template/installer/attribution paths remain validated by actual workflows and canonical source identity checks.
- `scripts/skill-source-matches-commit.test.ts` (55 lines) creates one Git tree and checks booleans from one helper after byte/list mutations. The complete installer already refuses changed bytes, working-tree provenance, incomplete trees and stale authorization (`tests/integration/installer.e2e.ts:687, 807, 1524, 2674, 2692`). Delete the isolated duplicate. Keep the installer unchanged.

### ST-03 — literal-only and parser-only cases inside integrations (medium; prune)

- `backend/fee-conversions/handler.test.ts:34`, **"other paths fall through to the next API module"**, only checks a null return. Remove it; retain unauthorized/admin data-projection outcomes, including high-precision totals and absence of signed bytes.
- `scripts/terms-preflight.test.ts:103`, **"still refuses unexpected policy fields and malformed bounty terms"**, mutates shapes and calls only the policy parser via a file loader. Delete this matrix. Retain producer → actual served terms → installed-script acknowledgement compatibility; combine the two successful compatibility variants into one coherent consumer round trip if this reduces setup.
- Treat one-off row/type/existence checks inside retained workflows as supporting assertions only; do not split them into their own tests. The per-case inventory flags the narrowly identified residual fragments rather than deleting security failure-path scenarios by name.

### ST-04 — duplicate mocked account-closure browser workflow (high; consolidate then delete)

`tests/e2e/account-sessions.spec.ts:103` reimplements account closure, membership, sessions and OAuth in route handlers. It repeats the actual browser → Pages → SQLite → identity flow in `tests/e2e/account-closure-integration.spec.ts`. Preserve its one distinct lost-response UI assertion by moving that failure into the real fixture flow, then remove the ~173-line double and exclusive helper setup. Keep the separate session-revocation browser case. Acceptance: real persisted closure, surviving obligations, uncertainty message, refused automatic reopen, and explicit authenticated reopen pass desktop and mobile.

### ST-05 — duplicate mocked monthly-payment UI (medium; delete after direct comparison)

`tests/e2e/automatic-monthly-payment.spec.ts` (153 lines) installs a fake wallet that only returns accounts/chain and checks default checkbox and wrong-owner refusal. `tests/e2e/vault-actions.spec.ts:762` already performs the same owner/default-control workflow against a real Anvil vault and verifies contract state and denied sends. Keep those assertions in the real workflow; remove the partial standalone file. Preserve a normal browser rendering check through the shared route accessibility matrix. Do not claim the optional Anvil browser run was covered by a default preview run: run its explicit CI/local mode for acceptance.

### ST-06 — static penalty display test after the first copy cleanup (medium; delete)

`tests/e2e/score-penalties.spec.ts` (154 lines) supplies a locally constructed snapshot and checks only text, links and rows. The source penalty-to-Points integration already exists in `workers/slopbot/penalty-appeal.test.ts` (including exactly-once debit/reversal and month behavior); the common browser table/navigation tests cover rendering and keyboard use. Remove this static double rather than lock another fixture snapshot. Required Points/payout state separation stays in production and complete paths.

### ST-07 — duplicate fixture project inventory (high; collapse to one source)

All **11** JSON files in `tests/fixtures/projects/` are structurally identical to corresponding entries in `tests/fixtures/project-registry.mjs`. This was checked by parsed, recursively key-sorted comparison for every file. Only `eliza.json` and `thenetwork.json` still have actual callers; the other nine are dead, and `prepare-monthly-rewards.test.ts`'s dynamic path is called only with its default Eliza ID after the first pass. The fixture overlay copies history and skills, not this projects directory.

Use a cloned lookup from the existing frozen registry in the existing fixture module and replace remaining file loads in tests, local integration drivers and generated test snippets. Remove all 11 JSON copies. No production registry or historical journal changes. Acceptance: all prior fixture objects deep-equal the lookup before deleting copies; installer, monthly rewards, release registry and local EVM workflows keep the same inputs. The list below records exact sizes.

### ST-08 — direct snapshot-store tests duplicate one cache outcome (medium; consolidate)

`backend/payments/vault-snapshots.test.ts:44–188` starts with five direct helper checks, while `:190` already reads the actual public API and later cases exercise ledger indexing and concurrent refreshes. Consolidate initial valid/older/decreasing/wrong-identity states into refresh → persisted last-good value → GET response workflow. Keep concurrent monotonicity cases and evidence-indexing cases, because they prove distinct transactional failures. Remove redundant initial object/field-only cases once the actual API sequence proves the same outcome. Do not replace wrong-identity or stale-evidence refusals with weaker shape assertions.

### ST-09 — referral poster has a fake-client and actual-client layer (medium; consolidate)

`workers/referral-accrual/poster.test.ts:170–354` has five tests against `fakeChain`, followed by a real EVM client plus durable SQL journal at `:591` onward. `workers/referral-accrual/anvil.integration.ts` also tests actual root posting, pending windows, gas caps, canonical receipts, voiding and claims. Consolidate earliest-root ordering and pending/paused/cap cases into the actual-client harness, then delete the fake-client-only section and helper. Keep distinct native-gas reservation, canonical evidence, uncertain-send and restart cases. Do not simply rename the fake block "integration" or delete the complete journal cases.

### ST-10 — expensive repeated R2 process setup (medium; optional measured refactor)

`tests/vetting-evidence-fixture.ts:40` spawns a new Node/Miniflare R2 process for every call. `scripts/vetting-api.test.ts`, `project-registry-api.test.ts`, `vetting-scan-flags.test.ts`, and `vetting-scan-service.test.ts` account for much of the baseline's elapsed work. `vetting-api` alone totals 5.44s, registry 5.17s, flags 4.67s, service 4.21s (individual-case elapsed sums; not independent wall clocks). Each new database is already a copied migrated image.

An explicit per-file R2 runtime can serve separately namespaced buckets/keys to fresh per-case databases. Each case gets a unique namespace; failed setup/shutdown must still fail. No shared mutable evidence across cases and no mocked R2. Measure before/after identical selections. Proceed only if this reduces setup/time without growing the fixture abstraction more than it removes. Do not replace real R2 with a Map to make timing look better.

### ST-11 — browser matrix repeatedly runs the same breakpoint/layout families (medium; consolidate)

The baseline preview has 179 desktop passes, 135 mobile passes, 21 laptop and 21 tablet passes. `site.spec.ts:1117` adds three reflow scenarios over 16 routes (48 explicit cases), while `:1269` repeats 21 general route checks at four widths. Full desktop/mobile coverage is required. The laptop/tablet lists can be reduced to representatives for the shared header, table, funding controls and setup form, because the product-specific path behavior is already run at both required widths. Keep 200% typography, 320px reflow, keyboard and axe checks for every distinct layout family. Eliminate duplicate `/projects/eliza/funding` versus trailing-slash layout assertions after the redirect/navigation route proves alias behavior.

The 48 intentional mobile skips are collection noise from the desktop-only reflow group. Restrict desktop-only tests at project selection instead of discovering then skipping them, if achievable without splitting the same route matrix into another copy. Record the reduced test list and preserved surface matrix; do not count removed duplicate cases as missing tests.

### ST-12 — install Firefox only in lanes that run Firefox (medium; implement)

`.github/workflows/deploy.yml:319–418` installs Chromium and Firefox/system dependencies on all five browser lanes. `playwright.config.ts` selects Firefox only for email/evidence specs, both tagged `@registry`. Preview and Pages run no Firefox cases. Give each matrix entry an explicit browser list: Chromium for preview/Pages, Chromium+Firefox for registry. Use that list for dependency and binary installation. Acceptance: `playwright --list` before/after is identical for each lane; required browsers are installed, and three lanes stop fetching unused Firefox. Keep pinned action versions and the existing strict test retries=0.

### ST-13 — duplicated code/escrow test selection (low; simplify alias)

`test:escrow-policy` enumerates six `.test.ts` files already included in `test`, which `verify:code` runs on every PR. The escrow workflow invokes this subset before its real-chain workflows. Remove the stale-prone duplicate subset step/alias, or keep the alias solely as documented developer convenience without treating it as additional release evidence. All actual contract and EVM/Solana end-to-end workflows remain. Verify the main code job remains part of required quality; no protection/release gate is changed.

### ST-14 — proven descendant-process leak on phase timeout (high; fix plus real regression)

`scripts/run-e2e-phase.mjs:44–56` kills only the launcher PID. A read-only audit probe invoked this real runner with a Node launcher that spawned a delayed child marker writer. At a 300ms deadline the phase returned failure, but the child still wrote its marker at 600ms: `{phaseStatus:1, descendantSurvivedTimeout:true}`. The audit cleaned up the descendant. Playwright web servers or Anvil children can survive exactly this path, occupy ports and invalidate later checks.

Terminate the entire owned process tree on timeout at the single runner boundary (POSIX owned process group; Windows native tree termination). Keep output failure and the original deadline. Add one real subprocess lifecycle integration that proves the launcher AND its descendant stop after a deadline, and that successful runs preserve nonzero/zero exit status. Do not mock spawn or make a test that only asserts `kill` was called. Test both supported platform branches where available; never claim Windows execution based on a macOS run. This is a demonstrated new regression, not coverage farming.

### ST-15 — setup cleanup starts too late in the registry runner (medium; fix)

`scripts/run-e2e.mjs:runRegistryPhase` creates the D1 directory and starts GitHub, notification and Slopbot fixtures before entering the `try/finally`. Failure starting a later fixture does not close earlier fixtures. Move acquisition under one ownership-aware `try/finally`; close only acquired resources and remove the temporary D1 on every exit. Preserve the primary error while cleanup failures remain observable. Pair with the real phase-runner failure regression or a real occupied-port startup scenario, not mocked teardown counts.

### ST-16 — retain the existing important parallel boundaries (keep)

The five nonbrowser Miniflare drivers already run via `Promise.all`; the security payment runner already bounds independent Anvil cases at two and assigns unique ports. Registry browser tests have deliberate serial state and isolated D1 per CI shard. Increasing registry worker count would race project bans, staged evidence and shared accounts. Windows installer and Linux installer prove distinct filesystem behavior. The trace operator workflow actually imports Chromium and belongs on a browser-provisioned runner; moving it blindly to the nonbrowser integration job would introduce an undeclared browser dependency. No changes here without measurement/evidence.

## Planned coverage preservation

| Product boundary | Primary retained evidence | Action |
| --- | --- | --- |
| Account/session/closure | real account closure integration; account sessions route + DB tests | remove mocked duplicate only after lost-response case migrates |
| Project onboarding/authority/revisions | registry browser lane; project API/self-service and network-failure integrations | retain denials, uncertainty, resume and immutable revision checks |
| Generated skill trust/activation | full installer lifecycle on Linux/Windows; generated publication path | remove isolated helper/marker smoke, preserve full installer |
| Snapshot/public Points | actual penalty/appeal pipeline; points navigation/filter/retry browser flows | remove static penalty display and census unit only |
| Monthly amounts/payment safety | full monthly SQL/attestation workflow; EVM/Solana browser+chain drivers | remove partial monthly double only with explicit Anvil pass |
| Private security/evidence | submissions, handler, R2/API/backup and controlled signed artifact workflows | retain real storage and recovery; namespace setup only if isolation is proven |
| Fee/referral durability | actual client+journal and dedicated Anvil workflows | replace fake-only duplicate poster block; preserve unknown send/reservation evidence |
| Test runner cleanup | new real child-process deadline regression | prove descendants terminate and failed phases remain failed |

## Acceptance plan

1. Freeze all relevant before/after selections against the same source/data fixture; preserve baseline 38.99s as one observation, not a benchmark guarantee.
2. Assert every removed helper case has a listed complete workflow owner; do not waive authorization/financial outcomes to lower counts.
3. Run full Bun integration and Miniflare suites, full desktop/mobile+remaining representative breakpoint browser matrix, Linux/Windows installer, and explicit local-chain flows affected by duplicate test removal.
4. Confirm no generated registry, points journal, contract source, signing scope, activation or deployment behavior changes.
5. Validate fixture object equality and byte/case counts; compare R2 setup process counts and focused elapsed times if sharing R2 runtime is implemented.
6. Preserve all failures as failures; no retry or default-success change. No live-provider, production, or mainnet claim follows from these local checks.

## Duplicate project fixture inventory

| Fixture | Bytes | Equality / callers |
| --- | ---: | --- |
| `tests/fixtures/projects/asi.json` | 5,099 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/canonry.json` | 4,525 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/darling-arm64.json` | 4,149 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/delta-star.json` | 6,467 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/eliza.json` | 4,504 | Parsed object identical to frozen registry; remaining callers to migrate |
| `tests/fixtures/projects/feed.json` | 3,567 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/heir-elements-sdk.json` | 3,336 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/nurosos.json` | 3,624 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/payzcode-ai.json` | 3,282 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/slopdotcash.json` | 4,663 | Parsed object identical to frozen registry; no live caller |
| `tests/fixtures/projects/thenetwork.json` | 3,367 | Parsed object identical to frozen registry; remaining callers to migrate |

Total duplicate fixture bytes: **46,583**.

## Complete source declaration inventory

### `backend/fee-conversions/handler.test.ts` — 105 lines

Keep auth/admin outcomes; remove fallthrough unit (ST-03)

- Line 34: test("other paths fall through to the next API module", async () => { — DELETE null-return unit (ST-03).
- Line 46: test("signed-out and non-admin sessions are refused", async () => { — Retain outcome in complete workflow.
- Line 62: test("admins get recent records and exact per-token totals without signed bytes", async () => { — Retain outcome in complete workflow.

### `backend/notifications/email.test.ts` — 414 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 112: test("verified opt-in sends future activity once; opt-out cancels queued mail and is independent of essential notices", async () => { — Retain outcome in complete workflow.
- Line 150: test("unverified and changed destinations cannot inherit activity consent", async () => { — Retain outcome in complete workflow.
- Line 194: test("optional-mail ambiguity retries only with attempt-bound independent evidence and remains bounded", async () => { — Retain outcome in complete workflow.
- Line 230: test("an essential notice retries a not-yet-effective destination on a bounded schedule; optional mail does not", async () => { — Retain outcome in complete workflow.
- Line 276: test("an essential notice exhausts after five non-send attempts and an absent record is suppressed", async () => { — Retain outcome in complete workflow.
- Line 317: test("opt-out cancels optional mail that is waiting for a reconciled retry", async () => { — Retain outcome in complete workflow.
- Line 356: test("scheduled drains finish activity delivery and report a failed security queue", async () => { — Retain outcome in complete workflow.

### `backend/notifications/exception-events.test.ts` — 293 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 67: test("setup completion is one project_ready notice, never sent to its publisher", async () => { — Retain outcome in complete workflow.
- Line 127: test("a self-service first revision reports ready only when it is active", async () => { — Retain outcome in complete workflow.
- Line 154: test("a scan that cannot finish reaches the owners once; other results write nothing", async () => { — Retain outcome in complete workflow.
- Line 186: test("losing the Slopbot installation reaches each affected project's owners once", async () => { — Retain outcome in complete workflow.
- Line 237: test("a verified report receipt reaches only its reporter, once, with no acknowledgment", async () => { — Retain outcome in complete workflow.

### `backend/notifications/notifications.test.ts` — 803 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 50: test("self-service listing sends no routine notice; later revisions notify once each", async () => { — Retain outcome in complete workflow.
- Line 156: test("project enforcement records notify the project and independent reviewers once", async () => { — Retain outcome in complete workflow.
- Line 260: test("wallet changes and finalized payment events notify the contributor once", async () => { — Retain outcome in complete workflow.
- Line 444: test("a notification changes only from unread to read and is never deleted", () => { — Retain outcome in complete workflow.
- Line 486: test("older unread notifications remain reachable when new events arrive", async () => { — Retain outcome in complete workflow.
- Line 557: test("lists only the signed-in recipient's rows, newest first", async () => { — Retain outcome in complete workflow.
- Line 571: test("marks the recipient's own rows read once and refuses other writes", async () => { — Retain outcome in complete workflow.
- Line 592: test("each notice reports its own email outcome without delivery details", async () => { — Retain outcome in complete workflow.
- Line 654: test("a signed-out request gets 401 and other paths are not handled", async () => { — Retain outcome in complete workflow.
- Line 707: test("one notice per moderator from the committed penalty, never to the author", async () => { — Retain outcome in complete workflow.
- Line 727: test("a penalty without moderator review writes no notice", async () => { — Retain outcome in complete workflow.
- Line 738: test("moderator access is rechecked on every list, open and read mark", async () => { — Retain outcome in complete workflow.

### `backend/payments/migration-0021.test.ts` — 225 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 98: test("keeps rows and children, names the reviewed asset, and copies amounts as 6-decimal base units", () => { — Retain outcome in complete workflow.
- Line 168: test("a row on a network without a reviewed asset fails the migration", () => { — Retain outcome in complete workflow.
- Line 181: test("applies inside one transaction with child rows present (the D1 path)", () => { — Retain outcome in complete workflow.
- Line 190: test("vault snapshots keep uint128 text, NULL counters, a fixed asset and a monotonic block", () => { — Retain outcome in complete workflow.

### `backend/payments/migrations.test.ts` — 236 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 133: test("keeps rows, children, objects and column order; then accepts robinhood", () => { — Retain outcome in complete workflow.
- Line 214: test("applies inside one transaction with child rows present (the D1 path)", () => { — Retain outcome in complete workflow.
- Line 230: test("the full migration set applies cleanly on an empty database", () => { — Retain outcome in complete workflow.

### `backend/payments/monthly.test.ts` — 2,162 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 180: test("Solana refuses a monthly cap above its token range before storing an allocation", async () => { — Retain outcome in complete workflow.
- Line 194: test("the amount-range migration preserves funded months, exclusions and authorization history", async () => { — Retain outcome in complete workflow.
- Line 262: test("an 18-decimal token month keeps exact amounts through owner review, freeze and attestation", async () => { — Retain outcome in complete workflow.
- Line 391: test(`a ${racing ? "concurrent" : "current"} owner ban refuses monthly ${action}`, async () => { — Retain outcome in complete workflow.
- Line 438: test("a ban after freeze excludes only the unfunded award and preserves the snapshot", async () => { — Retain outcome in complete workflow.
- Line 497: test("a ban that races monthly funding makes the coordinator retry before creating awards", async () => { — Retain outcome in complete workflow.
- Line 527: test("a later ban preserves monthly awards that are already funded", async () => { — Retain outcome in complete workflow.
- Line 557: test("freezes the current private allocations once at the cutoff and creates each obligation once when funded", async () => { — Retain outcome in complete workflow.
- Line 659: test("a funding-time excluded award is not advertised as awaiting payment", async () => { — Retain outcome in complete workflow.
- Line 698: test("a contributor's account shows the approved monthly award from the freeze until the vault reserves it", async () => { — Retain outcome in complete workflow.
- Line 778: test("without a defined cutoff nothing is frozen automatically, but the owner can finalize", async () => { — Retain outcome in complete workflow.
- Line 788: test("an owner who turns the default off, a restricted project and an unserved vault are not distributed automatically", async () => { — Retain outcome in complete workflow.
- Line 818: test("an award reserved earlier needs no new funds and cannot be planned twice", async () => { — Retain outcome in complete workflow.
- Line 884: test("a Solana hand reservation waits until automatic monthly payment is off", async () => { — Retain outcome in complete workflow.
- Line 917: test("a Solana month needs its full total free, even for an award reserved earlier", async () => { — Retain outcome in complete workflow.
- Line 946: test("an underfunded month has no obligation to reserve, and earlier unreserved obligations hold their funds", async () => { — Retain outcome in complete workflow.
- Line 990: test("after the cutoff the automatic default fixes the allocations until they are frozen", async () => { — Retain outcome in complete workflow.
- Line 1011: test("a month before the first automatic period is never frozen automatically", async () => { — Retain outcome in complete workflow.
- Line 1021: test("private changes stay within the cap, never pay their author and are serialized", async () => { — Retain outcome in complete workflow.
- Line 1067: test("an open month cannot be finalized", async () => { — Retain outcome in complete workflow.
- Line 1075: test("private bounty programs never run the monthly coordinator", async () => { — Retain outcome in complete workflow.
- Line 1143: test(`an obligation for ${label} under a frozen award's source is a conflict left out of the month`, async () => { — Retain outcome in complete workflow.
- Line 1192: test("a contributor sees a conflicting award, and a month of only conflicts signs nothing", async () => { — Retain outcome in complete workflow.
- Line 1218: test("uses only the frozen owner-adjusted awards, even after a later funding observation", async () => { — Retain outcome in complete workflow.
- Line 1238: test("refuses the root before the cutoff, after its window, and when the whole month is unfunded", async () => { — Retain outcome in complete workflow.
- Line 1251: test("signs a frozen month after a later revision that keeps its payment terms", async () => { — Retain outcome in complete workflow.
- Line 1295: test("rechecks restrictions and the owner's opt-out after the month was frozen", async () => { — Retain outcome in complete workflow.
- Line 1309: test("omits funding-time exclusions while preserving awards funded before a later ban", async () => { — Retain outcome in complete workflow.
- Line 1329: test("accepts a month frozen before fees rounded up, and no other fee", async () => { — Retain outcome in complete workflow.
- Line 1385: test("rejects a forged frozen payload even when its metadata still names the real project", async () => { — Retain outcome in complete workflow.
- Line 1415: test("monthly signing preserves its first intent through retry and refuses a changed root", async () => { — Retain outcome in complete workflow.
- Line 1542: test("V2 monthly signing publishes permanent source-bound attempts and resumes the selected admitted month", async () => { — Retain outcome in complete workflow.
- Line 1780: test("monthly signing never publishes when the signer fails or an opt-out arrives during signing", async () => { — Retain outcome in complete workflow.
- Line 1844: test("monthly dispatcher resumes an older Solana reservation after opt-out and retires only finalized completion", async () => { — Retain outcome in complete workflow.
- Line 1932: test("monthly dispatcher sends a new EVM V2 reservation before an older month's leaves", async () => { — Retain outcome in complete workflow.
- Line 1995: test("Solana v3 retries preserve the first signed freeze time after a signer outage", async () => { — Retain outcome in complete workflow.
- Line 2064: test("reserve release requires the live monthly owner authority and current policy before requesting any attestation", async () => { — Retain outcome in complete workflow.
- Line 2137: test("a concurrent project revision change refuses a prepared reserve release", async () => { — Retain outcome in complete workflow.

### `backend/payments/vault-snapshots.test.ts` — 440 lines

Consolidate store fragments into refresh/API sequence (ST-08)

- Line 44: test("stores a finalized read under the reviewed vault and asset", async () => { — Retain outcome in complete workflow.
- Line 63: test("rejects a read of another vault or asset, or a malformed counter", async () => { — Retain outcome in complete workflow.
- Line 85: test("never rewinds: an older block is ignored and a decreasing counter fails", async () => { — Retain outcome in complete workflow.
- Line 125: test("a Solana read names the project PDA and is stored under the token vault", async () => { — Retain outcome in complete workflow.
- Line 166: test("one failing vault does not stop the others", async () => { — Retain outcome in complete workflow.
- Line 190: test("serves cached rows with public edge caching and never reads a chain", async () => { — Retain outcome in complete workflow.
- Line 265: test("an unindexed project returns no rows, not zero totals", async () => { — Retain outcome in complete workflow.
- Line 297: test("requires the finalized vault snapshot and records its asset and decimals", async () => { — Retain outcome in complete workflow.
- Line 334: test("re-indexing stored evidence for the adapter's deployment makes no chain call", async () => { — Retain outcome in complete workflow.
- Line 370: test("concurrent finalized refreshes cannot decrease cumulative vault counters", async () => { — Retain outcome in complete workflow.
- Line 412: test("concurrent initial refreshes preserve asset identity and report superseded blocks", async () => { — Retain outcome in complete workflow.

### `backend/points/x.test.ts` — 110 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 8: test("X connection and reconnect reserve identity without granting points", async () => { — Retain outcome in complete workflow.

### `backend/projects/cloudflare-persistence.test.ts` — 219 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 78: test("renamed repository (alias is the current name) resolves in the live registry", async () => { — Retain outcome in complete workflow.
- Line 111: test("a legal transfer revision (alias append) keeps the repository resolvable", async () => { — Retain outcome in complete workflow.
- Line 161: test("a repository path acquired by another project before commit refuses the whole revision", async () => { — Retain outcome in complete workflow.

### `backend/referrals/claims.test.ts` — 298 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 126: test("claim API maps contract epoch through its filed period and keeps another actor's proof private", async () => { — Retain outcome in complete workflow.
- Line 148: test("cache failure and expiry preserve last verified totals; never-activated is hidden and first failure is unknown", async () => { — Retain outcome in complete workflow.
- Line 180: test("a paused pending window never matures, and a void retains the preceding root", async () => { — Retain outcome in complete workflow.
- Line 263: test("wallet review is read-only, and an explicit send rechecks the exact claim without token approvals", async () => { — Retain outcome in complete workflow.

### `backend/security/handler.test.ts` — 1,702 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 529: test("a maintainer imports direct GitHub reports and settles older links", async () => { — Retain outcome in complete workflow.
- Line 612: test("listing cases records only the cases disclosed and refuses an unaudited response", async () => { — Retain outcome in complete workflow.
- Line 644: test("a failed or missing analysis can be run again by the owner", async () => { — Retain outcome in complete workflow.
- Line 677: test("a stale triager change grants or revokes nothing", async () => { — Retain outcome in complete workflow.
- Line 759: test("a banned researcher keeps funded awards and appeals but receives no new bounty award", async () => { — Retain outcome in complete workflow.
- Line 801: test(`a banned maintainer cannot create a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => { — Retain outcome in complete workflow.
- Line 812: test("a ban that arrives during bounty approval prevents its reservation", async () => { — Retain outcome in complete workflow.
- Line 821: test("large program balances keep every minor unit after approved awards", async () => { — Retain outcome in complete workflow.
- Line 839: test("the owner chooses the amount, and approval reserves exactly that amount", async () => { — Retain outcome in complete workflow.
- Line 938: test("no award is a decision the reporter can appeal", async () => { — Retain outcome in complete workflow.
- Line 971: test("a concurrent reservation cannot overspend the program", async () => { — Retain outcome in complete workflow.
- Line 1012: test("reservations follow the vault's finalized free balance, not the published terms", async () => { — Retain outcome in complete workflow.
- Line 1075: test("a pledge reserves nothing", async () => { — Retain outcome in complete workflow.
- Line 1085: test("an award reserved before discretionary awards is approved at its amount", async () => { — Retain outcome in complete workflow.
- Line 1112: test("a proposed related-party award reserves only after independent approval", async () => { — Retain outcome in complete workflow.
- Line 1150: test("an appealed related-party refusal cannot be re-reviewed by the same reviewers", async () => { — Retain outcome in complete workflow.
- Line 1261: test("a co-maintainer who decides an award or an earlier technical decision cannot review the case as dispute", async () => { — Retain outcome in complete workflow.
- Line 1318: test("report analysis and appeal triage keep the scope recorded at receipt", async () => { — Retain outcome in complete workflow.
- Line 1367: test("a pending-revision quarantine blocks new awards but preserves reporting until reinstated", async () => { — Retain outcome in complete workflow.
- Line 1434: test(`a restricted or retired program cannot start a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => { — Retain outcome in complete workflow.
- Line 1462: test("private reporting remains available for a registered quarantined project", async () => { — Retain outcome in complete workflow.
- Line 1476: test.each(["pending", "applied", "unproved"])( — Retain outcome in complete workflow.
- Line 1514: test.each(["none", "quarantine", "ban"] as const)( — Retain outcome in complete workflow.
- Line 1546: test("a receipt check imports no new report after an applied quarantine", async () => { — Retain outcome in complete workflow.
- Line 1562: test("a previously funded award remains accessible while quarantined", async () => { — Retain outcome in complete workflow.
- Line 1580: test(`repository-bound ${identity} restriction blocks a new award (race: ${racing}, related: ${relatedParty})`, async () => { — Retain outcome in complete workflow.
- Line 1667: test(`an ${fault} enforcement read cannot approve an award and can retry`, async () => { — Retain outcome in complete workflow.

### `backend/security/submissions.test.ts` — 2,044 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 501: test.each([false, true])( — Retain outcome in complete workflow.
- Line 573: test("creation replays one key and refuses a second submission in flight", async () => { — Retain outcome in complete workflow.
- Line 601: test("replaying creation on a finished or abandoned submission refuses instead of re-authorizing", async () => { — Retain outcome in complete workflow.
- Line 683: test("the repository comes from the program terms, never from the request", async () => { — Retain outcome in complete workflow.
- Line 691: test.each([false, true])( — Retain outcome in complete workflow.
- Line 715: test("the grant cookie is encrypted, HttpOnly, Strict and scoped to the submission routes", async () => { — Retain outcome in complete workflow.
- Line 749: test("a missing, tampered, expired or rebound grant never reaches GitHub", async () => { — Retain outcome in complete workflow.
- Line 781: test("an unrelated authority outage preserves the reporter's own case list with a generic retry notice", async () => { — Retain outcome in complete workflow.
- Line 799: test("a moderator cannot discover an un-escalated reporting-only project from the private list", async () => { — Retain outcome in complete workflow.
- Line 810: test("a sent report survives a contact lookup outage and reconciles without sending again", async () => { — Retain outcome in complete workflow.
- Line 837: test(`a verified ${origin} report with no passing approver recovers after 24 hours with fresh reporter consent`, async () => { — Retain outcome in complete workflow.
- Line 909: test("private intake accepts a report without inventing an award", async () => { — Retain outcome in complete workflow.
- Line 1027: test("a report is filed as the reporter and its receipt is verified with GitHub", async () => { — Retain outcome in complete workflow.
- Line 1150: test("definite GitHub refusals fail with a code, and a fixed report can be resent", async () => { — Retain outcome in complete workflow.
- Line 1176: test("a 404 maps to app-not-installed when the intake App is missing", async () => { — Retain outcome in complete workflow.
- Line 1188: test("an interrupted send is uncertain, never resent, and reconciled to the one copy", async () => { — Retain outcome in complete workflow.
- Line 1214: test("a complete empty listing reopens the draft for exactly one new send", async () => { — Retain outcome in complete workflow.
- Line 1247: test("an incomplete or failed listing keeps the submission uncertain", async () => { — Retain outcome in complete workflow.
- Line 1279: test("duplicate copies adopt the earliest and tell only the technical approvers", async () => { — Retain outcome in complete workflow.
- Line 1312: test("a marker match authored by someone else is ignored", async () => { — Retain outcome in complete workflow.
- Line 1338: test("a send that never returned becomes uncertain after 60 seconds and is not resent", async () => { — Retain outcome in complete workflow.
- Line 1363: test("a concurrent double send makes one POST", async () => { — Retain outcome in complete workflow.
- Line 1391: test("an empty listing right after the attempt keeps it uncertain, and a late copy is then adopted", async () => { — Retain outcome in complete workflow.
- Line 1434: test("a resend that races a late copy adopts the earliest and records the duplicate", async () => { — Retain outcome in complete workflow.
- Line 1473: test("a submitted report GitHub never lets Slop verify stops blocking new reports", async () => { — Retain outcome in complete workflow.
- Line 1495: test("a 201 that is not the reporter's well-formed advisory is uncertain", async () => { — Retain outcome in complete workflow.
- Line 1506: test("an unreadable advisory after creation retries the read only", async () => { — Retain outcome in complete workflow.
- Line 1561: test("the reporter's own advisory is verified with GitHub's original time", async () => { — Retain outcome in complete workflow.
- Line 1596: test("a reporter credit on someone else's advisory is not authorship, and the author can still verify", async () => { — Retain outcome in complete workflow.
- Line 1633: test("an advisory that is not a live private report is never an automatic receipt", async () => { — Retain outcome in complete workflow.
- Line 1651: test("two concurrent verifications of one submission both answer with the one verified case", async () => { — Retain outcome in complete workflow.
- Line 1680: test("another user's advisory fails as author-mismatch with no case", async () => { — Retain outcome in complete workflow.
- Line 1690: test("an advisory GitHub cannot find fails as not-found", async () => { — Retain outcome in complete workflow.
- Line 1709: test("an advisory already recorded for another case returns 409 without leaking it", async () => { — Retain outcome in complete workflow.
- Line 1751: test("the deterministic analyzer only recommends from structured fields", async () => { — Retain outcome in complete workflow.
- Line 1789: test("only the reporter can reach a submission", async () => { — Retain outcome in complete workflow.
- Line 1812: test("an idle draft is abandoned after 24 hours", async () => { — Retain outcome in complete workflow.
- Line 1832: test("report content and tokens never reach D1, logs or responses", async () => { — Retain outcome in complete workflow.
- Line 1889: test("with intake off every submission route is closed, the list is empty and readiness says off", async () => { — Retain outcome in complete workflow.
- Line 1921: test("readiness reports automatic intake only when the App is installed and PVR is on", async () => { — Retain outcome in complete workflow.
- Line 1954: test("a participation ban stops new private reports and sending an existing draft", async () => { — Retain outcome in complete workflow.
- Line 1967: test("a ban before the send commits prevents the private GitHub request", async () => { — Retain outcome in complete workflow.
- Line 1978: test("a concurrent ban leaves no new private submission or creation event", async () => { — Retain outcome in complete workflow.
- Line 1994: test("a banned reporter can reconcile a report GitHub already received", async () => { — Retain outcome in complete workflow.
- Line 2023: test("an accepted private report still reconciles after quarantine", async () => { — Retain outcome in complete workflow.
- Line 2039: test("registered researcher can start a private report on a quarantined project", async () => { — Retain outcome in complete workflow.

### `scripts/account-closure.test.ts` — 358 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 70: test("closing an account ends every session, removes optional connections and keeps records", async () => { — Retain outcome in complete workflow.
- Line 216: test("a closed account signs in again only through an explicit reopen", async () => { — Retain outcome in complete workflow.
- Line 272: test("closure needs a signed-in session and a same-origin JSON request, and a repeat is safe", async () => { — Retain outcome in complete workflow.
- Line 322: test("retired Telegram routes reveal no links and preserve historical records", async () => { — Retain outcome in complete workflow.

### `scripts/account-sessions.test.ts` — 82 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 7: test("account sessions revoke only the authenticated actor and invalidate the revoked cookie", async () => { — Retain outcome in complete workflow.

### `scripts/collect-quality-census.test.ts` — 263 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 216: test("a mid-month reward start excludes earlier closures and the census reconciles", () => { — Retain outcome in complete workflow.
- Line 256: test("a month before the project's reward start is refused", () => { — Retain outcome in complete workflow.

### `scripts/contributor-template-identity.test.ts` — 43 lines

Delete subprocess marker smoke (ST-02)

- Line 34: test("ordinary attribution uses the Slop marker unless the target repository requires its legacy one", () => { — DELETE duplicate fragment; preserve owner listed above.

### `scripts/cycle-index-review-excluded.test.ts` — 190 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 172: test("the sync script accepts an excluded row end to end", () => { — Retain outcome in complete workflow.

### `scripts/enrich-contribution-quality.test.ts` — 107 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 70: test("all merge-credit actors receive diff evidence without a false duplicate group", () => { — Retain outcome in complete workflow.
- Line 81: test("inspection failures remain visible for every merge-credit actor", () => { — Retain outcome in complete workflow.
- Line 95: test("matching patches on different PRs flag every actor once", () => { — Retain outcome in complete workflow.

### `scripts/fee-converter-release-preflight.test.ts` — 120 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 111: test("the release continues when every enabled live network has its key", () => { — Retain outcome in complete workflow.

### `scripts/historical-cycle-registry.test.ts` — 101 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 16: test("a frozen owner proposal survives registry copy and primary changes", () => { — Retain outcome in complete workflow.

### `scripts/identity-maintenance.test.ts` — 59 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 7: test("a failed intake renewal fails the job, preserves evidence, and still cleans expired state", async () => { — Retain outcome in complete workflow.

### `scripts/legacy-repository-registry.test.ts` — 82 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 73: test("a project for a legacy repository must reuse its historical id", async () => { — Retain outcome in complete workflow.

### `scripts/owner-award-authority.test.ts` — 170 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 13: test("organization maintainers reach private monthly awards through their own session; other actors and transferred repositories do not", async () => { — Retain outcome in complete workflow.

### `scripts/payout-exclusion.test.ts` — 217 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 87: test("an excluded owner keeps the score, receives nothing, and the other share is not reduced", async () => { — Retain outcome in complete workflow.

### `scripts/points-import.test.ts` — 372 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 58: test("points publication retains the exact permanent history prefix", async () => { — Retain outcome in complete workflow.
- Line 130: test("a staged coverage list is served whole and an incomplete one publishes nothing", async () => { — Retain outcome in complete workflow.
- Line 173: test("journal reads select the complete prefix before generation-time tie breakers", async () => { — Retain outcome in complete workflow.
- Line 214: test("member lookups fail closed when a stale public login collides with a private member", async () => { — Retain outcome in complete workflow.
- Line 290: test("X-connection awards recorded from 24 October 2026 report no points", async () => { — Retain outcome in complete workflow.

### `scripts/prepare-monthly-rewards.test.ts` — 90 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 26: test("a month's proposal is stored once; a later ledger never adds or replaces rows", async () => { — Retain outcome in complete workflow.

### `scripts/project-application-github-check.test.ts` — 524 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 217: test("an owner whose write access Slopbot reads creates the project at once", async () => { — Retain outcome in complete workflow.
- Line 266: test("a new project lists exactly one repository", async () => { — Retain outcome in complete workflow.
- Line 277: test("every listed repository must be a public GitHub repository", async () => { — Retain outcome in complete workflow.
- Line 296: test("an alias must lead to the repository it names", async () => { — Retain outcome in complete workflow.
- Line 331: test("a check names at most 5 repositories and aliases", async () => { — Retain outcome in complete workflow.
- Line 366: test.each(["unchanged", "changed", "unavailable"])( — Retain outcome in complete workflow.
- Line 438: test("the repository owner is accepted as steward in any login case, from the App response alone", async () => { — Retain outcome in complete workflow.
- Line 465: test("a project cannot claim a different GitHub owner account type", async () => { — Retain outcome in complete workflow.

### `scripts/project-registry-api.test.ts` — 2,153 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 305: test("serves a newly approved project at once, purging the cached list", async () => { — Retain outcome in complete workflow.
- Line 339: test("an owner revision publishes at once and appends only its expected revision", async () => { — Retain outcome in complete workflow.
- Line 415: test("owners publish bounty terms and open only with current verified vault funds", async () => { — Retain outcome in complete workflow.
- Line 673: test("reads token decimals from chain once, stores the amount in base units and keeps them on later revisions", async () => { — Retain outcome in complete workflow.
- Line 812: test("refuses an unverifiable or malformed token and stores nothing", async () => { — Retain outcome in complete workflow.
- Line 833: test("refuses a project id too long for its reviewer skill name", async () => { — Retain outcome in complete workflow.
- Line 847: test("refuses activation when historical clean metadata lacks canonical closure", async () => { — Retain outcome in complete workflow.
- Line 882: test("creates a project only for current GitHub authority and refuses contradicted facts", async () => { — Retain outcome in complete workflow.
- Line 975: test("serves the exact approved bytes of a revision", async () => { — Retain outcome in complete workflow.
- Line 990: test("looks up GitHub only for a signed-in visitor and caches the facts", async () => { — Retain outcome in complete workflow.
- Line 1101: test("an id derived from a long project name renders the reviewer skill", async () => { — Retain outcome in complete workflow.
- Line 1139: test("historical clean metadata cannot publish skills without canonical closure", async () => { — Retain outcome in complete workflow.
- Line 1224: test("an ordinary ban preserves the owner's project appeal for independent review", async () => { — Retain outcome in complete workflow.
- Line 1262: test("quarantines and bans while refusing an appeal with only historical clean metadata", async () => { — Retain outcome in complete workflow.
- Line 1585: test("a revision of another project cannot claim a banned repository", async () => { — Retain outcome in complete workflow.
- Line 1643: test("a ban closes the public routes of another project listed for the repository", async () => { — Retain outcome in complete workflow.
- Line 1710: test("another project listed for a banned repository can still be retired", async () => { — Retain outcome in complete workflow.
- Line 1784: test("an account-only appeal cannot reinstate the project, while a project appeal can", async () => { — Retain outcome in complete workflow.
- Line 1856: test("reinstatement is refused while the restriction revision is pending", async () => { — Retain outcome in complete workflow.
- Line 1920: test("a revision fails when a restriction lands after its read", async () => { — Retain outcome in complete workflow.
- Line 1964: test("cached skill and public clearance cannot survive loss of retained evidence", async () => { — Retain outcome in complete workflow.
- Line 2065: test("records the referrer once on the created project", async () => { — Retain outcome in complete workflow.
- Line 2095: test("a recycled login cannot attribute the applicant to an older cached member", async () => { — Retain outcome in complete workflow.
- Line 2119: test("a project that names nobody records no referrer", async () => { — Retain outcome in complete workflow.
- Line 2127: test("refuses the applicant, the steward, team accounts and unknown logins", async () => { — Retain outcome in complete workflow.

### `scripts/project-self-service.test.ts` — 2,644 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 181: test("a new project cannot reuse a listed project id or repository", async () => { — Retain outcome in complete workflow.
- Line 197: test("an admin revision still replaces the listed project with that id", async () => { — Retain outcome in complete workflow.
- Line 219: test("creation requires the Slopbot installation, then queues the first scan and returns one status", async () => { — Retain outcome in complete workflow.
- Line 261: test("setup activates a project only with installation write access and a clean scan", async () => { — Retain outcome in complete workflow.
- Line 345: test("an owner records and revokes explicit closure consent with current authority and immutable revisions", async () => { — Retain outcome in complete workflow.
- Line 426: test("owner revisions publish presentation at once, rescan skill inputs and apply money prospectively", async () => { — Retain outcome in complete workflow.
- Line 556: test("an owner revision cannot record a vault; a reviewed admin revision can", async () => { — Retain outcome in complete workflow.
- Line 627: test("a payout exclusion starts with the next UTC month on every revision path", async () => { — Retain outcome in complete workflow.
- Line 727: test("an application stored before self-service setup publishes once, by its applicant", async () => { — Retain outcome in complete workflow.
- Line 812: test("an explicit moderator ban blocks new contribution intake without blaming the original applicant", async () => { — Retain outcome in complete workflow.
- Line 1509: test("account-ban appeals after project appeal or reinstatement resolve role, refusal and independent reviewer notices", () => — Retain outcome in complete workflow.
- Line 1512: test("a concurrent project appeal refuses the stale account request and a fresh retry uses the account role", () => — Retain outcome in complete workflow.
- Line 1515: test("denying the project appeal leaves a banned account's appeal for its own decision", async () => { — Retain outcome in complete workflow.
- Line 1606: test("an open account appeal survives later project restrictions and needs an independent account reviewer for each decision", async () => { — Retain outcome in complete workflow.
- Line 1931: test("a malicious decision that closes a kept project appeal needs an independent moderator while an account appeal is open", async () => { — Retain outcome in complete workflow.
- Line 1950: test("an account release leaves the kept project appeal for an independent malicious decision", async () => { — Retain outcome in complete workflow.
- Line 1968: test("a banned owner or moderator separates its project appeal from its account appeal in both filing orders", async () => { — Retain outcome in complete workflow.
- Line 2143: test("account-reinstatement upgrade preserves prior releases and separates future project decisions", async () => { — Retain outcome in complete workflow.
- Line 2208: test.each(["vault verification", "owner update"])( — Retain outcome in complete workflow.
- Line 2355: test("only the steward or a repository admin can register the project vault", async () => { — Retain outcome in complete workflow.
- Line 2434: test("a ban issued during the authority check prevents automatic activation", async () => { — Retain outcome in complete workflow.
- Line 2532: test("an account-page appeal from a banned owner survives reload without opening a project appeal", async () => { — Retain outcome in complete workflow.

### `scripts/quality-external-evaluation.test.ts` — 263 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 239: test("prepare-contribution-quality keeps the award as an evaluation", () => { — Retain outcome in complete workflow.

### `scripts/quality-payment-ledger.test.ts` — 363 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 293: test("prepare-contribution-quality builds evidence from the payment review ledger", () => { — Retain outcome in complete workflow.
- Line 304: test("source correction accepts that evidence and refuses to recover the removed review", async () => { — Retain outcome in complete workflow.
- Line 330: test("source correction refuses to recover a review only the payment review ledger credits", async () => { — Retain outcome in complete workflow.
- Line 355: test("prepare-contribution-quality accepts the archived September cycle", () => { — Retain outcome in complete workflow.

### `scripts/release-registry.test.ts` — 360 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 70: test("release carries the checked D1 registry and history into canonical attester setup", async () => { — Retain outcome in complete workflow.

### `scripts/skill-source-matches-commit.test.ts` — 55 lines

Delete helper unit; installer owns full behavior (ST-02)

- Line 8: test("batched skill provenance keeps exact binary bytes and tree inventory", () => { — DELETE duplicate fragment; preserve owner listed above.

### `scripts/solana-vault-setup-network-failure.test.ts` — 280 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 241: test("an unreadable Solana RPC is a retry, while a program mismatch still refuses", async () => { — Retain outcome in complete workflow.

### `scripts/staging-release.test.ts` — 227 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 130: test("a verified ancestor can progress while development advances; old guard rejects it", () => { — Retain outcome in complete workflow.
- Line 143: test("a newer attempted deployment prevents rollback regardless of success", () => { — Retain outcome in complete workflow.
- Line 150: test("a newer qualification-only deployment does not block an older release", () => { — Retain outcome in complete workflow.
- Line 182: test("a divergent deployment prevents overwriting unknown staging state", () => { — Retain outcome in complete workflow.
- Line 187: test("a force-pushed development branch cannot authorize an abandoned candidate", () => { — Retain outcome in complete workflow.
- Line 193: test("history pagination cannot hide a newer attempt on the second page", () => { — Retain outcome in complete workflow.
- Line 200: test("unavailable, malformed or unknown deployment provenance fails closed", () => { — Retain outcome in complete workflow.
- Line 214: test("history beyond the bound fails rather than trusting an incomplete scan", () => { — Retain outcome in complete workflow.
- Line 222: test("wrong checkout, repository or branch cannot reach the staging gate", () => { — Retain outcome in complete workflow.

### `scripts/terms-preflight.test.ts` — 115 lines

Keep producer/consumer round trip; delete shape matrix (ST-03)

- Line 83: test("acknowledges the terms.json slop.cash serves for a project without a bounty program", async () => { — Retain outcome in complete workflow.
- Line 94: test("acknowledges public security bounty terms and a policy served before them", async () => { — Retain outcome in complete workflow.
- Line 105: test("still refuses unexpected policy fields and malformed bounty terms", async () => { — DELETE shape matrix (ST-03).

### `scripts/trace-upload-attachable.test.ts` — 481 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 243: test("a second trace for a run is refused at the intent, and its bytes are never written", async () => { — Retain outcome in complete workflow.
- Line 257: test("an intent issued before another trace attached cannot write its bytes", async () => { — Retain outcome in complete workflow.
- Line 276: test("an intent issued before finalization cannot write its bytes afterwards", async () => { — Retain outcome in complete workflow.
- Line 298: test("overlapping different uploads retain only the reserved trace", async () => { — Retain outcome in complete workflow.
- Line 314: test("a failed storage write retains its reservation and permits a same-byte retry", async () => { — Retain outcome in complete workflow.
- Line 337: test("an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims", async () => { — Retain outcome in complete workflow.
- Line 381: test("a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write", async () => { — Retain outcome in complete workflow.

### `scripts/vault-setup-network-failure.test.ts` — 276 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 238: test("an unreadable RPC is a retry, while a factory mismatch still refuses", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-api.test.ts` — 1,119 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 240: test("the trusted publisher journals one signed intake attempt", async () => { — Retain outcome in complete workflow.
- Line 327: test("a signed clean claim without canonical closure cannot activate the revision", async () => { — Retain outcome in complete workflow.
- Line 358: test("the queue binds commits and templates without accepting an unsupported clean claim", async () => { — Retain outcome in complete workflow.
- Line 402: test("an incomplete result quarantines the revision and blocks activation", async () => { — Retain outcome in complete workflow.
- Line 501: test("an unavailable model review can never produce a clean result", async () => { — Retain outcome in complete workflow.
- Line 521: test("confirmed malice bans the project; a model label alone cannot", async () => { — Retain outcome in complete workflow.
- Line 618: test("forged, stale, mismatched and unconfigured requests fail closed", async () => { — Retain outcome in complete workflow.
- Line 682: test("private retained bytes remain inspectable without granting clean clearance", async () => { — Retain outcome in complete workflow.
- Line 801: test("a clean result cannot omit a referenced retained artifact or replace an immutable inventory", async () => { — Retain outcome in complete workflow.
- Line 836: test("historical metadata-only clean results have no retained-evidence exemption", async () => { — Retain outcome in complete workflow.
- Line 854: test("missing storage pauses acquisition while harmless queue registration remains available", async () => { — Retain outcome in complete workflow.
- Line 871: test("large retained evidence uses bounded chunks, immutable completion and actor-bound native downloads", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-public-key.test.ts` — 157 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 16: test("release assembly keeps plaintext settings, excludes signing material and reads back each environment's exact public key", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-publication-journal.test.ts` — 101 lines

Retain durable adapter uncertainty until equivalent D1-backed publisher flow exists; no unproved deletion

- Line 54: test("a restarted controller preserves an intent even when its reservation reply is lost", async () => { — Retain outcome in complete workflow.
- Line 67: test("only one concurrent controller can reserve a publication and its metadata stays immutable", async () => { — Retain outcome in complete workflow.
- Line 83: test("a receipt must match the reserved result and remains exactly once", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-queue.test.ts` — 346 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 273: test("signed real queue and SQLite revision acquire exact Git and template bytes without finishing assessment", async () => { — Retain outcome in complete workflow.
- Line 322: test("changed revision/template bytes and wrong signer leave queue pending and no completed bundle", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-scan-flags.test.ts` — 1,270 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 396: test("a clean supported scan lets activation proceed without an admin scan request", async () => { — Retain outcome in complete workflow.
- Line 444: test("changed executable content is rescanned; identical content reuses the cached scan", async () => { — Retain outcome in complete workflow.
- Line 476: test("an incomplete or legacy result never clears", async () => { — Retain outcome in complete workflow.
- Line 497: test("two distinct flags pause atomically with one moderator notice; a clean fresh scan reinstates", async () => { — Retain outcome in complete workflow.
- Line 615: test.each([0, 30_000])( — Retain outcome in complete workflow.
- Line 656: test("withdrawn flags stop counting and owners cannot flag", async () => { — Retain outcome in complete workflow.
- Line 699: test("only established contributors outside the project may flag", async () => { — Retain outcome in complete workflow.
- Line 730: test("a flag stops counting 90 days after it was filed", async () => { — Retain outcome in complete workflow.
- Line 754: test("a confirmed malicious result after a flag pause stays with a moderator", async () => { — Retain outcome in complete workflow.
- Line 803: test("the database refuses a flag pause without two distinct active reporters", async () => { — Retain outcome in complete workflow.
- Line 829: test("a banned account cannot add a flag but can withdraw its earlier flag", async () => { — Retain outcome in complete workflow.
- Line 858: test("a concurrent account ban cannot supply the flag that pauses another project", async () => { — Retain outcome in complete workflow.
- Line 870: test("the existing-project exemption is permanent but cannot clear reinstatement or later projects", async () => { — Retain outcome in complete workflow.
- Line 951: test("an exempt owner edit stays active without a scan, while flags still require fresh reinstatement", async () => { — Retain outcome in complete workflow.
- Line 1084: test("a non-exempt owner executable edit still pauses and queues its new content", async () => { — Retain outcome in complete workflow.
- Line 1123: test("withdrawing a flag after the 90-day lifetime expires it by lifetime and returns 404", async () => { — Retain outcome in complete workflow.
- Line 1151: test("a cached scan from before a two-flag pause is refused and cannot reinstate the project", async () => { — Retain outcome in complete workflow.
- Line 1178: test("a completed scan for a superseded commit pin records without lifting a flag pause until the live pin is scanned", async () => { — Retain outcome in complete workflow.
- Line 1232: test("a live-pin outage while a fresh clean scan lands defers the flag reinstatement to the next refresh", async () => { — Retain outcome in complete workflow.

### `scripts/vetting-scan-service.test.ts` — 1,053 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 567: test("a provider outage leaves the scan pending; the next pass clears the project with one Surplus review", async () => { — Retain outcome in complete workflow.
- Line 615: test("an ambiguous primary review runs the Surplus specialist once before publication", async () => { — Retain outcome in complete workflow.
- Line 637: test("a failed specialist is a service failure: nothing is published and the scan retries", async () => { — Retain outcome in complete workflow.
- Line 696: test("a clean result is never published without its retained evidence; the next pass retries", async () => { — Retain outcome in complete workflow.
- Line 723: test("an incomplete result is published although the evidence store fails, so the models are not called again", async () => { — Retain outcome in complete workflow.
- Line 750: test("malicious-code detection: risky new content is flagged, escalated to the specialist and kept quarantined", async () => { — Retain outcome in complete workflow.
- Line 799: test("a two-flag pause is reinstated automatically after the service's clean fresh scan", async () => { — Retain outcome in complete workflow.
- Line 844: test("an unpinned endpoint or model fails closed before the queue or any provider is contacted", async () => { — Retain outcome in complete workflow.
- Line 922: test("unsupported artifacts produce an incomplete scan rather than aborting the scan pass", async () => { — Retain outcome in complete workflow.

### `scripts/wallet-possession.test.ts` — 200 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 151: test("refuses an expired challenge re-signed over a later window", async () => { — Retain outcome in complete workflow.
- Line 170: test("refuses a live challenge signed over a shifted window", async () => { — Retain outcome in complete workflow.
- Line 182: test("records a proof over the window the server issued", async () => { — Retain outcome in complete workflow.

### `tests/e2e/account-closure-integration.spec.ts` — 233 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 13: test(`account closure ${withObligations ? "with unpaid awards and a private case" : "without awards"} requires an explicit authenticated reopen`, async ({ — Retain outcome in complete workflow.

### `tests/e2e/account-sessions.spec.ts` — 276 lines

Keep session revoke; merge closure uncertainty into real integration (ST-04)

- Line 10: test("Account waits for identity, revokes another session and signs out the current session", async ({ — Retain outcome in complete workflow.
- Line 103: test("Account closes itself and explicitly reopens after a lost response", async ({ — MERGE uncertainty into real closure integration; delete duplicate.

### `tests/e2e/automatic-monthly-payment.spec.ts` — 153 lines

Delete duplicate fake-wallet fragment after Anvil preservation (ST-05)

- Line 34: test("automatic monthly payment starts checked and only the vault owner can sign", async ({ — DELETE duplicate fragment; preserve owner listed above.

### `tests/e2e/email-preferences.spec.ts` — 91 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 4: test("verified activity email preference persists and can be withdrawn @registry", async ({ — Retain outcome in complete workflow.

### `tests/e2e/evidence-download.spec.ts` — 277 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 9: test("large private evidence downloads with a single-use browser grant @registry", async ({ — Retain outcome in complete workflow.

### `tests/e2e/funding-wallet-qa.spec.ts` — 173 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 6: test("legacy wallet links open Account Wallets on direct navigation and reload", { — Retain outcome in complete workflow.
- Line 109: test("funding and wallet keyboard flows remain accessible at 200 percent text size", async ({ — Retain outcome in complete workflow.

### `tests/e2e/hero-typewriter.spec.ts` — 63 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 9: test("hero types, deletes and cycles all original campaign phrases without moving the layout", async ({ — Retain outcome in complete workflow.
- Line 51: test("reduced motion keeps the hero static", async ({ page }) => { — Retain outcome in complete workflow.

### `tests/e2e/home-cache.spec.ts` — 279 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 11: test("renders bundled projects with data stalled and GitHub blocked", async ({ — Retain outcome in complete workflow.
- Line 85: test("an unavailable registry with no last good copy shows an error, never an empty list", async ({ — Retain outcome in complete workflow.
- Line 124: test("a failed registry read keeps the last good projects with a stale label", async ({ — Retain outcome in complete workflow.
- Line 215: test("a failed snapshot refresh keeps the last good scores with a stale label", async ({ — Retain outcome in complete workflow.

### `tests/e2e/login.spec.ts` — 209 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 9: "serves GitHub login on direct navigation and reload", — Retain outcome in complete workflow.
- Line 57: test(`login returns ${next} to a safe destination`, async ({ — Retain outcome in complete workflow.
- Line 173: test("the header login link keeps the current page as the return route", async ({ — Retain outcome in complete workflow.

### `tests/e2e/onboarding-clearance.spec.ts` — 74 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 4: test("project agent setup falls back to the general prompt until cleared", async ({ — Retain outcome in complete workflow.
- Line 58: test("home agent setup stays usable when discovery is unavailable", async ({ — Retain outcome in complete workflow.

### `tests/e2e/owner-awards.spec.ts` — 330 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 6: test("owner edits monthly allocations privately, finalizes them and keeps sign-in context", async ({ — Retain outcome in complete workflow.
- Line 203: test("owner reserve repair keeps healthy and unknown states held and restores a submitted transaction after reload", async ({ — Retain outcome in complete workflow.

### `tests/e2e/payment-availability.spec.ts` — 120 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 12: test("disabled payouts are visible from discovery through the project page", async ({ — Retain outcome in complete workflow.
- Line 94: test("a cycle record offers a funding check without inventing a vault balance", async ({ — Retain outcome in complete workflow.

### `tests/e2e/payout-consent.spec.ts` — 392 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 133: test("a recipient reviews the exact vault and signs consent without claiming payment", async ({ — Retain outcome in complete workflow.
- Line 167: test(`payout consent preserves the award after ${fault} failure`, async ({ — Retain outcome in complete workflow.
- Line 188: test("Solana recipient co-signs only the prepared binding and waits for payment finality", async ({ — Retain outcome in complete workflow.
- Line 373: test("payout consent remains readable with enlarged text and Escape restores the initiating control", async ({ — Retain outcome in complete workflow.

### `tests/e2e/payout-wallet-picker.spec.ts` — 848 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 195: test("modal routes Base and Robinhood Chain to MetaMask and Solana to Backpack despite Phantom globals", async ({ — Retain outcome in complete workflow.
- Line 270: test("Escape and close cancel without wallet requests and return focus", async ({ — Retain outcome in complete workflow.
- Line 293: test("wallet rejection stops registration and permits reopening the modal", async ({ — Retain outcome in complete workflow.
- Line 308: test("repeated announcements do not duplicate options and removed Solana wallet disappears", async ({ — Retain outcome in complete workflow.
- Line 339: test("no wallets offers official install links in either network modal", async ({ — Retain outcome in complete workflow.
- Line 366: test("legacy wallet browser remains connectable through the modal", async ({ — Retain outcome in complete workflow.
- Line 392: test("conflicting EIP-6963 UUID removes both providers without wallet requests", async ({ — Retain outcome in complete workflow.
- Line 427: test("mixed standard and legacy discovery keeps every distinct wallet", async ({ — Retain outcome in complete workflow.
- Line 565: test(`open modal reflows at ${scenario.name}`, async ({ page }, info) => { — Retain outcome in complete workflow.
- Line 648: test("changing a confirmed Base wallet opens the account picker and asks before registering the new account", async ({ — Retain outcome in complete workflow.
- Line 696: test("keeping the saved address registers nothing and returns focus to the wallet button", async ({ — Retain outcome in complete workflow.
- Line 721: test("connecting with an unconfirmed saved address asks before registering a different active account", async ({ — Retain outcome in complete workflow.
- Line 736: test("connecting the saved address confirms it without an extra step", async ({ — Retain outcome in complete workflow.
- Line 752: test("a wallet without an account picker falls back to its connected account", async ({ — Retain outcome in complete workflow.
- Line 773: test("rejecting the account picker stops the change", async ({ page }) => { — Retain outcome in complete workflow.
- Line 792: test(`wallet change confirmation reflows at ${scenario.name}`, async ({ — Retain outcome in complete workflow.

### `tests/e2e/points-social.spec.ts` — 229 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 10: test("social membership preserves past points and connection privacy without new awards", async ({ — Retain outcome in complete workflow.

### `tests/e2e/points.spec.ts` — 213 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 6: "points history is usable, accessible and independent of payments", — Retain outcome in complete workflow.
- Line 136: test("shows archived payments in their settlement month independently of points", async ({ — Retain outcome in complete workflow.

### `tests/e2e/profile-rename.spec.ts` — 643 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 92: test("a renamed contributor keeps archived cycles", async ({ page }, info) => { — Retain outcome in complete workflow.
- Line 126: test("a different actor reusing an old login does not inherit its history", async ({ — Retain outcome in complete workflow.
- Line 145: test("an inactive new owner does not inherit archived records or wallet lookups", async ({ — Retain outcome in complete workflow.
- Line 180: test("a directory-verified historical contributor keeps archived links", async ({ — Retain outcome in complete workflow.
- Line 193: test("historical names alone do not identify a current contributor or wallet", async ({ — Retain outcome in complete workflow.
- Line 212: test("a new owner listed without activity uses only its own identity and wallet", async ({ — Retain outcome in complete workflow.
- Line 236: test("conflicting current names withhold history and wallet lookups", async ({ — Retain outcome in complete workflow.
- Line 256: test("a stale activity login cannot override a directory rename", async ({ — Retain outcome in complete workflow.
- Line 286: test("an unavailable identity directory hides historical records until retry succeeds", async ({ — Retain outcome in complete workflow.
- Line 339: test("profile payment totals stay unavailable until direct transfers recover", async ({ — Retain outcome in complete workflow.
- Line 460: staleMembership — Retain outcome in complete workflow.
- Line 530: test(`directory-only membership identity: ${scenario}`, async ({ page }) => { — Retain outcome in complete workflow.

### `tests/e2e/profile-review-exclusions.spec.ts` — 396 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 110: test("a profile lists its own excluded reviews with their reasons", async ({ — Retain outcome in complete workflow.
- Line 245: test("a review-only nonmember sees accurate snapshot omissions", async ({ — Retain outcome in complete workflow.
- Line 310: test("a stale review-only profile shows the stale notice and zero points", async ({ — Retain outcome in complete workflow.
- Line 337: test("the current directory vetoes a renamed or recycled review-only login", async ({ — Retain outcome in complete workflow.
- Line 380: test("legacy snapshots without reviewer metadata do not report zero exclusions", async ({ — Retain outcome in complete workflow.

### `tests/e2e/profiles.spec.ts` — 362 lines

Keep real browser history; remove issue-census unit (ST-01)

- Line 17: test("profiles preserve legacy coverage and expose recorded issue history", async ({ — Retain outcome in complete workflow.
- Line 197: test("issue census records a hidden transition as incomplete history", async () => { — DELETE helper unit (ST-01).

### `tests/e2e/project-payment-navigation.spec.ts` — 378 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 127: test(`direct payments keep project identity through ${navigation}`, async ({ — Retain outcome in complete workflow.
- Line 211: test("a late previous payment request cannot overwrite a retried project", async ({ — Retain outcome in complete workflow.
- Line 317: test("a flag draft does not follow browser history to another project", async ({ — Retain outcome in complete workflow.

### `tests/e2e/project-proposal.spec.ts` — 841 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 188: test("drafts a project through the setup steps and creates it without an admin", async ({ — Retain outcome in complete workflow.
- Line 449: test("failed or partial GitHub lookups never fill unknown facts", async ({ — Retain outcome in complete workflow.
- Line 539: test("Robinhood Chain drafts a USDG escrow manifest", async ({ — Retain outcome in complete workflow.
- Line 604: test("a signed-in maintainer picks an owned repository and gets suggested text", async ({ — Retain outcome in complete workflow.
- Line 755: test(`submits a valid project identity for ${name}`, async ({ — Retain outcome in complete workflow.

### `tests/e2e/project-standings-navigation.spec.ts` — 251 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 84: test("Money received standings preserve unavailable data and recover on retry", async ({ — Retain outcome in complete workflow.
- Line 150: test("history navigation keeps contributor standings scoped to the current project", async ({ — Retain outcome in complete workflow.
- Line 200: test("global standings still accept project, sort and contributor filters", async ({ — Retain outcome in complete workflow.

### `tests/e2e/referral-claims.spec.ts` — 357 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 154: test("referrer reviews, signs once, and waits for verified claim status", async ({ — Retain outcome in complete workflow.
- Line 197: test("unactivated referrals stay hidden; stale, paused and unknown claims cannot sign", async ({ — Retain outcome in complete workflow.
- Line 235: test("blocked claim storage keeps amounts visible and refuses a wallet send", async ({ — Retain outcome in complete workflow.
- Line 261: test("refresh retains an unverified claim when storage becomes unreadable", async ({ — Retain outcome in complete workflow.
- Line 298: test("an unreadable pending marker does not hide amounts or permit an unchecked retry", async ({ — Retain outcome in complete workflow.
- Line 327: test("an older stored claim cannot confirm the newer request on this page", async ({ — Retain outcome in complete workflow.

### `tests/e2e/registry.spec.ts` — 2,388 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 318: test("an empty registry shows the empty state, never stale build data @registry", async ({ — Retain outcome in complete workflow.
- Line 341: test("a signed-out visitor must sign in to look up GitHub and submit @registry", async ({ — Retain outcome in complete workflow.
- Line 373: test("an owner creates a paused project without admin approval @registry", async ({ — Retain outcome in complete workflow.
- Line 418: test("an owner creates and updates directly; an admin can delist by exception @registry", async ({ — Retain outcome in complete workflow.
- Line 586: test("an admin cannot activate or publish skills without canonical scan closure @registry", async ({ — Retain outcome in complete workflow.
- Line 759: test("the applicant's inbox lists each decision and revision once and keeps the read state @registry", async ({ — Retain outcome in complete workflow.
- Line 815: test("moderators restrict a project and refuse reinstatement without canonical scan closure @registry", async ({ — Retain outcome in complete workflow.
- Line 1151: test("a moderator decides a confirmed malicious result and bans the project and its maintainer @registry", async ({ — Retain outcome in complete workflow.
- Line 1371: test("an owner installs Slopbot before creation and resumes setup; a failed scan and lost access each show the next action @registry", async ({ — Retain outcome in complete workflow.
- Line 1573: test("an owner publishes while public GitHub is rate limited and recovers only a stale revision @registry", async ({ — Retain outcome in complete workflow.
- Line 1744: test("an owner initializes a legacy monthly project without shortening its accepted policy @registry", async ({ — Retain outcome in complete workflow.
- Line 1911: test("an applicant publishes an application stored before self-service setup without entering it again @registry", async ({ — Retain outcome in complete workflow.
- Line 2040: test("a designated operator inspects retained vetting bytes with reasoned access @registry", async ({ — Retain outcome in complete workflow.
- Line 2159: test("repository lookup failures explain the next action and preserve the draft @registry", async ({ — Retain outcome in complete workflow.
- Line 2231: test("two contributors flag through the form, pause the project and notify moderators @registry", async ({ — Retain outcome in complete workflow.

### `tests/e2e/score-penalties.spec.ts` — 154 lines

Delete static snapshot display duplicate (ST-06)

- Line 46: test("a published debit and a payout exclusion show on the profile and the cycle", async ({ — DELETE duplicate fragment; preserve owner listed above.

### `tests/e2e/security-bounty.spec.ts` — 3,036 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 517: test("owners publish and control bounty programs with verified funding @registry", async ({ — Retain outcome in complete workflow.
- Line 694: test("private security bounty programs keep cases restricted from intake to award @registry", async ({ — Retain outcome in complete workflow.
- Line 1904: test("private settlement requires visibility consent and produces an unsigned request @registry", async ({ — Retain outcome in complete workflow.
- Line 2081: test("private bounty obligations continue through role loss, approver replacement, and a ban @registry", async ({ — Retain outcome in complete workflow.
- Line 2370: test("automatic private intake files as the reporter and verifies receipt @registry @private-intake", async ({ — Retain outcome in complete workflow.

### `tests/e2e/site.spec.ts` — 1,532 lines

Consolidate duplicate breakpoint paths; preserve distinct layout families (ST-11)

- Line 59: test("discovers projects and one points-ranked homepage leaderboard", async ({ — Retain outcome in complete workflow.
- Line 168: test("shows agent setup and keeps contribution records available", async ({ — Retain outcome in complete workflow.
- Line 210: test("never presents Delta Star's external prize as platform money", async ({ — Retain outcome in complete workflow.
- Line 226: test("shows the frozen record for a cycle the live window still covers", { — Retain outcome in complete workflow.
- Line 269: test("renders contributor and cycle records from validated public data", { — Retain outcome in complete workflow.
- Line 440: test("makes the public project draft boundary unmistakable", async ({ — Retain outcome in complete workflow.
- Line 481: test("publishes criteria changes directly and stops a stale maintainer draft", async ({ — Retain outcome in complete workflow.
- Line 667: test("reaches and reads older inbox notifications without losing the page", async ({ — Retain outcome in complete workflow.
- Line 729: test("the inbox keeps read, acknowledged and email outcomes distinct and puts email settings after the notices", async ({ — Retain outcome in complete workflow.
- Line 834: test("an admin leaves an unset reward asset unchanged until choosing it", async ({ — Retain outcome in complete workflow.
- Line 917: test("project pages omit full standings and sponsor links keep their destination", async ({ — Retain outcome in complete workflow.
- Line 936: test("serves byte-consistent bootstrap and read-only site artifacts", { — Retain outcome in complete workflow.
- Line 1079: test("shows an explicit error for invalid data and retries", async ({ — Retain outcome in complete workflow.
- Line 1140: test(`reflows ${path} with ${scenario.name}`, async ({ page }) => { — Retain outcome in complete workflow.
- Line 1188: test("finds a receipt and opens its full evidence and GitHub contribution", async ({ — Retain outcome in complete workflow.
- Line 1283: test(`keeps ${route} accessible and inside the viewport`, { — Retain outcome in complete workflow.
- Line 1353: test("opens the models page directly and through keyboard navigation", async ({ — Retain outcome in complete workflow.
- Line 1410: test("opens the sponsors page directly and through keyboard navigation", async ({ — Retain outcome in complete workflow.
- Line 1463: test("lands direct and lazy cross-route hash links on their section", async ({ — Retain outcome in complete workflow.
- Line 1525: test("refuses prototype paths", async ({ page }) => { — Retain outcome in complete workflow.

### `tests/e2e/slopbot-appeal-inbox.spec.ts` — 105 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 7: test("an escalated contribution appeal opens from the moderator Inbox and shows resolution @registry", async ({ — Retain outcome in complete workflow.

### `tests/e2e/solana-vault-actions.spec.ts` — 1,662 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 414: test("Solana wallet deposits, recovers after reload, and owner withdraws with verified fee", async ({ — Retain outcome in complete workflow.
- Line 1656: bounty — Retain outcome in complete workflow.

### `tests/e2e/vault-actions.spec.ts` — 1,996 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 254: test("depositor funds a real vault, recovers a submitted transaction and owner withdraws only free funds", async ({ — Retain outcome in complete workflow.
- Line 762: test("owner turns automatic monthly payment on by default, then opts out", async ({ — Retain outcome in complete workflow.
- Line 981: test("owner creates, registers and funds a vault through the real API", async ({ — Retain outcome in complete workflow.
- Line 1585: test("owner funds a separate bounty vault with private balances and no monthly reward", async ({ — Retain outcome in complete workflow.

### `tests/e2e/wallet-readback.spec.ts` — 109 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 31: test("Account Wallets restores all saved networks and public records after reload", async ({ — Retain outcome in complete workflow.
- Line 64: test("unavailable wallet readback retries without inventing an empty account", async ({ — Retain outcome in complete workflow.
- Line 94: test("expired wallet sessions require sign-in with an Account return path", async ({ — Retain outcome in complete workflow.

### `workers/fee-converter/fee-converter.test.ts` — 1,797 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 180: test("mode defaults to off and runs nothing", async () => { — Retain outcome in complete workflow.
- Line 191: test("scheduled startup failures reject after every enabled network is attempted", async () => { — Retain outcome in complete workflow.
- Line 233: test("a key that does not control the configured fee wallet is refused", async () => { — Retain outcome in complete workflow.
- Line 256: test("retained Robinhood fees report not converted through receipt and recovery runs without quotes or keys", async () => { — Retain outcome in complete workflow.
- Line 400: test(`${network} ${field}=${String(value)} refuses before preparation`, async () => { — Retain outcome in complete workflow.
- Line 428: test(`${network} valid costs ${JSON.stringify(costs)} retain the 10x gate`, async () => { — Retain outcome in complete workflow.
- Line 451: test("a receipt run converts a newly received fee and leaves an unchanged balance alone", async () => { — Retain outcome in complete workflow.
- Line 477: test("a repeated fee amount after finalization is a new receipt", async () => { — Retain outcome in complete workflow.
- Line 492: test("the recovery scan retries a token that a receipt run leaves alone", async () => { — Retain outcome in complete workflow.
- Line 508: test("dry_run records the quote and never prepares or signs", async () => { — Retain outcome in complete workflow.
- Line 522: test("the record keeps the fee-wallet balances before and after", async () => { — Retain outcome in complete workflow.
- Line 538: test("the stablecoin and empty balances are never quoted", async () => { — Retain outcome in complete workflow.
- Line 549: test("small amounts stay pending below the minimum and below the gas multiple", async () => { — Retain outcome in complete workflow.
- Line 565: test("a pending fee converts once a later receipt lifts it over the threshold", async () => { — Retain outcome in complete workflow.
- Line 577: test("unknown or excessive price impact and loose minimums are skipped", async () => { — Retain outcome in complete workflow.
- Line 595: test("an unchanged skip is recorded once, not every run", async () => { — Retain outcome in complete workflow.
- Line 606: test("a large balance is scaled to fit the per-run cap across tokens", async () => { — Retain outcome in complete workflow.
- Line 630: test("live sends in the last 24 hours count against the daily cap", async () => { — Retain outcome in complete workflow.
- Line 652: test("an approval is journaled before an ambiguous broadcast and excludes conversion totals", async () => { — Retain outcome in complete workflow.
- Line 715: test("a canonical approval permits a fresh later swap without counting the approval value", async () => { — Retain outcome in complete workflow.
- Line 746: test("a legacy failed approval hash stays held without inventing its raw bytes", async () => { — Retain outcome in complete workflow.
- Line 777: test("an unknown send blocks a new attempt until it is reconciled", async () => { — Retain outcome in complete workflow.
- Line 812: test("a send proven unable to land frees the token for a new attempt", async () => { — Retain outcome in complete workflow.
- Line 824: test("a failed prepare leaves no signed bytes and no open row", async () => { — Retain outcome in complete workflow.
- Line 837: test("a concurrent run on the same network is locked out", async () => { — Retain outcome in complete workflow.
- Line 849: test("a run that lost its lease never deletes the successor's lock", async () => { — Retain outcome in complete workflow.
- Line 869: test("a stale run cannot release a lease it already let lapse", async () => { — Retain outcome in complete workflow.
- Line 886: test("a run that still owns an unexpired lease releases it", async () => { — Retain outcome in complete workflow.
- Line 897: test("a run renews its lease so a long run keeps the lock", async () => { — Retain outcome in complete workflow.
- Line 918: test("a run renews the lease before starting a later chunk", async () => { — Retain outcome in complete workflow.
- Line 955: test("a run stops starting new chunks once it loses its lease", async () => { — Retain outcome in complete workflow.
- Line 1010: test("a slow reconciliation cannot replace after lease takeover", async () => { — Retain outcome in complete workflow.
- Line 1035: test("replacement work that outlives its lease keeps the original pending", async () => { — Retain outcome in complete workflow.
- Line 1054: test("the replacement append refuses a successor lease taken during the database wait", async () => { — Retain outcome in complete workflow.
- Line 1068: test("an append cannot revive an original settled during the database wait", async () => { — Retain outcome in complete workflow.
- Line 1086: test("lease loss after journaling preserves bytes without broadcasting", async () => { — Retain outcome in complete workflow.
- Line 1102: test("a delayed restart delivers journaled bytes before another fee step", async () => { — Retain outcome in complete workflow.
- Line 1120: test("an explicit node fee refusal can escalate after trying the journaled bytes", async () => { — Retain outcome in complete workflow.
- Line 1134: test("an uncertain rebroadcast never skips to a new fee step", async () => { — Retain outcome in complete workflow.
- Line 1148: test("the schema refuses a second open send, a submitted row without bytes, and edits to final rows", async () => { — Retain outcome in complete workflow.
- Line 1181: test("a pending row needs its reason and is final", async () => { — Retain outcome in complete workflow.
- Line 1198: test("fee conversion rebuilds keep every earlier record and its guards", async () => { — Retain outcome in complete workflow.
- Line 1309: test("candidate tokens come only from reviewed manifests on the network", async () => { — Retain outcome in complete workflow.
- Line 1739: test("a dry run reports the claim and signs nothing", async () => { — Retain outcome in complete workflow.
- Line 1754: test("a live run claims once and a rerun finds nothing left to claim", async () => { — Retain outcome in complete workflow.
- Line 1766: test("a previously signed claim expires through two-provider proof without retrying on missing evidence", async () => { — Retain outcome in complete workflow.
- Line 1785: test("a fee below the dust threshold keeps accruing in the vault", async () => { — Retain outcome in complete workflow.

### `workers/fee-converter/native-gas.test.ts` — 1,073 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 146: test("missing native limits refuse before the Worker reads its key", async () => { — Retain outcome in complete workflow.
- Line 165: test("exact-wei reservations serialize competing attempts and preserve liability across midnight", async () => { — Retain outcome in complete workflow.
- Line 186: test("a successor retires only uncommitted reservations; stale signed commits roll back", async () => { — Retain outcome in complete workflow.
- Line 225: test("a wrong signature or duplicate reservation cannot create a durable send", async () => { — Retain outcome in complete workflow.
- Line 242: test("same-nonce replacements reserve their maximum once and settle exactly one winner", async () => { — Retain outcome in complete workflow.
- Line 292: test("unavailable receipts retain gas until the canonical cost is recovered", async () => { — Retain outcome in complete workflow.
- Line 381: test("business failure and router expiry do not release signed gas; overruns hold future signing", async () => { — Retain outcome in complete workflow.
- Line 411: test("legacy approval and swap hashes both enter accounting with independently proved nonces", async () => { — Retain outcome in complete workflow.
- Line 424: test.each(["complete", "changed-fee", "missing-signature"])( — Retain outcome in complete workflow.
- Line 506: test.each(["allowed", "transaction", "day", "value", "base-allowance"])( — Retain outcome in complete workflow.
- Line 719: test("Solana signed costs share the atomic journal while unknown sends retain their whole ceiling", async () => { — Retain outcome in complete workflow.
- Line 794: test("Solana migration preserves existing EVM liabilities and immutable receipt evidence", () => { — Retain outcome in complete workflow.
- Line 823: test("expiry evidence and zero-cost resolution commit atomically under the current Solana lease", async () => { — Retain outcome in complete workflow.
- Line 979: test("versioned signed sends retain immutable account evidence atomically with the native reservation", async () => { — Retain outcome in complete workflow.

### `workers/fee-converter/solana-route-prepare.test.ts` — 539 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 367: test("a v0 Token-2022 swap signs only after account review and retains the review with its native liability", async () => { — Retain outcome in complete workflow.
- Line 522: test("a substituted lookup or extra token debit refuses before reserving or signing", async () => { — Retain outcome in complete workflow.

### `workers/notify/security.test.ts` — 501 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 153: test("a case change queues once, sends generic per-role mail once, and needs explicit recipient acknowledgment", async () => { — Retain outcome in complete workflow.
- Line 220: test("a report receipt is mailed generically and never escalates for a missing acknowledgment", async () => { — Retain outcome in complete workflow.
- Line 256: test("ambiguous transport never resends until independent non-acceptance evidence; failures reach only an authorized backup", async () => { — Retain outcome in complete workflow.
- Line 298: test("role revocation suppresses queued mail; missing verified destinations exhaust bounded retries without losing the case", async () => { — Retain outcome in complete workflow.
- Line 326: test("backup notices have a durable inbox row and their own authenticated acknowledgment", async () => { — Retain outcome in complete workflow.
- Line 355: test("already escalated history cannot starve a later overdue notice", async () => { — Retain outcome in complete workflow.
- Line 384: test("pre-pilot inbox history is not mailed and does not expose a dead acknowledgment action", async () => { — Retain outcome in complete workflow.
- Line 426: test("a negative receipt cannot reconcile a later attempt or append duplicate evidence", async () => { — Retain outcome in complete workflow.
- Line 471: test("concurrent copies of one provider receipt append one delivery event", async () => { — Retain outcome in complete workflow.

### `workers/payment-executor/wallet-rotation.test.ts` — 187 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 159: test("rotates after the award was paid by the attempt's own transaction", async () => { — Retain outcome in complete workflow.
- Line 168: test("rotates after a paid award whose attempt lost its executor response", async () => { — Retain outcome in complete workflow.
- Line 174: test("rotates after a paid award whose attempt was outpaid by another transaction", async () => { — Retain outcome in complete workflow.
- Line 183: test("still holds the rotation while an unpaid award's attempt is uncertain", async () => { — Retain outcome in complete workflow.

### `workers/referral-accrual/poster.test.ts` — 884 lines

Consolidate fake-chain section into actual-client workflow (ST-09)

- Line 171: test("posts the earliest filed root the chain lacks, after reconciling", async () => { — Retain outcome in complete workflow.
- Line 224: test("refuses while a root is pending, paused, or the chain disagrees", async () => { — Retain outcome in complete workflow.
- Line 274: test("prechecks the cap, the shrink rule and the funding before signing", async () => { — Retain outcome in complete workflow.
- Line 297: test("a failed broadcast leaves the signed bytes to resend unchanged", async () => { — Retain outcome in complete workflow.
- Line 333: test("an owner void halts posting until the operator acknowledges it", async () => { — Retain outcome in complete workflow.
- Line 609: test("missing receipt and advanced nonce stay held without a new send", async () => { — Retain outcome in complete workflow.
- Line 625: test("nonfinal void holds, disappears safely, and only canonical final void is permanent", async () => { — Retain outcome in complete workflow.
- Line 647: test("configuration change refuses before RPC or stored broadcast", async () => { — Retain outcome in complete workflow.
- Line 662: test("actual transport error cannot put signed bytes into a diagnostic; wrong returned hash refuses", async () => { — Retain outcome in complete workflow.
- Line 687: test("actual quote over the cap never invokes the account signer or broadcast", async () => { — Retain outcome in complete workflow.
- Line 757: test("unknown sends retain one reservation across midnight and unchanged rebroadcast", async () => { — Retain outcome in complete workflow.
- Line 782: test("reverted costs consume the receipt UTC day's budget and release only later-day capacity", async () => { — Retain outcome in complete workflow.
- Line 812: test("overlapping quotes cannot commit or broadcast two native liabilities", async () => { — Retain outcome in complete workflow.
- Line 847: test("lower transaction cap refuses before signing or any journal reservation", async () => { — Retain outcome in complete workflow.
- Line 861: test("actual client prices only canonical receipt evidence and derives legacy signed liability", async () => { — Retain outcome in complete workflow.

### `workers/referral-accrual/referral-accrual.test.ts` — 850 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 201: test(`a failed ${table} insert leaves no partial month across restart`, async () => { — Retain outcome in complete workflow.
- Line 276: test("a lost batch response resumes the already committed file without duplicate accruals", async () => { — Retain outcome in complete workflow.
- Line 316: test(`a ${replacement ? "replaced" : "expired"} lease cannot file stale work`, async () => { — Retain outcome in complete workflow.
- Line 361: test("files each closed month once, in order, with recomputable totals", async () => { — Retain outcome in complete workflow.
- Line 487: test("a late-observed payout joins the month it was observed in", async () => { — Retain outcome in complete workflow.
- Line 504: test("project cap, pool cap, window, hold, ban and asset rules", async () => { — Retain outcome in complete workflow.
- Line 618: test("the wallet is the current authorized claim on the claim chain only", async () => { — Retain outcome in complete workflow.
- Line 649: test("a wallet is pinned once it enters a tree, so a leaf never moves", async () => { — Retain outcome in complete workflow.
- Line 701: test("two accounts on one wallet keep one leaf and the file says which", async () => { — Retain outcome in complete workflow.
- Line 730: test("a held lease blocks a second run and lapses afterwards", async () => { — Retain outcome in complete workflow.
- Line 750: test("only the daily schedule files accruals and the Worker serves no route", async () => { — Retain outcome in complete workflow.
- Line 789: test("lists filed epochs and serves the exact filed bytes", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/appeal.test.ts` — 366 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 11: test("Slopbot queue confirms appeal labels and refuses private or replaced repositories", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/history-registry.test.ts` — 464 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 194: test("ingestion reads existing history through HTTP when registries use different names", async () => { — Retain outcome in complete workflow.
- Line 239: test("history consumers retain registered aliases and reject a different immutable source", async () => { — Retain outcome in complete workflow.
- Line 385: test(`immutable repository identity reads ${kind} across registry names`, async () => { — Retain outcome in complete workflow.
- Line 415: test(`live registered ${kind} remain readable after pause and retirement`, async () => { — Retain outcome in complete workflow.

### `workers/slopbot/maintainer-hold.test.ts` — 687 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 346: test("an uncertain finding waits 7 days for the maintainer, then is labeled once and never closed", async () => { — Retain outcome in complete workflow.
- Line 394: test("a maintainer who acts inside the window keeps the decision; Slopbot adds no label", async () => { — Retain outcome in complete workflow.
- Line 407: test("a label-only finding without cited evidence waits even at high confidence", async () => { — Retain outcome in complete workflow.
- Line 421: test("a pull request converted to draft during the window is not labeled", async () => { — Retain outcome in complete workflow.
- Line 442: test.each([true, false])( — Retain outcome in complete workflow.
- Line 466: test("an upheld appeal supersedes an open maintainer hold and removes slopbot:uncertain after the hold window", async () => { — Retain outcome in complete workflow.
- Line 502: test.each(["timeline", "add"] as const)( — Retain outcome in complete workflow.
- Line 534: test("an upheld appeal removes a hold label added after its issue snapshot", async () => { — Retain outcome in complete workflow.
- Line 564: test("a hold retries an unknown label write against the stored upheld appeal", async () => { — Retain outcome in complete workflow.
- Line 609: test("an appeal retries an unknown label removal without changing its stored decision", async () => { — Retain outcome in complete workflow.
- Line 649: test("a maintainer reopen removes the uncertain label and supersedes a due hold without an appeal", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/penalty-appeal.test.ts` — 1,988 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 795: test(`project closure consent respects the ${boundary} boundary`, async () => { — Retain outcome in complete workflow.
- Line 859: test("fresh project consent and confirmation permit closure without a repository file", async () => { — Retain outcome in complete workflow.
- Line 868: test("a spam close debits 3 thirds once; an accepted uphold draft reopens the item and reverses the debit once", async () => { — Retain outcome in complete workflow.
- Line 959: test("an upheld appeal reopens only Slopbot's own close, never a later maintainer close", async () => { — Retain outcome in complete workflow.
- Line 1019: test("a scam close escalates to a moderator; only a moderator decides, and a denial keeps the debit", async () => { — Retain outcome in complete workflow.
- Line 1073: test("a maintainer reopen upholds an open appeal and removes the finding label, but does not post an upheld comment after a maintainer-denied appeal", async () => { — Retain outcome in complete workflow.
- Line 1127: test("a rejected draft escalates, and an appeal unresolved for 7 days escalates once", async () => { — Retain outcome in complete workflow.
- Line 1165: test("concurrent moderator decisions cannot deny an appeal after its uphold starts reopening the PR", async () => { — Retain outcome in complete workflow.
- Line 1195: test("a retry after an uncertain reopen completes the recorded appeal decision", async () => { — Retain outcome in complete workflow.
- Line 1230: test("a recorded debit reaches the published score once and an upheld appeal restores it", async () => { — Retain outcome in complete workflow.
- Line 1321: test("a reopen and later close keeps the debit in its recorded month", async () => { — Retain outcome in complete workflow.
- Line 1366: test(`an escalated appeal reaches the moderator Inbox and respects ${state} delivery state`, async () => { — Retain outcome in complete workflow.
- Line 1436: test("a scam close writes one moderator account-review notice across replays", async () => { — Retain outcome in complete workflow.
- Line 1512: test("a reversed scam penalty suppresses the pending account-review mail", async () => { — Retain outcome in complete workflow.
- Line 1525: test(`a ${category} close writes no moderator account-review notice`, async () => { — Retain outcome in complete workflow.
- Line 1534: test("a scam notice write failure is recovered after GitHub has closed the item", async () => { — Retain outcome in complete workflow.
- Line 1556: test(`a lost ${stage} comment response reconciles once through the actual queue`, async () => { — Retain outcome in complete workflow.
- Line 1599: test("concurrent deliveries serialize the same appeal stage", async () => { — Retain outcome in complete workflow.
- Line 1624: test("an expired publisher cannot complete or cause its successor to repeat the pending POST", async () => { — Retain outcome in complete workflow.
- Line 1658: test("missing evidence after an uncertain POST stays pending without a duplicate or false success", async () => { — Retain outcome in complete workflow.
- Line 1684: test("unavailable comment history refuses a first POST but remains retryable", async () => { — Retain outcome in complete workflow.
- Line 1702: test(`a confirmed GitHub ${status} rejection allows an authorized appeal retry`, async () => { — Retain outcome in complete workflow.
- Line 1719: test("replaying an old reopen cannot remove a newer head finding", async () => { — Retain outcome in complete workflow.
- Line 1742: test("a delayed bound reopen clears the same-head finding that raced before its marker", async () => { — Retain outcome in complete workflow.
- Line 1760: test("a genuine fresh same-second reopen clears the finding and reverses once", async () => { — Retain outcome in complete workflow.
- Line 1778: test("unknown label DELETE retries preserve one reversal and current maintainer authority", async () => { — Retain outcome in complete workflow.
- Line 1813: test("unsupported legacy reopen and a subsequently closed item make no decision", async () => { — Retain outcome in complete workflow.
- Line 1833: test(`a same-revision reopen wins a concurrent category label (lost response: ${loseResponse})`, async () => { — Retain outcome in complete workflow.
- Line 1861: test("the first delivery of an old-head reopen preserves a newer finding", async () => { — Retain outcome in complete workflow.
- Line 1888: test(`a confirmed same-revision reopen recovers a close already in flight: ${failure}`, async () => { — Retain outcome in complete workflow.
- Line 1931: test(`late-close recovery preserves a subsequent ${later}`, async () => { — Retain outcome in complete workflow.
- Line 1959: test("a reopen that confirms at the first penalty INSERT atomically prevents a new debit", async () => { — Retain outcome in complete workflow.
- Line 1976: test("a delayed genuine reopen reverses the bot close that raced before queue delivery", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/reopen-source.test.ts` — 189 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 87: test("a lost queue response retains the signed source and changed redelivery cannot rebind it", async () => { — Retain outcome in complete workflow.
- Line 129: test("only a confirmed bound receipt can supersede a hold on its exact revision", async () => { — Retain outcome in complete workflow.
- Line 164: test("missing or unsigned reopen evidence cannot enqueue a maintainer decision", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/review-scope.test.ts` — 341 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 259: test("a paused project gets security review only and no contributor-work action", async () => { — Retain outcome in complete workflow.
- Line 275: test("current target comparison replaces stale PR files and stale zero-file metadata", async () => { — Retain outcome in complete workflow.
- Line 284: test("target movement after review prevents even an advisory write", async () => { — Retain outcome in complete workflow.
- Line 323: test("an equal stored digest cannot label a changed original as a duplicate", async () => { — Retain outcome in complete workflow.
- Line 333: test("an unavailable PR cannot be reviewed as an issue without its source", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/spend-alerts.test.ts` — 479 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 56: test("monthly cost ledger sends every crossed $500 milestone once, including failed calls and prior months", async () => { — Retain outcome in complete workflow.
- Line 91: test("ambiguous mail is retained and not resent by the next scheduled invocation", async () => { — Retain outcome in complete workflow.
- Line 108: test("alerts-only inference continues beyond $500 while notices and attempt identity remain enforced", async () => { — Retain outcome in complete workflow.
- Line 151: test("alerts-only migration preserves earlier capped reservations and reconciliations", () => { — Retain outcome in complete workflow.
- Line 200: test("alerts-only route retains unknown fallback costs without a reserve or duplicate call", async () => { — Retain outcome in complete workflow.
- Line 350: test("attempt migration preserves populated children; known alerts-only costs reconcile above old estimates", async () => { — Retain outcome in complete workflow.
- Line 446: test("provider failure mail retains ambiguous delivery without a blind resend", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/value-live-registry.test.ts` — 445 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 87: test(`live registration reaches the consumer; ${change} authority`, async () => { — Retain outcome in complete workflow.
- Line 245: test("old and failing requests cannot starve new valuation requests", async () => { — Retain outcome in complete workflow.
- Line 389: test("scheduler preserves appeal progress when retry dispatch is unavailable", async () => { — Retain outcome in complete workflow.

### `workers/slopbot/webhook-installation.test.ts` — 413 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 235: test("does not replay an older suspend after its committed response was lost", async () => { — Retain outcome in complete workflow.
- Line 252: test("does not let a delayed older suspend replace a newer unsuspend", async () => { — Retain outcome in complete workflow.
- Line 269: test("records a suspend even when the created delivery was missed", async () => { — Retain outcome in complete workflow.
- Line 279: test("accepts GitHub's numeric installation timestamps", async () => { — Retain outcome in complete workflow.
- Line 288: test("orders equivalent ISO timestamp spellings by instant", async () => { — Retain outcome in complete workflow.
- Line 298: test("fails closed when lifecycle events share a source timestamp", async () => { — Retain outcome in complete workflow.
- Line 308: test("does not replay a pre-migration ambiguous delivery", async () => { — Retain outcome in complete workflow.
- Line 327: test("applies a lifecycle event generated during the migration second", async () => { — Retain outcome in complete workflow.
- Line 346: test(`installation ${action} records one owner notice in the webhook transaction`, async () => { — Retain outcome in complete workflow.

### `workers/vetting/acquire.test.ts` — 181 lines

Keep: complete persisted/request/browser/CLI workflow; no whole-file deletion justified.

- Line 133: test("acquires exact real Git objects without checkout, hooks, symlink following or execution", async () => { — Retain outcome in complete workflow.
- Line 167: test("altered blobs, incomplete trees and redirects leave no completed acquisition", async () => { — Retain outcome in complete workflow.

## Explicit workflow and native-contract inventory

- `backend/payments/evm.integration.ts` (2,116 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `backend/security/payments.integration.ts` (2,016 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `backend/security/reporting-readiness.workflow.mjs` (476 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `backend/trace/workflow.mjs` (595 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/evm/adapter.integration.ts` (1,252 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/evm/monthly-reserve.integration.ts` (1,802 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/escrow.e2e.mjs` (3,508 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/executor.e2e.mjs` (1,572 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/keeper.e2e.mjs` (711 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/owner-instructions.e2e.mjs` (351 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/owner-plan.e2e.mjs` (723 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/production-delay.e2e.mjs` (335 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `contracts/solana/integration/token-2022.e2e.mjs` (302 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `scripts/escrow-acceptance/upgrade.integration.ts` (635 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `scripts/payment-keeper/evm.integration.ts` (1,157 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `scripts/value-merge-sdk.workflow.mjs` (280 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `scripts/vetting-assembly-workflow.ts` (510 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `scripts/vetting-evidence-assembly-workflow.ts` (709 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `tests/integration/installer.e2e.ts` (2,712 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/fee-converter/fork.integration.ts` (1,998 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/fee-converter/solana-local.integration.ts` (569 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payment-executor/bind-trigger.integration.ts` (1,111 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payment-executor/binding-cancellation.workflow.mjs` (202 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payment-executor/binding-recovery.workflow.mjs` (182 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payment-executor/bootstrap-workflow.mjs` (454 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payments/reconcile.integration.ts` (341 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payments/recovery.integration.ts` (375 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/payments/registry.integration.ts` (955 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/referral-accrual/anvil.integration.ts` (849 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/vetting-backup/qualification-workflow.mjs` (242 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/vetting-backup/workflow.mjs` (450 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/vetting-flags/workflow.ts` (123 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.
- `workers/vetting-sandbox/workflow.ts` (92 lines): retain real entry-point/local-chain/filesystem/workerd workflow; no evidence supports deletion.

All `contracts/evm/test/*.sol`, `contracts/solana/**/*.rs` test blocks and contract TypeScript tests are retained under the owner’s explicit exception. Operational workflows are not executed or activated merely because they appear in this inventory.

## Expanded baseline execution inventory

- `scripts/staging-release.test.ts`: a verified ancestor can progress while development advances; old guard rejects it — pass, 502.45 ms.
- `scripts/staging-release.test.ts`: a newer attempted deployment prevents rollback regardless of success — pass, 412.63 ms.
- `scripts/staging-release.test.ts`: a newer qualification-only deployment does not block an older release — pass, 600.36 ms.
- `scripts/staging-release.test.ts`: a divergent deployment prevents overwriting unknown staging state — pass, 405.92 ms.
- `scripts/staging-release.test.ts`: a force-pushed development branch cannot authorize an abandoned candidate — pass, 259.95 ms.
- `scripts/staging-release.test.ts`: history pagination cannot hide a newer attempt on the second page — pass, 435.66 ms.
- `scripts/staging-release.test.ts`: unavailable, malformed or unknown deployment provenance fails closed — pass, 681.08 ms.
- `scripts/staging-release.test.ts`: history beyond the bound fails rather than trusting an incomplete scan — pass, 553.40 ms.
- `scripts/staging-release.test.ts`: wrong checkout, repository or branch cannot reach the staging gate — pass, 239.82 ms.
- `scripts/project-registry-api.test.ts`: project registry API > serves a newly approved project at once, purging the cached list — pass, 388.90 ms.
- `scripts/project-registry-api.test.ts`: project registry API > an owner revision publishes at once and appends only its expected revision — pass, 190.00 ms.
- `scripts/project-registry-api.test.ts`: project registry API > owners publish bounty terms and open only with current verified vault funds — pass, 200.50 ms.
- `scripts/project-registry-api.test.ts`: project registry API > reads token decimals from chain once, stores the amount in base units and keeps them on later revisions — pass, 192.39 ms.
- `scripts/project-registry-api.test.ts`: project registry API > refuses an unverifiable or malformed token and stores nothing — pass, 192.77 ms.
- `scripts/project-registry-api.test.ts`: project registry API > refuses a project id too long for its reviewer skill name — pass, 186.55 ms.
- `scripts/project-registry-api.test.ts`: project registry API > refuses activation when historical clean metadata lacks canonical closure — pass, 227.93 ms.
- `scripts/project-registry-api.test.ts`: project registry API > creates a project only for current GitHub authority and refuses contradicted facts — pass, 186.91 ms.
- `scripts/project-registry-api.test.ts`: project registry API > serves the exact approved bytes of a revision — pass, 187.50 ms.
- `scripts/project-registry-api.test.ts`: project registry API > looks up GitHub only for a signed-in visitor and caches the facts — pass, 194.22 ms.
- `scripts/project-registry-api.test.ts`: generated skill publication > an id derived from a long project name renders the reviewer skill — pass, 200.63 ms.
- `scripts/project-registry-api.test.ts`: generated skill publication > historical clean metadata cannot publish skills without canonical closure — pass, 219.29 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > an ordinary ban preserves the owner's project appeal for independent review — pass, 191.37 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > quarantines and bans while refusing an appeal with only historical clean metadata — pass, 291.62 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > a revision of another project cannot claim a banned repository — pass, 192.19 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > a ban closes the public routes of another project listed for the repository — pass, 198.95 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > another project listed for a banned repository can still be retired — pass, 190.56 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > an account-only appeal cannot reinstate the project, while a project appeal can — pass, 187.55 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > reinstatement is refused while the restriction revision is pending — pass, 193.26 ms.
- `scripts/project-registry-api.test.ts`: project enforcement (ADM-06) > a revision fails when a restriction lands after its read — pass, 195.21 ms.
- `scripts/project-registry-api.test.ts`: cached skill and public clearance cannot survive loss of retained evidence — pass, 209.42 ms.
- `scripts/project-registry-api.test.ts`: referral attribution (PRJ-05) > records the referrer once on the created project — pass, 187.65 ms.
- `scripts/project-registry-api.test.ts`: referral attribution (PRJ-05) > a recycled login cannot attribute the applicant to an older cached member — pass, 186.22 ms.
- `scripts/project-registry-api.test.ts`: referral attribution (PRJ-05) > a project that names nobody records no referrer — pass, 187.45 ms.
- `scripts/project-registry-api.test.ts`: referral attribution (PRJ-05) > refuses the applicant, the steward, team accounts and unknown logins — pass, 192.55 ms.
- `scripts/trace-upload-attachable.test.ts`: a second trace for a run is refused at the intent, and its bytes are never written — pass, 8.59 ms.
- `scripts/trace-upload-attachable.test.ts`: an intent issued before another trace attached cannot write its bytes — pass, 3.06 ms.
- `scripts/trace-upload-attachable.test.ts`: an intent issued before finalization cannot write its bytes afterwards — pass, 4.42 ms.
- `scripts/trace-upload-attachable.test.ts`: overlapping different uploads retain only the reserved trace — pass, 3.00 ms.
- `scripts/trace-upload-attachable.test.ts`: a failed storage write retains its reservation and permits a same-byte retry — pass, 4.67 ms.
- `scripts/trace-upload-attachable.test.ts`: an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims — pass, 4.63 ms.
- `scripts/trace-upload-attachable.test.ts`: a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write — pass, 10.52 ms.
- `scripts/vault-setup-network-failure.test.ts`: an unreadable RPC is a retry, while a factory mismatch still refuses — pass, 6.87 ms.
- `scripts/fee-converter-release-preflight.test.ts`: the release stops before upload on an unreviewed Worker secret — pass, 22.44 ms.
- `scripts/fee-converter-release-preflight.test.ts`: the release stops before upload on a network the Worker parser refuses — pass, 26.50 ms.
- `scripts/fee-converter-release-preflight.test.ts`: the release stops before upload on live mode without an enabled network's key — pass, 25.13 ms.
- `scripts/fee-converter-release-preflight.test.ts`: the release continues when every enabled live network has its key — pass, 24.70 ms.
- `scripts/account-sessions.test.ts`: account sessions revoke only the authenticated actor and invalidate the revoked cookie — pass, 3.52 ms.
- `scripts/owner-award-authority.test.ts`: organization maintainers reach private monthly awards through their own session; other actors and transferred repositories do not — pass, 8.04 ms.
- `scripts/identity-maintenance.test.ts`: a failed intake renewal fails the job, preserves evidence, and still cleans expired state — pass, 3.96 ms.
- `scripts/solana-vault-setup-network-failure.test.ts`: an unreadable Solana RPC is a retry, while a program mismatch still refuses — pass, 6.89 ms.
- `scripts/vetting-public-key.test.ts`: release assembly keeps plaintext settings, excludes signing material and reads back each environment's exact public key — pass, 699.81 ms.
- `scripts/release-registry.test.ts`: release carries the checked D1 registry and history into canonical attester setup — pass, 570.84 ms.
- `scripts/contributor-template-identity.test.ts`: ordinary attribution uses the Slop marker unless the target repository requires its legacy one — pass, 61.20 ms.
- `scripts/vetting-queue.test.ts`: signed real queue and SQLite revision acquire exact Git and template bytes without finishing assessment — pass, 6.55 ms.
- `scripts/vetting-queue.test.ts`: changed revision/template bytes and wrong signer leave queue pending and no completed bundle — pass, 3.74 ms.
- `scripts/project-self-service.test.ts`: a new project cannot reuse a listed project id or repository — pass, 3.30 ms.
- `scripts/project-self-service.test.ts`: an admin revision still replaces the listed project with that id — pass, 4.12 ms.
- `scripts/project-self-service.test.ts`: creation requires the Slopbot installation, then queues the first scan and returns one status — pass, 2.95 ms.
- `scripts/project-self-service.test.ts`: setup activates a project only with installation write access and a clean scan — pass, 6.75 ms.
- `scripts/project-self-service.test.ts`: an owner records and revokes explicit closure consent with current authority and immutable revisions — pass, 5.96 ms.
- `scripts/project-self-service.test.ts`: owner revisions publish presentation at once, rescan skill inputs and apply money prospectively — pass, 6.88 ms.
- `scripts/project-self-service.test.ts`: an owner revision cannot record a vault; a reviewed admin revision can — pass, 3.79 ms.
- `scripts/project-self-service.test.ts`: a payout exclusion starts with the next UTC month on every revision path — pass, 8.33 ms.
- `scripts/project-self-service.test.ts`: an application stored before self-service setup publishes once, by its applicant — pass, 3.02 ms.
- `scripts/project-self-service.test.ts`: an explicit moderator ban blocks new contribution intake without blaming the original applicant — pass, 10.81 ms.
- `scripts/project-self-service.test.ts`: account-ban appeals after project appeal or reinstatement resolve role, refusal and independent reviewer notices — pass, 8.10 ms.
- `scripts/project-self-service.test.ts`: a concurrent project appeal refuses the stale account request and a fresh retry uses the account role — pass, 7.02 ms.
- `scripts/project-self-service.test.ts`: denying the project appeal leaves a banned account's appeal for its own decision — pass, 5.48 ms.
- `scripts/project-self-service.test.ts`: an open account appeal survives later project restrictions and needs an independent account reviewer for each decision — pass, 13.04 ms.
- `scripts/project-self-service.test.ts`: a malicious decision that closes a kept project appeal needs an independent moderator while an account appeal is open — pass, 5.48 ms.
- `scripts/project-self-service.test.ts`: an account release leaves the kept project appeal for an independent malicious decision — pass, 6.64 ms.
- `scripts/project-self-service.test.ts`: a banned owner or moderator separates its project appeal from its account appeal in both filing orders — pass, 10.71 ms.
- `scripts/project-self-service.test.ts`: account-reinstatement upgrade preserves prior releases and separates future project decisions — pass, 43.22 ms.
- `scripts/project-self-service.test.ts`: a ban issued during vault verification blocks the owner revision — pass, 6.80 ms.
- `scripts/project-self-service.test.ts`: a ban issued during owner update blocks the owner revision — pass, 4.69 ms.
- `scripts/project-self-service.test.ts`: only the steward or a repository admin can register the project vault — pass, 4.67 ms.
- `scripts/project-self-service.test.ts`: a ban issued during the authority check prevents automatic activation — pass, 4.44 ms.
- `scripts/project-self-service.test.ts`: an account-page appeal from a banned owner survives reload without opening a project appeal — pass, 6.88 ms.
- `scripts/vetting-scan-flags.test.ts`: automatic scan and activation > a clean supported scan lets activation proceed without an admin scan request — pass, 228.64 ms.
- `scripts/vetting-scan-flags.test.ts`: automatic scan and activation > changed executable content is rescanned; identical content reuses the cached scan — pass, 221.65 ms.
- `scripts/vetting-scan-flags.test.ts`: automatic scan and activation > an incomplete or legacy result never clears — pass, 207.05 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > two distinct flags pause atomically with one moderator notice; a clean fresh scan reinstates — pass, 241.00 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > a flag filed during a scan waits for a newer scan (offset 0) — pass, 244.90 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > a flag filed during a scan waits for a newer scan (offset 30000) — pass, 241.95 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > withdrawn flags stop counting and owners cannot flag — pass, 216.34 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > only established contributors outside the project may flag — pass, 225.77 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > a flag stops counting 90 days after it was filed — pass, 214.89 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > a confirmed malicious result after a flag pause stays with a moderator — pass, 236.82 ms.
- `scripts/vetting-scan-flags.test.ts`: two-contributor flags > the database refuses a flag pause without two distinct active reporters — pass, 210.24 ms.
- `scripts/vetting-scan-flags.test.ts`: a banned account cannot add a flag but can withdraw its earlier flag — pass, 211.46 ms.
- `scripts/vetting-scan-flags.test.ts`: a concurrent account ban cannot supply the flag that pauses another project — pass, 214.59 ms.
- `scripts/vetting-scan-flags.test.ts`: the existing-project exemption is permanent but cannot clear reinstatement or later projects — pass, 268.02 ms.
- `scripts/vetting-scan-flags.test.ts`: an exempt owner edit stays active without a scan, while flags still require fresh reinstatement — pass, 379.62 ms.
- `scripts/vetting-scan-flags.test.ts`: a non-exempt owner executable edit still pauses and queues its new content — pass, 207.73 ms.
- `scripts/vetting-scan-flags.test.ts`: withdrawing a flag after the 90-day lifetime expires it by lifetime and returns 404 — pass, 213.02 ms.
- `scripts/vetting-scan-flags.test.ts`: a cached scan from before a two-flag pause is refused and cannot reinstate the project — pass, 215.41 ms.
- `scripts/vetting-scan-flags.test.ts`: a completed scan for a superseded commit pin records without lifting a flag pause until the live pin is scanned — pass, 234.75 ms.
- `scripts/vetting-scan-flags.test.ts`: a live-pin outage while a fresh clean scan lands defers the flag reinstatement to the next refresh — pass, 235.08 ms.
- `scripts/wallet-possession.test.ts`: wallet possession challenge window > refuses an expired challenge re-signed over a later window — pass, 11.88 ms.
- `scripts/wallet-possession.test.ts`: wallet possession challenge window > refuses a live challenge signed over a shifted window — pass, 6.17 ms.
- `scripts/wallet-possession.test.ts`: wallet possession challenge window > records a proof over the window the server issued — pass, 3.94 ms.
- `scripts/account-closure.test.ts`: closing an account ends every session, removes optional connections and keeps records — pass, 7.63 ms.
- `scripts/account-closure.test.ts`: a closed account signs in again only through an explicit reopen — pass, 3.73 ms.
- `scripts/account-closure.test.ts`: closure needs a signed-in session and a same-origin JSON request, and a repeat is safe — pass, 2.97 ms.
- `scripts/account-closure.test.ts`: retired Telegram routes reveal no links and preserve historical records — pass, 2.91 ms.
- `scripts/skill-source-matches-commit.test.ts`: batched skill provenance keeps exact binary bytes and tree inventory — pass, 119.34 ms.
- `scripts/vetting-publication-journal.test.ts`: a restarted controller preserves an intent even when its reservation reply is lost — pass, 0.83 ms.
- `scripts/vetting-publication-journal.test.ts`: only one concurrent controller can reserve a publication and its metadata stays immutable — pass, 0.29 ms.
- `scripts/vetting-publication-journal.test.ts`: a receipt must match the reserved result and remains exactly once — pass, 0.35 ms.
- `scripts/quality-payment-ledger.test.ts`: 2026-10 quality evidence follows the payment review ledger > prepare-contribution-quality builds evidence from the payment review ledger — pass, 152.95 ms.
- `scripts/quality-payment-ledger.test.ts`: 2026-10 quality evidence follows the payment review ledger > source correction accepts that evidence and refuses to recover the removed review — pass, 659.81 ms.
- `scripts/quality-payment-ledger.test.ts`: 2026-10 quality evidence follows the payment review ledger > source correction refuses to recover a review only the payment review ledger credits — pass, 434.14 ms.
- `scripts/quality-payment-ledger.test.ts`: pre-2026-10 quality evidence keeps the score ledger > prepare-contribution-quality accepts the archived September cycle — pass, 131.26 ms.
- `scripts/vetting-api.test.ts`: community security vetting > the trusted publisher journals one signed intake attempt — pass, 227.12 ms.
- `scripts/vetting-api.test.ts`: community security vetting > a signed clean claim without canonical closure cannot activate the revision — pass, 226.15 ms.
- `scripts/vetting-api.test.ts`: community security vetting > the queue binds commits and templates without accepting an unsupported clean claim — pass, 238.92 ms.
- `scripts/vetting-api.test.ts`: community security vetting > an incomplete result quarantines the revision and blocks activation — pass, 217.73 ms.
- `scripts/vetting-api.test.ts`: community security vetting > an unavailable model review can never produce a clean result — pass, 220.79 ms.
- `scripts/vetting-api.test.ts`: community security vetting > confirmed malice bans the project; a model label alone cannot — pass, 223.25 ms.
- `scripts/vetting-api.test.ts`: community security vetting > forged, stale, mismatched and unconfigured requests fail closed — pass, 257.29 ms.
- `scripts/vetting-api.test.ts`: private retained bytes remain inspectable without granting clean clearance — pass, 254.87 ms.
- `scripts/vetting-api.test.ts`: a clean result cannot omit a referenced retained artifact or replace an immutable inventory — pass, 222.88 ms.
- `scripts/vetting-api.test.ts`: historical metadata-only clean results have no retained-evidence exemption — pass, 195.53 ms.
- `scripts/vetting-api.test.ts`: missing storage pauses acquisition while harmless queue registration remains available — pass, 195.33 ms.
- `scripts/vetting-api.test.ts`: large retained evidence uses bounded chunks, immutable completion and actor-bound native downloads — pass, 2961.30 ms.
- `scripts/points-import.test.ts`: points publication retains the exact permanent history prefix — pass, 98.19 ms.
- `scripts/points-import.test.ts`: a staged coverage list is served whole and an incomplete one publishes nothing — pass, 29.67 ms.
- `scripts/points-import.test.ts`: journal reads select the complete prefix before generation-time tie breakers — pass, 19.10 ms.
- `scripts/points-import.test.ts`: member lookups fail closed when a stale public login collides with a private member — pass, 3.41 ms.
- `scripts/points-import.test.ts`: X-connection awards recorded from 24 October 2026 report no points — pass, 2.10 ms.
- `scripts/payout-exclusion.test.ts`: an excluded owner keeps the score, receives nothing, and the other share is not reduced — pass, 9.69 ms.
- `scripts/prepare-monthly-rewards.test.ts`: a month's proposal is stored once; a later ledger never adds or replaces rows — pass, 130.72 ms.
- `scripts/collect-quality-census.test.ts`: collect-quality-census covers the preparation period > a mid-month reward start excludes earlier closures and the census reconciles — pass, 1115.47 ms.
- `scripts/collect-quality-census.test.ts`: collect-quality-census covers the preparation period > a month before the project's reward start is refused — pass, 23.22 ms.
- `scripts/project-application-github-check.test.ts`: an owner whose write access Slopbot reads creates the project at once — pass, 8.31 ms.
- `scripts/project-application-github-check.test.ts`: no project is created when Slopbot reads missing — pass, 2.53 ms.
- `scripts/project-application-github-check.test.ts`: no project is created when Slopbot reads suspended — pass, 2.02 ms.
- `scripts/project-application-github-check.test.ts`: no project is created when Slopbot reads read access — pass, 1.92 ms.
- `scripts/project-application-github-check.test.ts`: no project is created when Slopbot reads unbound Slopbot — pass, 1.85 ms.
- `scripts/project-application-github-check.test.ts`: a new project lists exactly one repository — pass, 1.78 ms.
- `scripts/project-application-github-check.test.ts`: every listed repository must be a public GitHub repository — pass, 0.28 ms.
- `scripts/project-application-github-check.test.ts`: an alias must lead to the repository it names — pass, 4.68 ms.
- `scripts/project-application-github-check.test.ts`: a check names at most 5 repositories and aliases — pass, 0.24 ms.
- `scripts/project-application-github-check.test.ts`: publishing a stored application rechecks its alias facts: unchanged — pass, 2.77 ms.
- `scripts/project-application-github-check.test.ts`: publishing a stored application rechecks its alias facts: changed — pass, 2.09 ms.
- `scripts/project-application-github-check.test.ts`: publishing a stored application rechecks its alias facts: unavailable — pass, 1.97 ms.
- `scripts/project-application-github-check.test.ts`: the repository owner is accepted as steward in any login case, from the App response alone — pass, 3.21 ms.
- `scripts/project-application-github-check.test.ts`: another account's login with the owner's id is refused — pass, 2.23 ms.
- `scripts/project-application-github-check.test.ts`: another account's node id with the owner's id is refused — pass, 1.96 ms.
- `scripts/project-application-github-check.test.ts`: a project cannot claim a different GitHub owner account type — pass, 1.95 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses old Worker reply from the App — pass, 2.01 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses private repository from the App — pass, 1.98 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses recreated repository from the App — pass, 2.19 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses changed repository node from the App — pass, 1.96 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses different owner from the App — pass, 1.88 ms.
- `scripts/project-application-github-check.test.ts`: an owner write refuses changed owner node from the App — pass, 2.17 ms.
- `scripts/cycle-index-review-excluded.test.ts`: cycle index review window > the sync script accepts an excluded row end to end — pass, 1106.38 ms.
- `scripts/vetting-scan-service.test.ts`: a provider outage leaves the scan pending; the next pass clears the project with one Surplus review — pass, 388.01 ms.
- `scripts/vetting-scan-service.test.ts`: an ambiguous primary review runs the Surplus specialist once before publication — pass, 341.91 ms.
- `scripts/vetting-scan-service.test.ts`: a failed specialist is a service failure: nothing is published and the scan retries — pass, 309.25 ms.
- `scripts/vetting-scan-service.test.ts`: a clean result is never published without its retained evidence; the next pass retries — pass, 385.86 ms.
- `scripts/vetting-scan-service.test.ts`: an incomplete result is published although the evidence store fails, so the models are not called again — pass, 341.88 ms.
- `scripts/vetting-scan-service.test.ts`: malicious-code detection: risky new content is flagged, escalated to the specialist and kept quarantined — pass, 441.05 ms.
- `scripts/vetting-scan-service.test.ts`: a two-flag pause is reinstated automatically after the service's clean fresh scan — pass, 393.50 ms.
- `scripts/vetting-scan-service.test.ts`: an unpinned endpoint or model fails closed before the queue or any provider is contacted — pass, 244.42 ms.
- `scripts/vetting-scan-service.test.ts`: unsupported artifacts produce an incomplete scan rather than aborting the scan pass — pass, 1361.65 ms.
- `scripts/legacy-repository-registry.test.ts`: a project for a legacy repository must reuse its historical id — pass, 4.90 ms.
- `scripts/historical-cycle-registry.test.ts`: a frozen owner proposal survives registry copy and primary changes — pass, 1873.86 ms.
- `scripts/terms-preflight.test.ts`: acknowledges the terms.json slop.cash serves for a project without a bounty program — pass, 0.75 ms.
- `scripts/terms-preflight.test.ts`: acknowledges public security bounty terms and a policy served before them — pass, 0.37 ms.
- `scripts/terms-preflight.test.ts`: still refuses unexpected policy fields and malformed bounty terms — pass, 0.50 ms.
- `scripts/enrich-contribution-quality.test.ts`: all merge-credit actors receive diff evidence without a false duplicate group — pass, 15.12 ms.
- `scripts/enrich-contribution-quality.test.ts`: inspection failures remain visible for every merge-credit actor — pass, 27.22 ms.
- `scripts/enrich-contribution-quality.test.ts`: matching patches on different PRs flag every actor once — pass, 13.58 ms.
- `scripts/quality-external-evaluation.test.ts`: payment quality evidence for an external evaluated contribution > prepare-contribution-quality keeps the award as an evaluation — pass, 24.57 ms.
- `workers/notify/security.test.ts`: a case change queues once, sends generic per-role mail once, and needs explicit recipient acknowledgment — pass, 7.18 ms.
- `workers/notify/security.test.ts`: a report receipt is mailed generically and never escalates for a missing acknowledgment — pass, 4.46 ms.
- `workers/notify/security.test.ts`: ambiguous transport never resends until independent non-acceptance evidence; failures reach only an authorized backup — pass, 4.03 ms.
- `workers/notify/security.test.ts`: role revocation suppresses queued mail; missing verified destinations exhaust bounded retries without losing the case — pass, 3.70 ms.
- `workers/notify/security.test.ts`: backup notices have a durable inbox row and their own authenticated acknowledgment — pass, 5.24 ms.
- `workers/notify/security.test.ts`: already escalated history cannot starve a later overdue notice — pass, 29.09 ms.
- `workers/notify/security.test.ts`: pre-pilot inbox history is not mailed and does not expose a dead acknowledgment action — pass, 81.37 ms.
- `workers/notify/security.test.ts`: a negative receipt cannot reconcile a later attempt or append duplicate evidence — pass, 4.68 ms.
- `workers/notify/security.test.ts`: concurrent copies of one provider receipt append one delivery event — pass, 3.01 ms.
- `workers/payment-executor/wallet-rotation.test.ts`: rotates after the award was paid by the attempt's own transaction — pass, 7.57 ms.
- `workers/payment-executor/wallet-rotation.test.ts`: rotates after a paid award whose attempt lost its executor response — pass, 4.03 ms.
- `workers/payment-executor/wallet-rotation.test.ts`: rotates after a paid award whose attempt was outpaid by another transaction — pass, 3.89 ms.
- `workers/payment-executor/wallet-rotation.test.ts`: still holds the rotation while an unpaid award's attempt is uncertain — pass, 3.54 ms.
- `workers/slopbot/appeal.test.ts`: Slopbot queue confirms appeal labels and refuses private or replaced repositories — pass, 59.53 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > does not replay an older suspend after its committed response was lost — pass, 80.06 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > does not let a delayed older suspend replace a newer unsuspend — pass, 77.43 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > records a suspend even when the created delivery was missed — pass, 77.76 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > accepts GitHub's numeric installation timestamps — pass, 78.07 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > orders equivalent ISO timestamp spellings by instant — pass, 77.16 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > fails closed when lifecycle events share a source timestamp — pass, 77.47 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > does not replay a pre-migration ambiguous delivery — pass, 87.50 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation webhook delivery > applies a lifecycle event generated during the migration second — pass, 83.86 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation suspend records one owner notice in the webhook transaction — pass, 82.96 ms.
- `workers/slopbot/webhook-installation.test.ts`: installation deleted records one owner notice in the webhook transaction — pass, 81.40 ms.
- `workers/slopbot/spend-alerts.test.ts`: monthly cost ledger sends every crossed $500 milestone once, including failed calls and prior months — pass, 2.91 ms.
- `workers/slopbot/spend-alerts.test.ts`: ambiguous mail is retained and not resent by the next scheduled invocation — pass, 0.39 ms.
- `workers/slopbot/spend-alerts.test.ts`: alerts-only inference continues beyond $500 while notices and attempt identity remain enforced — pass, 0.75 ms.
- `workers/slopbot/spend-alerts.test.ts`: alerts-only migration preserves earlier capped reservations and reconciliations — pass, 0.52 ms.
- `workers/slopbot/spend-alerts.test.ts`: alerts-only route retains unknown fallback costs without a reserve or duplicate call — pass, 6.83 ms.
- `workers/slopbot/spend-alerts.test.ts`: attempt migration preserves populated children; known alerts-only costs reconcile above old estimates — pass, 1.99 ms.
- `workers/slopbot/spend-alerts.test.ts`: provider failure mail retains ambiguous delivery without a blind resend — pass, 0.44 ms.
- `workers/slopbot/history-registry.test.ts`: ingestion reads existing history through HTTP when registries use different names — pass, 5.88 ms.
- `workers/slopbot/history-registry.test.ts`: history consumers retain registered aliases and reject a different immutable source — pass, 7.13 ms.
- `workers/slopbot/history-registry.test.ts`: immutable repository identity reads value-assessments across registry names — pass, 6.46 ms.
- `workers/slopbot/history-registry.test.ts`: live registered value-assessments remain readable after pause and retirement — pass, 5.96 ms.
- `workers/slopbot/history-registry.test.ts`: immutable repository identity reads work-unit-assessments across registry names — pass, 4.52 ms.
- `workers/slopbot/history-registry.test.ts`: live registered work-unit-assessments remain readable after pause and retirement — pass, 5.24 ms.
- `workers/slopbot/history-registry.test.ts`: live registered penalties remain readable after pause and retirement — pass, 4.41 ms.
- `workers/slopbot/review-scope.test.ts`: a paused project gets security review only and no contributor-work action — pass, 18.94 ms.
- `workers/slopbot/review-scope.test.ts`: current target comparison replaces stale PR files and stale zero-file metadata — pass, 9.86 ms.
- `workers/slopbot/review-scope.test.ts`: target movement after review prevents even an advisory write — pass, 9.92 ms.
- `workers/slopbot/review-scope.test.ts`: missing source cannot reach a model or GitHub action — pass, 5.62 ms.
- `workers/slopbot/review-scope.test.ts`: saturated source cannot reach a model or GitHub action — pass, 6.08 ms.
- `workers/slopbot/review-scope.test.ts`: wrong-repo source cannot reach a model or GitHub action — pass, 5.68 ms.
- `workers/slopbot/review-scope.test.ts`: unavailable source cannot reach a model or GitHub action — pass, 5.37 ms.
- `workers/slopbot/review-scope.test.ts`: wrong-comparison source cannot reach a model or GitHub action — pass, 5.46 ms.
- `workers/slopbot/review-scope.test.ts`: an equal stored digest cannot label a changed original as a duplicate — pass, 9.72 ms.
- `workers/slopbot/review-scope.test.ts`: an unavailable PR cannot be reviewed as an issue without its source — pass, 5.19 ms.
- `workers/slopbot/reopen-source.test.ts`: a lost queue response retains the signed source and changed redelivery cannot rebind it — pass, 4.10 ms.
- `workers/slopbot/reopen-source.test.ts`: only a confirmed bound receipt can supersede a hold on its exact revision — pass, 2.41 ms.
- `workers/slopbot/reopen-source.test.ts`: missing or unsigned reopen evidence cannot enqueue a maintainer decision — pass, 2.23 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an uncertain finding waits 7 days for the maintainer, then is labeled once and never closed — pass, 15.54 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a maintainer who acts inside the window keeps the decision; Slopbot adds no label — pass, 12.39 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a label-only finding without cited evidence waits even at high confidence — pass, 9.27 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a pull request converted to draft during the window is not labeled — pass, 11.47 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a due hold rechecks substantive source after a target advance (changed=%s) — pass, 11.01 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a due hold rechecks substantive source after a target advance (changed=%s) — pass, 11.76 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an upheld appeal supersedes an open maintainer hold and removes slopbot:uncertain after the hold window — pass, 38.83 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an appeal upheld during the hold's timeline request leaves no uncertain label — pass, 18.22 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an appeal upheld during the hold's add request leaves no uncertain label — pass, 20.34 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an upheld appeal removes a hold label added after its issue snapshot — pass, 19.08 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a hold retries an unknown label write against the stored upheld appeal — pass, 20.97 ms.
- `workers/slopbot/maintainer-hold.test.ts`: an appeal retries an unknown label removal without changing its stored decision — pass, 20.41 ms.
- `workers/slopbot/maintainer-hold.test.ts`: a maintainer reopen removes the uncertain label and supersedes a due hold without an appeal — pass, 29.96 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the absent boundary — pass, 12.70 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the revoked boundary — pass, 11.92 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the during confirmation boundary — pass, 9.68 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the production off boundary — pass, 9.37 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the file off boundary — pass, 10.15 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the category off boundary — pass, 6.98 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the invalid file boundary — pass, 9.23 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the truncated file boundary — pass, 11.34 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the non-file boundary — pass, 10.17 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the unreadable file boundary — pass, 12.95 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the redirect boundary — pass, 13.18 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the empty success boundary — pass, 10.72 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the forbidden boundary — pass, 5.82 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the rate limited boundary — pass, 4.69 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the server failure boundary — pass, 4.92 ms.
- `workers/slopbot/penalty-appeal.test.ts`: project closure consent respects the malformed response boundary — pass, 4.69 ms.
- `workers/slopbot/penalty-appeal.test.ts`: fresh project consent and confirmation permit closure without a repository file — pass, 15.80 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a spam close debits 3 thirds once; an accepted uphold draft reopens the item and reverses the debit once — pass, 30.39 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an upheld appeal reopens only Slopbot's own close, never a later maintainer close — pass, 53.94 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a scam close escalates to a moderator; only a moderator decides, and a denial keeps the debit — pass, 29.50 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a maintainer reopen upholds an open appeal and removes the finding label, but does not post an upheld comment after a maintainer-denied appeal — pass, 52.05 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a rejected draft escalates, and an appeal unresolved for 7 days escalates once — pass, 52.03 ms.
- `workers/slopbot/penalty-appeal.test.ts`: concurrent moderator decisions cannot deny an appeal after its uphold starts reopening the PR — pass, 25.23 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a retry after an uncertain reopen completes the recorded appeal decision — pass, 25.79 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a recorded debit reaches the published score once and an upheld appeal restores it — pass, 30.23 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a reopen and later close keeps the debit in its recorded month — pass, 19.05 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an escalated appeal reaches the moderator Inbox and respects active delivery state — pass, 23.56 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an escalated appeal reaches the moderator Inbox and respects revoked delivery state — pass, 23.96 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an escalated appeal reaches the moderator Inbox and respects resolved delivery state — pass, 23.38 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an escalated appeal reaches the moderator Inbox and respects opted-out delivery state — pass, 23.47 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a scam close writes one moderator account-review notice across replays — pass, 19.54 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a reversed scam penalty suppresses the pending account-review mail — pass, 20.24 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a spam close writes no moderator account-review notice — pass, 17.99 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a duplicate close writes no moderator account-review notice — pass, 16.00 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a scam notice write failure is recovered after GitHub has closed the item — pass, 22.37 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a lost draft comment response reconciles once through the actual queue — pass, 27.55 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a lost escalation comment response reconciles once through the actual queue — pass, 25.56 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a lost resolution comment response reconciles once through the actual queue — pass, 26.27 ms.
- `workers/slopbot/penalty-appeal.test.ts`: concurrent deliveries serialize the same appeal stage — pass, 21.79 ms.
- `workers/slopbot/penalty-appeal.test.ts`: an expired publisher cannot complete or cause its successor to repeat the pending POST — pass, 23.32 ms.
- `workers/slopbot/penalty-appeal.test.ts`: missing evidence after an uncertain POST stays pending without a duplicate or false success — pass, 22.82 ms.
- `workers/slopbot/penalty-appeal.test.ts`: unavailable comment history refuses a first POST but remains retryable — pass, 23.30 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 401 rejection allows an authorized appeal retry — pass, 21.31 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 403 rejection allows an authorized appeal retry — pass, 22.41 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 404 rejection allows an authorized appeal retry — pass, 20.17 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 410 rejection allows an authorized appeal retry — pass, 21.54 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 422 rejection allows an authorized appeal retry — pass, 20.36 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed GitHub 429 rejection allows an authorized appeal retry — pass, 20.46 ms.
- `workers/slopbot/penalty-appeal.test.ts`: replaying an old reopen cannot remove a newer head finding — pass, 23.19 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a delayed bound reopen clears the same-head finding that raced before its marker — pass, 11.59 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a genuine fresh same-second reopen clears the finding and reverses once — pass, 21.60 ms.
- `workers/slopbot/penalty-appeal.test.ts`: unknown label DELETE retries preserve one reversal and current maintainer authority — pass, 33.50 ms.
- `workers/slopbot/penalty-appeal.test.ts`: unsupported legacy reopen and a subsequently closed item make no decision — pass, 24.11 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a same-revision reopen wins a concurrent category label (lost response: false) — pass, 19.13 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a same-revision reopen wins a concurrent category label (lost response: true) — pass, 21.80 ms.
- `workers/slopbot/penalty-appeal.test.ts`: the first delivery of an old-head reopen preserves a newer finding — pass, 12.66 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed same-revision reopen recovers a close already in flight: none — pass, 21.26 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed same-revision reopen recovers a close already in flight: close response — pass, 20.50 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed same-revision reopen recovers a close already in flight: reopen response — pass, 20.79 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a confirmed same-revision reopen recovers a close already in flight: closer evidence — pass, 22.72 ms.
- `workers/slopbot/penalty-appeal.test.ts`: late-close recovery preserves a subsequent human close — pass, 17.58 ms.
- `workers/slopbot/penalty-appeal.test.ts`: late-close recovery preserves a subsequent new head — pass, 17.84 ms.
- `workers/slopbot/penalty-appeal.test.ts`: late-close recovery preserves a subsequent merged — pass, 17.21 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a reopen that confirms at the first penalty INSERT atomically prevents a new debit — pass, 18.20 ms.
- `workers/slopbot/penalty-appeal.test.ts`: a delayed genuine reopen reverses the bot close that raced before queue delivery — pass, 18.38 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; none authority — pass, 5.68 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; removed authority — pass, 2.66 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; paused authority — pass, 2.55 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; restricted authority — pass, 2.40 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; identity authority — pass, 3.04 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; deselected authority — pass, 5.31 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; september authority — pass, 2.91 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; october authority — pass, 2.67 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; early-api-override authority — pass, 2.36 ms.
- `workers/slopbot/value-live-registry.test.ts`: live registration reaches the consumer; notice-failed authority — pass, 3.57 ms.
- `workers/slopbot/value-live-registry.test.ts`: old and failing requests cannot starve new valuation requests — pass, 99.22 ms.
- `workers/slopbot/value-live-registry.test.ts`: scheduler preserves appeal progress when retry dispatch is unavailable — pass, 2.33 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a failed referral_accruals insert leaves no partial month across restart — pass, 316.51 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a failed referral_accrual_files insert leaves no partial month across restart — pass, 368.52 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a failed referral_claim_wallets insert leaves no partial month across restart — pass, 308.57 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a lost batch response resumes the already committed file without duplicate accruals — pass, 297.01 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a expired lease cannot file stale work — pass, 3.57 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: atomic monthly filing and restart > a replaced lease cannot file stale work — pass, 2.64 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > files each closed month once, in order, with recomputable totals — pass, 3.41 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > a late-observed payout joins the month it was observed in — pass, 2.39 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > project cap, pool cap, window, hold, ban and asset rules — pass, 5.15 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > the wallet is the current authorized claim on the claim chain only — pass, 4.47 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > a wallet is pinned once it enters a tree, so a leaf never moves — pass, 3.89 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > two accounts on one wallet keep one leaf and the file says which — pass, 2.26 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > a held lease blocks a second run and lapses afterwards — pass, 2.37 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: one accrual run > only the daily schedule files accruals and the Worker serves no route — pass, 2.78 ms.
- `workers/referral-accrual/referral-accrual.test.ts`: public accrual route > lists filed epochs and serves the exact filed bytes — pass, 2.31 ms.
- `workers/referral-accrual/poster.test.ts`: posting the next root > posts the earliest filed root the chain lacks, after reconciling — pass, 3.87 ms.
- `workers/referral-accrual/poster.test.ts`: posting the next root > refuses while a root is pending, paused, or the chain disagrees — pass, 2.34 ms.
- `workers/referral-accrual/poster.test.ts`: posting the next root > prechecks the cap, the shrink rule and the funding before signing — pass, 3.41 ms.
- `workers/referral-accrual/poster.test.ts`: posting the next root > a failed broadcast leaves the signed bytes to resend unchanged — pass, 2.63 ms.
- `workers/referral-accrual/poster.test.ts`: posting the next root > an owner void halts posting until the operator acknowledges it — pass, 2.70 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_hash cannot close a migrated journal — pass, 7.70 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_block cannot close a migrated journal — pass, 3.55 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_index cannot close a migrated journal — pass, 3.27 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > no_event cannot close a migrated journal — pass, 3.98 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_event_block cannot close a migrated journal — pass, 3.87 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_total cannot close a migrated journal — pass, 5.68 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > noncanonical_revert cannot close a migrated journal — pass, 3.71 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > wrong_chain cannot close a migrated journal — pass, 2.69 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > missing receipt and advanced nonce stay held without a new send — pass, 4.21 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > nonfinal void holds, disappears safely, and only canonical final void is permanent — pass, 8.05 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > configuration change refuses before RPC or stored broadcast — pass, 2.59 ms.
- `workers/referral-accrual/poster.test.ts`: canonical poster journal through actual client > actual transport error cannot put signed bytes into a diagnostic; wrong returned hash refuses — pass, 154.88 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > actual quote over the cap never invokes the account signer or broadcast — pass, 2.24 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > unknown sends retain one reservation across midnight and unchanged rebroadcast — pass, 2.46 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > reverted costs consume the receipt UTC day's budget and release only later-day capacity — pass, 2.21 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > overlapping quotes cannot commit or broadcast two native liabilities — pass, 2.09 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > lower transaction cap refuses before signing or any journal reservation — pass, 1.83 ms.
- `workers/referral-accrual/poster.test.ts`: durable referral native fee budgets > actual client prices only canonical receipt evidence and derives legacy signed liability — pass, 4.54 ms.
- `workers/vetting/acquire.test.ts`: acquires exact real Git objects without checkout, hooks, symlink following or execution — pass, 25.99 ms.
- `workers/vetting/acquire.test.ts`: altered blobs, incomplete trees and redirects leave no completed acquisition — pass, 9.53 ms.
- `workers/fee-converter/native-gas.test.ts`: missing native limits refuse before the Worker reads its key — pass, 0.78 ms.
- `workers/fee-converter/native-gas.test.ts`: exact-wei reservations serialize competing attempts and preserve liability across midnight — pass, 3.52 ms.
- `workers/fee-converter/native-gas.test.ts`: a successor retires only uncommitted reservations; stale signed commits roll back — pass, 4.35 ms.
- `workers/fee-converter/native-gas.test.ts`: a wrong signature or duplicate reservation cannot create a durable send — pass, 3.81 ms.
- `workers/fee-converter/native-gas.test.ts`: same-nonce replacements reserve their maximum once and settle exactly one winner — pass, 4.06 ms.
- `workers/fee-converter/native-gas.test.ts`: unavailable receipts retain gas until the canonical cost is recovered — pass, 5.41 ms.
- `workers/fee-converter/native-gas.test.ts`: business failure and router expiry do not release signed gas; overruns hold future signing — pass, 7.51 ms.
- `workers/fee-converter/native-gas.test.ts`: legacy approval and swap hashes both enter accounting with independently proved nonces — pass, 2.11 ms.
- `workers/fee-converter/native-gas.test.ts`: legacy hash-only liability requires the original signed transaction: complete — pass, 3.41 ms.
- `workers/fee-converter/native-gas.test.ts`: legacy hash-only liability requires the original signed transaction: changed-fee — pass, 2.38 ms.
- `workers/fee-converter/native-gas.test.ts`: legacy hash-only liability requires the original signed transaction: missing-signature — pass, 2.23 ms.
- `workers/fee-converter/native-gas.test.ts`: actual signer preparation enforces final fee bounds: allowed — pass, 4.06 ms.
- `workers/fee-converter/native-gas.test.ts`: actual signer preparation enforces final fee bounds: transaction — pass, 2.13 ms.
- `workers/fee-converter/native-gas.test.ts`: actual signer preparation enforces final fee bounds: day — pass, 3.06 ms.
- `workers/fee-converter/native-gas.test.ts`: actual signer preparation enforces final fee bounds: value — pass, 2.05 ms.
- `workers/fee-converter/native-gas.test.ts`: actual signer preparation enforces final fee bounds: base-allowance — pass, 2.27 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: success — pass, 3.67 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: reverted — pass, 3.67 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: not-canonical — pass, 2.97 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: missing-transaction — pass, 3.39 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: base-complete — pass, 3.69 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: base-missing-data — pass, 3.27 ms.
- `workers/fee-converter/native-gas.test.ts`: actual adapter reconciles native cost only with canonical complete evidence: base-missing-operator — pass, 3.83 ms.
- `workers/fee-converter/native-gas.test.ts`: Solana signed costs share the atomic journal while unknown sends retain their whole ceiling — pass, 7.38 ms.
- `workers/fee-converter/native-gas.test.ts`: Solana migration preserves existing EVM liabilities and immutable receipt evidence — pass, 71.16 ms.
- `workers/fee-converter/native-gas.test.ts`: expiry evidence and zero-cost resolution commit atomically under the current Solana lease — pass, 7.56 ms.
- `workers/fee-converter/native-gas.test.ts`: versioned signed sends retain immutable account evidence atomically with the native reservation — pass, 4.70 ms.
- `workers/fee-converter/solana-route-prepare.test.ts`: a v0 Token-2022 swap signs only after account review and retains the review with its native liability — pass, 17.29 ms.
- `workers/fee-converter/solana-route-prepare.test.ts`: a substituted lookup or extra token debit refuses before reserving or signing — pass, 8.44 ms.
- `workers/fee-converter/fee-converter.test.ts`: release gates > mode defaults to off and runs nothing — pass, 2.94 ms.
- `workers/fee-converter/fee-converter.test.ts`: release gates > scheduled startup failures reject after every enabled network is attempted — pass, 2.52 ms.
- `workers/fee-converter/fee-converter.test.ts`: release gates > a key that does not control the configured fee wallet is refused — pass, 0.49 ms.
- `workers/fee-converter/fee-converter.test.ts`: USDC routes > retained Robinhood fees report not converted through receipt and recovery runs without quotes or keys — pass, 2.33 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base gasUsd=undefined refuses before preparation — pass, 2.20 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > ethereum gasUsd=undefined refuses before preparation — pass, 1.82 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base gasUsd=null refuses before preparation — pass, 1.69 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > ethereum gasUsd=unpriced refuses before preparation — pass, 1.68 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base gasUsd=-1 refuses before preparation — pass, 1.64 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base l1FeeUsd=undefined refuses before preparation — pass, 1.57 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base l1FeeUsd=null refuses before preparation — pass, 1.84 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base l1FeeUsd=unpriced refuses before preparation — pass, 1.67 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > ethereum l1FeeUsd=unpriced refuses before preparation — pass, 1.56 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base valid costs {} retain the 10x gate — pass, 2.15 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base valid costs {"gasUsd":"0","l1FeeUsd":"0"} retain the 10x gate — pass, 2.05 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > ethereum valid costs {"gasUsd":0} retain the 10x gate — pass, 1.85 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > ethereum valid costs {"gasUsd":"2.000001"} retain the 10x gate — pass, 1.92 ms.
- `workers/fee-converter/fee-converter.test.ts`: Kyber gas pricing in the conversion workflow > base valid costs {"gasUsd":"1","l1FeeUsd":"1.000001"} retain the 10x gate — pass, 2.01 ms.
- `workers/fee-converter/fee-converter.test.ts`: receipt-triggered conversion > a receipt run converts a newly received fee and leaves an unchanged balance alone — pass, 2.35 ms.
- `workers/fee-converter/fee-converter.test.ts`: receipt-triggered conversion > a repeated fee amount after finalization is a new receipt — pass, 2.38 ms.
- `workers/fee-converter/fee-converter.test.ts`: receipt-triggered conversion > the recovery scan retries a token that a receipt run leaves alone — pass, 2.54 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > dry_run records the quote and never prepares or signs — pass, 1.76 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > the record keeps the fee-wallet balances before and after — pass, 1.97 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > the stablecoin and empty balances are never quoted — pass, 2.04 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > small amounts stay pending below the minimum and below the gas multiple — pass, 2.39 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > a pending fee converts once a later receipt lifts it over the threshold — pass, 2.26 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > unknown or excessive price impact and loose minimums are skipped — pass, 2.22 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > an unchanged skip is recorded once, not every run — pass, 2.01 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > a large balance is scaled to fit the per-run cap across tokens — pass, 1.94 ms.
- `workers/fee-converter/fee-converter.test.ts`: conversion policy > live sends in the last 24 hours count against the daily cap — pass, 2.27 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > an approval is journaled before an ambiguous broadcast and excludes conversion totals — pass, 2.41 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a canonical approval permits a fresh later swap without counting the approval value — pass, 2.11 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a legacy failed approval hash stays held without inventing its raw bytes — pass, 2.22 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > an unknown send blocks a new attempt until it is reconciled — pass, 2.82 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a send proven unable to land frees the token for a new attempt — pass, 2.16 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a failed prepare leaves no signed bytes and no open row — pass, 1.77 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a concurrent run on the same network is locked out — pass, 1.81 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a run that lost its lease never deletes the successor's lock — pass, 1.68 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a stale run cannot release a lease it already let lapse — pass, 1.62 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a run that still owns an unexpired lease releases it — pass, 1.56 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a run renews its lease so a long run keeps the lock — pass, 1.57 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a run renews the lease before starting a later chunk — pass, 2.21 ms.
- `workers/fee-converter/fee-converter.test.ts`: idempotent sends > a run stops starting new chunks once it loses its lease — pass, 1.81 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > a slow reconciliation cannot replace after lease takeover — pass, 2.05 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > replacement work that outlives its lease keeps the original pending — pass, 2.00 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > the replacement append refuses a successor lease taken during the database wait — pass, 2.40 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > an append cannot revive an original settled during the database wait — pass, 2.31 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > lease loss after journaling preserves bytes without broadcasting — pass, 2.09 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > a delayed restart delivers journaled bytes before another fee step — pass, 2.29 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > an explicit node fee refusal can escalate after trying the journaled bytes — pass, 2.54 ms.
- `workers/fee-converter/fee-converter.test.ts`: replacement lease and restart recovery > an uncertain rebroadcast never skips to a new fee step — pass, 2.03 ms.
- `workers/fee-converter/fee-converter.test.ts`: D1 contract > the schema refuses a second open send, a submitted row without bytes, and edits to final rows — pass, 2.43 ms.
- `workers/fee-converter/fee-converter.test.ts`: D1 contract > a pending row needs its reason and is final — pass, 1.72 ms.
- `workers/fee-converter/fee-converter.test.ts`: D1 contract > fee conversion rebuilds keep every earlier record and its guards — pass, 54.45 ms.
- `workers/fee-converter/fee-converter.test.ts`: D1 contract > candidate tokens come only from reviewed manifests on the network — pass, 2.43 ms.
- `workers/fee-converter/fee-converter.test.ts`: Solana vault fee claims > a dry run reports the claim and signs nothing — pass, 4.87 ms.
- `workers/fee-converter/fee-converter.test.ts`: Solana vault fee claims > a live run claims once and a rerun finds nothing left to claim — pass, 9.25 ms.
- `workers/fee-converter/fee-converter.test.ts`: Solana vault fee claims > a previously signed claim expires through two-provider proof without retrying on missing evidence — pass, 18.25 ms.
- `workers/fee-converter/fee-converter.test.ts`: Solana vault fee claims > a fee below the dust threshold keeps accruing in the vault — pass, 3.74 ms.
- `backend/payments/migration-0021.test.ts`: migration 0021 > keeps rows and children, names the reviewed asset, and copies amounts as 6-decimal base units — pass, 7.26 ms.
- `backend/payments/migration-0021.test.ts`: migration 0021 > a row on a network without a reviewed asset fails the migration — pass, 6.18 ms.
- `backend/payments/migration-0021.test.ts`: migration 0021 > applies inside one transaction with child rows present (the D1 path) — pass, 7.50 ms.
- `backend/payments/migration-0021.test.ts`: migration 0021 > vault snapshots keep uint128 text, NULL counters, a fixed asset and a monotonic block — pass, 6.29 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > Solana refuses a monthly cap above its token range before storing an allocation — pass, 5.79 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > the amount-range migration preserves funded months, exclusions and authorization history — pass, 86.37 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > an 18-decimal token month keeps exact amounts through owner review, freeze and attestation — pass, 7.19 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a current owner ban refuses monthly allocation — pass, 2.64 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a concurrent owner ban refuses monthly allocation — pass, 2.69 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a current owner ban refuses monthly setting — pass, 4.26 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a concurrent owner ban refuses monthly setting — pass, 2.26 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a current owner ban refuses monthly finalize — pass, 2.41 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a concurrent owner ban refuses monthly finalize — pass, 2.45 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a ban after freeze excludes only the unfunded award and preserves the snapshot — pass, 4.35 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a ban that races monthly funding makes the coordinator retry before creating awards — pass, 3.03 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a later ban preserves monthly awards that are already funded — pass, 3.26 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > freezes the current private allocations once at the cutoff and creates each obligation once when funded — pass, 6.29 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a funding-time excluded award is not advertised as awaiting payment — pass, 3.94 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a contributor's account shows the approved monthly award from the freeze until the vault reserves it — pass, 4.36 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > without a defined cutoff nothing is frozen automatically, but the owner can finalize — pass, 2.59 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > an owner who turns the default off, a restricted project and an unserved vault are not distributed automatically — pass, 2.18 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > an award reserved earlier needs no new funds and cannot be planned twice — pass, 4.33 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a Solana hand reservation waits until automatic monthly payment is off — pass, 5.24 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a Solana month needs its full total free, even for an award reserved earlier — pass, 4.55 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > an underfunded month has no obligation to reserve, and earlier unreserved obligations hold their funds — pass, 4.64 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > after the cutoff the automatic default fixes the allocations until they are frozen — pass, 4.23 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > a month before the first automatic period is never frozen automatically — pass, 1.89 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > private changes stay within the cap, never pay their author and are serialized — pass, 2.65 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > an open month cannot be finalized — pass, 1.85 ms.
- `backend/payments/monthly.test.ts`: monthly coordinator > private bounty programs never run the monthly coordinator — pass, 2.06 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > an obligation for another actor under a frozen award's source is a conflict left out of the month — pass, 4.37 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > an obligation for a smaller gross under a frozen award's source is a conflict left out of the month — pass, 3.03 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > an obligation for a wrong fee under a frozen award's source is a conflict left out of the month — pass, 5.87 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > a contributor sees a conflicting award, and a month of only conflicts signs nothing — pass, 3.86 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > uses only the frozen owner-adjusted awards, even after a later funding observation — pass, 3.56 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > refuses the root before the cutoff, after its window, and when the whole month is unfunded — pass, 3.50 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > signs a frozen month after a later revision that keeps its payment terms — pass, 5.99 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > rechecks restrictions and the owner's opt-out after the month was frozen — pass, 2.42 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > omits funding-time exclusions while preserving awards funded before a later ban — pass, 4.26 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > accepts a month frozen before fees rounded up, and no other fee — pass, 3.91 ms.
- `backend/payments/monthly.test.ts`: monthly attestation input > rejects a forged frozen payload even when its metadata still names the real project — pass, 3.24 ms.
- `backend/payments/monthly.test.ts`: monthly signing preserves its first intent through retry and refuses a changed root — pass, 7.26 ms.
- `backend/payments/monthly.test.ts`: V2 monthly signing publishes permanent source-bound attempts and resumes the selected admitted month — pass, 24.05 ms.
- `backend/payments/monthly.test.ts`: monthly signing never publishes when the signer fails or an opt-out arrives during signing — pass, 7.12 ms.
- `backend/payments/monthly.test.ts`: monthly dispatcher resumes an older Solana reservation after opt-out and retires only finalized completion — pass, 4.72 ms.
- `backend/payments/monthly.test.ts`: monthly dispatcher sends a new EVM V2 reservation before an older month's leaves — pass, 2.36 ms.
- `backend/payments/monthly.test.ts`: Solana v3 retries preserve the first signed freeze time after a signer outage — pass, 7.60 ms.
- `backend/payments/monthly.test.ts`: reserve release requires the live monthly owner authority and current policy before requesting any attestation — pass, 5.32 ms.
- `backend/payments/monthly.test.ts`: a concurrent project revision change refuses a prepared reserve release — pass, 2.27 ms.
- `backend/payments/vault-snapshots.test.ts`: storeVaultSnapshot > stores a finalized read under the reviewed vault and asset — pass, 2.69 ms.
- `backend/payments/vault-snapshots.test.ts`: storeVaultSnapshot > rejects a read of another vault or asset, or a malformed counter — pass, 1.60 ms.
- `backend/payments/vault-snapshots.test.ts`: storeVaultSnapshot > never rewinds: an older block is ignored and a decreasing counter fails — pass, 1.86 ms.
- `backend/payments/vault-snapshots.test.ts`: storeVaultSnapshot > a Solana read names the project PDA and is stored under the token vault — pass, 1.58 ms.
- `backend/payments/vault-snapshots.test.ts`: storeVaultSnapshot > one failing vault does not stop the others — pass, 1.71 ms.
- `backend/payments/vault-snapshots.test.ts`: GET /api/v1/payments/projects/:id/vault > serves cached rows with public edge caching and never reads a chain — pass, 2.23 ms.
- `backend/payments/vault-snapshots.test.ts`: GET /api/v1/payments/projects/:id/vault > an unindexed project returns no rows, not zero totals — pass, 1.65 ms.
- `backend/payments/vault-snapshots.test.ts`: indexPaymentEvent asset > requires the finalized vault snapshot and records its asset and decimals — pass, 2.26 ms.
- `backend/payments/vault-snapshots.test.ts`: indexPaymentEvent asset > re-indexing stored evidence for the adapter's deployment makes no chain call — pass, 2.04 ms.
- `backend/payments/vault-snapshots.test.ts`: concurrent finalized refreshes cannot decrease cumulative vault counters — pass, 10.49 ms.
- `backend/payments/vault-snapshots.test.ts`: concurrent initial refreshes preserve asset identity and report superseded blocks — pass, 2.17 ms.
- `backend/payments/migrations.test.ts`: migration 0017 > keeps rows, children, objects and column order; then accepts robinhood — pass, 6.07 ms.
- `backend/payments/migrations.test.ts`: migration 0017 > applies inside one transaction with child rows present (the D1 path) — pass, 4.73 ms.
- `backend/payments/migrations.test.ts`: migration 0017 > the full migration set applies cleanly on an empty database — pass, 81.64 ms.
- `backend/security/submissions.test.ts`: private intake: cached reporting observations > failed or stale public observations do not authorize or permanently block submission (no program: %s) — pass, 11.27 ms.
- `backend/security/submissions.test.ts`: private intake: cached reporting observations > failed or stale public observations do not authorize or permanently block submission (no program: %s) — pass, 5.64 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > creation replays one key and refuses a second submission in flight — pass, 3.15 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > replaying creation on a finished or abandoned submission refuses instead of re-authorizing — pass, 8.08 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > the repository comes from the program terms, never from the request — pass, 2.38 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > a grant for another GitHub account is refused and sets no grant cookie (no program: %s) — pass, 2.58 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > a grant for another GitHub account is refused and sets no grant cookie (no program: %s) — pass, 2.57 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > the grant cookie is encrypted, HttpOnly, Strict and scoped to the submission routes — pass, 3.08 ms.
- `backend/security/submissions.test.ts`: private intake: creation and identity > a missing, tampered, expired or rebound grant never reaches GitHub — pass, 5.43 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > an unrelated authority outage preserves the reporter's own case list with a generic retry notice — pass, 7.16 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > a moderator cannot discover an un-escalated reporting-only project from the private list — pass, 3.78 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > a sent report survives a contact lookup outage and reconciles without sending again — pass, 9.32 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > a verified slop report with no passing approver recovers after 24 hours with fresh reporter consent — pass, 10.43 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > a verified direct report with no passing approver recovers after 24 hours with fresh reporter consent — pass, 6.67 ms.
- `backend/security/submissions.test.ts`: registered project without paid bounty terms > private intake accepts a report without inventing an award — pass, 6.81 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a report is filed as the reporter and its receipt is verified with GitHub — pass, 4.97 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > definite GitHub refusals fail with a code, and a fixed report can be resent — pass, 11.05 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a 404 maps to app-not-installed when the intake App is missing — pass, 3.48 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > an interrupted send is uncertain, never resent, and reconciled to the one copy — pass, 3.89 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a complete empty listing reopens the draft for exactly one new send — pass, 5.81 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > an incomplete or failed listing keeps the submission uncertain — pass, 6.84 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > duplicate copies adopt the earliest and tell only the technical approvers — pass, 4.48 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a marker match authored by someone else is ignored — pass, 3.33 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a send that never returned becomes uncertain after 60 seconds and is not resent — pass, 4.56 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a concurrent double send makes one POST — pass, 3.28 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > an empty listing right after the attempt keeps it uncertain, and a late copy is then adopted — pass, 4.32 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a resend that races a late copy adopts the earliest and records the duplicate — pass, 4.87 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a submitted report GitHub never lets Slop verify stops blocking new reports — pass, 3.49 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > a 201 that is not the reporter's well-formed advisory is uncertain — pass, 6.59 ms.
- `backend/security/submissions.test.ts`: private intake: send outcomes > an unreadable advisory after creation retries the read only — pass, 3.45 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > the reporter's own advisory is verified with GitHub's original time — pass, 3.31 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > a reporter credit on someone else's advisory is not authorship, and the author can still verify — pass, 3.68 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > an advisory that is not a live private report is never an automatic receipt — pass, 8.65 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > two concurrent verifications of one submission both answer with the one verified case — pass, 4.41 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > another user's advisory fails as author-mismatch with no case — pass, 3.72 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > an advisory GitHub cannot find fails as not-found — pass, 2.96 ms.
- `backend/security/submissions.test.ts`: private intake: direct GitHub reports > an advisory already recorded for another case returns 409 without leaking it — pass, 4.98 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > the deterministic analyzer only recommends from structured fields — pass, 0.12 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > only the reporter can reach a submission — pass, 3.18 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > an idle draft is abandoned after 24 hours — pass, 2.68 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > privacy > report content and tokens never reach D1, logs or responses — pass, 9.68 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > with intake off every submission route is closed, the list is empty and readiness says off — pass, 2.01 ms.
- `backend/security/submissions.test.ts`: private intake: analysis, access, privacy and mode > readiness reports automatic intake only when the App is installed and PVR is on — pass, 3.78 ms.
- `backend/security/submissions.test.ts`: a participation ban stops new private reports and sending an existing draft — pass, 4.43 ms.
- `backend/security/submissions.test.ts`: a ban before the send commits prevents the private GitHub request — pass, 2.74 ms.
- `backend/security/submissions.test.ts`: a concurrent ban leaves no new private submission or creation event — pass, 2.33 ms.
- `backend/security/submissions.test.ts`: a banned reporter can reconcile a report GitHub already received — pass, 3.74 ms.
- `backend/security/submissions.test.ts`: an accepted private report still reconciles after quarantine — pass, 3.98 ms.
- `backend/security/submissions.test.ts`: registered researcher can start a private report on a quarantined project — pass, 2.53 ms.
- `backend/security/handler.test.ts`: automatic private intake > a maintainer imports direct GitHub reports and settles older links — pass, 6.42 ms.
- `backend/security/handler.test.ts`: automatic private intake > listing cases records only the cases disclosed and refuses an unaudited response — pass, 3.92 ms.
- `backend/security/handler.test.ts`: automatic private intake > a failed or missing analysis can be run again by the owner — pass, 5.08 ms.
- `backend/security/handler.test.ts`: automatic private intake > a stale triager change grants or revokes nothing — pass, 4.16 ms.
- `backend/security/handler.test.ts`: discretionary awards > a banned researcher keeps funded awards and appeals but receives no new bounty award — pass, 9.01 ms.
- `backend/security/handler.test.ts`: discretionary awards > a banned maintainer cannot create a new bounty award (race: false, related: false) — pass, 3.82 ms.
- `backend/security/handler.test.ts`: discretionary awards > a banned maintainer cannot create a new bounty award (race: true, related: false) — pass, 4.09 ms.
- `backend/security/handler.test.ts`: discretionary awards > a banned maintainer cannot create a new bounty award (race: false, related: true) — pass, 4.06 ms.
- `backend/security/handler.test.ts`: discretionary awards > a banned maintainer cannot create a new bounty award (race: true, related: true) — pass, 5.17 ms.
- `backend/security/handler.test.ts`: discretionary awards > a ban that arrives during bounty approval prevents its reservation — pass, 4.73 ms.
- `backend/security/handler.test.ts`: discretionary awards > large program balances keep every minor unit after approved awards — pass, 89.39 ms.
- `backend/security/handler.test.ts`: discretionary awards > the owner chooses the amount, and approval reserves exactly that amount — pass, 8.85 ms.
- `backend/security/handler.test.ts`: discretionary awards > no award is a decision the reporter can appeal — pass, 5.91 ms.
- `backend/security/handler.test.ts`: discretionary awards > a concurrent reservation cannot overspend the program — pass, 7.71 ms.
- `backend/security/handler.test.ts`: discretionary awards > reservations follow the vault's finalized free balance, not the published terms — pass, 9.75 ms.
- `backend/security/handler.test.ts`: discretionary awards > a pledge reserves nothing — pass, 3.91 ms.
- `backend/security/handler.test.ts`: discretionary awards > an award reserved before discretionary awards is approved at its amount — pass, 4.32 ms.
- `backend/security/handler.test.ts`: related-party awards > a proposed related-party award reserves only after independent approval — pass, 6.09 ms.
- `backend/security/handler.test.ts`: related-party awards > an appealed related-party refusal cannot be re-reviewed by the same reviewers — pass, 15.82 ms.
- `backend/security/handler.test.ts`: related-party awards > a co-maintainer who decides an award or an earlier technical decision cannot review the case as dispute — pass, 7.16 ms.
- `backend/security/handler.test.ts`: report analysis and appeal triage keep the scope recorded at receipt — pass, 6.14 ms.
- `backend/security/handler.test.ts`: restricted programs > a pending-revision quarantine blocks new awards but preserves reporting until reinstated — pass, 8.47 ms.
- `backend/security/handler.test.ts`: restricted programs > a restricted or retired program cannot start a new bounty award (race: false, related: false) — pass, 3.58 ms.
- `backend/security/handler.test.ts`: restricted programs > a restricted or retired program cannot start a new bounty award (race: true, related: false) — pass, 3.73 ms.
- `backend/security/handler.test.ts`: restricted programs > a restricted or retired program cannot start a new bounty award (race: false, related: true) — pass, 5.11 ms.
- `backend/security/handler.test.ts`: restricted programs > a restricted or retired program cannot start a new bounty award (race: true, related: true) — pass, 4.36 ms.
- `backend/security/handler.test.ts`: quarantined private cases > private reporting remains available for a registered quarantined project — pass, 2.10 ms.
- `backend/security/handler.test.ts`: quarantined private cases > existing appeal triage follows quarantine revision evidence: pending — pass, 5.72 ms.
- `backend/security/handler.test.ts`: quarantined private cases > existing appeal triage follows quarantine revision evidence: applied — pass, 5.21 ms.
- `backend/security/handler.test.ts`: quarantined private cases > existing appeal triage follows quarantine revision evidence: unproved — pass, 5.55 ms.
- `backend/security/handler.test.ts`: quarantined private cases > an owner retirement closes a failed appeal triage retry after none — pass, 4.80 ms.
- `backend/security/handler.test.ts`: quarantined private cases > an owner retirement closes a failed appeal triage retry after quarantine — pass, 4.32 ms.
- `backend/security/handler.test.ts`: quarantined private cases > an owner retirement closes a failed appeal triage retry after ban — pass, 5.21 ms.
- `backend/security/handler.test.ts`: quarantined private cases > a receipt check imports no new report after an applied quarantine — pass, 2.33 ms.
- `backend/security/handler.test.ts`: quarantined private cases > a previously funded award remains accessible while quarantined — pass, 5.37 ms.
- `backend/security/handler.test.ts`: repository-bound id restriction blocks a new award (race: false, related: false) — pass, 5.05 ms.
- `backend/security/handler.test.ts`: repository-bound id restriction blocks a new award (race: false, related: true) — pass, 5.16 ms.
- `backend/security/handler.test.ts`: repository-bound id restriction blocks a new award (race: true, related: false) — pass, 6.63 ms.
- `backend/security/handler.test.ts`: repository-bound id restriction blocks a new award (race: true, related: true) — pass, 14.03 ms.
- `backend/security/handler.test.ts`: repository-bound path restriction blocks a new award (race: false, related: false) — pass, 5.11 ms.
- `backend/security/handler.test.ts`: repository-bound path restriction blocks a new award (race: false, related: true) — pass, 5.58 ms.
- `backend/security/handler.test.ts`: repository-bound path restriction blocks a new award (race: true, related: false) — pass, 6.52 ms.
- `backend/security/handler.test.ts`: repository-bound path restriction blocks a new award (race: true, related: true) — pass, 6.61 ms.
- `backend/security/handler.test.ts`: an failed enforcement read cannot approve an award and can retry — pass, 5.42 ms.
- `backend/security/handler.test.ts`: an missing enforcement read cannot approve an award and can retry — pass, 5.02 ms.
- `backend/security/handler.test.ts`: an partial enforcement read cannot approve an award and can retry — pass, 5.92 ms.
- `backend/fee-conversions/handler.test.ts`: admin fee-conversions route > other paths fall through to the next API module — pass, 1.88 ms.
- `backend/fee-conversions/handler.test.ts`: admin fee-conversions route > signed-out and non-admin sessions are refused — pass, 1.98 ms.
- `backend/fee-conversions/handler.test.ts`: admin fee-conversions route > admins get recent records and exact per-token totals without signed bytes — pass, 2.17 ms.
- `backend/referrals/claims.test.ts`: claim API maps contract epoch through its filed period and keeps another actor's proof private — pass, 2.55 ms.
- `backend/referrals/claims.test.ts`: cache failure and expiry preserve last verified totals; never-activated is hidden and first failure is unknown — pass, 3.75 ms.
- `backend/referrals/claims.test.ts`: a paused pending window never matures, and a void retains the preceding root — pass, 1.78 ms.
- `backend/referrals/claims.test.ts`: wallet review is read-only, and an explicit send rechecks the exact claim without token approvals — pass, 3.45 ms.
- `backend/projects/cloudflare-persistence.test.ts`: renamed repository (alias is the current name) resolves in the live registry — pass, 4.11 ms.
- `backend/projects/cloudflare-persistence.test.ts`: a legal transfer revision (alias append) keeps the repository resolvable — pass, 2.32 ms.
- `backend/projects/cloudflare-persistence.test.ts`: a repository path acquired by another project before commit refuses the whole revision — pass, 2.08 ms.
- `backend/points/x.test.ts`: X connection and reconnect reserve identity without granting points — pass, 7.45 ms.
- `backend/notifications/notifications.test.ts`: notification events > self-service listing sends no routine notice; later revisions notify once each — pass, 3.10 ms.
- `backend/notifications/notifications.test.ts`: notification events > project enforcement records notify the project and independent reviewers once — pass, 2.73 ms.
- `backend/notifications/notifications.test.ts`: notification events > wallet changes and finalized payment events notify the contributor once — pass, 4.78 ms.
- `backend/notifications/notifications.test.ts`: notification events > a notification changes only from unread to read and is never deleted — pass, 1.90 ms.
- `backend/notifications/notifications.test.ts`: notifications API > older unread notifications remain reachable when new events arrive — pass, 6.16 ms.
- `backend/notifications/notifications.test.ts`: notifications API > lists only the signed-in recipient's rows, newest first — pass, 2.20 ms.
- `backend/notifications/notifications.test.ts`: notifications API > marks the recipient's own rows read once and refuses other writes — pass, 2.07 ms.
- `backend/notifications/notifications.test.ts`: notifications API > each notice reports its own email outcome without delivery details — pass, 2.47 ms.
- `backend/notifications/notifications.test.ts`: notifications API > a signed-out request gets 401 and other paths are not handled — pass, 1.82 ms.
- `backend/notifications/notifications.test.ts`: slopbot scam review notices > one notice per moderator from the committed penalty, never to the author — pass, 1.89 ms.
- `backend/notifications/notifications.test.ts`: slopbot scam review notices > a penalty without moderator review writes no notice — pass, 3.30 ms.
- `backend/notifications/notifications.test.ts`: slopbot scam review notices > moderator access is rechecked on every list, open and read mark — pass, 2.84 ms.
- `backend/notifications/email.test.ts`: verified opt-in sends future activity once; opt-out cancels queued mail and is independent of essential notices — pass, 4.34 ms.
- `backend/notifications/email.test.ts`: unverified and changed destinations cannot inherit activity consent — pass, 3.02 ms.
- `backend/notifications/email.test.ts`: optional-mail ambiguity retries only with attempt-bound independent evidence and remains bounded — pass, 3.86 ms.
- `backend/notifications/email.test.ts`: an essential notice retries a not-yet-effective destination on a bounded schedule; optional mail does not — pass, 3.08 ms.
- `backend/notifications/email.test.ts`: an essential notice exhausts after five non-send attempts and an absent record is suppressed — pass, 2.72 ms.
- `backend/notifications/email.test.ts`: opt-out cancels optional mail that is waiting for a reconciled retry — pass, 2.36 ms.
- `backend/notifications/email.test.ts`: scheduled drains finish activity delivery and report a failed security queue — pass, 4.37 ms.
- `backend/notifications/exception-events.test.ts`: exception-only notification events > setup completion is one project_ready notice, never sent to its publisher — pass, 2.39 ms.
- `backend/notifications/exception-events.test.ts`: exception-only notification events > a self-service first revision reports ready only when it is active — pass, 2.04 ms.
- `backend/notifications/exception-events.test.ts`: exception-only notification events > a scan that cannot finish reaches the owners once; other results write nothing — pass, 2.16 ms.
- `backend/notifications/exception-events.test.ts`: exception-only notification events > losing the Slopbot installation reaches each affected project's owners once — pass, 2.36 ms.
- `backend/notifications/exception-events.test.ts`: exception-only notification events > a verified report receipt reaches only its reporter, once, with no acknowledgment — pass, 3.38 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > admits the live approved metadata-only mint — pass, 0.76 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > admits trailing zero padding after the last record — pass, 0.07 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > keeps classic SPL mints — pass, 0.03 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses an unsupported owner and a non-base64 account — pass, 0.06 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses an uninitialized mint and a wrong classic layout — pass, 0.04 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses a Token-2022 mint whose authorities are not disabled — pass, 0.15 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > applies the authority rule to a base Token-2022 mint — pass, 0.06 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > admits revoked authorities that retain their old key bytes — pass, 0.06 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses every other or unknown mint extension — pass, 0.10 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses a truncated, mistyped or unpadded base — pass, 0.06 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses metadata that does not name the requested mint — pass, 0.05 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenMint > refuses malformed metadata — pass, 0.05 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenAccount > admits the live ImmutableOwner token account — pass, 0.02 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenAccount > admits a Token-2022 token account with no extension — pass, 0.02 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenAccount > keeps classic SPL token accounts — pass, 0.03 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenAccount > admits ImmutableOwner with trailing padding and refuses a payload — pass, 0.06 ms.
- `contracts/solana/token-extensions.test.ts`: readTokenAccount > refuses every other or unknown token-account extension — pass, 0.06 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > reads counters and decimals from one finalized slot — pass, 0.57 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > reads mint decimals 0, 6, 9 and 18 — pass, 0.51 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > throws when the vault holds less than free, reserved and accrued — pass, 0.27 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > throws when the counters exceed deposits — pass, 0.12 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > refuses a truncated Token-2022 mint and an uninitialized mint — pass, 0.25 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > reads an approved metadata-only Token-2022 vault from one finalized slot — pass, 0.35 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > refuses a Token-2022 mint outside the approved subset — pass, 0.13 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > refuses a vault account with an unadmitted extension or token program — pass, 0.25 ms.
- `contracts/solana/adapter.test.ts`: readVaultTotals > refuses a legacy-size project account — pass, 0.03 ms.
- `contracts/solana/adapter.test.ts`: solanaMintDecimals > reads admitted token programs for the complete owner paths and refuses unsafe mints — pass, 0.21 ms.
- `contracts/solana/adapter.test.ts`: program addresses > derive the Config and vault PDAs — pass, 0.04 ms.
- `contracts/solana/token.test.ts`: economic, hook, duplicate and unknown mint extensions cannot ride alongside allowed metadata — pass, 0.16 ms.
- `contracts/solana/token.test.ts`: ImmutableOwner token accounts preserve program identity and refuse unrelated extensions — pass, 0.04 ms.
- `contracts/solana/monthly-commitment.test.ts`: set_monthly_commitment instruction > names the owner signer and the writable project, then cap and flag — pass, 0.27 ms.
- `contracts/solana/monthly-commitment.test.ts`: set_monthly_commitment instruction > refuses another wallet, a foreign vault, a zero cap when on and u64 overflow — pass, 0.13 ms.
- `contracts/solana/monthly-commitment.test.ts`: set_monthly_commitment instruction > compiles a one-signer legacy message with the program read-only — pass, 0.15 ms.
- `contracts/solana/monthly-commitment.test.ts`: monthly commitment state > reads the u64 cap at 307 and the switch at 315 of the project account — pass, 0.04 ms.
- `contracts/solana/monthly-commitment.test.ts`: Solana monthly setting route > is unavailable without the reviewed vault resolver — pass, 0.10 ms.
- `contracts/solana/monthly-commitment.test.ts`: Solana monthly setting route > rejects malformed settings before resolving the vault — pass, 0.21 ms.
- `contracts/solana/monthly-commitment.test.ts`: Solana monthly setting route > refuses a non-owner wallet with a readable reason and no chain read — pass, 0.11 ms.
- `contracts/evm/scripts.test.ts`: deploy scripts > network scripts fix no address; only Base takes the default fee recipient — pass, 0.23 ms.
- `contracts/evm/scripts.test.ts`: deploy scripts > roles come from the environment; only Base has a default fee recipient — pass, 0.07 ms.

## Implementation results

The report-first commit is `18f655f2`. The implementation following it resolves the selected changes as follows; this section records final decisions separately from the original baseline audit above.

| Finding | Implemented result |
| --- | --- |
| SF-01 | Funding route no longer loads unused leaderboard/cycle snapshots; current-registry and vault data requirements remain. |
| SF-02 | Submission-list reload clears its old error, so503→Retry→200 reaches the real list in the same document. |
| SF-03 | Page-owned project sessions feed setup children and private submission cards. Initial setup and a three-card case list each use one project-session request. A fresh shared identity check remains on entering Review, and an actor switch refreshes the owner inventory; the UI does not display the old actor while checking. This preserves the earlier review-time confirmation while removing redundant children, so the initial report's proposed zero additional Review reads was deliberately not adopted. |
| SF-04 | Project automatic-intake sign-in goes directly to login with the project security return path; checking and failed sessions use the shared panel. |
| SF-05 | One canonical decimal parser validates token amounts. Existing token decimals are honored; new token precision remains server-verified. Token previews show token units; stablecoin cent/cap rules and positive-amount requirements remain. |
| SF-06 | The remaining two identical action wrappers use `useAction`, preserving creation-failure classification and pending-record recovery. |
| SF-07/09/10/11/12 | Keep current preload/manual operator reads, contextual score explanations, formatters and CSS groups. No measured user problem or complete cascade-equivalence proof justified extra abstraction/churn. All other retained frontend decisions above stand. |
| SB-01 | One SQL statement reads the five account datasets from the same snapshot. Actual reservation interleaving now returns the award before reservation in the first response and as a reserved payment in the next; it never disappears. Missing database output throws instead of inventing empty arrays. |
| SB-02 | At most four independent vault refreshes proceed concurrently. Controlled8-vault/30ms measurement improved254ms→65ms with all8 rows retained; peak in-flight reads1→4. Blocked/failing vaults no longer stall healthy ones; errors retain deterministic order and monotonic writes are unchanged. |
| SB-03 | Unsigned Solana builders reuse adapter PDA/public-key helpers. Ordinary and private-bounty unsigned messages and derivations are byte-identical to baseline vector SHA-256 `3ec1f0ff5f64e4a2ccde178c3a13c389bfa12eaccfc9ab42d22840ea7810e8b5`. Native program source is untouched. |
| SR-01 | Unused immutable-file writer deleted. |
| SR-02 | Abandoned checker CLI/barrel and519 lines of its exclusive policy branches removed. `planReferencedArtifacts` moved unchanged into the actual artifact module, giving ingestion one direct import and one adjacent declaration file. The original plan for two declaration files was simplified further.24 retained parser/planner/semantic results and6 constants matched the baseline; live verifier function bodies stayed unchanged. |
| SR-03 | Cycle comparison reuses byte-identical `canonicalJson`;11 historical fixture representations match. The differently ordered project-policy serializer remains. |
| ST-01/02/03 | Deleted residual census unit under Playwright, two isolated helper/marker suites and literal/parser-only fragments. Complete installer, real API/database outcomes and meaningful failure paths remain. |
| ST-04/05/06 | Moved lost-response closure coverage into the actual handler/DB/browser workflow; removed mocked closure duplicate, standalone mocked monthly-toggle flow and static penalty-display suite. Full chain monthly control, ledger penalty/appeal and real navigation evidence remain. |
| ST-07 | Deleted11 duplicate project JSON files (46,583 bytes). All consumers use a cloned lookup in the one frozen fixture registry; no production inventory changed. |
| ST-08/09 | Consolidated snapshot-store outcomes into refresh→D1→public API, preserving concurrency controls. Removed five duplicate fake poster cases; the actual Anvil scenario now proves an empty first file epoch is skipped before the next funded root posts at contract epoch0. Other durable budget/uncertain-send cases remain. |
| ST-10 | Kept per-case real R2 runtimes: sharing would require additional lifetime/namespace complexity without an established net benefit. No Map replacement or weaker storage double introduced. |
| ST-11 | Full desktop/mobile route coverage remains; laptop/tablet and extra reflow checks use six representative layout families. Desktop-only checks are excluded by project selection instead of generating mobile skip noise. |
| ST-12/13 | Preview/Pages CI install only Chromium; registry retains Chromium+Firefox. Removed redundant escrow-policy subset execution and alias; full code, contract and chain workflows remain. |
| ST-14/15 | Timeout kills the owned process tree; real subprocess heartbeat proves descendants stop and exit codes survive. Registry acquisition/cleanup share one lifetime, attempt every acquired cleanup and preserve original failure. Windows CI runs the lifecycle regression; trigger paths now follow canonical templates and fixture inputs. |

Targeted implementation acceptance completed before the combined run:80 backend/contract cases;18 poster cases; actual EVM payment integration; full Anvil referral posting/watch/void/claim/cache workflow;35 installer cases/244 assertions;18 fixture/runner/store cases/116 assertions; compiler and formatting checks. Desktop/mobile browser regressions exercise the selected UI behaviors against isolated before/after bundles. These are local fixture/chain results, not production or real-provider qualification.

Full combined exact-head validation, final browser artifacts, request measurements and limitations are retained in the task's local `codebase-second-review` evidence directory, with a final `validation.md` index. No private source archive, prompt, response, signing material or session token is published as evidence. Native Solana validator/Anchor/Cargo and a local Windows runner are unavailable in this environment; Solana unsigned-byte equivalence and existing adapter tests are local evidence, while native Windows lifecycle is covered by its checked-in CI workflow. No live model behavior changed, so provider calls and agent-client qualification do not apply to these refactors.

### Acceptance follow-ups

Before/after network capture measured the funding route's removed payload at **14,449,314 bytes over two unused snapshot requests**. Initial setup project-session reads fell2→1; a three-submission private inbox fell4→1; project security sign-in reads fell2→1. Review deliberately performs its fresh shared identity read, including an actual account-switch browser scenario. The first scoped final run passed14 desktop/mobile cases; eight route/device visual scenarios passed16 normal/enlarged axe scans.

A combined320px/200%-text stress capture then exposed a pre-existing footer collision: the unbreakable contact link overlapped the fixed-size mark in the two-column layout. The baseline was captured and documented before this follow-up edit. The footer now has one canonical wrapping flex rule, with bounded wrapping links; its duplicate base display rule is removed. The existing reflow workflow checks every Community link against the mark rectangle, so this is behavior coverage rather than a text/existence assertion. This resolves a real accessibility defect; optional unproven selector-grouping remains deferred as previously recorded.

Running the preserved complete workflows exposed two stale test expectations: the deliberately lost successful account-close response was not declared to strict browser diagnostics, and an Anvil case still expected the old manual monthly-read count after automatic loading had shipped. Both keep their full real persistence/chain assertions and now explicitly assert their expected one-off failure. The actual Anvil workflow also shared one chain port across concurrent viewport projects; explicit local-chain modes now default to one worker, while ordinary preview remains parallel and Pages keeps its default serial access. These are corrections to exercised tests and runner configuration, not application errors hidden by looser global failure handling.

The first combined validation at `438b41b6` passed669 Bun cases with one intentional sandbox skip, all five native Miniflare workflows, dependency audit, compilation, lint and build. A browser run with an accidental explicit two-worker override on the stateful registry lane hit a Miniflare D1 internal error; the default single-worker registry lane must be rerun before calling it green. A corrected real account-close desktop/mobile selection passed4/4; the final runner/CSS follow-up will receive its own committed-source verification. Final logs record each run and its actual result without retroactively describing the earlier failed runs as successful.

The final parallel browser run exposed a pre-existing race inside the hero animation test: its installed clock continued advancing after it observed a complete phrase, allowing the phrase to start deleting before the next assertion. The product kept cycling correctly. The test now pauses that clock before navigation, matching the existing reduced-motion case, and advances it explicitly. All original phrase, layout and accessibility assertions and timeouts remain. A fresh isolated desktop/mobile run passed4/4. This is a one-line test-determinism correction, not an animation/product change. The main cleanup was already merged through #1402/#1404 before waiting for remote CI, as requested.

The local default preview worker pool is also capped at two (and at half the available CPU parallelism, minimum one). The previous half-of-machine default started nine browsers on this host while other local workflows were active, producing a static-server socket failure and slow-response assertions. This bounds per-page ledger memory/CPU work while retaining parallel preview checks, the one-worker Pages/chain defaults and an explicit caller override. It changes no timeout, retry, assertion or product behavior.

## Completion audit after the merged second pass

The first completion claim was too broad: the full browser run subsequently supplied a reproducible profile identity race, and review of the actual remaining mixed test suite found three residual client-only fragments plus a fixture startup exception that could bypass cleanup. This addendum records those gaps before their source corrections. Merging without waiting for CI, as requested, did not prove them resolved. The goal remains active until the corrections and the resulting behavior are verified.

Current integration baseline: `a3f1b96b` from `origin/development`, including the separately approved PRD note about November payout exclusions. This cleanup does not change that policy. Windows and native contract job metadata shows cancellation during setup after merge; those statuses are not evidence of a failing test or a passing platform qualification. Local platform limitations remain explicit.

### Requirement-by-requirement completion evidence

| Requested category | Authoritative implementation/evidence | Current conclusion |
| --- | --- | --- |
| Combine files/simplify structure | SR01–03 deletion/direct import/canonical JSON; shared Solana helper; sole fixture registry; first-pass canonical skill tree | Implemented; static references and byte comparisons checked |
| Simplify features/gates/human steps | SF01–06; direct project login; correct token precision; first-pass automatic monthly reads | Implemented; selected browser/chain workflows pass |
| Shared UI/components/styles | Reused SignInPanel, WalletConnection, useAction; footer display owned by design system | Implemented; visual/reflow evidence; unproved general abstractions explicitly rejected |
| UI/UX path complexity | Shared session reads and fresh Review identity; failed-list Retry; direct return path | Implemented; PI01 exposes one remaining profile ordering defect |
| Remove unnecessary explanatory copy | First-pass duplicate footer/domain content removed; SF10/SF20 retained context tied to decisions and money/consent | Audited and classified, not blanket deletion of required facts |
| Text better expressed graphically | Existing actual logo/icon/graph assets inventoried; all seven agent icons live; no supported replacement for identifiers/amounts | Audited; avoid decorative text-to-image conversion without a user benefit |
| Hidden errors/defaults/exception patterns | Removed dead CLI fallbacks; shared visible action errors; consistent account read; explicit aggregate refresh errors | Implemented; remaining fixture startup exception recorded below |
| Buttons that can be automatic | Automatic reads/focus refresh and direct login; signatures/moderation/consent remain deliberate | Implemented within approved authority |
| Dead scripts/code/imports | 656-module import/export scan and runtime/CLI checks; SR01/02 removals; no stale executable references | Implemented; tool candidate counts are not misrepresented as dead code |
| Useless tests | ST01–06 prune literal/helper/mock-only fragments and preserve complete outcomes | Implemented, except three ST09 fragments now identified |
| Non-contract units and fixtures | Sole cloned registry; two additional helper suites removed; contract tests retained | ST09 final cleanup pending; retained suites exercise real DB/process/browser/chain boundaries |
| Simplify/parallelize/deduplicate E2E | ST07–16; bounded concurrency; representative layout matrix; process-tree cleanup; no duplicate browsers in CI | Implemented except real startup-error gap below |
| Other smells/bugs/efficiency | SB01 atomic account view, SB02 independent vault refresh, SB03 byte-identical PDA reuse | Implemented with real reproduction/measurements; PI01 remaining |
| Explicit best-practice criteria | 14-row root matrix and16-rule frontend rubric in report | Complete artifact |
| Extremely detailed report before code | Initial second-pass report committed `18f655f2`; this completion addendum precedes corrections | Complete artifact; final validation must be appended honestly |
| All justified implementation and verification | Full run at f785:346 pass/20 skip/1 fail; exact remaining failure and two audit gaps follow | Incomplete until those gaps are resolved; no blanket100% claim |

# Profile identity arrival-order audit

Source: f785dfab1eb5b9e0cfd5ccc7956e10f34bcf32a7. Audit/reproduction only; no application edits at report creation.

## PI01 — Do not resolve a profile actor while its membership veto is pending

Priority: P2 correctness and request-authority ordering. Scope: src/ProfilePage.tsx canonical currentProfileActor boundary and the existing profile identity browser regression. No payout mutation or private-data exposure is demonstrated.

PRD: section3 requires permanent GitHub actor IDs through renames; section2 keeps wallet records in the account service and says one record cannot replace another required proof; section7 visitor acceptance requires consistent profile/receipt records and retained historical URLs. Repository working rules require distinct loading/invalid/error states. This restores already-intended identity validation rather than introducing product policy.

### Evidence

- `ProfilePage.tsx:80-82` passes the independently loading profile census and current membership to currentProfileActor, then immediately uses the result in useCurrentWallet.
- `ProfilePage.tsx:470-472` waits for the directory to be ready but does not wait for `membership.joinStatus`.
- `ProfilePage.tsx:477-483` checks a current membership conflict only when a member has already arrived.
- `ProfilePage.tsx:490-496` falls back to a unique directory record while the membership lookup may still be loading.
- `Points.tsx:451-495` explicitly exposes the login-keyed membership state as loading/ready/absent/unavailable. While loading it returns joined:null, which is not proof that no membership conflict exists.
- `ProfilePage.tsx:539-540` starts the actor-bound wallet read as soon as the premature candidate is returned. A later correct UI rejection cannot undo that request.
- Full exact-source run `/tmp/slop-second-f785-e2e.log` lines23254-23273: mobile `directory-only membership identity: reassigned login` ultimately hid conflicting records but recorded `/api/v1/wallet-claims/actors/3/current`, where the test required no read.

### Sequence

For `/contributors/alice`, the current directory describes actor3 as alice. A public membership record still describes historical actor2 as alice. With directory-first arrival, currentProfileActor selects actor3 and triggers a wallet read while membership is loading. When actor2 arrives, the conflict correctly rejects the profile. Membership-first arrival already remains unresolved until the directory arrives, then rejects. The network effect therefore depends on response ordering even though final UI matches.

### Proposed exact correction

Add `membership.joinStatus === "loading"` to the early unresolved condition of currentProfileActor, alongside its existing snapshot/directory prerequisites. Keep this at the canonical actor-resolution boundary, so both profile history and useCurrentWallet stay unresolved together. Use the existing “Checking contributor…” display while waiting; no second state machine, timer, request, or duplicated guard in the wallet hook.

Keep ready and absent membership behavior, directory-only actor fallback, login-keyed cancellation, and terminal `unavailable` behavior unchanged. `unavailable` is deliberate compatibility behavior on preview/non-product origins (Points.tsx467-469), and changing its public cached-record fallback would be broader policy than this reproduced ordering defect. The page's own authenticated-actor path and session timing are not changed without a separate demonstrated defect. Do not gate public profiles on successful private authentication.

### Acceptance/reproduction plan

Extend the existing reassigned-login browser case with deferred directory/member responses for both orders. While one required source is held, check the page stays unresolved and no actor-bound wallet request starts; after both respond with conflicting permanent IDs, assert no history/points/wallet appears and no wallet request has occurred. Retain the existing valid-current-member and preview directory-only cases, proving ready/absent/unavailable fallback behavior was preserved. Capture desktop/mobile before/after screenshots, video and request logs. No extra unit tests.

Controlled reproduction is running in an isolated standard fixture; results will be appended below before implementation authorization.


# Test/fixture completion audit

Read-only review of `f785dfab1eb5b9e0cfd5ccc7956e10f34bcf32a7`, the committed second-pass report, and the actual source. This is completion of the selected audit, not a new broad review. No source edits were made.

## Findings that still need action

1. **ST15 startup cleanup has one demonstrated hole.** `tests/github-api-fixture.mjs` ends with a `Promise` that resolves on `server.listen` but does not reject on the server `error` event. `runRegistryPhase` now correctly wraps acquisition in its cleanup lifetime, but `EADDRINUSE` escapes that promise as an unhandled event, terminates Node, and skips the caller's cleanup. A real loopback occupied-port probe wrapped the call in `try/catch/finally`; Node terminated with unhandled `EADDRINUSE`, and the catch did not run. Log: `/tmp/slop-completion-github-startup.log`. Fix only this fixture's startup promise to reject the server error and remove the temporary listener after listening. Validate through a real occupied-port scenario, not a mocked callback.

2. **ST09 retains three standalone client-method fragments under the user's strict non-contract-unit criterion.** The five originally named fake-chain scenarios are gone; the durable reservation/overlap and actual-client reconciliation cases are legitimate integrations. These three are different:
   - `workers/referral-accrual/poster.test.ts:437`: calls only `client.broadcast` and `message(error)` after seeding a DB, without executing the actual posting/recovery workflow or asserting any journal transition. Preserve its diagnostic privacy/wrong-hash behavior by driving `postNextRoot` through rebroadcast and asserting the durable row remains unknown, its signed bytes unchanged, and its reason contains only the safe category. The RPC fixture must model missing receipt with unchanged nonce for this workflow. Do not keep a helper-only redaction assertion.
   - `:462`: observes a mocked account factory/signing call and calls only `client.prepare`. This isolated quote/signer spy can be removed; the actual Anvil workflow already runs the over-cap quote through `runOnce`, asserts `gas_budget`, no post or gas rows, and unchanged nonce before the allowed run posts exactly once. The complete D1 gas-cap refusal case also remains.
   - `:636`: calls only `client.nativeCost` for controlled receipt shapes. Remove the direct return-value case or absorb any distinct legacy-liability assertion into actual journal reconciliation. Existing full Anvil workflow asserts recorded `maximum_wei`, `actual_wei == receipt.gasUsed * effectiveGasPrice`, and the receipt UTC day; actual-client `postNextRoot` cases already reject noncanonical/wrong-index evidence without closing the journal.
   These are bounded leftovers in an explicitly selected mixed suite, not a request for additional theoretical test coverage.

3. **Final combined acceptance is not yet green.** The durable validation index truthfully records the exact `f785dfab` matrix as346 passed/20 skipped/1 failed. The failure is the known profile identity race assigned to the frontend agent. Do not report all original goal requirements complete until its correction and relevant exact-head validation are recorded.

## ST01–16 status and retained workflow mapping

| Finding | Current source | Retained behavior / evidence |
| --- | --- | --- |
| ST01 | Complete | `profiles.spec.ts` contains only the real profile navigation/history case. The old census/helper unit and exclusive imports are gone. |
| ST02 | Complete | Both helper/marker suite files deleted; full installer authorizes/refuses revisions and performs install, update, no-op, rollback, lock and corrupted-archive behavior. 35-case installer run passed. |
| ST03 | Complete | Fee null-return case and terms parser shape matrix gone. Auth refusal/admin high-precision projection and generated terms→real preflight consumer remain. Optional combination of the two terms compatibility scenarios was not mandatory and their distinct compatibility inputs remain meaningful. |
| ST04 | Complete | Mock closure body gone from `account-sessions`. Real handler+SQLite closure now drops one successful response, verifies uncertainty, retained obligations/session revocation and explicit authenticated reopening. Precise intentional failed-response diagnostic is asserted once. Desktop/mobile4/4 targeted pass. |
| ST05 | Complete | Standalone mock monthly file deleted. Real Anvil browser checks owner default/opt-out and transaction authority. Final scoped Anvil browser8/8 pass is separately recorded. |
| ST06 | Complete | Static penalty fixture/display file deleted. `penalty-appeal.test.ts` persists debits/reversals, publishes the ledger, preserves month attribution and tests actual appeal/state transitions; general table/navigation UI remains. |
| ST07 | Complete | All11 duplicate JSON manifests deleted, sole frozen registry used through cloned lookup. Exact baseline comparison11/11 identical,46,583 bytes removed; caller references migrated. |
| ST08 | Complete | One refresh→D1→public API sequence retains both chains, wrong deployment/decreasing counters/decimals refusal, older-block suppression and forward progress. Edge-cache, evidence index, concurrent monotonic writes and bounded refresh tests remain. |
| ST09 | Partial | Five named fake-only scenarios gone, actual Anvil empty-first-file ordering added and passed. Three remaining standalone client fragments above require final cleanup. Durable fake-boundary D1 interleavings are retained appropriately, so their shared fakeChain is not dead. |
| ST10 | Deliberate keep | Per-case real R2 runtime retained with documented lifecycle/namespace complexity rationale. Optional optimization required a smaller measured-safe implementation; none was demonstrated. No synthetic Map substituted. |
| ST11 | Complete | Full desktop/mobile route matrix retained; six representative breakpoint families;18 distinct reflow/text scenarios; desktop-only reflow excluded from mobile discovery. Trailing-slash duplicate layout removed; HTTP alias route test remains. Later footer overlap checks strengthen actual geometry. |
| ST12 | Complete | Chromium-only preview1/preview2/Pages matrix entries; Chromium+Firefox registry1/registry2. Firefox test selection remains email/evidence. YAML valid. |
| ST13 | Complete | No live `test:escrow-policy` alias/caller remains. Main `verify:code` runs all retained Bun suites, actual native/chain workflows remain in escrow CI. |
| ST14 | Complete source; platform caveat | POSIX owned process group kill and Windows taskkill tree handling implemented, failures observable. Actual descendant heartbeat regression and nonzero/zero exit test pass. Windows workflow runs it before installer, with corrected source/fixture triggers. No local Windows execution claim. |
| ST15 | Partial | D1 creation/migrations/startup now within one acquired-resource lifetime; all acquired close/delete actions attempted and original error retained. Fix the unhandled GitHub server startup event above to cover the remaining real startup failure. |
| ST16 | Complete deliberate preservation | Independent Miniflare and bounded2-Anvil workflows retained; registry/Pages and explicit same-chain browser workflows default serial. Later preview cap2 is documented from observed contention and keeps independent parallelism; no retry/timeout weakening. |

## Stale-reference and inventory check

No live code/config/ordinary documentation reference remains to the deleted four suite files, `tests/fixtures/projects`, or `test:escrow-policy`. Hits in the two codebase review documents are deliberately historical before/after inventory. `scripts/skill-source-matches-commit.mjs` remains a live production helper imported by `prepare-site.mjs`; only its isolated `.test.ts` was removed, so that reference is correct.

Noncontract Bun suites63→62 (two helper suites deleted; one real subprocess suite added); browser specs31→29; protected contract TypeScript suites5→5. All contract tests remain. Native Windows and Solana tooling unavailable locally is disclosed by the validation index; existence of CI configuration is not represented as local execution.
