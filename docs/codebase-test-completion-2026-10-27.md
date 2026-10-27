# Remaining-test completion review — 27 October 2026 UTC

## Why this addendum is necessary

The earlier whole-codebase review and its implementation are preserved in [the first review](codebase-review-2026-10-26.md) and [the second review](codebase-review-second-pass-2026-10-26.md). They cover the requested structure, feature steps, UI reuse, copy, graphics, error handling, automatic actions, dead code and test-runner changes. However, their final test classification was too broad: a useful database or browser workflow can still contain unrelated unit assertions. A filename, fixture database, green run or generic “integration” label is not proof that every contained test meets the owner's explicit requirement.

This addendum records the remaining test-level gaps **before their implementation**, with an exhaustive declaration ledger. It does not reopen product policy or claim a fresh audit of unrelated later feature branches. The frozen audit source is `7812a2fb90365f8ba1c8ce34f45096340332e397`, whose tree is identical to merged main `c28814f4fe7b5e03c390017d3ff6754518739552`. The implementation starts from current development `0f44509acb996a101f6ca9de68fc022f89c9da8a`; its new test changes were separately classified below. No queued check is a new merge gate: the owner expressly requested merging without waiting.

## Complete test inventory and decisions

| Audit slice | Files | Source declarations inspected | Decision record |
| --- | ---: | ---: | --- |
| Script tests | 32 | 162 | Every declaration and parameterized body below; nine pure/partial declarations plus isolated fragments and one consolidation |
| Backend and fee/referral/payment/notification Worker tests | 20 | 259 | Every declaration below; six units, two incomplete startup cases and four fragment-bearing workflows |
| Browser, Slopbot and acquisition tests | 39 | 216 | Every callback below; two incomplete/metadata-only browser cases and embedded fragments |
| Python vetting workflows | 5 | 8 test methods and 3 executable workflows | Real OS/VM/acquisition workflows remain; synthetic frame-size arithmetic is removed |
| Skill installer | 1 suite | 35 executed lifecycle cases in retained evidence | Real Git authority, filesystem install/update/rollback and archives remain; no new unit fragment identified |
| Smart-contract suites and native workflows | Preserved | Exempt from unit deletion by the user's instruction | Contract source, byte layouts, accounting, proof, finality and native fixtures remain intact |

Counts describe source registration sites, not runtime parameter expansion. A test that checks a value after a meaningful action can remain useful; a literal or pure helper assertion alone cannot. Controlled external transports are retained only when a real coordinator, HTTP contract, database, filesystem, browser or chain boundary is being exercised. They are never cited as real provider/model qualification.

The declared implementation is to remove the listed isolated units and tautologies; consolidate useful concurrency, startup and migration outcomes into existing real workflows; remove only exclusive test scaffolding; and narrow the sole test-only export of `cvss3BaseScore` while retaining its internal implementation. There will be no new test file, no weakened financial/authentication guard, no change to application behavior and no deletion of contract tests.

## Relationship to the other requested cleanup categories

The original reports remain the authoritative finding-by-finding record for source structure, fewer user steps, shared UI, copy/graphics, automatic reads, dead code and exception handling. Their changes are present in the merged source, including the removed dead CLI, canonical skill scripts and JSON implementation, shared session/actions/wallet UI, automatic owner reads, bounded vault refresh, profile identity/deadline repair, footer layout, payload removal and process cleanup. This completion pass corrects the one remaining contradiction: helper tests and helper assertions that survived the earlier test pass.

The existing native contract complexity was also checked against the requested simplification criteria. The two EVM contracts have different public ABIs and token/proof responsibilities; `epochCount`/`nextEpoch` and fee accessors remain compatibility entrypoints. Network deployment wrappers already delegate to one factory implementation while pinning chain identity. Solana account constraints and Token-2022 admission protect exact owners, extensions, mints and layouts; the apparently unused monthly-source account remains an instruction-ABI compatibility account. Removing those interfaces, constraints or immutable native fixtures would change the product contract rather than remove dead application code. No native contract change is selected.

## Detailed independent audits

### Execution finding before the final test correction

The first grouped run after the removals passed 63 cases, skipped the intentional native-sandbox case, and failed four newly added acquisition-refusal cases. All four fail on the same pre-existing `ReferenceError: TEMPLATE is not defined`: development `0f44509a` appended an assertion using the old fixture constant after the earlier fixture had become mutable `templateSha256`. The cleanup did not change that reference. Replace only the stale name with `templateSha256`, retaining the exact assessed-template assertion and the complete persisted refusal/notice/repeat workflows. This is a test correction, not a production scanner change. The failed run remains recorded at `/tmp/slop-residual-scripts-tests.log` and must not be represented as a pass.

### Implemented result and verification

All listed removals and consolidations are implemented. Twenty-two source test declarations were removed across the three audit slices (10 script, seven backend/worker and five browser/new-worker declarations), with no new test file. Two whole helper-only files are deleted. The implementation removes 1,118 net non-report lines across 26 paths. Shared fixtures remain only where retained workflow consumers use them; exclusive control/wallet/schema-inventory scaffolding is gone. The README now explicitly describes the retained unit tests as smart-contract tests.

The real project-revision race now appends an immutable D1 revision during the existing authenticated release request and checks its refusal. The scheduled fee-converter case preserves actual pending conversion work when another network fails startup, and proves that off mode leaves those persisted rows unchanged. Migration checks compare full parent and child rows instead of index/trigger-name inventories. The existing cached referral API supplies the paused/void results rather than an isolated epoch helper. These changes preserve useful outcomes while removing their former unit-only substitutes.

The only production source diff against `0f44509a` removes `export` from the internally used `cvss3BaseScore`; normalizing that exact keyword reproduces the original file byte for byte. No smart-contract source, test, fixture or native deployment script changed. No new product, financial, signer or activation behavior was introduced.

Validation: all eight edited backend/fee/referral suites pass together, **239 cases and 1,920 assertions**. The ten edited script suites reconcile to **67 passes and one intentional native-sandbox skip**: nine unchanged suites passed in the first group, and the corrected scan-service suite then passed **15 cases/187 assertions** with that skip. The first group's four stale-template failures remain in its log. One initially retained migration schema-inventory reference failed during cleanup; it was removed and replaced by the same full-row preservation check, after which the complete eight-suite group passed. The focused Slopbot workflow passes **1/1**. Typecheck, changed-file formatting, Python syntax, static reference checks and whitespace validation pass. No full browser matrix is claimed for this test-only reduction; the owner explicitly requested merging without waiting for queued quality checks.

All exact R/U/I/F/C/EWT markers identified in the independent ledgers below were reconciled with the final source. Their earlier “remove” and “not yet satisfied” wording records the report-before-code state; this result section records their completed implementation. The previous whole-codebase source/UI findings remain resolved or deliberately retained for their documented authority/compatibility reasons.

# Final script-test classification audit

Audited source: `7812a2fb90365f8ba1c8ce34f45096340332e397`, whose complete tree matches main `c28814f4`. Later development changes are excluded except the two explicitly requested `e2a0148e` additions below. Read-only; no test execution or source edits.

Inventory: **32 files, 14,343 lines, 162 source test declarations** (test.each and loops expand at runtime; one native-sandbox declaration is conditional). Every source declaration is listed below.

## Classification criteria

- **K — retain complete boundary/workflow:** actual command reads/writes artifacts, actual OS/process lifecycle, real SQL state/refusal/concurrency through a production handler/service, or producer→consumer bytes across real modules. Controlled external transport is acceptable where the test is expressly about routing/state, not provider/model qualification.
- **R — remove unit/partial smoke:** direct pure parser/planner/validator or return-shape/wording assertion without the relevant production entrypoint or persisted/user-visible outcome. Loading a file, seeding an unused database, self-serving an object, or spawning a wrapper around the same helper does not make this an integration.
- **M — meaningful workflow with removable fragments:** retain its real outcome and prune the listed unit/tautological segments.
- **C — consolidate duplicate complete outcomes:** not a unit, but reuse an existing full flow rather than a separate setup for one default field.

## Concrete gaps

**Nine source declarations remain removable unit/partial cases across five files**, including one whole 157-line helper-only file (`vetting-public-key.test.ts`). Additional mixed workflow/fixture fragments and one consolidation opportunity are identified below. The previous broad “retain integration” labels missed these. Detailed dispositions and exclusive helper/import consequences follow; none requires changing production behavior.

1. **`project-application-github-check.test.ts`:** R277, R331; remove direct-control tail315–328 from M296. Remove `control()` (97–110), its `repositoryControl` and `parseRepositoryIdentity` imports. The fake `partner-lab/shared-models` and `example/registry-docs` transport records and docs-old aliases are exclusive to these direct helper probes; retain `repository()` because the real admission refusal at266 still constructs a second repository. Keep actual Pages/SQL submit cases.
2. **`project-registry-api.test.ts`:** R1101 archive-key/wording smoke, R1784 and R1856 pure planner cases. Remove their exclusive `slugify`, `buildProjectPublication`, `EnforcementRefusal`, and `ProjectEnforcement` imports. `planEnforcement` and `projectRestriction` remain used by the earlier real historical persistence bridge and must not be blindly removed. Prune null-return smoke1141–1146 and fixed-input length835. C2119 can join the actual referral scenario at2065/2127. Keep all meaningful registry, security, race and SQL outcomes.
3. **`vetting-public-key.test.ts`:** remove the sole test and file. Its local HTTP server only returns metadata the test assembled itself; it never traverses the actual release-mode validation/provider metadata read or production derive/assemble/verify CLI. If this security boundary needs retained coverage, a single actual CLI lifecycle with an explicit controlled provider transport is the meaningful replacement. No checked-in fixture file becomes exclusively dead; Wrangler source configs are production inputs.
4. **`quality-payment-ledger.test.ts`:** R304 and R330 test `prepareSourceCorrection` directly and infer acceptance from a different rejection. Remove these sections and exclusive `correctionError()`, `recoveredFrom()`, `prepareSourceCorrection` import, and the now-exclusive “adds” synthetic snapshot branch. Keep CLI293/355. Preserve the distinct no-double-credit requirement via `scripts/prepare-source-correction.ts` command input/output if replacing, not another helper unit.
5. **`terms-preflight.test.ts`:** R94 manually mutates policy then checks a parser’s return. First case83 retains actual publication→file authority→consumer compatibility. To preserve bounty compatibility, supply a bounty through the publication producer within that flow; do not keep the manual shape variant. No exclusive checked-in fixture.
6. **`historical-cycle-registry.test.ts`:** generated subprocess lines47–55 and60–72 are isolated `assertLeaderboardSnapshot`/`assertPublishableLeaderboardSnapshot` matrices. Remove them and exclusive `snapshotFixture` / `assertPublishableLeaderboardSnapshot` imports from the generated program; retain the actual proposal/archive validation, tampered proposal refusal and invariant digest across registry changes.
7. **`vetting-scan-service.test.ts`:** remove938–979, which writes `service.json` then calls `serviceConfigFrom` and checks a parsed profile/error. `serviceConfigFrom` import becomes dead. Keep904–936 because the actual coordinator must refuse before contacting provider/queue and leave no persisted pending assessment.
8. **Small tautologies outside test outcomes:** remove `prepare-monthly-rewards.test.ts:85` empty-helper return; `fee-converter-release-preflight.test.ts:64–65` self-checks of fixture string substitutions; `cycle-index-review-excluded.test.ts:183` reread of text just written; `owner-award-authority.test.ts:33` static frozen fixture type. These do not prove the actual CLI/DB/authorization outcomes that follow.

There is **no justification to delete an entire real SQL/HTTP/CLI test merely because it contains a controlled external boundary**. In particular the trace-upload suite has a create-only R2 stand-in, but its authentic signatures, migrated SQL reservation/attach/finalize behavior are real; it is not native-R2 qualification. The scan service uses synthetic provider outputs and must never be cited as real model qualification.

## Every source declaration

### `scripts/account-closure.test.ts` — 358 lines

Real migrated SQL, authenticated points handlers, session invalidation, preserved obligations and closure/reopen/retired-route outcomes.

- **L70 K** — closing an account ends every session, removes optional connections and keeps records. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L216 K** — a closed account signs in again only through an explicit reopen. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L272 K** — closure needs a signed-in session and a same-origin JSON request, and a repeat is safe. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L322 K** — retired Telegram routes reveal no links and preserve historical records. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/account-sessions.test.ts` — 82 lines

Real migrated SQL and authenticated session list/revoke API; another actor retains access while the revoked cookie fails.

- **L7 K** — account sessions revoke only the authenticated actor and invalidate the revoked cookie. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/collect-quality-census.test.ts` — 263 lines

Actual collector CLI consumes paginated GitHub stand-in responses, writes census files, then actual quality-preparation CLI consumes them; reject invalid periods at the CLI.

- **L216 K** — a mid-month reward start excludes earlier closures and the census reconciles. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L256 K** — a month before the project's reward start is refused. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/cycle-index-review-excluded.test.ts` — 190 lines

Actual sync CLI exports a cycle index from changed on-disk historical proposals and verifies refusal/acceptance; retain the workflow but remove the immediate literal readback below.

- **L172 M** — the sync script accepts an excluded row end to end. Keep actual sync acceptance/counterexample; drop literal reread assertion at184 immediately after this test writes that same value.

### `scripts/e2e-runner.test.ts` — 143 lines

Real OS child processes, a descendant heartbeat/PID, timed termination, exit status, and occupied TCP port rejection/release/rebinding. No spawn mocks.

- **L11 K** — a timed-out launcher stops its descendant server before returning failure. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L77 K** — a completed phase preserves successful and failed child exit codes. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L92 K** — an occupied fixture port rejects startup and lets the caller release and reuse it. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/enrich-contribution-quality.test.ts` — 107 lines

Actual CLI reads quality/census/PR-diff files and writes enriched output. Assertions inspect the actual output artifact, including actor-wide propagation and stale/incomplete inputs; this is the command’s complete product outcome, not a pure function wrapped in a gratuitous subprocess.

- **L70 K** — all merge-credit actors receive diff evidence without a false duplicate group. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L81 K** — inspection failures remain visible for every merge-credit actor. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L95 K** — matching patches on different PRs flag every actor once. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/fee-converter-release-preflight.test.ts` — 120 lines

