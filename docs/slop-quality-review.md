# Slop page quality review

Original review: 24 September 2026. Incorporated into requirements: 6 October 2026.

## Status and precedence

This is the complete earlier editorial review. Its observations are dated evidence, not a claim about the current deployment.
Reproduce each defect on the implementation revision before changing code. Record resolved items instead of repeating completed work.
The [PRD section 16](slop-product-requirements.md#16-page-and-ux-requirements) defines the current requirements.
The [MVP quality delivery plan](slop-mvp-plan.md#quality-review-delivery) defines their order and acceptance.

The following later requirements replace conflicting recommendations in this review:

- LDR-02 and LDR-03 require Slop Score as the default. Points and Money received remain separate sorts. Consolidate ranking surfaces, not these measures.
- ACC-02 requires Account settings. Move personal controls there. Keep `/points` as a compatibility entry to leaderboard rules, with redirects for old account and people links.
- PRJ requirements define the authenticated five-step setup flow. Apply progressive disclosure within that flow; do not replace it with the earlier three-step proposal.
- WAL requirements cover Base and Solana. Do not retain the earlier Solana-only form as the target.
- Financial rates, signing authority and settlement networks follow the approved versioned policy. The earlier 1% example is historical, not a new fee requirement.
- The 40–60% copy reduction is an editorial target. It is not a mandatory quota or measured result.
- Chart and layout suggestions are alternatives. Implement them only when they improve the required task. No new scoring, sanctions, fees, or financial authority are approved here.

## Verdict

Keep the cream background, heavy black typography, orange accents, restrained borders, and GitHub-native identity. The visual foundation is distinctive. The main problem is information hierarchy: introductory prose, implementation details, disclaimers, and repeated statistics often get more space than the user's next action.

Reduce default-visible explanatory copy by roughly 40–60% as an editorial target, not a measured result. Achieve that by deleting repetition, separating different tasks, and replacing explanations with labeled states and a few useful diagrams. Do not achieve it by shrinking text, hiding material conditions, or putting every paragraph in an accordion.

The strongest first pass is: accurate money labels, one points leaderboard, one profile summary, one account settings destination, shorter page titles, readable mobile tables, and a single canonical explanation of the mechanism.

## Evidence and scope (24 September 2026)

- Read the deployed site through the browser: home, How it works including Verification, Sponsors, Models, Points, login, wallet registration, Eliza and Delta Star project pages, both Heir project variants, Eliza funding (all four payout steps), project update, project creation, contributor profile, cycle archive, one closed cycle, and receipts.
- Visually inspected representative desktop pages and 390px mobile Home and Models. This is an editorial/UX review, not a complete accessibility or functional certification.
- Read route handling and page/component source from `origin/develop` at `fa576cd5f1d7ac81aa255d33eff65af2e349cdc5`, including conditional form, payout, profile, and verification states. Production was observed separately; it is not asserted to serve that exact SHA.
- Covered all current route templates. Repeated project/profile/cycle instances share those templates; every individual contributor or historical record was not opened. The eight project manifests were reviewed for status and content differences.
- Signed-in account states were reviewed in source and the preceding avatar validation, not by completing a fresh OAuth flow. No financial actions or form submissions were performed.
- The local preview was blank. No application files were changed for the September review.

## Fix first: presentation that can mislead or obstruct

| Priority | Observed issue | Recommended correction |
|---|---|---|
| P0 | Home project cards prominently advertise `$5k/mo` without an adjacent unfunded label; the project page explains that the amount is a target and no funding is committed. | Show `Monthly target $5,000` and `Unfunded` together. Separate target, committed amount, and payment availability. Never rely on a later paragraph to qualify the headline. |
| P0 | At 390px, the Models table squeezes “Merged PRs” and numeric values into vertical characters. | Use compact mobile rows with model, merged count, and share; expand secondary metrics. If retaining a table, give columns minimum widths and a keyboard-accessible horizontal scroller. Never wrap a number digit by digit. |
| P0 | The profile showed `1744.6666666666667` as the 35-day score. | Use a shared score formatter (e.g. `1,744.67`) with exact precision in details. Keep money calculations in integer units. |
| P0 | A project displays “Contribution points” and a second monthly “leaderboard,” with different scopes and values. Profile pages add an “overall rank” based on another measure. | Make public rank points-based everywhere. Put allocation scoring in a separately labeled allocation view with an explicit period. Preserve the separate calculations. |
| P0 | Profile project rows display dollar figures even when the overview says projected/unfunded and paid is zero. The cycle hero calls $10,000 a “current cycle amount.” | Label each amount at the point of display: `Simulated`, `Suggested`, `Approved`, or `Paid`. Avoid the ambiguous “current cycle amount.” |
| P1 | Many data-driven routes initially render an introduction or nearly empty main area; `DataNotice` returns nothing while loading. | Reserve the content area and show a useful loading state. Keep identity and route title stable while data loads. Never substitute zero or a paused state for unknown data. |
| P1 | Receipts say “Verified receipt,” while their seal describes only a device signature. | Use “Device-signed receipt” or the precise verified property. Do not imply model-provider verification. |
| P1 | “Fund a project” on the homepage links to the new-project form. | Route it to project funding selection/Sponsors. Keep “Add a project” for onboarding a new repository. |

P0 means the first implementation pass, not an assertion of a security vulnerability.

## Shared style and information architecture

### Navigation and footer

- Keep Projects, Leaderboard, How it works, Models, Sponsors, Add a project, and the far-right avatar. The wordmark already returns home; remove the redundant Home link from interior pages.
- Use the same names everywhere. The footer currently calls How it works “How scoring works” and Sponsors “Fund a pool.” Pick one label per destination.
- Keep Receipts and Cycles out of the primary navigation. Group their footer links under a small “Records” group, alongside verification access.
- Preserve the avatar-only header. Put account identity and points inside its dropdown; show explicit scope if dropdown points include bonuses excluded from rankings.
- Replace “Your profile and ways to earn,” which links to a general points page, with two truthful destinations: “Your profile” and “How points work.”
- Do not add another top-level tab for each subtopic. Use local tabs/sections within the appropriate destination.

### Type, space, and controls

- Reserve the enormous display headline for the homepage and perhaps the sponsor landing page. Functional pages should start with a compact title, one sentence, and their data/action.
- Current Models, Receipts, How it works, and project update heroes consume much of a desktop viewport. On mobile the Models explanation consumes most of the first screen before any data.
- Keep the heavy display face for short titles. Reduce long headlines and extreme negative spacing on multiline functional headings.
- Use three deliberate type roles: display heading, readable body, compact metadata. Restrict uppercase labels and monospace to labels/technical identifiers.
- Standardize buttons: orange primary action, quieter secondary action, text links for navigation. Points/account controls currently look like default browser forms next to the more designed marketing pages.
- Use whitespace and thin separators before adding another outlined card. Profile sections currently resemble several independently assembled products.
- Use one date format, one numeric formatter, and tabular numerals. Display a readable date/window near the metric; put exact UTC timestamps in details.
- Make active navigation and selected tabs clear. Use text plus shape/icon for state, not color alone. Preserve contrast, visible focus, target size, and reduced-motion support.

## 1. Home and Projects section — `/`

**Keep:** the direct promise, project grid, strong primary action, points leaderboard, cream/orange/black palette.

**Cut or merge:**

1. Remove the three explanatory feature blocks (“Pay for accepted outcomes,” “Keep GitHub in control,” “Ship with any agent”). Their ideas recur in the hero and How it works.
2. Keep only one short three-step explainer, not both feature blocks and process blocks.
3. Remove repeated Add/Fund/Get started calls scattered through the same screen. One primary contributor action and one sponsor action are enough.
4. Shorten project descriptions to a single concrete line; move methodology and acceptance rules to project detail.
5. Keep exact funding state beside each amount. The million-dollar external opportunity needs an “External prize” label directly on its card, not just on the detail page.
6. Consider a static complete hero. The typewriter animation visibly leaves “MAKE MONEY” with an empty second line during its cycle; the core message should remain legible at every moment.
7. Move the leaderboard above the secondary explainer if the page's main purpose is finding projects and people.

**Proposed order:** hero → projects → leaderboard → three-step overview → footer.

**Example hero copy:** “Ship useful work on GitHub. Earn points. Explore project rewards.” The surrounding project states must still explain when funding is unavailable.

**Useful visual:** a compact horizontal flow: `Choose a project → Ship a PR → Maintainer review`. A separate payment branch can link to How it works; do not imply every PR automatically leads to payment.

## 2. Leaderboard — `/#leaderboard` and project standings

- One ranking component, one visual treatment, one definition of the selected score.
- Default row: rank, avatar/name, points. Desktop may add merged PRs only if their window matches and is explicit. Avoid stuffing payouts, scoring diagnostics, and receipt bonuses into every row.
- Place period/project/search in one compact toolbar; use “All time” only if the actual coverage supports it. Otherwise use “Recorded history.”
- Replace explanatory text under every table with “How points work,” opening one compact explanation.
- “New earners · 30 days” is a cohort filter, whereas month/history are time windows. Separate those concepts or name the view clearly.
- Merge public community membership and contribution-directory discovery into one People view reachable from the leaderboard. People with zero earned points should remain discoverable without manufacturing a rank.
- Explicit product decision: welcome/X bonuses currently appear on profiles but not earned-point standings. Either keep this policy and label “Earned points” versus “Total points,” or intentionally change ranking rules with a policy migration. Do not silently add incompatible figures during a visual refactor.

## 3. Project detail — `/projects/:id`

**Recommended structure:** identity and status → contribute action → tabs for Contributors, Funding, History, Details.

- Use project name as the main identifier and a short purpose line. “Make money…” can remain a brand accent, but it should not overwhelm paused, deprecated, or permission-gated projects.
- Consolidate reward card, participation notice, and funding disclosure into one truthful status module: monthly target, committed amount, payment availability, next action.
- Put the agent prompt immediately after that module. Keep Copy prominent; collapse terminal installation, downloads, raw skill links, and advanced setup under “Other ways to start.” Preserve working Markdown/archive endpoints.
- Replace the long sentence about exact models, permanent private traces, operators, and append-only wallet registries with a short requirements summary and “Contribution requirements.” Show consequential trace privacy information before any upload.
- Collapse unavailable direct funding to “Direct funding unavailable” with a reason. A large expanded “Fund this project” area with no usable funding route wastes space.
- Show one contributor ranking. Move score/share calculations into a clearly labeled “Allocation” view; do not merge participation points into payout formulas.
- Move payment history beneath Funding/History. Keep maintainer actions together instead of scattering “Manage payouts” and “Draft a project update” among public statistics.
- Replace “license inbound terms” with human wording: “MIT · Contribution terms.” Keep unknown terms visibly unknown.
- Link “Contributors” to this project's people, not the generic `/points#people` directory.

### Project-specific content

| Project | Specific edit |
|---|---|
| Eliza | Shorten purpose to “Build and improve elizaOS.” Prioritize unfunded target labeling and merge the two ranking blocks. |
| ASI | First line: “Improve continual-learning benchmarks.” Put Alberta Plan, seeded comparisons, baselines, and method-porting requirements in contribution details. |
| Darling arm64 | First line: “Help macOS apps run on Linux arm64.” Keep paused state visible; move control/A-B-A/harness requirements into contribution guidance. |
| Heir Elements SDK | Lead with “Archived — replaced by Heir Desk SDK,” plus a direct successor link. Remove the money headline and duplicate activation notices. Retain historical records. |
| Heir Desk SDK | Lead with “Permission required” and the proprietary-license restriction. Avoid suggesting unrestricted open-source participation or earnings. |
| Delta Star | Keep the external prize structurally distinct from monthly pools. Label the advertised prize on the card; show the 90/10 split as a small allocation graphic with “of an award actually received.” Remove inapplicable monthly-payment UI. |
| MONNA Agent Permission Diff | Shorten to “Compare agent permissions offline.” Move redaction/parser/execution restrictions into requirements; keep paused status. |
| Visual Strategy Canvas | Shorten to “Turn a brief into an editable strategy canvas.” Put provider setup and export-test requirements in details; keep paused status. |

## 4. Public profile — `/contributors/:login`

This is the strongest consolidation opportunity after the Points page.

- One header: avatar, name, GitHub, public X, share link. Owner-only settings and wallet actions should not dominate another person's public profile.
- One summary strip: **Points · Paid · Merged · Open · Closed**. Label PR coverage (Slop repositories) and timeframe. Show verified paid as the primary money value; self-reported direct payments stay distinct in payment details.
- Remove duplicate Paid values from the later stat strip. Move the 35-day allocation score and receipt multipliers out of the primary profile summary.
- Replace the standalone “Slop Points” card and separate accepted-work feed with one activity area, with Work / Points / Payments views. Preserve source links and exact history.
- The observed points history contains twenty nearly identical “+10 pts · Eliza · merged pull request” rows. Use linked PR titles; group by date; initially show five records with “View history.” Grouping must preserve individual audit entries.
- Turn earned milestones into three small labeled badges rather than a sentence separated by dots. Avoid a large badge collection competing with the work.
- Consolidate Projects, Past cycles, and Frozen months into project rows with expandable history. Keep frozen, approved, and paid distinctions.
- Put the repeated “Evidence guidance” sentence once above Open work, or show it only on an item that actually lacks evidence. Four identical paragraphs contribute no additional information.
- Use one scope/timestamp per dataset section, not a long date string repeated in every tile. Keep different dataset windows explicit.
- Sort recent activity predictably; show older records through pagination, not an ever-longer wall.

## 5. Account settings and legacy Points page — `/points`

The current page handles too many unrelated jobs: login, privacy, X connection, public members, contributor search, standings, and earning rules.

- Make Account settings the canonical destination for this route's account controls (a clearer route can redirect from `/points`).
- Keep only identity, public visibility, connected accounts, wallet link, and sign out.
- Move both directories into the leaderboard's People view; eliminate their duplicate search controls.
- Remove the standalone standings from Account settings.
- Move Ways to earn into the leaderboard's points explanation, with one canonical policy link.
- Replace the long earning paragraph with a compact table: accepted contribution tiers, eligible review awards per policy, finalized payout +25, join +5, connect X +10. Mark bonuses and whether they affect rank.
- X should be one connection row: account icon, Connected/Not connected, account handle, +10 earned once, and Connect/Disconnect.
- The signed-in source contains two X visibility controls with slightly different wording. Keep one authoritative control and immediate saved/error feedback.
- Remove “Sloperators, maintainers, reviewers, and supporters can all connect.” A generally available connection control already communicates that.
- Keep public membership optional. Do not combine membership privacy, X visibility, and public GitHub contribution records into one vague toggle.

## 6. Login — `/login`

- One compact panel with “Log in,” one sentence, and “Continue with GitHub.” Remove the second “Sign in to Slop” heading.
- The button already explains the provider. Cut “GitHub is the only way to sign in” and move the +5 explanation out of the primary login task.
- Suggested supporting line: “Use GitHub to manage your profile.”
- Put public-profile consent below the button or in a clear onboarding step, without silently changing the existing opt-in.
- After login, return to the original intended task. Avoid leaving signed-in users on another marketing/login panel.
- Match the site's designed primary button and compact form style.

## 7. Wallet registration — `/wallet`

- Treat it as an Account settings task, while preserving a direct URL for existing links.
- Use a three-state flow: address → confirm public registration → saved. Show the signed-in identity and supported network explicitly.
- Keep the warning that identity/address will be public and permanent immediately before confirmation. This is not optional prose to remove.
- Shorten “Registration does not prove control…” to a precise caption, such as “Registration records a receiving address; it does not authorize payment.” Retain the fuller explanation in details.
- Remove record digests and raw timestamps from the success headline. Show address, network, confirmation state, and “View public record”; put technical identifiers in details.
- Change “Confirm register” to “Register address.”
- Avoid showing GitHub authentication as a second unrelated login journey; reuse identity where the security design permits, while retaining any required reauthentication.
- Render only supported network flows. Do not present a chain selector or wallet connection that the current UI cannot complete.

## 8. How it works, including Verification — `/how-it-works`

The current page reads like multiple protocol documents concatenated into one landing page.

- Shorten the title to “How Slop works.” Keep one introductory sentence.
- First screen: four-step visual — **Choose work → Submit a PR → Maintainer review → Points and reward review**.
- Keep the distinction between earning points and becoming eligible for a payment. Payment is a separate reviewed path.
- Collapse sponsor setup, precise freeze time, signature internals, and scoring rule version into secondary sections.
- Replace the “thirds” column with human-facing tier names and score weights. Integer thirds are an implementation representation; retain them in the protocol/export, not the introductory table.
- Replace the long allocation example with one visual equation: accepted weight / total weight × funded pool = projected allocation. Use clearly labeled sample numbers and a review-state caption.
- Show money states as a timeline: Projected → Under review → Approved → Scheduled → Paid. Draw Held, Unclaimed, and Excluded as branches/statuses, not inevitable next steps.
- Consolidate repeated “never holds/signs/broadcasts” prose into one short trust statement and detailed reference.
- Verification should remain within How it works, but as a useful collapsed “Verify a payment” section. Put summary and evidence links first; address derivation forms and RPC/Borsh/PDA details belong under “Advanced verification.”
- Preserve direct access to verification tools. Canonicalize the legacy `/verification` destination to the section or one shared presentation; avoid two independently maintained explanations.
- Replace the long list of protocol links with a small “Technical references” disclosure.

## 9. Sponsors — `/sponsors`

- Keep “Fund the merges. Keep the keys.” It is one of the stronger headlines.
- Put an actionable project/pool list and Fund/Add choice near the top. Currently a long audience study comes before the funding process.
- Reduce the introduction to two lines: sponsor controls budget; maintainers accept work; signing stays external.
- Replace “Who builds on Slop” prose and two large tables with three carefully labeled stats plus one simple horizontal focus-area chart. Keep snapshot date, denominator, and methodology link available.
- Do not imply that contributors' past employers/repositories endorse Slop. If using logos or names, label them “Contributors have merged work into…” and retain evidence.
- Move the full outside-repository dataset to an expandable audience report. Median repository stars is weak primary selling information and can leave the default page.
- Replace duplicated process/state explanations with the same canonical How it works components or concise links.
- Replace the five-column all-pools table full of “none/disabled” values with rows showing project, target, commitment, availability, and a real next action.
- Show the fee as arithmetic: `$5,000 awards + $50 fee = $5,050 total`. Keep its 1% rate and external-prize exception clear; put transfer mechanics in details.
- Put optional review budget behind “Add a separate review budget” in setup. It need not be another full-width landing-page essay.
- One final action block is sufficient. Remove repeated manifesto-style “What X does not buy / never holds / no form / no admin panel” text when the constraint is already represented precisely.

## 10. Add a project — `/projects/new`

- Start with repository URL and a lookup step. Retrieve numeric IDs, node IDs, repository name, branch candidates, and license facts where possible; allow review/correction and fail explicitly when lookup cannot establish facts.
- Do not make maintainers manually supply GitHub database identifiers on the first screen.
- Use three actual progressive steps: Repository → Project and budget → Review proposal. The current three-step banner describes the overall process but leaves a large form visible at once.
- Shorten “Money-forward headline” to “Short description.” Avoid asking users to invent marketing copy before defining work.
- Keep unknown authority/terms as valid explicit states, subject to the real project rules. Do not make up facts to complete a simplified form.
- Display conditional legal fields only when their chosen mode requires them. Put immutable license evidence in an advanced/review section.
- Move JSON out of the default side-by-side layout. Show a human-readable proposal summary and “View manifest.” The raw output currently consumes half the desktop form before the user has entered anything.
- Make the final action “Continue on GitHub,” with Copy brief and Download manifest as alternatives. Preserve the truth that a draft is not a listing or activation.
- Show validation by field plus a short summary; retain entered values on errors.
- Preview name, purpose, status, funding target, and repository so users can assess the actual listing they are proposing.

## 11. Project update — `/projects/:id/manage`

- Replace the enormous “Propose changes to Eliza” hero with “Edit project proposal” and a compact Draft badge.
- Reuse the new-project form components and terminology for shared fields.
- Show before/after changes, a reason, and the GitHub handoff. Put generated brief/JSON in an optional preview.
- Consolidate payout drafting into the dedicated payout workflow rather than maintaining a second allocation editor with different language.
- For disabled payments, show one short status and a requirements link, not a large mostly empty Payouts section.
- Keep the local-draft limitation adjacent to the final action. Never label a copy/download action “Save” or imply it publishes.

## 12. Funding and payout management — `/projects/:id/funding`

- Separate the public Funding records view from the maintainer Manage payouts workspace with local tabs. A public “View transactions” link currently lands above a 108-person editing table.
- Keep the existing four-step payout progression; it is a useful structure. Add current readiness and unresolved blockers to each step.
- Review recipients: show name, amount, destination status, decision; expand a row for reason, full address, and proof. Avoid three full input controls plus full wallet addresses in every visible row.
- Add pagination and quick filters for missing destinations, changed amounts, exclusions, and needs review. Preserve draft edits while filtering.
- Display compact rounded money for scanning, but preserve exact six-decimal USDC in edit/review details and final exports. Never round the actual transaction plan.
- Put the changed-total summary and download/next action near the working area rather than after all recipients.
- Prepare funding: show one dependency checklist and only the current next action. Keep “payments disabled / do not deposit yet” prominent when applicable; do not hide it in an accordion.
- Approve cycle: replace long manual instructions with a concise GitHub handoff summary and copyable required inputs. Keep source hashes and original artifact binding in advanced evidence, reachable before submission.
- Track payments: use a status list per cycle/recipient with external transaction links. Never show approval/submission as Paid.
- Public records: put Verified and Self-reported in separate labeled categories, not paragraphs asking the reader to remember the distinction.
- Keep signer capability distinct from balance. “Funding available” must not be inferred merely from a positive balance.

## 13. Models — `/models`

- Title: “Models.” Subheading: “Models declared on accepted work.”
- Replace the long first paragraph with: “Self-reported usage, not a model benchmark.” Keep this qualification visible, with Methodology for detail.
- First visual: ranked horizontal bars for merged PR count or share of all merged PRs. Use a consistent denominator and visible window.
- Do not use a pie chart for model shares: a PR can name several models, so shares overlap.
- Show model-name coverage separately as a valid part-to-whole bar: Declared / Not declared. This makes missing coverage obvious without an essay.
- Default table: Model, Merged PRs, Share, Contributors. Expand Reviews, Signed PRs, allocation score, concentration, and exact identity string.
- Put concentration beside each expanded model with a simple bar and “X of Y outcomes from one contributor.” It is context, not performance.
- Rename “PR points” to the actual allocation-score term to avoid confusion with participation points.
- Group Models and Clients as local tabs. Replace “Harnesses, from signed receipts only” with “Clients” plus a “Signed runs only” caption.
- Move token statistics into details; their sparse reporting makes them poor headline comparison metrics.
- Review alias handling before deduplication. Preserve exact provider/model declarations in evidence; merge display aliases only through a reviewed identity mapping, never by guessing from similar names.
- Consolidate all caveats into one short visible qualifier and an expandable Methodology section. Avoid repeating self-reporting limits in three locations.

## 14. Receipts — `/receipts`

- Title: “Run receipts.” One line: “Public metadata from device-signed contribution runs.”
- Replace the wall of large cards with a searchable, paginated list: contributor/work, project, model/client, date, signature state.
- The current receipt cards lead with an opaque run ID and repeat the same labels hundreds of times. Lead with the linked contribution and person when the data supports it.
- Keep run ID, device key, private-trace digest, token details, and exact timestamps behind row expansion or a detail view. Retain copying and full source evidence.
- Replace the decorative “S / Verified receipt” seal with the precise property established.
- Treat missing token reporting distinctly from measured zero. Investigate the source before changing observed zeros to “Not reported.”
- Link from Models and contribution activity to filtered receipts so the evidence supports a question rather than forming a separate wall of metadata.

## 15. Cycle archive — `/cycles`

- Title: “Payment cycles.” One sentence at most.
- Use a compact table/list: project, month, state, suggested, approved, paid. Keep financial stages separate.
- Add project/year/state filters when there are enough records to warrant them; avoid empty controls for a one-record archive.
- Replace paragraph-level definitions with state badges and a single “How cycle states work” link.
- Use project display names rather than internal slugs.
- External-prize records require shares/terms, not a misleading all-dollar template.

## 16. Cycle detail — `/cycles/:project/:month`

- Lead with project, readable month, state, and the amount appropriate to that state.
- Replace “current cycle amount” with “Suggested allocation,” “Approved allocation,” or “Paid,” according to the record.
- Use the four-stage visual as an actual progress indicator with the current stage and relevant dates. The present stage cards explain the process but do not make progress obvious.
- Put the main unresolved condition immediately next to the amount, including unfunded status.
- Keep contributor table and exact downloadable records. Collapse repetitive methodology and hash previews into Evidence.
- Use the historical cycle's scoring version and frozen source; never relabel it using the latest rules.

## 17. Legacy Verification and error states

- `/verification`: reuse the canonical How it works verification section, preserve incoming links, and avoid adding its header tab back.
- Missing project/profile/cycle: short specific message with one useful recovery link. Do not present unavailable data as a 404 when the entity may exist.
- Loading: retain route title/identity and show a bounded placeholder where records will appear.
- Error: concise human message, Retry, and optional technical details. Empty: say what has not happened yet and the next useful action. Stale: show last successful update without discarding valid historical data.
- Invalid or unsupported records: expose the inability to verify instead of silently falling back to a reassuring zero or success state.

## Consolidation map

| Repeated material | Canonical home | Other surfaces |
|---|---|---|
| Points ranking | Leaderboard | Project-filtered view; profile total |
| Community + contributor discovery | People view within leaderboard | Links from project/profile |
| Membership and X settings | Account settings | Avatar menu entry |
| Earning rules | Leaderboard explanation + protocol | Short “How points work” link |
| Money-state definitions | How it works | Compact local badges with explanation links |
| Funding custody/authority explanation | How it works / sponsor details | One contextual sentence at actual funding action |
| Project proposals | Shared proposal form | New and update modes |
| Allocation editing | Manage payouts | Link from project/cycle |
| PR, points, and payment activity | Profile activity views | One summary strip |
| Signature/model caveats | Models methodology + receipt details | Precise local status labels |
| Verification tools | How it works → Verification | Compatibility route and direct anchors |

## Visuals worth building

| Replace | With | Why |
|---|---|---|
| Long contribution process prose | 3–4 step flow | Shows where GitHub review happens |
| Repeated payment-state definitions | Branched lifecycle timeline | Makes approved vs paid obvious |
| Allocation example paragraph | Annotated fraction/equation | Shows the calculation without implementation units |
| Fee paragraph plus repeated totals | Awards + fee = total | Communicates the separate fee clearly |
| Models comparison prose | Ranked bars + compact table | Makes counts and share readable |
| Model coverage paragraph | Declared / undeclared bar | Displays missing coverage honestly |
| Long profile stat blocks | One five-metric strip | Answers the user's requested profile questions immediately |
| Long earning paragraph | Small activity/points table | Makes earning rules scannable |
| Sponsor audience tables | Focus-area bars + report link | Keeps the evidence without dominating conversion |
| Payout-preparation instructions | Readiness checklist | Shows what is blocking the next step |

Avoid decorative charts, fabricated trend arrows, revenue-style points graphics, pie charts with overlapping shares, and contribution heatmaps that reward activity over accepted work. Keep charts labeled and supply accessible text/table equivalents.

## Suggested copy replacements

| Current | Proposed |
|---|---|
| Accepted work in. Auditable allocations out. | How Slop works |
| Which models merge. By the receipts. | Models |
| Signed runs, without the private trace. | Run receipts |
| Every pool gets a dated public record. | Payment cycles |
| Money has exact states. | Payment stages |
| One reproducible allocation. | How allocations are calculated |
| Read the contracts. Inspect the record. | Technical references |
| Propose changes to Eliza. | Edit Eliza proposal |
| Current cycle amount | Suggested / Approved / Paid amount, derived from state |
| Funding promotion paused · $0 | Paused, Archived, or Loading funding status, derived from actual cause |
| Outcomes from busiest contributor | Top contributor share, with X of Y in details |
| Confirm register | Register address |
| Your profile and ways to earn | Separate Your profile and How points work links |

## Implementation order and acceptance

1. **Clarity fixes:** funding labels, simulated-money labels, mobile Models layout, score formatting, truthful CTA destinations, explicit loading states.
2. **Consolidation:** points/account/directory separation, one public ranking, unified profile summary, public funding vs maintainer workspace, shared proposal form.
3. **Editorial pass:** cut repeated introductions, shorten titles, remove duplicate explanations, apply consistent terminology and controls.
4. **Selective visuals:** process, lifecycle, fee equation, model bars, sponsor audience chart, readiness checklist.
5. **Polish and verification:** mobile, keyboard, 200% zoom, reduced motion, contrast, empty/error/stale states, long names, large numbers, and source/download links.

Acceptance targets:

- A new visitor can identify a project, its real funding state, and how to start without reading a protocol explanation.
- A profile answers points, paid amount, merged/open/closed PRs, and social identity in its first meaningful viewport.
- Each page has one primary purpose and one primary next action.
- Every displayed financial amount has its state and period adjacent to it.
- Points never resemble a redeemable balance; allocation score is explicitly separate.
- Models are useful on a narrow screen without interpreting vertical digits.
- The default surface becomes substantially shorter without removing auditability, consent, funding restrictions, or recoverable error states.
- Existing links, immutable records, raw Markdown, archives, downloads, and GitHub authority remain intact.

This is a review and proposed edit plan. No application changes or policy changes were made.