Actual checked-in shell preflight executes with Bash error behavior and the Worker parser; refusal prevents the upload continuation. Remove fixture self-checks, retain all four outcomes.

- **L91 K** — the release stops before upload on %s [3 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L111 K** — the release continues when every enabled live network has its key. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/historical-cycle-registry.test.ts` — 102 lines

Actual proposal builder and archive consumer across separate processes/changed registry, comparing immutable proposal bytes. Keep that integration; embedded standalone snapshot parser matrices are removable.

- **L17 M** — a frozen owner proposal survives registry copy and primary changes. Keep archive/registry workflow; remove standalone snapshot validator mutations at47–55 and60–72.

### `scripts/identity-maintenance.test.ts` — 59 lines

Real loopback HTTP plus migrated SQL through scheduled maintenance; failed renewal leaves old evidence, cleanup still happens, recovery advances it.

- **L7 K** — a failed intake renewal fails the job, preserves evidence, and still cleans expired state. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/legacy-repository-registry.test.ts` — 82 lines

Actual project handler with migrated SQL refuses duplicate historical repository identity and accepts the historical id.

- **L73 K** — a project for a legacy repository must reuse its historical id. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/owner-award-authority.test.ts` — 169 lines

Actual Pages route, persisted session/registry, and controlled GitHub reads prove private monthly authorization and refusal of transferred/wrong actor; remove static fixture-type assertion only.

- **L14 M** — organization maintainers reach private monthly awards through their own session; other actors and transferred repositories do not. Keep actual authorization flow; drop static frozen-fixture Organization assertion at35.

### `scripts/payout-exclusion.test.ts` — 217 lines

Real snapshot→monthly base→migrated SQL→owner allocation service, confirming excluded principal is not allocated and another allocation can change.

- **L87 K** — an excluded owner keeps the score, receives nothing, and the other share is not reduced. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/points-import.test.ts` — 372 lines

Generated SQL executes against real migrations and real points HTTP/API responses, covering append-only prefix, incomplete batch rollback, stale cursor, private identity and retired awards.

- **L58 K** — points publication retains the exact permanent history prefix. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L130 K** — a staged coverage list is served whole and an incomplete one publishes nothing. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L173 K** — journal reads select the complete prefix before generation-time tie breakers. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L214 K** — member lookups fail closed when a stale public login collides with a private member. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L290 K** — X-connection awards recorded from 24 October 2026 report no points. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/prepare-monthly-rewards.test.ts` — 89 lines

Real generated proposal SQL persists once on migrated DB and refuses replacement/deletion; remove unrelated empty-helper-return assertion.

- **L25 M** — a month's proposal is stored once; a later ledger never adds or replaces rows. Keep generated SQL persistence/replay/deletion checks; drop empty helper-return assertion85.

### `scripts/project-application-github-check.test.ts` — 524 lines

Mixed. Actual Pages+session+SQL submission cases are meaningful. Direct repositoryControl calls with fetch replacements bypass the admission workflow and are units.

- **L217 K** — an owner whose write access Slopbot reads creates the project at once. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L234 K** — no project is created when Slopbot reads %s [4 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L266 K** — a new project lists exactly one repository. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L277 R** — every listed repository must be a public GitHub repository. Direct repositoryControl result/lookup assertions only; no handler, persisted admission or artifact consumer. Remove with its exclusive control helper.
- **L296 M** — an alias must lead to the repository it names. Keep the two real submit outcomes; remove trailing direct control(...) assertion at315–328.
- **L331 R** — a check names at most 5 repositories and aliases. Direct repositoryControl limit/lookup-count unit. Remove; real single-repository admission policy already runs through submit at266.
- **L366 K** — publishing a stored application rechecks its alias facts: %s [3 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L438 K** — the repository owner is accepted as steward in any login case, from the App response alone. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L450 K** — another account’s %s with the owner’s id is refused [2 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L465 K** — a project cannot claim a different GitHub owner account type. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L476 K** — an owner write refuses %s from the App [6 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/project-registry-api.test.ts` — 2153 lines

Mixed. Retained handlers operate real project/enforcement SQL and R2-backed evidence or consume approved artifact bytes. Pure enforcement planners and archive-key/wording smoke remain below.

- **L305 K** — serves a newly approved project at once, purging the cached list. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L339 K** — an owner revision publishes at once and appends only its expected revision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L415 K** — owners publish bounty terms and open only with current verified vault funds. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L673 K** — reads token decimals from chain once, stores the amount in base units and keeps them on later revisions. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L812 K** — refuses an unverifiable or malformed token and stores nothing. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L833 M** — refuses a project id too long for its reviewer skill name. Keep actual overlong-ID API refusal/no stored project; drop the fixed-string length assertion at835.
- **L847 K** — refuses activation when historical clean metadata lacks canonical closure. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L882 K** — creates a project only for current GitHub authority and refuses contradicted facts. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L975 K** — serves the exact approved bytes of a revision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L990 K** — looks up GitHub only for a signed-in visitor and caches the facts. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1101 R** — an id derived from a long project name renders the reviewer skill. Mostly archive-name length/key-existence and telemetry wording; real DB setup does not turn buildProjectPublication return-shape smoke into archive installation. Remove or merge the long-name input into existing full installer/publication workflow.
- **L1139 M** — historical clean metadata cannot publish skills without canonical closure. Keep all gated artifact outcomes; remove unrelated null-return smoke at1141–1146.
- **L1224 K** — an ordinary ban preserves the owner's project appeal for independent review. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1262 K** — quarantines and bans while refusing an appeal with only historical clean metadata. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1585 K** — a revision of another project cannot claim a banned repository. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1643 K** — a ban closes the public routes of another project listed for the repository. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1710 K** — another project listed for a banned repository can still be retired. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1784 R** — an account-only appeal cannot reinstate the project, while a project appeal can. After unnecessary DB seed, only projectRestriction/planEnforcement are called on fabricated records and returned values/errors checked. Remove; actual account/project appeal flows in project-self-service retain these policy boundaries.
- **L1856 R** — reinstatement is refused while the restriction revision is pending. Creates fake project/restriction then only calls planEnforcement and checks error code/status. Remove; real stale/restricted write and appeal workflows remain.
- **L1920 K** — a revision fails when a restriction lands after its read. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1964 K** — cached skill and public clearance cannot survive loss of retained evidence. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2065 K** — records the referrer once on the created project. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2095 K** — a recycled login cannot attribute the applicant to an older cached member. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2119 C** — a project that names nobody records no referrer. Consolidate this default-only creation/referrer check into the complete referral workflow at2065 or2127; omission/null behavior can share its existing database.
- **L2127 K** — refuses the applicant, the steward, team accounts and unknown logins. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/project-self-service.test.ts` — 2644 lines

Actual project/trace handlers, migrated SQL, immutable revisions, account-vs-project appeal semantics and controlled concurrent writes. The CLEARED fixture supplies an external scan prerequisite; it is not asserted as real model qualification.

- **L181 K** — a new project cannot reuse a listed project id or repository. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L197 K** — an admin revision still replaces the listed project with that id. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L219 K** — creation requires the Slopbot installation, then queues the first scan and returns one status. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L261 K** — setup activates a project only with installation write access and a clean scan. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L345 K** — an owner records and revokes explicit closure consent with current authority and immutable revisions. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L426 K** — owner revisions publish presentation at once, rescan skill inputs and apply money prospectively. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L556 K** — an owner revision cannot record a vault; a reviewed admin revision can. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L627 K** — a payout exclusion starts with the next UTC month on every revision path. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L727 K** — an application stored before self-service setup publishes once, by its applicant. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L812 K** — an explicit moderator ban blocks new contribution intake without blaming the original applicant. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1509 K** — account-ban appeals after project appeal or reinstatement resolve role, refusal and independent reviewer notices. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1512 K** — a concurrent project appeal refuses the stale account request and a fresh retry uses the account role. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1515 K** — denying the project appeal leaves a banned account's appeal for its own decision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1606 K** — an open account appeal survives later project restrictions and needs an independent account reviewer for each decision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1931 K** — a malicious decision that closes a kept project appeal needs an independent moderator while an account appeal is open. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1950 K** — an account release leaves the kept project appeal for an independent malicious decision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1968 K** — a banned owner or moderator separates its project appeal from its account appeal in both filing orders. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2143 K** — account-reinstatement upgrade preserves prior releases and separates future project decisions. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2208 K** — a ban issued during %s blocks the owner revision [2 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2355 K** — only the steward or a repository admin can register the project vault. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2434 K** — a ban issued during the authority check prevents automatic activation. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L2532 K** — an account-page appeal from a banned owner survives reload without opening a project appeal. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/quality-external-evaluation.test.ts` — 263 lines

Actual award loader→snapshot→quality CLI persists an external evaluation record in generated quality output.

- **L239 K** — prepare-contribution-quality keeps the award as an evaluation. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/quality-payment-ledger.test.ts` — 363 lines

Mixed. Keep actual quality CLI outputs for current and archived cycles. The two source-correction refusal cases then call a pure exported preparation helper and inspect error messages without executing its CLI or producing a correction artifact.

- **L293 K** — prepare-contribution-quality builds evidence from the payment review ledger. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L304 R** — source correction accepts that evidence and refuses to recover the removed review. CLI input setup is repeated, but subject is pure prepareSourceCorrection rejection. No correction CLI output is created; “accepts evidence” is inferred from a later error. Remove or replace with actual prepare-source-correction CLI refusal/output preservation.
- **L330 R** — source correction refuses to recover a review only the payment review ledger credits. Pure source-correction rejection after generated input; move distinct no-double-credit refusal into the same actual correction CLI workflow if retaining it.
- **L355 K** — prepare-contribution-quality accepts the archived September cycle. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/release-registry.test.ts` — 359 lines

Real migrated registry HTTP, snapshot CLI, checked-in shell digest/transport steps, and actual attester config generator. Missing/stale/tampered inputs stop before untrusted module import.

- **L71 K** — release carries the checked D1 registry and history into canonical attester setup. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/solana-vault-setup-network-failure.test.ts` — 280 lines

Actual owner route + SQL + loopback Solana RPC and program verification; unavailable RPC differs from wrong program, logs stay private, revision does not change.

- **L241 K** — an unreadable Solana RPC is a retry, while a program mismatch still refuses. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/staging-release.test.ts` — 238 lines

Actual Git repositories and staging-order CLI with a stateful gh transport stand-in; exit/continuation implements the release gate itself. Distinct ancestry, history and provenance refusals retained.

- **L130 K** — a verified ancestor can progress while development advances; old guard rejects it. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L143 K** — a newer attempted deployment prevents rollback regardless of success. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L150 K** — a newer %s record does not block an older release [3 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L193 K** — a divergent deployment prevents overwriting unknown staging state. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L198 K** — a force-pushed development branch cannot authorize an abandoned candidate. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L204 K** — history pagination cannot hide a newer attempt on the second page. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L211 K** — unavailable, malformed or unknown deployment provenance fails closed. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L225 K** — history beyond the bound fails rather than trusting an incomplete scan. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L233 K** — wrong checkout, repository or branch cannot reach the staging gate. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/terms-preflight.test.ts` — 103 lines

Mixed. The first case feeds the real publication route’s terms bytes into the real file-authority preflight consumer. The second edits fixture terms then only calls the parser.

- **L83 K** — acknowledges the terms.json slop.cash serves for a project without a bounty program. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L94 R** — acknowledges public security bounty terms and a policy served before them. Manually adds/removes securityBounty on an already built object, then checks preflight return only. Remove parser-only variant or derive both policies through the real publication route inside the first workflow.

### `scripts/trace-upload-attachable.test.ts` — 481 lines

Actual authenticated trace handlers and migrated SQL execute create/intent/reservation/upload/finalize/ban interleavings. R2 is a controlled create-only stand-in: keep as handler/DB integration, never claim native R2 qualification from it.

- **L243 K** — a second trace for a run is refused at the intent, and its bytes are never written. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L257 K** — an intent issued before another trace attached cannot write its bytes. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L276 K** — an intent issued before finalization cannot write its bytes afterwards. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L298 K** — overlapping different uploads retain only the reserved trace. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L314 K** — a failed storage write retains its reservation and permits a same-byte retry. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L337 K** — an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L381 K** — a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vault-setup-network-failure.test.ts` — 276 lines

Actual owner route + migrated SQL + loopback EVM RPC/factory verification; HTTP429, refused connections and incompatible code preserve truthful retry/error states and no changed revision.

- **L238 K** — an unreadable RPC is a retry, while a factory mismatch still refuses. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vetting-api.test.ts` — 1119 lines

Actual signed intake/project/operator APIs with migrated SQL and native local R2 test closure, grants, byte digests, concurrency and fail-closed outcomes.

- **L240 K** — the trusted publisher journals one signed intake attempt. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L327 K** — a signed clean claim without canonical closure cannot activate the revision. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L358 K** — the queue binds commits and templates without accepting an unsupported clean claim. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L402 K** — an incomplete result quarantines the revision and blocks activation. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L501 K** — an unavailable model review can never produce a clean result. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L521 K** — confirmed malice bans the project; a model label alone cannot. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L618 K** — forged, stale, mismatched and unconfigured requests fail closed. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L682 K** — private retained bytes remain inspectable without granting clean clearance. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L801 K** — a clean result cannot omit a referenced retained artifact or replace an immutable inventory. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L836 K** — historical metadata-only clean results have no retained-evidence exemption. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L854 K** — missing storage pauses acquisition while harmless queue registration remains available. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L871 K** — large retained evidence uses bounded chunks, immutable completion and actor-bound native downloads. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vetting-public-key.test.ts` — 157 lines

Unit suite disguised as a release round trip. Calls publicScannerKey/scannerPagesConfiguration/verifyScannerPublicKey directly; test writes/reads their object and serves that same object over loopback. Does not execute derive/assemble/verify release command, gate or provider-readback path.

- **L16 R** — release assembly keeps plaintext settings, excludes signing material and reads back each environment's exact public key. Entire case is helper assembly/validator testing with test-owned file and self-echoed HTTP metadata. Remove file, or replace with the actual derive→assemble→verify release command on controlled provider transport.

### `scripts/vetting-publication-journal.test.ts` — 101 lines

Actual SQL migration and publication journal reserve/complete operations, including lost committed replies, concurrent uniqueness and immutable receipt constraints. Stub fetch transports SQL to real SQLite; it does not manufacture results.

- **L54 K** — a restarted controller preserves an intent even when its reservation reply is lost. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L67 K** — only one concurrent controller can reserve a publication and its metadata stays immutable. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L83 K** — a receipt must match the reserved result and remains exactly once. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vetting-queue.test.ts` — 346 lines

Actual signed queue/project HTTP handlers, migrated SQL, real Git objects and acquired on-disk bundle. Tampered pin/identity prevents a bundle and leaves persisted queue pending.

- **L273 K** — signed real queue and SQLite revision acquire exact Git and template bytes without finishing assessment. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L322 K** — changed revision/template bytes and wrong signer leave queue pending and no completed bundle. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vetting-scan-flags.test.ts` — 1270 lines

Actual project/flag/signed-scan APIs, migrated SQL, local R2 and database upgrade; state and user-visible listing follow each flag/scan/appeal transition.

- **L396 K** — a clean supported scan lets activation proceed without an admin scan request. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L444 K** — changed executable content is rescanned; identical content reuses the cached scan. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L476 K** — an incomplete or legacy result never clears. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L497 K** — two distinct flags pause atomically with one moderator notice; a clean fresh scan reinstates. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L615 K** — a flag filed during a scan waits for a newer scan (offset %i) [2 variants]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L656 K** — withdrawn flags stop counting and owners cannot flag. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L699 K** — only established contributors outside the project may flag. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L730 K** — a flag stops counting 90 days after it was filed. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L754 K** — a confirmed malicious result after a flag pause stays with a moderator. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L803 K** — the database refuses a flag pause without two distinct active reporters. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L829 K** — a banned account cannot add a flag but can withdraw its earlier flag. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L858 K** — a concurrent account ban cannot supply the flag that pauses another project. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L870 K** — the existing-project exemption is permanent but cannot clear reinstatement or later projects. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L951 K** — an exempt owner edit stays active without a scan, while flags still require fresh reinstatement. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1084 K** — a non-exempt owner executable edit still pauses and queues its new content. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1123 K** — withdrawing a flag after the 90-day lifetime expires it by lifetime and returns 404. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1151 K** — a cached scan from before a two-flag pause is refused and cannot reinstate the project. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1178 K** — a completed scan for a superseded commit pin records without lifting a flag pause until the live pin is scanned. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1232 K** — a live-pin outage while a fresh clean scan lands defers the flag reinstatement to the next refresh. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/vetting-scan-service.test.ts` — 1113 lines

Actual scan coordinator→real Git→loopback provider protocol→R2→signed publication/project SQL. Controlled provider outputs establish service routing/retry, not model correctness. One embedded config-reader unit section remains.

- **L586 K** — authenticated source acquisition exceeds the public quota without sharing its credential. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L627 K** — a provider outage leaves the scan pending; the next pass clears the project with one Surplus review. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L675 K** — an ambiguous primary review runs the Surplus specialist once before publication. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L697 K** — a failed specialist is a service failure: nothing is published and the scan retries. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L756 K** — a clean result is never published without its retained evidence; the next pass retries. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L783 K** — an incomplete result is published although the evidence store fails, so the models are not called again. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L810 K** — malicious-code detection: risky new content is flagged, escalated to the specialist and kept quarantined. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L859 K** — a two-flag pause is reinstated automatically after the service's clean fresh scan. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L904 M** — an unpinned endpoint or model fails closed before the queue or any provider is contacted. Keep runScanPass refusal with no persisted queue/provider activity; remove file→serviceConfigFrom unit tail938–979.
- **L982 K** — unsupported artifacts produce an incomplete scan rather than aborting the scan pass. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L1051 K** — a native artifact runs only in the real disposable sandbox and stays quarantined [conditional native sandbox]. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

### `scripts/wallet-possession.test.ts` — 200 lines

Actual cryptographic signing, authenticated trace routes and real migrated challenge/proof records; shifted/expired windows cannot persist proof and correct signature can.

- **L151 K** — refuses an expired challenge re-signed over a later window. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L170 K** — refuses a live challenge signed over a shifted window. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.
- **L182 K** — records a proof over the window the server issued. Retain the complete outcome through the boundary described above; controlled preparation is not asserted as provider/chain qualification.

## Requested post-main development delta (`e2a0148e`)

- **`scripts/vetting-release-dispatch.test.ts`, new sole declaration: K.** Executes the checked-in Bash dispatcher with a stateful GitHub CLI transport. Actual queued branch state and process exit are verified for production/staging completion, changed head, skipped deployment, active scan, other branch, failed dispatch and cron backstop. This is the dispatcher’s complete boundary, not a direct helper test. Local fixture script/state files are exclusive setup; no new unit fragment identified.
- **`scripts/vetting-scan-service.test.ts`, new “a template update replaces stale queued work without changing its retained assessment”: K.** Calls the complete scan coordinator, changes the live template input, verifies persisted old and new SQL records plus no duplicate next pass and denied activation. New reset of the template fixture prevents cross-test leakage.
- **Same file, added interrupted-scan/flag scenario in the existing reinstatement case: K.** Actual coordinator/SQL pending scan, second flag-triggered scan, database duplicate pending-index refusal, fresh completion and user-visible reinstatement. Direct INSERT is testing a real database constraint, not a pure schema parser.

## Suggested implementation/validation scope after report approval

Delete/prune the R/M portions without touching production code or retained native contract tests. Consolidate the single C default-field case into its real referral workflow. Recompute unused imports and local fixture reachability after deletion. For preserved distinct security/correction behavior, route it through an existing real CLI or admission workflow instead of inventing parser units. Run the edited SQL/CLI/fixture suites and existing installer only if their inputs change; no need to rerun live-provider or mainnet work. This audit itself ran no tests and made no source edits.

## Approved implementation disposition

Parent review approved the R/M removals and C consolidation as test-only cleanup. Do not add replacement tests or production seams, and do not recreate the discarded source-correction/parser cases. Preserve existing complete CLI/SQL/HTTP workflows and both separately audited post-main vetting workflow additions. Planned source edits are limited to these 11 existing paths:

- `scripts/project-application-github-check.test.ts`
- `scripts/project-registry-api.test.ts`
- `scripts/vetting-public-key.test.ts`
- `scripts/quality-payment-ledger.test.ts`
- `scripts/terms-preflight.test.ts`
- `scripts/historical-cycle-registry.test.ts`
- `scripts/vetting-scan-service.test.ts`
- `scripts/prepare-monthly-rewards.test.ts`
- `scripts/fee-converter-release-preflight.test.ts`
- `scripts/cycle-index-review-excluded.test.ts`
- `scripts/owner-award-authority.test.ts`

## Final development delta: `e2a0148e` → `0f44509acb996a101f6ca9de68fc022f89c9da8a`

Only `scripts/vetting-scan-service.test.ts` changes within the planned edit paths. One parameterized declaration adds four complete coordinator scenarios: source-entry cap with evidence available/unavailable, oversized source response, and truncated source tree. Each traverses real local Git acquisition, `runScanPass`, persisted assessment/result, evidence retention, activation refusal, owner notification SQL, and repeat-pass idempotency. The unavailable-evidence variant checks that refusal resolves without falsely claiming retained evidence. These are **M: retain the workflow and prune one direct-helper fragment**. Controlled GitHub/provider transport does not claim live model qualification.

- Keep all four boundary scenarios and their persisted incomplete/not-inspected, no-provider-call, evidence, activation, recipient, and no-repeat-work assertions.
- Remove only `expect(summarize(assessment).modelRuns).toEqual([])` and the now-exclusive `summarize` import: that direct summary-helper shape assertion is redundant with the real result's not-started review and observed zero provider calls. It has no additional boundary outcome.
- The new `sourceResponse` fixture switch and oversized/truncated response branches are used by these retained acquisition workflows; keep them. No separate fixture file becomes dead.
- Baseline inventory remains the frozen main inventory above; this is one additional source declaration expanding to four runtime scenarios, not a rewrite of that inventory. The previously approved `serviceConfigFrom` parser-only fragment is still removable after rebasing; use content anchors because line numbers shifted.


---

# Final backend/worker test audit

Audited frozen tree: `7812a2fb90365f8ba1c8ce34f45096340332e397` (same application tree as merged main `c28814f4`, per parent). Scope: every `backend/**/*test.ts` and `workers/{fee-converter,referral-accrual,payment-executor,notify}/**/*test.ts`: **20 files, 14,690 source lines, 259 test declarations**. Parameterized/loop declarations count once; every listed variant/body was inspected. No source edit or test execution was performed for this audit. Later branch changes are excluded.

This is a fresh body/fixture audit, not inherited “integration” labels. A migrated database allocated but never reached does not make a unit test an integration. Retention requires an actual HTTP contract, coordinating workflow with persistent state, transaction/crypto boundary tied to storage, or real SQL migration/constraint execution. Controlled provider responses are permitted to exercise those boundaries but do not prove live provider/chain qualification. Merely calling a client helper with mocked wallet methods is not sufficient.

## Required removals/consolidations

**Six unit-only declarations remain (U1–U6)**. Remove their isolated form. U5 should carry its useful race through the existing real API/D1 scenario rather than lose the authority guard. **Two incomplete/no-op declarations (I1–I2)** should be consolidated into meaningful Worker execution with existing durable state, rather than counted as complete integration. **Four surviving declarations contain removable or replaceable unit/inventory fragments (F1–F4)**. All other **247 declarations** have the concrete boundary recorded in the full ledger below. Thus this frozen tree does **not** yet meet the user's complete non-contract-unit cleanup request.

### U1 — deterministic analyzer unit

`backend/security/submissions.test.ts:1751–1787`, “the deterministic analyzer only recommends from structured fields”: directly calls `cvss3BaseScore` and `deterministicAnalyzer.analyze` on object literals; no HTTP route, DB, adapter or persistence is reached. Delete this whole declaration. Drop `cvss3BaseScore` from the import at line27; retain `deterministicAnalyzer`, which is a real setup dependency at line162. The actual intake cases at909,1027,1150,1188,1832 still exercise routing/analysis as part of persisted report handling. If a structured-field/prompt-injection counterexample is retained, put it through existing `ready`/`send` and inspect the stored case routing result, not another analyzer-only call.

`backend/security/report-analysis.ts:33` exports `cvss3BaseScore` solely for this unit outside its module. Its production call at line91 remains: **remove only `export`, not the function or scoring behavior**. No whole production module is dead.

### U2 — constructor/key-check unit

`workers/fee-converter/fee-converter.test.ts:233–253`, “a key that does not control the configured fee wallet is refused”: allocates D1/NativeGasJournal but only executes `createEvmClient`'s synchronous constructor with `generatePrivateKey` and expects a throw. No row, RPC, Worker or coordinator is reached. Delete the isolated declaration and its local dynamic `generatePrivateKey` import. `createEvmClient`/`NativeGasJournal` imports remain used by real quote/native/claim integrations. Preserve the production key-control check. If coverage is needed, exercise a wrong key through the existing Worker startup/integration path and assert real existing work remains untouched.

### U3 — config/getter sentinel unit

`workers/fee-converter/native-gas.test.ts:146–163`, “missing native limits refuse before the Worker reads its key”: `runOnce` exits in config parsing; its D1 handle is never used, and the only side-effect oracle is a getter counter. Remove the standalone declaration; its `runOnce` import at line22 then becomes unused. Keep `envLimits`, which still configures the actual signed-journal fixture. The real adapter preparation/native-cap scenarios at506, actual journal contention at165, and actual Anvil per-transaction budget scenario remain. Missing-config refusal may be folded into a Worker integration with an already populated journal; do not replace it with another mock getter unit.

### U4 — scope-only early-return unit

`backend/payments/monthly.test.ts:1075–1083`, “private bounty programs never run the monthly coordinator”: passes `{PAYMENT_SCOPE:'security-bounty'} as never` and checks `null`. It reaches no DB, registry, scheduler or financial record. Delete it and the test import `runMonthlyCoordinator` at line26. **Keep the production export**: `workers/payment-executor/index.ts:29,637` is a real external consumer, and the payments Worker calls it internally. Existing real monthly owner/coordinator suites remain; private bounty exclusion should be asserted against actual funded private-program rows through a Worker flow if retained.

### U5 — mocked revision-counter race

`backend/payments/monthly.test.ts:2137–2162`, “a concurrent project revision change refuses a prepared reserve release”: `getProject` is replaced by an object-returning closure and `releaseReserve` increments an in-memory number. In this service path all project reads are injected and no D1 read/write is reached; the global beforeEach DB is decorative. Fold the counterexample into the preceding real Request/session/D1 case at2064: append a genuine immutable project revision in the release dependency, then assert the real request refuses stale authorization. Remove the isolated mocked declaration and its local `revision` counter; common fixtures/imports remain. Preserve `unchanged`/authority behavior in production.

### U6 — wallet-helper unit wrapped in a fixture read

`backend/referrals/claims.test.ts:263–298`, “wallet review is read-only, and an explicit send rechecks the exact claim without token approvals”: the initial real API read merely supplies an object. The tested behavior is then `reviewReferralClaim`/`sendReferralClaim` against `connection`'s canned wallet replies and an in-memory `pendingSaved` boolean; there is no browser/localStorage, actual chain receipt or post-send persistence. Remove this declaration and exclusive `connection` helper at205–261. Remove test-only imports `decodeFunctionData`, `encodeFunctionResult`, `REFERRAL_ABI`, `ReferralAccount`, `reviewReferralClaim`, `sendReferralClaim`; keep `Hex`, `keccak256`, `code`, `buildTree` needed by the actual cached API fixture. `src/ReferralClaims.tsx:164,178` still uses the production helpers: **keep both functions**. Actual browser flow `tests/e2e/referral-claims.spec.ts:154` covers review/sign/reload/reconcile; the real Anvil referral driver covers on-chain claim/finality. Root/amount/account refusal cases may join that existing browser workflow if they are not already covered there.

### I1–I2 — incomplete Worker startup checks

- `workers/fee-converter/fee-converter.test.ts:180–189` only checks default config, `runOnce` early-return `[]`, and zero rows in a database that started empty. Remove the standalone `parseConfig({}).mode` assertion and fold default-off behavior into a run with existing conversion/lease state, proving it is unchanged and no attempt is made. Config inputs used to execute a real flow are retained; parser output alone is not.
- `workers/fee-converter/fee-converter.test.ts:191–231` does invoke `worker.scheduled`/`waitUntil`, but both networks stop at missing-key parsing. Two console strings and two still-empty tables do not demonstrate continued useful work after one network fails. Consolidate with the existing healthy conversion workflow so one enabled network completes durable work and another fails startup, while the overall scheduled promise still rejects. The actual all-networks-attempted failure behavior must remain. The isolated `work.toBeDefined()` is setup smoke; a missing promise should fail an explicit setup guard rather than add a product assertion.

### F1–F4 — remove unit/inventory fragments, retain surrounding integrations

- **F1:** `backend/referrals/claims.test.ts:192,195` directly checks `activeClaimEpoch(h.snapshot)` while mutating memory. Replace both with the existing `h.save` + `h.read` API path for paused and then void state. Keep the final API assertion at197. Drop only the test import `activeClaimEpoch`; its production API/cache consumers remain.
- **F2:** `backend/notifications/notifications.test.ts:643–651` calls `parseNotificationsResponse` to prove unchanged length and rejects an invented `emailDelivery:'opened'` literal. Remove these isolated parser assertions; keep actual API recipient/mail-state mapping and secret omission in this declaration. The parser import is **not** dead: line758 consumes a real notification response in the moderator-access workflow, and `src/Inbox.tsx` uses it in production.
- **F3:** `backend/security/handler.test.ts:1626–1633` invokes `publicRestrictionOf` after the actual award request already proved repository restriction. Remove this redundant direct helper block and its now-unused import at11; keep the real restriction -> no-reservation -> reinstatement -> award workflow surrounding it. The production helper is widely used in project APIs, skill publication and payment workers; do not delete it.
- **F4:** `backend/payments/migrations.test.ts:133–211` includes the literal `expectedObjects` map at38–76 and `objects()` helper at79–88 to compare index/trigger names. Remove that schema-name inventory and its snapshot `.objs` assertions. Retain actual SQL migration, FK rejection, positional inserts, immutable writes and lineage constraints. The “keeps rows” check currently compares counts; use existing seeded full row values before/after for real data preservation rather than replacing the inventory with another literal schema list. No extra fixture set is needed.

## Fixture and production cleanup limits

No whole production file becomes unreachable through these removals. Only `cvss3BaseScore` loses its sole external test consumer, and it remains necessary internally. Exclusive removable test scaffolding is U6's connection/wallet mock and U5's local revision-counter setup; U2/U3's local key/getter instrumentation disappears with their declarations. Shared SQLite/migration fixtures, signed transaction fixtures, fake GitHub adapter, notification transport stand-in and real project registry fixtures remain required by retained workflows. Do not delete contract tests or native contract code.

## Complete declaration ledger

Codes: **HTTP** actual Request/Response contract with real persisted state (or meaningful auth refusal); **FLOW** coordinating multi-module workflow with actual D1 state; **SQL** actual persistent transaction/query/lease/constraint behavior; **DDL** actual migration executed on old/new SQLite data. **U** remove isolated unit, **I** consolidate incomplete startup evidence, **F** retain surrounding integration after removing/replacing noted fragment. Each row names the actual scenario inspected; file-level text identifies the exercised implementation boundary, not just the existence of a fixture.

### `backend/fee-conversions/handler.test.ts` — 2 declarations

Boundary inspected: handleFeeConversionsApi -> migrated fee_conversions; authorization, exact aggregate amounts and no signed bytes.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 34 | HTTP | signed-out and non-admin sessions are refused |
| 50 | HTTP | admins get recent records and exact per-token totals without signed bytes |

### `backend/notifications/email.test.ts` — 7 declarations

Boundary inspected: handleEmailPreferences -> D1 consent/outbox -> dispatch/reconcile; actual persisted destination/attempt state.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 112 | FLOW | verified opt-in sends future activity once; opt-out cancels queued mail and is independent of essential notices |
| 150 | FLOW | unverified and changed destinations cannot inherit activity consent |
| 194 | FLOW | optional-mail ambiguity retries only with attempt-bound independent evidence and remains bounded |
| 230 | FLOW | an essential notice retries a not-yet-effective destination on a bounded schedule; optional mail does not |
| 276 | FLOW | an essential notice exhausts after five non-send attempts and an absent record is suppressed |
| 317 | FLOW | opt-out cancels optional mail that is waiting for a reconciled retry |
| 356 | FLOW | scheduled drains finish activity delivery and report a failed security queue |

### `backend/notifications/exception-events.test.ts` — 5 declarations

Boundary inspected: real event INSERT/SELECT statements, source rows and recipient-specific D1 notices; first case also appends real project revision.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 67 | SQL | setup completion is one project_ready notice, never sent to its publisher |
| 127 | SQL | a self-service first revision reports ready only when it is active |
| 154 | SQL | a scan that cannot finish reaches the owners once; other results write nothing |
| 186 | SQL | losing the Slopbot installation reaches each affected project's owners once |
| 237 | SQL | a verified report receipt reaches only its reporter, once, with no acknowledgment |

### `backend/notifications/notifications.test.ts` — 12 declarations

Boundary inspected: real project/ledger/wallet writers or notifications HTTP handler -> D1 notices, ownership and read/mail state.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 50 | FLOW | self-service listing sends no routine notice; later revisions notify once each |
| 156 | FLOW | project enforcement records notify the project and independent reviewers once |
| 260 | FLOW | wallet changes and finalized payment events notify the contributor once |
| 444 | DDL | a notification changes only from unread to read and is never deleted |
| 486 | FLOW | older unread notifications remain reachable when new events arrive |
| 557 | FLOW | lists only the signed-in recipient's rows, newest first |
| 571 | FLOW | marks the recipient's own rows read once and refuses other writes |
| 592 | F2 | each notice reports its own email outcome without delivery details |
| 654 | HTTP | a signed-out request gets 401 and other paths are not handled |
| 707 | FLOW | one notice per moderator from the committed penalty, never to the author |
| 727 | FLOW | a penalty without moderator review writes no notice |
| 738 | FLOW | moderator access is rechecked on every list, open and read mark |

### `backend/payments/migration-0021.test.ts` — 4 declarations

Boundary inspected: executes migration0021 against SQLite with old data/children, real asset conversion or constraint/rollback effects.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 98 | DDL | keeps rows and children, names the reviewed asset, and copies amounts as 6-decimal base units |
| 168 | DDL | a row on a network without a reviewed asset fails the migration |
| 181 | DDL | applies inside one transaction with child rows present (the D1 path) |
| 190 | DDL | vault snapshots keep uint128 text, NULL counters, a fixed asset and a monotonic block |

### `backend/payments/migrations.test.ts` — 3 declarations

Boundary inspected: executes real migration(s) against SQLite; FK/row retention, positional inserts and immutable writes.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 133 | F4 | keeps rows, children, objects and column order; then accepts robinhood |
| 214 | DDL | applies inside one transaction with child rows present (the D1 path) |
| 230 | DDL | the full migration set applies cleanly on an empty database |

### `backend/payments/monthly.test.ts` — 39 declarations

Boundary inspected: real monthly owner/coordinator/attestation or payments HTTP -> migrated D1 allocation/obligation/authorization state.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 180 | FLOW | Solana refuses a monthly cap above its token range before storing an allocation |
| 194 | DDL | the amount-range migration preserves funded months, exclusions and authorization history |
| 262 | FLOW | an 18-decimal token month keeps exact amounts through owner review, freeze and attestation |
| 391 | FLOW | a ${racing ? "concurrent" : "current"} owner ban refuses monthly ${action} |
| 438 | FLOW | a ban after freeze excludes only the unfunded award and preserves the snapshot |
| 497 | FLOW | a ban that races monthly funding makes the coordinator retry before creating awards |
| 527 | FLOW | a later ban preserves monthly awards that are already funded |
| 557 | FLOW | freezes the current private allocations once at the cutoff and creates each obligation once when funded |
| 659 | FLOW | a funding-time excluded award is not advertised as awaiting payment |
| 698 | FLOW | a contributor's account shows the approved monthly award from the freeze until the vault reserves it |
| 778 | FLOW | without a defined cutoff nothing is frozen automatically, but the owner can finalize |
| 788 | FLOW | an owner who turns the default off, a restricted project and an unserved vault are not distributed automatically |
| 818 | FLOW | an award reserved earlier needs no new funds and cannot be planned twice |
| 884 | FLOW | a Solana hand reservation waits until automatic monthly payment is off |
| 917 | FLOW | a Solana month needs its full total free, even for an award reserved earlier |
| 946 | FLOW | an underfunded month has no obligation to reserve, and earlier unreserved obligations hold their funds |
| 990 | FLOW | after the cutoff the automatic default fixes the allocations until they are frozen |
| 1011 | FLOW | a month before the first automatic period is never frozen automatically |
| 1021 | FLOW | private changes stay within the cap, never pay their author and are serialized |
| 1067 | FLOW | an open month cannot be finalized |
| 1075 | U4 | private bounty programs never run the monthly coordinator |
| 1143 | FLOW | an obligation for ${label} under a frozen award's source is a conflict left out of the month |
| 1192 | FLOW | a contributor sees a conflicting award, and a month of only conflicts signs nothing |
| 1218 | FLOW | uses only the frozen owner-adjusted awards, even after a later funding observation |
| 1238 | FLOW | refuses the root before the cutoff, after its window, and when the whole month is unfunded |
| 1251 | FLOW | signs a frozen month after a later revision that keeps its payment terms |
| 1295 | FLOW | rechecks restrictions and the owner's opt-out after the month was frozen |
| 1309 | FLOW | omits funding-time exclusions while preserving awards funded before a later ban |
| 1329 | FLOW | accepts a month frozen before fees rounded up, and no other fee |
| 1385 | FLOW | rejects a forged frozen payload even when its metadata still names the real project |
| 1415 | FLOW | monthly signing preserves its first intent through retry and refuses a changed root |
| 1542 | FLOW | V2 monthly signing publishes permanent source-bound attempts and resumes the selected admitted month |
| 1780 | FLOW | monthly signing never publishes when the signer fails or an opt-out arrives during signing |
| 1844 | FLOW | monthly dispatcher resumes an older Solana reservation after opt-out and retires only finalized completion |
| 1932 | FLOW | monthly dispatcher sends a new EVM V2 reservation before an older month's leaves |
| 1995 | FLOW | Solana v3 retries preserve the first signed freeze time after a signer outage |
| 2064 | FLOW | reserve release requires the live monthly owner authority and current policy before requesting any attestation |
| 2137 | U5 | a concurrent project revision change refuses a prepared reserve release |
| 2164 | FLOW | account keeps an award visible when a reservation is indexed during its read |

### `backend/payments/vault-snapshots.test.ts` — 8 declarations

Boundary inspected: real refresh/conditional D1 writes/payments HTTP cache -> stored finalized counters or explicit conflict.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 43 | FLOW | refreshes both chain caches and preserves the last verified public totals after invalid reads |
| 149 | FLOW | serves cached rows with public edge caching and never reads a chain |
| 224 | FLOW | an unindexed project returns no rows, not zero totals |
| 256 | FLOW | requires the finalized vault snapshot and records its asset and decimals |
| 293 | FLOW | re-indexing stored evidence for the adapter's deployment makes no chain call |
| 329 | FLOW | concurrent finalized refreshes cannot decrease cumulative vault counters |
| 371 | FLOW | concurrent initial refreshes preserve asset identity and report superseded blocks |
| 401 | FLOW | bounded refresh advances healthy vaults while earlier reads wait and reports every failure |

### `backend/points/x.test.ts` — 1 declarations

Boundary inspected: real X OAuth start/callback/disconnect API with transport stand-in -> persistent identity claims and unchanged earned points.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 8 | HTTP | X connection and reconnect reserve identity without granting points |

### `backend/projects/cloudflare-persistence.test.ts` — 3 declarations

Boundary inspected: actual create/append D1 project revisions -> repository index -> Slopbot capabilities or atomic conflict.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 78 | FLOW | renamed repository (alias is the current name) resolves in the live registry |
| 111 | FLOW | a legal transfer revision (alias append) keeps the repository resolvable |
| 161 | FLOW | a repository path acquired by another project before commit refuses the whole revision |

### `backend/referrals/claims.test.ts` — 4 declarations

Boundary inspected: actual referral claims HTTP -> migrated files/cache/claim-wallet rows; privacy, exact balances and stale states.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 126 | HTTP | claim API maps contract epoch through its filed period and keeps another actor's proof private |
| 148 | HTTP | cache failure and expiry preserve last verified totals; never-activated is hidden and first failure is unknown |
| 180 | F1 | a paused pending window never matures, and a void retains the preceding root |
| 263 | U6 | wallet review is read-only, and an explicit send rechecks the exact claim without token approvals |

### `backend/security/handler.test.ts` — 27 declarations

Boundary inspected: actual private security HTTP transitions -> D1 cases/events/reservations/access audit; provider/authority dependencies controlled.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 529 | HTTP | a maintainer imports direct GitHub reports and settles older links |
| 612 | HTTP | listing cases records only the cases disclosed and refuses an unaudited response |
| 644 | HTTP | a failed or missing analysis can be run again by the owner |
| 677 | HTTP | a stale triager change grants or revokes nothing |
| 759 | HTTP | a banned researcher keeps funded awards and appeals but receives no new bounty award |
| 801 | HTTP | a banned maintainer cannot create a new bounty award (race: ${racing}, related: ${relatedParty}) |
| 812 | HTTP | a ban that arrives during bounty approval prevents its reservation |
| 821 | HTTP | large program balances keep every minor unit after approved awards |
| 839 | HTTP | the owner chooses the amount, and approval reserves exactly that amount |
| 938 | HTTP | no award is a decision the reporter can appeal |
| 971 | HTTP | a concurrent reservation cannot overspend the program |
| 1012 | HTTP | reservations follow the vault's finalized free balance, not the published terms |
| 1075 | HTTP | a pledge reserves nothing |
| 1085 | HTTP | an award reserved before discretionary awards is approved at its amount |
| 1112 | HTTP | a proposed related-party award reserves only after independent approval |
| 1150 | HTTP | an appealed related-party refusal cannot be re-reviewed by the same reviewers |
| 1261 | HTTP | a co-maintainer who decides an award or an earlier technical decision cannot review the case as dispute |
| 1318 | HTTP | report analysis and appeal triage keep the scope recorded at receipt |
| 1367 | HTTP | a pending-revision quarantine blocks new awards but preserves reporting until reinstated |
| 1434 | HTTP | a restricted or retired program cannot start a new bounty award (race: ${racing}, related: ${relatedParty}) |
| 1462 | HTTP | private reporting remains available for a registered quarantined project |
| 1476 | HTTP | existing appeal triage follows quarantine revision evidence: %s |
| 1514 | HTTP | an owner retirement closes a failed appeal triage retry after %s |
| 1546 | HTTP | a receipt check imports no new report after an applied quarantine |
| 1562 | HTTP | a previously funded award remains accessible while quarantined |
| 1580 | F3 | repository-bound ${identity} restriction blocks a new award (race: ${racing}, related: ${relatedParty}) |
| 1667 | HTTP | an ${fault} enforcement read cannot approve an award and can retry |

### `backend/security/submissions.test.ts` — 46 declarations

Boundary inspected: actual private-intake HTTP + GitHub adapter/OAuth stand-in -> D1 submission/case/events and retry/idempotency/privacy effects.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 501 | HTTP | failed or stale public observations do not authorize or permanently block submission (no program: %s) |
| 573 | HTTP | creation replays one key and refuses a second submission in flight |
| 601 | HTTP | replaying creation on a finished or abandoned submission refuses instead of re-authorizing |
| 683 | HTTP | the repository comes from the program terms, never from the request |
| 691 | HTTP | a grant for another GitHub account is refused and sets no grant cookie (no program: %s) |
| 715 | HTTP | the grant cookie is encrypted, HttpOnly, Strict and scoped to the submission routes |
| 749 | HTTP | a missing, tampered, expired or rebound grant never reaches GitHub |
| 781 | HTTP | an unrelated authority outage preserves the reporter's own case list with a generic retry notice |
| 799 | HTTP | a moderator cannot discover an un-escalated reporting-only project from the private list |
| 810 | HTTP | a sent report survives a contact lookup outage and reconciles without sending again |
| 837 | HTTP | a verified ${origin} report with no passing approver recovers after 24 hours with fresh reporter consent |
| 909 | HTTP | private intake accepts a report without inventing an award |
| 1027 | HTTP | a report is filed as the reporter and its receipt is verified with GitHub |
| 1150 | HTTP | definite GitHub refusals fail with a code, and a fixed report can be resent |
| 1176 | HTTP | a 404 maps to app-not-installed when the intake App is missing |
| 1188 | HTTP | an interrupted send is uncertain, never resent, and reconciled to the one copy |
| 1214 | HTTP | a complete empty listing reopens the draft for exactly one new send |
| 1247 | HTTP | an incomplete or failed listing keeps the submission uncertain |
| 1279 | HTTP | duplicate copies adopt the earliest and tell only the technical approvers |
| 1312 | HTTP | a marker match authored by someone else is ignored |
| 1338 | HTTP | a send that never returned becomes uncertain after 60 seconds and is not resent |
| 1363 | HTTP | a concurrent double send makes one POST |
| 1391 | HTTP | an empty listing right after the attempt keeps it uncertain, and a late copy is then adopted |
| 1434 | HTTP | a resend that races a late copy adopts the earliest and records the duplicate |
| 1473 | HTTP | a submitted report GitHub never lets Slop verify stops blocking new reports |
| 1495 | HTTP | a 201 that is not the reporter's well-formed advisory is uncertain |
| 1506 | HTTP | an unreadable advisory after creation retries the read only |
| 1561 | HTTP | the reporter's own advisory is verified with GitHub's original time |
| 1596 | HTTP | a reporter credit on someone else's advisory is not authorship, and the author can still verify |
| 1633 | HTTP | an advisory that is not a live private report is never an automatic receipt |
| 1651 | HTTP | two concurrent verifications of one submission both answer with the one verified case |
| 1680 | HTTP | another user's advisory fails as author-mismatch with no case |
| 1690 | HTTP | an advisory GitHub cannot find fails as not-found |
| 1709 | HTTP | an advisory already recorded for another case returns 409 without leaking it |
| 1751 | U1 | the deterministic analyzer only recommends from structured fields |
| 1789 | HTTP | only the reporter can reach a submission |
| 1812 | HTTP | an idle draft is abandoned after 24 hours |
| 1832 | HTTP | report content and tokens never reach D1, logs or responses |
| 1889 | HTTP | with intake off every submission route is closed, the list is empty and readiness says off |
| 1921 | HTTP | readiness reports automatic intake only when the App is installed and PVR is on |
| 1954 | HTTP | a participation ban stops new private reports and sending an existing draft |
| 1967 | HTTP | a ban before the send commits prevents the private GitHub request |
| 1978 | HTTP | a concurrent ban leaves no new private submission or creation event |
| 1994 | HTTP | a banned reporter can reconcile a report GitHub already received |
| 2023 | HTTP | an accepted private report still reconciles after quarantine |
| 2039 | HTTP | registered researcher can start a private report on a quarantined project |

### `workers/fee-converter/fee-converter.test.ts` — 47 declarations

Boundary inspected: actual runNetwork/runOnce orchestration -> D1 conversion/native journal/lease effects; chain transport is controlled, not live qualification.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 180 | I1 | mode defaults to off and runs nothing |
| 191 | I2 | scheduled startup failures reject after every enabled network is attempted |
| 233 | U2 | a key that does not control the configured fee wallet is refused |
| 256 | FLOW | retained Robinhood fees report not converted through receipt and recovery runs without quotes or keys |
| 400 | FLOW | ${network} ${field}=${String(value)} refuses before preparation |
| 428 | FLOW | ${network} valid costs ${JSON.stringify(costs)} retain the 10x gate |
| 451 | FLOW | a receipt run converts a newly received fee and leaves an unchanged balance alone |
| 477 | FLOW | a repeated fee amount after finalization is a new receipt |
| 492 | FLOW | the recovery scan retries a token that a receipt run leaves alone |
| 508 | FLOW | dry_run records the quote and never prepares or signs |
| 522 | FLOW | the record keeps the fee-wallet balances before and after |
| 538 | FLOW | the stablecoin and empty balances are never quoted |
| 549 | FLOW | small amounts stay pending below the minimum and below the gas multiple |
| 565 | FLOW | a pending fee converts once a later receipt lifts it over the threshold |
| 577 | FLOW | unknown or excessive price impact and loose minimums are skipped |
| 595 | FLOW | an unchanged skip is recorded once, not every run |
| 606 | FLOW | a large balance is scaled to fit the per-run cap across tokens |
| 630 | FLOW | live sends in the last 24 hours count against the daily cap |
| 652 | FLOW | an approval is journaled before an ambiguous broadcast and excludes conversion totals |
| 715 | FLOW | a canonical approval permits a fresh later swap without counting the approval value |
| 746 | FLOW | a legacy failed approval hash stays held without inventing its raw bytes |
| 777 | FLOW | an unknown send blocks a new attempt until it is reconciled |
| 812 | FLOW | a send proven unable to land frees the token for a new attempt |
| 824 | FLOW | a failed prepare leaves no signed bytes and no open row |
| 837 | FLOW | a concurrent run on the same network is locked out |
| 849 | SQL | a run that lost its lease never deletes the successor's lock |
| 869 | SQL | a stale run cannot release a lease it already let lapse |
| 886 | SQL | a run that still owns an unexpired lease releases it |
| 897 | SQL | a run renews its lease so a long run keeps the lock |
| 918 | FLOW | a run renews the lease before starting a later chunk |
| 955 | FLOW | a run stops starting new chunks once it loses its lease |
| 1010 | FLOW | a slow reconciliation cannot replace after lease takeover |
| 1035 | FLOW | replacement work that outlives its lease keeps the original pending |
| 1054 | FLOW | the replacement append refuses a successor lease taken during the database wait |
| 1068 | FLOW | an append cannot revive an original settled during the database wait |
| 1086 | FLOW | lease loss after journaling preserves bytes without broadcasting |
| 1102 | FLOW | a delayed restart delivers journaled bytes before another fee step |
| 1120 | FLOW | an explicit node fee refusal can escalate after trying the journaled bytes |
| 1134 | FLOW | an uncertain rebroadcast never skips to a new fee step |
| 1148 | FLOW | the schema refuses a second open send, a submitted row without bytes, and edits to final rows |
| 1181 | DDL | a pending row needs its reason and is final |
| 1198 | DDL | fee conversion rebuilds keep every earlier record and its guards |
| 1309 | SQL | candidate tokens come only from reviewed manifests on the network |
| 1739 | FLOW | a dry run reports the claim and signs nothing |
| 1754 | FLOW | a live run claims once and a rerun finds nothing left to claim |
| 1766 | FLOW | a previously signed claim expires through two-provider proof without retrying on missing evidence |
| 1785 | FLOW | a fee below the dust threshold keeps accruing in the vault |

### `workers/fee-converter/native-gas.test.ts` — 15 declarations

Boundary inspected: actual NativeGasJournal/D1ConversionStore or actual adapter -> real signed bytes and migrated D1 liability/receipt/lease state.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 146 | U3 | missing native limits refuse before the Worker reads its key |
| 165 | SQL | exact-wei reservations serialize competing attempts and preserve liability across midnight |
| 186 | SQL | a successor retires only uncommitted reservations; stale signed commits roll back |
| 225 | SQL | a wrong signature or duplicate reservation cannot create a durable send |
| 242 | SQL | same-nonce replacements reserve their maximum once and settle exactly one winner |
| 292 | SQL | unavailable receipts retain gas until the canonical cost is recovered |
| 381 | SQL | business failure and router expiry do not release signed gas; overruns hold future signing |
| 411 | SQL | legacy approval and swap hashes both enter accounting with independently proved nonces |
| 424 | SQL | legacy hash-only liability requires the original signed transaction: %s |
| 506 | SQL | actual signer preparation enforces final fee bounds: %s |
| 611 | SQL | actual adapter reconciles native cost only with canonical complete evidence: %s |
| 719 | SQL | Solana signed costs share the atomic journal while unknown sends retain their whole ceiling |
| 794 | DDL | Solana migration preserves existing EVM liabilities and immutable receipt evidence |
| 823 | SQL | expiry evidence and zero-cost resolution commit atomically under the current Solana lease |
| 979 | SQL | versioned signed sends retain immutable account evidence atomically with the native reservation |

### `workers/fee-converter/solana-route-prepare.test.ts` — 2 declarations

Boundary inspected: actual quote/prepare/account-resolution/signing -> native D1 reservation then retained proof/restart validation; controlled RPC.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 367 | FLOW | a v0 Token-2022 swap signs only after account review and retains the review with its native liability |
| 522 | FLOW | a substituted lookup or extra token debit refuses before reserving or signing |

### `workers/notify/security.test.ts` — 9 declarations

Boundary inspected: actual security API -> D1 source/outbox -> dispatch/reconcile -> authenticated acknowledgment; only mail transport controlled.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 153 | FLOW | a case change queues once, sends generic per-role mail once, and needs explicit recipient acknowledgment |
| 220 | FLOW | a report receipt is mailed generically and never escalates for a missing acknowledgment |
| 256 | FLOW | ambiguous transport never resends until independent non-acceptance evidence; failures reach only an authorized backup |
| 298 | FLOW | role revocation suppresses queued mail; missing verified destinations exhaust bounded retries without losing the case |
| 326 | FLOW | backup notices have a durable inbox row and their own authenticated acknowledgment |
| 355 | FLOW | already escalated history cannot starve a later overdue notice |
| 384 | FLOW | pre-pilot inbox history is not mailed and does not expose a dead acknowledgment action |
| 426 | FLOW | a negative receipt cannot reconcile a later attempt or append duplicate evidence |
| 471 | FLOW | concurrent copies of one provider receipt append one delivery event |

### `workers/payment-executor/wallet-rotation.test.ts` — 4 declarations

Boundary inspected: real signed wallet records -> ledger index -> first/later dispatch -> rotation authorization with migrated D1 attempts.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 159 | FLOW | rotates after the award was paid by the attempt's own transaction |
| 168 | FLOW | rotates after a paid award whose attempt lost its executor response |
| 174 | FLOW | rotates after a paid award whose attempt was outpaid by another transaction |
| 183 | FLOW | still holds the rotation while an unpaid award's attempt is uncertain |

### `workers/referral-accrual/poster.test.ts` — 9 declarations

Boundary inspected: actual postNextRoot + actual D1AccrualStore and retained bytes -> durable journal/gas reconciliation; controlled RPC/client inputs.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 360 | FLOW | %s cannot close a migrated journal |
| 383 | FLOW | missing receipt and advanced nonce stay held without a new send |
| 399 | FLOW | nonfinal void holds, disappears safely, and only canonical final void is permanent |
| 421 | FLOW | configuration change refuses before RPC or stored broadcast |
| 436 | FLOW | failed or mismatched rebroadcasts retain the exact signed attempt and only safe diagnostics |
| 486 | FLOW | unknown sends retain one reservation across midnight and unchanged rebroadcast |
| 511 | FLOW | reverted costs consume the receipt UTC day's budget and release only later-day capacity |
| 541 | FLOW | overlapping quotes cannot commit or broadcast two native liabilities |
| 576 | FLOW | lower transaction cap refuses before signing or any journal reservation |

### `workers/referral-accrual/referral-accrual.test.ts` — 12 declarations

Boundary inspected: actual accrual run/store + migrated paid records -> immutable filed bytes/leafs/leases/restart or public HTTP results.

| Line | Decision/boundary | Scenario |
| ---: | --- | --- |
| 201 | FLOW | a failed ${table} insert leaves no partial month across restart |
| 276 | FLOW | a lost batch response resumes the already committed file without duplicate accruals |
| 316 | FLOW | a ${replacement ? "replaced" : "expired"} lease cannot file stale work |
| 361 | FLOW | files each closed month once, in order, with recomputable totals |
| 487 | FLOW | a late-observed payout joins the month it was observed in |
| 504 | FLOW | project cap, pool cap, window, hold, ban and asset rules |
| 618 | FLOW | the wallet is the current authorized claim on the claim chain only |
| 649 | FLOW | a wallet is pinned once it enters a tree, so a leaf never moves |
| 701 | FLOW | two accounts on one wallet keep one leaf and the file says which |
| 730 | FLOW | a held lease blocks a second run and lapses afterwards |
| 750 | FLOW | only the daily schedule files accruals and the Worker serves no route |
| 789 | FLOW | lists filed epochs and serves the exact filed bytes |

## Completion boundary

This audit proves the frozen tree still contains the named non-contract unit/fragment residue; it does not claim a cleaned final tree or new passing tests. After implementation, rerun a declaration/reference scan and the affected real integrations. Retain provider/finality/consent/state tests as scoped, and do not call controlled responses live model or chain qualification.


---

# Final merged-main browser/worker test audit

Audit target: primary worktree `7812a2fb`, same requested source tree as merged main `c28814f4`. Read-only source inspection; no browser, test suite, provider, VM or chain execution was performed. No repository files were changed. A separate development-only section covers the requested `e2a0148e` follow-up; those findings are not silently attributed to merged main.

## Result

The no-useless-tests requirement is **not fully satisfied yet**. Six bounded remnants remain on merged main: two whole low-value/incomplete browser cases and four inline helper/literal/synthetic fragments. No entire existing main E2E, Slopbot or vetting workflow file is proven disposable. The new development-only `value-commit-discovery.test.ts` is a separate wholly unit-level file and conflicts with the user's explicit prohibition.

Inventory:29 E2E spec files /136 TypeScript test-registration callback sites;9 Slopbot test files /78 sites;1 vetting TypeScript test file /2 sites;5 Python workflow files with8 unittest methods and3 executable main workflows. These are source declarations, not expanded runtime counts: loops and `test.each` create additional actual cases, and contract-browser conditional modes intentionally require their local chain toolchains. The AST-assisted inventory enumerated every callback and its calls/assertions; the audit then checked boundary helpers, imported fixtures and suspicious fragments. Large workflow callbacks are retained as whole workflows, not reduced to their names or headline assertion count.

## Removal criteria

- Delete isolated pure input/output helper assertions even when placed at the end of a real integration test. Their surrounding file does not convert them to integration coverage.
- Delete fixed-value/text-only checks with no meaningful state transition or transport/authority outcome.
- Remove or consolidate a claimed workflow that can silently skip the very scenario named in the test, or whose fixtures cannot distinguish correct from incorrect behavior.
- Retain actual stateful boundary outcomes: database transactions, signed webhook handling, persistence/reload, conflict/timeout/cancellation ordering, byte-bound artifacts, navigation destinations, accessibility/keyboard behavior, native filesystem/namespace enforcement and actual chain workflows. These legitimately assert values; the value assertion is not their entire purpose.
- A stub provider or synthetic model verdict can exercise a worker's persistence/authorization controls. It is not evidence of model quality or production qualification. Do not mislabel these as real LLM acceptance, but do not delete the real handler/database outcomes solely because the external provider is deterministic.
- Setup validation such as `assertProfiles(census)` can establish an input prerequisite for the following real browser path. It is not a standalone coverage result; redundant literal assertions after it can be removed.

## Exact merged-main cleanup gaps

### EWT01 — Redundant census version literal inside a real browser workflow

- `tests/e2e/profiles.spec.ts:127`: `expect(census.schemaVersion).toBe("2")`.
- The case has just fetched and validated the generated census, then finds a reopened issue, opens its author profile and expands real issue history. Those later steps are useful. The exact-version assertion merely repeats the fixture/build format and supplies no user outcome; the following reopened-issue requirement already refuses a census missing the required history.
- Delete only line127. Retain `assertProfiles(census)` at126 as input validation and retain the rest of the case. No import or fixture becomes exclusive from this one-line deletion.

### EWT02 — Pure projection assertion after already checking the rendered rows

- `tests/e2e/site.spec.ts:500–502`: `expect(view.leaders.every(leader => leader.projectedMinor === "0")).toBe(true)`.
- This checks a local `createProjectView` result, not the browser. The preceding loop has already checked every rendered share cell is a percentage of payment weight rather than dollars. The pure helper assertion is a unit fragment inside the E2E file.
- Delete500–502 only; retain the actual cycle navigation, row count and rendered-share assertions. `view`, `createProjectView` and `loadSnapshot` remain needed by that same workflow.

### EWT03 — Whole metadata-only page case

- `tests/e2e/site.spec.ts:1212–1228`, `project pages omit full standings and sponsor links keep their destination`.
- It goes directly to a project and asserts the absence of a fixed label, then directly to Sponsors and inspects one href. It never activates the sponsor link or exercises a changed state. The dedicated Sponsors keyboard/navigation case and broad route/reflow matrix already cover the real surface; other payment/navigation workflows exercise funding links.
- Delete this entire case and its exclusive screenshot `direct-sponsor-handoffs.png` expectation/output. It introduces no unique imports, helper functions or fixture data. If the exact sponsor destination remains required evidence, activate it within the existing Sponsors workflow rather than retain a separate label/href-only case.

### EWT04 — Frozen-record case can pass without its promised scenario

- `tests/e2e/site.spec.ts:521–562`, `shows the frozen record for a cycle the live window still covers`.
- `528–535` catches every failure while searching for an overlapping live cycle; `537` falls back to any cycle, and `538` conditionally skips all archived-row assertions when none is found. Thus passing does not establish that frozen data beat a conflicting live recomputation. Even with a cycle, it only checks count, first login and CSS class, without deliberately different live/frozen money or points.
- The unconditional tail merely opens a missing2025-01 cycle and inspects a project-page href. That tail can carry the entire “passing” result after the named scenario was skipped.
- Remove this incomplete standalone case. Preserve the substantial archive filtering/navigation/download-hash workflow at564 onward. If frozen-vs-live selection still needs dedicated proof, put explicit differing source values and an unavoidable assertion into that existing archive workflow, rather than add another speculative or conditionally bypassed case.
- No helper/import becomes dead: `loadCycles`, `loadSnapshot`, `createProjectView` and `PROJECTS` all have other callers in this same spec.

### EWT05 — Pure operator recovery helper tail in a real Slopbot workflow

- `workers/slopbot/appeal.test.ts:310–360` directly calls `recoverAppealJob` with an in-memory delivery/state object, then varies five object fields and a command marker and checks thrown strings.
- This does not invoke the recovery CLI, HTTP delivery-read boundary, queue, durable journal or worker on those variants. It is a unit suite attached after real signed-webhook/SQLite/queue work. The successful equality to `queued[1]` at322–325 is also direct helper input/output.
- Delete310–360 and exclusive import at5 (`recoverAppealJob` from `scripts/recover-slopbot-appeal`). `delivery` and `state` locals are exclusive to that block. Keep the signed webhook redelivery loop at294–309 and its real queue result. Keep the production recovery script itself; deleting its test import is not evidence that the operator entrypoint is dead.
- The source comment at278–279 should describe the retained duplicate-delivery result after this deletion. Do not claim the operator CLI is fully covered by the retained worker test; real CLI qualification would be a separate, useful workflow if required.

### EWT06 — Synthetic frame-size estimate inside native filesystem workflow

- `workers/vetting/filesystem_workflow_test.py:99–116` creates a manually assembled `maximum` object with invented `worstMetadata`, trace/output strings and source-hash repetitions, then checks the length of `base64(json.dumps(maximum))` against a numeric threshold.
- It does not call the actual guest receipt/framing writer, transport decoder, collector, or VM ingress boundary. It therefore cannot prove the production wire-format maximum and is a shape/size unit estimate, despite the surrounding real Linux filesystem workflow.
- Delete99–116, including exclusive local `import json`, `transport_root`, `transport`, `body`, `maximum` and `framed`. Retain the final actual-workflow completion print117. Keep imported/global `base64`: the earlier real captured-byte assertions use it. Keep `FilesystemCapture.MAX_BYTES/MAX_METADATA` production code and the earlier real file/count/metadata-limit, symlink replacement, FIFO and secret-exclusion scenarios.
- Real transport integrity remains exercised in VM workflow acquisition/collection and altered captured serial bytes. If a strict max-size transport qualification is required, it must send the actual maximal receipt through that boundary; this synthetic arithmetic is not a substitute.

## Deliberate keep decisions (no whole-file deletion)

### Browser surface

All29 merged-main spec files contain at least one useful real-browser or actual service/chain path. Route redirects, encoded login destinations, modal focus/Escape, clipboard output, URL filter persistence, stale/error handling, exact signing bytes and deliberate zero-write/read checks are behavior outcomes; do not delete them under a blanket “uses toHaveText/toHaveAttribute” rule.

- Account closure calls the actual handler through the fixture server and observes database/account recovery after a lost successful response. Account sessions exercise revoke/signout actions. Email preferences use authenticated Pages routes and persist consent changes. Evidence download consumes actual one-time grants and compares large downloaded bytes.
- Wallet-provider modal specs exercise injected browser providers and registration actions without moving real funds; wallet readback and error recovery are actual rendered account contracts. The signing/finality contract browser modes use actual Anvil/Solana toolchains and API fixtures; their supported-environment guards are not empty passing tests.
- Profile-rename specs exercise immutable-actor routing, conflicting asynchronous records, retries, actual request cancellation and history/payment separation. The recent failure proved why these cannot be replaced by pure lookup tests. Review-exclusion missing/stale/renamed cases distinguish unavailable metadata from zero exclusions, not merely policy copy.
- Home cache, registry, security and standings tests exercise network failures, retained state, denied writes and navigation. Native `@registry` cases mutate real local D1/R2/API state. Synthetic provider responses do not claim real provider qualification.
- Hero animation checks actual timed typing/deletion, reduced-motion behavior and stable geometry. Accessibility/reflow rows test keyboard/focus and layout, including a reproduced footer overlap; these are not content inventory tests.
- Public archive downloads compare served bytes with frozen digests. The direct HTTP bootstrap/headers tests verify routing/security/content types and checksums. They are protocol integration tests, not arbitrary export/constant census tests.

### Slopbot surface

- `appeal.test.ts`: retain its actual queue/webhook/SQLite behavior; remove only EWT05.
- `history-registry.test.ts`: retain all four declaration sites. They read real SQLite journals through handler-backed HTTP or storage adapters, append a successor, reject replacement, check immutable repository mismatch, and distinguish DB failure from absent history. The intentionally incomplete award evidence tests history transport only and is explicitly prevented from awarding Points; it is not claimed as a full model-award qualification.
- `maintainer-hold.test.ts`: retain all11 sites. They execute the real hold/review/appeal scheduling flows with SQLite, time, label state and interleaving; cover unknown writes and reopen protections. Synthetic verdicts isolate enforcement control and do not prove model correctness.
- `penalty-appeal.test.ts`: retain all34 sites. These cross worker review, signed webhook/queue, database journal, public ledger, moderator/notice and concurrency boundaries. Zero writes, debit/reversal count and label assertions are real control outcomes; not isolated penalty calculator tests.
- `reopen-source.test.ts`: retain all3 sites. Actual durable source binding, lost queue response, signed/unsigned webhook and atomic confirmation outcomes justify the storage-level integration calls.
- `review-scope.test.ts`: retain all6 sites. Real `reviewItem`, SQLite and loopback HTTP verify that current source replaces stale PR metadata and invalid/moving source cannot reach model/GitHub action. Provider payload fixtures qualify input/action control only.
- `spend-alerts.test.ts`: retain all7 sites. Real migration/data preservation and dispatch/ledger idempotency outcomes, with unknown delivery/cost handling. Database migrations are not unit constant checks.
- `value-live-registry.test.ts`: retain all3 sites. Actual scheduler/queue/SQLite consumers test live authority, starvation ordering and appeal progress after dispatch refusal.
- `webhook-installation.test.ts`: retain all9 sites. Signed webhook delivery persists lifecycle state in SQLite; equal timestamps, source order, lost responses and moderator notifications are authority transitions, even though some cases are short.

### Vetting surface

- `acquire.test.ts`: retain both sites. Creates actual Git objects/symlink/executable fixtures, serves objects over loopback HTTP, observes materialized exact bytes/no execution, and ensures malformed blobs/tree/redirect failure leaves no completed acquisition.
- `artifacts_workflow_test.py`: retain all4 methods. Actual isolated CLI parsing, namespace/host/network enforcement and refusal without isolation; source literal construction is adversarial input, not an asserted fake result.
- `dependencies_workflow_test.py`: retain the main workflow. Actual network/mount namespaces, DNS, TLS, bounded downloads and analyzer invocation prove private-address/redirect/size/timeout refusal with captured headers, and no guest execution authorization.
- `filesystem_workflow_test.py`: retain the main workflow except EWT06. Actual Linux file descriptors, mutations, symlink-race replacement, FIFO refusal and secret-byte exclusion remain valuable OS integration.
- `provenance_workflow_test.py`: retain all4 methods. Actual Git/tar/zip/source/release subprocess comparisons, digest mismatch, unsafe path and missing-data failure. These assert concrete byte/permission provenance outcomes.
- `vm_workflow_test.py`: retain the main workflow. Actual VM boot, unprivileged/offline execution, serialized source collection, altered captured evidence refusal, kernel policy pinning, process timeout and actual QCOW2 external-data rejection. Direct `assert_standalone` receives actual qemu-img metadata and tests a real image boundary; it is not a made-up config-shape fixture.

## Separate development-only follow-up e2a0148e

### EWT07 — New whole helper-unit file conflicts with the explicit test constraint

`workers/slopbot/value-commit-discovery.test.ts` is128 lines and not in the merged-main audit baseline. It contains3 declaration sites (the marker loop expands the first to2 cases):

1. `55`: `collectRetainedMergeReferences` with a literal in-memory `EvidenceClient.get` stub and exact requested paths/result shape; no actual HTTP worker, database or persisted valuation outcome.
2. `109`: direct `sameRepositoryCommitHints` parser result equality. Pure unit test.
3. `118`: `EvidenceClient.get` throws a constructed GitHubError, followed by exact error-identity propagation. Pure stubbed helper test, not an actual provider failure despite its title.

Delete this whole file under the user's explicit no-unit requirement. Its `source()` builder, actor/repository/SHA constants, imports of `sha256Hex`, `GitHubError`, `sameRepositoryCommitHints`, `EvidenceClient`, and `collectRetainedMergeReferences` are exclusive to it. Retain the production modules. The underlying bug may merit real consumer/valuation workflow coverage; migrate the demonstrated attribution/merge distinction into that existing workflow rather than preserve an isolated helper suite.

The accompanying4-line `tests/e2e/email-preferences.spec.ts` change is retained: it changes navigation wait from DOMContentLoaded to commit, then still waits for the actual heading and fonts before exercising authenticated consent/persistence. It does not remove an assertion, stub the app, or turn the workflow into a shape test.

## Limits

No suite was run, and no pass count is claimed. This report does not qualify real LLM behavior, production deployment, local Windows, or Solana availability. It is a source-completeness/removal audit. Preserve real workflow fixtures unless every consuming case is removed; the six main recommendations need no shared-fixture directory deletion. Do not delete operational producer/CLI helpers merely because a removed unit fragment was their only test import.

## Declaration-by-declaration disposition appendix


### tests/e2e/account-closure-integration.spec.ts

- `13` `account closure ${withObligations ? "with unpaid awards and a private case" : "without awards"} requires an explicit authenticated reopen` — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/account-sessions.spec.ts

- `10` "Account waits for identity, revokes another session and signs out the current session" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/email-preferences.spec.ts

- `4` "verified activity email preference persists and can be withdrawn @registry" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/evidence-download.spec.ts

- `9` "large private evidence downloads with a single-use browser grant @registry" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/funding-wallet-qa.spec.ts

- `6` "legacy wallet links open Account Wallets on direct navigation and reload" — Retain — stateful/browser/protocol boundary described above.
- `109` "funding and wallet keyboard flows remain accessible at 200 percent text size" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/hero-typewriter.spec.ts

- `9` "hero types, deletes and cycles all original campaign phrases without moving the layout" — Retain — stateful/browser/protocol boundary described above.
- `52` "reduced motion keeps the hero static" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/home-cache.spec.ts

- `11` "renders bundled projects with data stalled and GitHub blocked" — Retain — stateful/browser/protocol boundary described above.
- `85` "an unavailable registry with no last good copy shows an error, never an empty list" — Retain — stateful/browser/protocol boundary described above.
- `124` "a failed registry read keeps the last good projects with a stale label" — Retain — stateful/browser/protocol boundary described above.
- `215` "a failed snapshot refresh keeps the last good scores with a stale label" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/login.spec.ts

- `10` "serves GitHub login on direct navigation and reload" — Retain — stateful/browser/protocol boundary described above.
- `58` `login returns ${next} to a safe destination` — Retain — stateful/browser/protocol boundary described above.
- `178` "the header login link keeps the current page as the return route" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/onboarding-clearance.spec.ts

- `4` "project agent setup falls back to the general prompt until cleared" — Retain — stateful/browser/protocol boundary described above.
- `58` "home agent setup stays usable when discovery is unavailable" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/owner-awards.spec.ts

- `6` "owner edits monthly allocations privately, finalizes them and keeps sign-in context" — Retain — stateful/browser/protocol boundary described above.
- `242` "owner reserve repair keeps healthy and unknown states held and restores a submitted transaction after reload" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/payment-availability.spec.ts

- `12` "disabled payouts are visible from discovery through the project page" — Retain — stateful/browser/protocol boundary described above.
- `94` "a cycle record offers a funding check without inventing a vault balance" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/payout-consent.spec.ts

- `133` "a recipient reviews the exact vault and signs consent without claiming payment" — Retain — stateful/browser/protocol boundary described above.
- `167` `payout consent preserves the award after ${fault} failure` — Retain — stateful/browser/protocol boundary described above.
- `188` "Solana recipient co-signs only the prepared binding and waits for payment finality" — Retain — stateful/browser/protocol boundary described above.
- `373` "payout consent remains readable with enlarged text and Escape restores the initiating control" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/payout-wallet-picker.spec.ts

- `195` "modal routes Base and Robinhood Chain to MetaMask and Solana to Backpack despite Phantom globals" — Retain — stateful/browser/protocol boundary described above.
- `270` "Escape and close cancel without wallet requests and return focus" — Retain — stateful/browser/protocol boundary described above.
- `293` "wallet rejection stops registration and permits reopening the modal" — Retain — stateful/browser/protocol boundary described above.
- `308` "repeated announcements do not duplicate options and removed Solana wallet disappears" — Retain — stateful/browser/protocol boundary described above.
- `339` "no wallets offers official install links in either network modal" — Retain — stateful/browser/protocol boundary described above.
- `366` "legacy wallet browser remains connectable through the modal" — Retain — stateful/browser/protocol boundary described above.
- `392` "conflicting EIP-6963 UUID removes both providers without wallet requests" — Retain — stateful/browser/protocol boundary described above.
- `427` "mixed standard and legacy discovery keeps every distinct wallet" — Retain — stateful/browser/protocol boundary described above.
- `565` `open modal reflows at ${scenario.name}` — Retain — stateful/browser/protocol boundary described above.
- `648` "changing a confirmed Base wallet opens the account picker and asks before registering the new account" — Retain — stateful/browser/protocol boundary described above.
- `696` "keeping the saved address registers nothing and returns focus to the wallet button" — Retain — stateful/browser/protocol boundary described above.
- `721` "connecting with an unconfirmed saved address asks before registering a different active account" — Retain — stateful/browser/protocol boundary described above.
- `736` "connecting the saved address confirms it without an extra step" — Retain — stateful/browser/protocol boundary described above.
- `752` "a wallet without an account picker falls back to its connected account" — Retain — stateful/browser/protocol boundary described above.
- `773` "rejecting the account picker stops the change" — Retain — stateful/browser/protocol boundary described above.
- `792` `wallet change confirmation reflows at ${scenario.name}` — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/points-social.spec.ts

- `10` "social membership preserves past points and connection privacy without new awards" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/points.spec.ts

- `6` "points history is usable, accessible and independent of payments" — Retain — stateful/browser/protocol boundary described above.
- `136` "shows archived payments in their settlement month independently of points" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/profile-rename.spec.ts

- `92` "a renamed contributor keeps archived cycles" — Retain — stateful/browser/protocol boundary described above.
- `126` "a different actor reusing an old login does not inherit its history" — Retain — stateful/browser/protocol boundary described above.
- `145` "an inactive new owner does not inherit archived records or wallet lookups" — Retain — stateful/browser/protocol boundary described above.
- `180` "a directory-verified historical contributor keeps archived links" — Retain — stateful/browser/protocol boundary described above.
- `193` "historical names alone do not identify a current contributor or wallet" — Retain — stateful/browser/protocol boundary described above.
- `212` "a new owner listed without activity uses only its own identity and wallet" — Retain — stateful/browser/protocol boundary described above.
- `236` "conflicting current names withhold history and wallet lookups" — Retain — stateful/browser/protocol boundary described above.
- `256` "a stale activity login cannot override a directory rename" — Retain — stateful/browser/protocol boundary described above.
- `286` "an unavailable identity directory hides historical records until retry succeeds" — Retain — stateful/browser/protocol boundary described above.
- `339` "profile payment totals stay unavailable until direct transfers recover" — Retain — stateful/browser/protocol boundary described above.
- `460` staleMembership    ? "a stale public membership cannot override a known rename"    : "an anonymous visitor sees a points-only new owner's own identity" — Retain — stateful/browser/protocol boundary described above.
- `533` `directory-only membership identity: ${scenario}` — Retain — stateful/browser/protocol boundary described above.
- `740` "an unavailable session preserves an unconflicted cached profile" — Retain — stateful/browser/protocol boundary described above.
- `767` "membership lookup terminates at the shared request deadline" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/profile-review-exclusions.spec.ts

- `110` "a profile lists its own excluded reviews with their reasons" — Retain — stateful/browser/protocol boundary described above.
- `245` "a review-only nonmember sees accurate snapshot omissions" — Retain — stateful/browser/protocol boundary described above.
- `310` "a stale review-only profile shows the stale notice and zero points" — Retain — stateful/browser/protocol boundary described above.
- `337` "the current directory vetoes a renamed or recycled review-only login" — Retain — stateful/browser/protocol boundary described above.
- `380` "legacy snapshots without reviewer metadata do not report zero exclusions" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/profiles.spec.ts

- `6` "profiles preserve legacy coverage and expose recorded issue history" — Retain browser path; remove version literal — EWT01.

### tests/e2e/project-payment-navigation.spec.ts

- `127` `direct payments keep project identity through ${navigation}` — Retain — stateful/browser/protocol boundary described above.
- `211` "a late previous payment request cannot overwrite a retried project" — Retain — stateful/browser/protocol boundary described above.
- `317` "a flag draft does not follow browser history to another project" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/project-proposal.spec.ts

- `188` "drafts a project through the setup steps and creates it without an admin" — Retain — stateful/browser/protocol boundary described above.
- `470` "failed or partial GitHub lookups never fill unknown facts" — Retain — stateful/browser/protocol boundary described above.
- `560` "Robinhood Chain drafts a USDG escrow manifest" — Retain — stateful/browser/protocol boundary described above.
- `625` "a signed-in maintainer picks an owned repository and gets suggested text" — Retain — stateful/browser/protocol boundary described above.
- `776` `submits a valid project identity for ${name}` — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/project-standings-navigation.spec.ts

- `84` "Money received standings preserve unavailable data and recover on retry" — Retain — stateful/browser/protocol boundary described above.
- `150` "history navigation keeps contributor standings scoped to the current project" — Retain — stateful/browser/protocol boundary described above.
- `200` "global standings still accept project, sort and contributor filters" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/referral-claims.spec.ts

- `154` "referrer reviews, signs once, and waits for verified claim status" — Retain — stateful/browser/protocol boundary described above.
- `197` "unactivated referrals stay hidden; stale, paused and unknown claims cannot sign" — Retain — stateful/browser/protocol boundary described above.
- `235` "blocked claim storage keeps amounts visible and refuses a wallet send" — Retain — stateful/browser/protocol boundary described above.
- `261` "refresh retains an unverified claim when storage becomes unreadable" — Retain — stateful/browser/protocol boundary described above.
- `298` "an unreadable pending marker does not hide amounts or permit an unchecked retry" — Retain — stateful/browser/protocol boundary described above.
- `327` "an older stored claim cannot confirm the newer request on this page" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/registry.spec.ts

- `318` "an empty registry shows the empty state, never stale build data @registry" — Retain — stateful/browser/protocol boundary described above.
- `341` "a signed-out visitor must sign in to look up GitHub and submit @registry" — Retain — stateful/browser/protocol boundary described above.
- `373` "an owner creates a paused project without admin approval @registry" — Retain — stateful/browser/protocol boundary described above.
- `418` "an owner creates and updates directly; an admin can delist by exception @registry" — Retain — stateful/browser/protocol boundary described above.
- `586` "an admin cannot activate or publish skills without canonical scan closure @registry" — Retain — stateful/browser/protocol boundary described above.
- `759` "the applicant's inbox lists each decision and revision once and keeps the read state @registry" — Retain — stateful/browser/protocol boundary described above.
- `815` "moderators restrict a project and refuse reinstatement without canonical scan closure @registry" — Retain — stateful/browser/protocol boundary described above.
- `1151` "a moderator decides a confirmed malicious result and bans the project and its maintainer @registry" — Retain — stateful/browser/protocol boundary described above.
- `1371` "an owner installs Slopbot before creation and resumes setup; a failed scan and lost access each show the next action @registry" — Retain — stateful/browser/protocol boundary described above.
- `1573` "an owner publishes while public GitHub is rate limited and recovers only a stale revision @registry" — Retain — stateful/browser/protocol boundary described above.
- `1744` "an owner initializes a legacy monthly project without shortening its accepted policy @registry" — Retain — stateful/browser/protocol boundary described above.
- `1911` "an applicant publishes an application stored before self-service setup without entering it again @registry" — Retain — stateful/browser/protocol boundary described above.
- `2040` "a designated operator inspects retained vetting bytes with reasoned access @registry" — Retain — stateful/browser/protocol boundary described above.
- `2159` "repository lookup failures explain the next action and preserve the draft @registry" — Retain — stateful/browser/protocol boundary described above.
- `2231` "two contributors flag through the form, pause the project and notify moderators @registry" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/security-bounty.spec.ts

- `517` "owners publish and control bounty programs with verified funding @registry" — Retain — stateful/browser/protocol boundary described above.
- `694` "private security bounty programs keep cases restricted from intake to award @registry" — Retain — stateful/browser/protocol boundary described above.
- `1904` "private settlement requires visibility consent and produces an unsigned request @registry" — Retain — stateful/browser/protocol boundary described above.
- `2081` "private bounty obligations continue through role loss, approver replacement, and a ban @registry" — Retain — stateful/browser/protocol boundary described above.
- `2370` "automatic private intake files as the reporter and verifies receipt @registry @private-intake" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/site.spec.ts

- `41` "funding opens without downloading contribution snapshots" — Retain — stateful/browser/protocol boundary described above.
- `68` "project setup shares one sign-in read with its owner inventory" — Retain — stateful/browser/protocol boundary described above.
- `101` "security reports recover a failed list and share one session across submissions" — Retain — stateful/browser/protocol boundary described above.
- `190` "security sign-in returns directly to the selected project" — Retain — stateful/browser/protocol boundary described above.
- `230` "token amounts keep asset precision when publishing an unrelated project edit" — Retain — stateful/browser/protocol boundary described above.
- `354` "discovers projects and one points-ranked homepage leaderboard" — Retain — stateful/browser/protocol boundary described above.
- `463` "shows agent setup and keeps contribution records available" — Retain browser path; remove pure projection tail — EWT02.
- `505` "never presents Delta Star's external prize as platform money" — Retain — stateful/browser/protocol boundary described above.
- `521` "shows the frozen record for a cycle the live window still covers" — Remove/consolidate incomplete case — EWT04.
- `564` "renders contributor and cycle records from validated public data" — Retain — stateful/browser/protocol boundary described above.
- `735` "makes the public project draft boundary unmistakable" — Retain — stateful/browser/protocol boundary described above.
- `776` "publishes criteria changes directly and stops a stale maintainer draft" — Retain — stateful/browser/protocol boundary described above.
- `962` "reaches and reads older inbox notifications without losing the page" — Retain — stateful/browser/protocol boundary described above.
- `1024` "the inbox keeps read, acknowledged and email outcomes distinct and puts email settings after the notices" — Retain — stateful/browser/protocol boundary described above.
- `1129` "an admin leaves an unset reward asset unchanged until choosing it" — Retain — stateful/browser/protocol boundary described above.
- `1212` "project pages omit full standings and sponsor links keep their destination" — Remove whole case — EWT03.
- `1231` "serves byte-consistent bootstrap and read-only site artifacts" — Retain — stateful/browser/protocol boundary described above.
- `1387` "shows an explicit error for invalid data and retries" — Retain — stateful/browser/protocol boundary described above.
- `1441` `reflows ${path} with ${scenario.name}` — Retain — stateful/browser/protocol boundary described above.
- `1508` "finds a receipt and opens its full evidence and GitHub contribution" — Retain — stateful/browser/protocol boundary described above.
- `1610` `keeps ${route} accessible and inside the viewport` — Retain — stateful/browser/protocol boundary described above.
- `1680` "opens the models page directly and through keyboard navigation" — Retain — stateful/browser/protocol boundary described above.
- `1737` "opens the sponsors page directly and through keyboard navigation" — Retain — stateful/browser/protocol boundary described above.
- `1790` "lands direct and lazy cross-route hash links on their section" — Retain — stateful/browser/protocol boundary described above.
- `1852` "refuses prototype paths" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/slopbot-appeal-inbox.spec.ts

- `7` "an escalated contribution appeal opens from the moderator Inbox and shows resolution @registry" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/solana-vault-actions.spec.ts

- `414` "Solana wallet deposits, recovers after reload, and owner withdraws with verified fee" — Retain — stateful/browser/protocol boundary described above.
- `1656` bounty    ? "owner creates, recovers and funds a private Solana bounty vault through the API"    : "owner creates, recovers, registers and funds a Solana vault through the API" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/vault-actions.spec.ts

- `254` "depositor funds a real vault, recovers a submitted transaction and owner withdraws only free funds" — Retain — stateful/browser/protocol boundary described above.
- `772` "owner turns automatic monthly payment on by default, then opts out" — Retain — stateful/browser/protocol boundary described above.
- `991` "owner creates, registers and funds a vault through the real API" — Retain — stateful/browser/protocol boundary described above.
- `1595` "owner funds a separate bounty vault with private balances and no monthly reward" — Retain — stateful/browser/protocol boundary described above.

### tests/e2e/wallet-readback.spec.ts

- `31` "Account Wallets restores all saved networks and public records after reload" — Retain — stateful/browser/protocol boundary described above.
- `64` "unavailable wallet readback retries without inventing an empty account" — Retain — stateful/browser/protocol boundary described above.
- `94` "expired wallet sessions require sign-in with an Account return path" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/appeal.test.ts

- `11` "Slopbot queue confirms appeal labels and refuses private or replaced repositories" — Retain worker/DB path; remove pure recovery tail — EWT05.

### workers/slopbot/history-registry.test.ts

- `194` "ingestion reads existing history through HTTP when registries use different names" — Retain — stateful/browser/protocol boundary described above.
- `239` "history consumers retain registered aliases and reject a different immutable source" — Retain — stateful/browser/protocol boundary described above.
- `385` `immutable repository identity reads ${kind} across registry names` — Retain — stateful/browser/protocol boundary described above.
- `415` `live registered ${kind} remain readable after pause and retirement` — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/maintainer-hold.test.ts

- `346` "an uncertain finding waits 7 days for the maintainer, then is labeled once and never closed" — Retain — stateful/browser/protocol boundary described above.
- `394` "a maintainer who acts inside the window keeps the decision; Slopbot adds no label" — Retain — stateful/browser/protocol boundary described above.
- `407` "a label-only finding without cited evidence waits even at high confidence" — Retain — stateful/browser/protocol boundary described above.
- `421` "a pull request converted to draft during the window is not labeled" — Retain — stateful/browser/protocol boundary described above.
- `442` "a due hold rechecks substantive source after a target advance (changed=%s)" — Retain — stateful/browser/protocol boundary described above.
- `466` "an upheld appeal supersedes an open maintainer hold and removes slopbot:uncertain after the hold window" — Retain — stateful/browser/protocol boundary described above.
- `502` "an appeal upheld during the hold's %s request leaves no uncertain label" — Retain — stateful/browser/protocol boundary described above.
- `534` "an upheld appeal removes a hold label added after its issue snapshot" — Retain — stateful/browser/protocol boundary described above.
- `564` "a hold retries an unknown label write against the stored upheld appeal" — Retain — stateful/browser/protocol boundary described above.
- `609` "an appeal retries an unknown label removal without changing its stored decision" — Retain — stateful/browser/protocol boundary described above.
- `649` "a maintainer reopen removes the uncertain label and supersedes a due hold without an appeal" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/penalty-appeal.test.ts

- `822` `project closure consent respects the ${boundary} boundary` — Retain — stateful/browser/protocol boundary described above.
- `886` "fresh project consent and confirmation permit closure without a repository file" — Retain — stateful/browser/protocol boundary described above.
- `895` "a spam close debits 3 thirds once; an accepted uphold draft reopens the item and reverses the debit once" — Retain — stateful/browser/protocol boundary described above.
- `986` "an upheld appeal reopens only Slopbot's own close, never a later maintainer close" — Retain — stateful/browser/protocol boundary described above.
- `1046` "a scam close escalates to a moderator; only a moderator decides, and a denial keeps the debit" — Retain — stateful/browser/protocol boundary described above.
- `1100` "a maintainer reopen upholds an open appeal and removes the finding label, but does not post an upheld comment after a maintainer-denied appeal" — Retain — stateful/browser/protocol boundary described above.
- `1154` "a rejected draft escalates, and an appeal unresolved for 7 days escalates once" — Retain — stateful/browser/protocol boundary described above.
- `1192` "concurrent moderator decisions cannot deny an appeal after its uphold starts reopening the PR" — Retain — stateful/browser/protocol boundary described above.
- `1222` "a retry after an uncertain reopen completes the recorded appeal decision" — Retain — stateful/browser/protocol boundary described above.
- `1257` "a recorded debit reaches the published score once and an upheld appeal restores it" — Retain — stateful/browser/protocol boundary described above.
- `1348` "a reopen and later close keeps the debit in its recorded month" — Retain — stateful/browser/protocol boundary described above.
- `1393` `an escalated appeal reaches the moderator Inbox and respects ${state} delivery state` — Retain — stateful/browser/protocol boundary described above.
- `1463` "a scam close writes one moderator account-review notice across replays" — Retain — stateful/browser/protocol boundary described above.
- `1539` "a reversed scam penalty suppresses the pending account-review mail" — Retain — stateful/browser/protocol boundary described above.
- `1552` `a ${category} close writes no moderator account-review notice` — Retain — stateful/browser/protocol boundary described above.
- `1561` "a scam notice write failure is recovered after GitHub has closed the item" — Retain — stateful/browser/protocol boundary described above.
- `1583` `a lost ${stage} comment response reconciles once through the actual queue` — Retain — stateful/browser/protocol boundary described above.
- `1626` "concurrent deliveries serialize the same appeal stage" — Retain — stateful/browser/protocol boundary described above.
- `1651` "an expired publisher cannot complete or cause its successor to repeat the pending POST" — Retain — stateful/browser/protocol boundary described above.
- `1685` "missing evidence after an uncertain POST stays pending without a duplicate or false success" — Retain — stateful/browser/protocol boundary described above.
- `1711` "unavailable comment history refuses a first POST but remains retryable" — Retain — stateful/browser/protocol boundary described above.
- `1729` `a confirmed GitHub ${status} rejection allows an authorized appeal retry` — Retain — stateful/browser/protocol boundary described above.
- `1746` "replaying an old reopen cannot remove a newer head finding" — Retain — stateful/browser/protocol boundary described above.
- `1769` "a delayed bound reopen clears the same-head finding that raced before its marker" — Retain — stateful/browser/protocol boundary described above.
- `1787` "a genuine fresh same-second reopen clears the finding and reverses once" — Retain — stateful/browser/protocol boundary described above.
- `1805` "unknown label DELETE retries preserve one reversal and current maintainer authority" — Retain — stateful/browser/protocol boundary described above.
- `1840` "unsupported legacy reopen and a subsequently closed item make no decision" — Retain — stateful/browser/protocol boundary described above.
- `1860` `a same-revision reopen wins a concurrent category label (lost response: ${loseResponse})` — Retain — stateful/browser/protocol boundary described above.
- `1888` "the first delivery of an old-head reopen preserves a newer finding" — Retain — stateful/browser/protocol boundary described above.
- `1915` `a confirmed same-revision reopen recovers a close already in flight: ${failure}` — Retain — stateful/browser/protocol boundary described above.
- `1958` `late-close recovery preserves a subsequent ${later}` — Retain — stateful/browser/protocol boundary described above.
- `1986` "a reopen that confirms at the first penalty INSERT atomically prevents a new debit" — Retain — stateful/browser/protocol boundary described above.
- `2003` "a delayed genuine reopen reverses the bot close that raced before queue delivery" — Retain — stateful/browser/protocol boundary described above.
- `2022` `an account banned ${timing} needs a moderator to resolve its public appeal` — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/reopen-source.test.ts

- `87` "a lost queue response retains the signed source and changed redelivery cannot rebind it" — Retain — stateful/browser/protocol boundary described above.
- `129` "only a confirmed bound receipt can supersede a hold on its exact revision" — Retain — stateful/browser/protocol boundary described above.
- `164` "missing or unsigned reopen evidence cannot enqueue a maintainer decision" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/review-scope.test.ts

- `259` "a paused project gets security review only and no contributor-work action" — Retain — stateful/browser/protocol boundary described above.
- `275` "current target comparison replaces stale PR files and stale zero-file metadata" — Retain — stateful/browser/protocol boundary described above.
- `284` "target movement after review prevents even an advisory write" — Retain — stateful/browser/protocol boundary described above.
- `298` "%s source cannot reach a model or GitHub action" — Retain — stateful/browser/protocol boundary described above.
- `323` "an equal stored digest cannot label a changed original as a duplicate" — Retain — stateful/browser/protocol boundary described above.
- `333` "an unavailable PR cannot be reviewed as an issue without its source" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/spend-alerts.test.ts

- `56` "monthly cost ledger sends every crossed $500 milestone once, including failed calls and prior months" — Retain — stateful/browser/protocol boundary described above.
- `91` "ambiguous mail is retained and not resent by the next scheduled invocation" — Retain — stateful/browser/protocol boundary described above.
- `108` "alerts-only inference continues beyond $500 while notices and attempt identity remain enforced" — Retain — stateful/browser/protocol boundary described above.
- `151` "alerts-only migration preserves earlier capped reservations and reconciliations" — Retain — stateful/browser/protocol boundary described above.
- `200` "alerts-only route retains unknown fallback costs without a reserve or duplicate call" — Retain — stateful/browser/protocol boundary described above.
- `350` "attempt migration preserves populated children; known alerts-only costs reconcile above old estimates" — Retain — stateful/browser/protocol boundary described above.
- `446` "provider failure mail retains ambiguous delivery without a blind resend" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/value-live-registry.test.ts

- `87` `live registration reaches the consumer; ${change} authority` — Retain — stateful/browser/protocol boundary described above.
- `245` "old and failing requests cannot starve new valuation requests" — Retain — stateful/browser/protocol boundary described above.
- `389` "scheduler preserves appeal progress when retry dispatch is unavailable" — Retain — stateful/browser/protocol boundary described above.

### workers/slopbot/webhook-installation.test.ts

- `235` "does not replay an older suspend after its committed response was lost" — Retain — stateful/browser/protocol boundary described above.
- `252` "does not let a delayed older suspend replace a newer unsuspend" — Retain — stateful/browser/protocol boundary described above.
- `269` "records a suspend even when the created delivery was missed" — Retain — stateful/browser/protocol boundary described above.
- `279` "accepts GitHub's numeric installation timestamps" — Retain — stateful/browser/protocol boundary described above.
- `288` "orders equivalent ISO timestamp spellings by instant" — Retain — stateful/browser/protocol boundary described above.
- `298` "fails closed when lifecycle events share a source timestamp" — Retain — stateful/browser/protocol boundary described above.
- `308` "does not replay a pre-migration ambiguous delivery" — Retain — stateful/browser/protocol boundary described above.
- `327` "applies a lifecycle event generated during the migration second" — Retain — stateful/browser/protocol boundary described above.
- `346` `installation ${action} records one owner notice in the webhook transaction` — Retain — stateful/browser/protocol boundary described above.

### workers/vetting/acquire.test.ts

- `133` "acquires exact real Git objects without checkout, hooks, symlink following or execution" — Retain — stateful/browser/protocol boundary described above.
- `167` "altered blobs, incomplete trees and redirects leave no completed acquisition" — Retain — stateful/browser/protocol boundary described above.

### Python workflow declarations

- `workers/vetting/artifacts_workflow_test.py:40` `test_nested_inventory_never_runs_or_extracts_code` — Retain real CLI/OS/VM workflow.
- `workers/vetting/artifacts_workflow_test.py:55` `test_archive_escape_links_and_expansion_are_quarantined` — Retain real CLI/OS/VM workflow.
- `workers/vetting/artifacts_workflow_test.py:73` `test_actual_parser_namespace_cannot_read_host_write_or_reach_network` — Retain real CLI/OS/VM workflow.
- `workers/vetting/artifacts_workflow_test.py:111` `test_missing_isolation_does_not_return_partial_inventory` — Retain real CLI/OS/VM workflow.
- `workers/vetting/dependencies_workflow_test.py:35` `main` — Retain real CLI/OS/VM workflow.
- `workers/vetting/filesystem_workflow_test.py:9` `main` — Retain real filesystem workflow; remove synthetic size tail EWT06.
- `workers/vetting/provenance_workflow_test.py:75` `test_actual_git_source_and_release_differences_remain_quarantined` — Retain real CLI/OS/VM workflow.
- `workers/vetting/provenance_workflow_test.py:94` `test_lfs_pointer_gap_and_unavailable_zip_mode_remain_visible` — Retain real CLI/OS/VM workflow.
- `workers/vetting/provenance_workflow_test.py:122` `test_root_prefix_is_not_stripped` — Retain real CLI/OS/VM workflow.
- `workers/vetting/provenance_workflow_test.py:129` `test_missing_mismatched_and_unsafe_inputs_never_return_partial_comparison` — Retain real CLI/OS/VM workflow.
- `workers/vetting/vm_workflow_test.py:12` `main` — Retain real CLI/OS/VM workflow.


---

