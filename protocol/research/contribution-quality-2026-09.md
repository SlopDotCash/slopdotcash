# Contribution quality and August payout review

Research and implementation decision, 10 September 2026. This document defines an advisory review workflow. It does not amend a project's approved scoring policy, ratify any contributor's award, or authorize a payment. Historical snapshots and closed cycles remain immutable.

## Finding

The August Eliza preparation contains 108 credited people, 4,668 credited merges, 2,383 ordinary review events and 10 evaluated contributions. Every merge has provisional micro credit. Ordinary reviews contribute 7,149 of 12,003 score-thirds, or 59.6% of the unweighted score. Thus a feature, a production repair and a blank-line cleanup can each receive one third of a point, while an ordinary qualifying review receives one point. The problem is missing outcome valuation and grouping, not simply excessive small PRs.

The initial search census returned 5,429 PRs, including 723 unmerged closures. Independent repository enumeration scanned 20,388 PR records over 204 pages and found 7,348 August closures: 4,706 merged and 2,642 unmerged. Search omitted 1,919 unmerged PRs even though its advertised counts reconciled. The merged ID sets match exactly. Of the 2,642 unmerged closures, 2,113 were opened in August and 529 are older backlog. Closed PR count divided by August merge count is not an acceptance rate: open, later-closed and reopened submissions have different coverage. The quality workspace preserves this distinction.

Among credited merges, 14 have zero churn, 300 have at most ten changed lines, and 165 target a branch other than the project's configured integration branch. These are triage signals. They are neither proof of abuse nor automatic reasons to remove an award. In particular, a branch promotion can duplicate implementation credit while separately requiring valuable release work.

The user specified a $10,000 August cap and a $5,000 September cap. Both remain in the project manifest. This change uses the August preparation's complete actor census, including missing-wallet contributors and people without September activity.

## Research and implications

Forsgren and colleagues' SPACE framework argues that developer productivity cannot be represented by a single activity metric. This supports keeping outcome value, collaboration and review evidence distinct rather than constructing a purported productivity score from PR or line counts. It does not provide a monetary reward formula or validate any particular tier coefficient. [Microsoft Research, SPACE, 2021](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/).

Google's guidance recommends small, self-contained changes because they are easier to understand and review. It explicitly allows logical work to be split, expects tests alongside implementation and distinguishes generated changes from changes requiring extensive manual review. Penalizing small PRs as a class would encourage larger, less reviewable submissions. The appropriate unit for rewards is the accepted outcome, with constituent PRs linked together. A small diff is a reason to inspect scope, not a reason to assume little value. [Google engineering practices, Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html).

Google's review guidance asks whether a change solves a real user problem, integrates well, avoids unnecessary complexity and includes meaningful tests. It warns against speculative generality and tests that do not expose actual faults. This supports asking for a reachable caller, an acceptance condition and a regression demonstration when evaluating tiny defensive patches. Counting test lines or files alone would reward maintenance burden and test inflation. [Google engineering practices, What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html).

Sadowski and colleagues studied Google's review process using interviews, a survey and logs of nine million reviewed changes. The study offers evidence that review is a substantial collaborative engineering process; its setting and observational design do not establish a universal exchange rate between one review and one implementation. We therefore permit independently evidenced review work to receive an appropriate tier without applying a blanket maintainer multiplier. [Modern Code Review: A Case Study at Google, 2018](https://research.google/pubs/modern-code-review-a-case-study-at-google/).

Git's patch-ID facility is intended to find likely duplicate changes. Its stable mode ignores whitespace, while verbatim mode preserves it. Whitespace can be semantic in indentation-sensitive languages and string literals. Our conservative local analyzer preserves paths, context and changed-line whitespace; it ignores only hunk coordinates. A matching digest is a grouping candidate, not a proof that two branch landings have the same effect or that one author deserves another's credit. [Git patch-id documentation](https://git-scm.com/docs/git-patch-id).

GitHub's PR-file endpoint paginates and has a maximum file limit. Missing or truncated patches must remain unknown rather than being treated as a complete empty diff. Our analyzer reconciles the expected file count, additions and deletions with actual patch lines, refuses missing patches and checks the captured head against the source census before issuing content flags. [GitHub REST pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files).

These sources support the design constraints. They do not scientifically establish the project's existing 1/3, 1, 3, 8, 15 and 25 point tiers, a fair rejection percentage, or a universal maintainer premium. Those are governance choices that need explicit reasons, prospective policy, sensitivity checks and contributor challenge rights.

## Proposed valuation rubric

Use the existing tier vocabulary to make a concrete proposal. A tier describes an accepted outcome, not the number of lines, PRs, prompts, tokens, hours claimed or tests added.

| Tier | Points | Evidence to look for |
| --- | ---: | --- |
| Micro | 1/3 | Narrow accepted cleanup, correction or incremental maintenance with limited independent effect. |
| Small | 1 | Bounded useful behavior change or repair with a demonstrated caller and acceptance condition. |
| Medium | 3 | A substantive fix or feature with meaningful edge cases, integration and convincing verification. |
| Large | 8 | A substantial accepted capability, architectural repair or difficult production incident resolution. |
| XL | 15 | Broad independently verified impact requiring exceptional integration or review responsibility. |
| Exceptional | 25 | Unusually consequential accepted work with independent co-review and a specific public justification. |

These descriptions are anchors for review, not an automatic classifier. A one-line security correction can be large; a thousand generated lines can be micro. A deletion can simplify a difficult system. Documentation can materially unblock users. Reviewers should assess actual accepted effects and maintenance consequences, not assume code implementation is the only useful output.

The existing score-ratification protocol retains its authority requirements, including co-ratification and independent handling of self/related-party awards. A local tier choice is only a proposed allocation adjustment; it cannot create a ratified ledger record.

## One outcome, one award

For split fixes, backports and release promotions, collect all constituent source event IDs before selecting the tier. The quality calculator replaces their combined provisional weight with one outcome weight. This prevents multiplying the same accepted change by opening several PRs. It also allows a substantive outcome previously split across micro-scored PRs to receive a substantial tier.

Grouping is scoped to one contributor and one contribution kind. It never guesses co-authorship. For salvaged work, identify the original accepted contribution and the maintainer's distinct repair or integration work. Use a reviewed allocation/evaluation with explicit shares and source references when multiple people deserve credit. Check that neither the original nor replacement source is already rewarded elsewhere.

Each reviewed outcome uses `tierThirds * 10000` as its weight. Untouched events retain their exact original weights, including any existing evidence bonuses. This is deliberately a partial-review comparison: it does not silently discard evidence bonuses or rewrite every unreviewed contributor's historical score. The app exposes the unresolved event count. A final review should address the remaining uncertainty before funds are allocated.

Repeated independent useful outcomes remain eligible without a hard count cap. Merely grouping unrelated work to lower a contributor's award is not justified. The calculator requires a reason and public evidence, but only the maintainer review can determine whether that reason is true.

## Rejected submissions and avoidable burden

An unmerged submission already earns no implementation credit. Further deductions should concern a documented repeated avoidable pattern: submitting the same already-covered fix after notice, inventing unreachable defensive paths, or repeatedly reversing explicit project policy. They should not follow from the act of closing a PR.

The app requires at least two distinct submissions opened in the target cycle by the same credited contributor, public source links, a written reason and an explicit proposed rate. There is no automatically recommended penalty rate. Older backlog remains visible but cannot satisfy this repeated-in-cycle threshold. A single duplicate cannot be repeated in the payload to manufacture a pattern.

Superseded changes, rebases, useful partial fixes, independently necessary backports and harmless withdrawals need individual treatment. In particular, if a maintainer incorporates the useful part into a replacement, preserve that authorship. A negative outcome for one attempted implementation does not erase unrelated accepted work.

Deduction arithmetic happens after allocation: `withheld = floor(actorAllocation * basisPoints / 10000)`. Withheld principal remains unallocated. It does not increase other contributors' awards or the later monthly cap. The UI exports the retained amount so reviewers can reconcile the total. No fee is calculated or charged here; the existing settlement lifecycle determines the fee on approved principal.

A project should adopt any general penalty policy prospectively and disclose it to contributors. For August, every proposed adjustment requires a specific public explanation and normal review; the existence of this tool is not evidence that a historical contributor agreed to a new automatic penalty.

## Maintainer and reviewer contribution

Reward actual maintenance outcomes: catching a reproducible blocker, repairing a contributor's otherwise useful implementation, resolving a production incident, coordinating necessary integration or validating a release. A maintainer title alone is not evidence of work and should not multiply every submission.

The new review view exposes the existing review and evaluation events alongside implementation. Useful findings on rejected PRs can enter through the existing strict `evaluations/` protocol, which requires a reviewed manifest and source deduplication. This change does not fabricate missing review events or infer approval from a comment. New awards and shared authorship require a reviewed successor preparation/ledger rather than adding an arbitrary wallet recipient in the browser.

The current ordinary-review collector's broad substantive-text threshold remains a limitation of the frozen baseline. This workspace makes it possible to reassess those events and prevents their volume from being mistaken for verified review value. It does not claim every historical review has now been semantically evaluated. Future policy should require an identifiable finding, reproduction or accepted improvement and the response that resolves it; generic praise and repeated restatements should not be promoted to substantive review tiers.

## August examples for review

- NubsCarson PRs #19630 and #19632 contain the same Terraform provider checksum patch on develop and main. The conservative analyzer flags this pair. Propose one implementation outcome; separately evidenced release work is a different question.
- Lalalune #20564 removes a blank line. This is a genuine micro-sized change; group it with its accepted parent if appropriate. Do not compare it to a full feature merely because both merged.
- Agent-cortex #19766 adds a mock method as a follow-up. Check its parent #19727 before creating two independent awards. Small necessary repairs are not proof of spam.
- Lalalune #19359 changes one TypeScript compiler option. Its functional effect needs review; one changed line does not establish trivial value.
- ss251 #17599 changes canonical Bun-version CI enforcement and includes a real checker and regression coverage. Its provisional micro tier deserves substantive examination. The large test diff alone is not the award rationale.
- Agent-cortex #23238 changes transactional push-token bounds; #23386 changes Gmail address parsing. Review caller behavior, regressions and acceptance before proposing substantive tiers.
- wtfsayo #18175 and #22082 implement settings/onboarding flows. Judge their accepted scope and integration, not raw churn.
- Lalalune #18853/#18855/#18856 and deepanshu-yd #20390/#21187/#21891/#21903 contain documented closure rationales concerning unused paths or policy contradictions. They are candidates for reasoned review, not adjudicated penalties.
- HomunculusLabs #18332 contributed tests incorporated into #18335. ss251 #22367/#22370 were replaced with preserved authorship. Do not treat these closures as automatic lost contribution.
- Reviews by krutftw on #17718 and ngngocnhan1997-hub on #22374 identify blocking defects on unmerged PRs. Investigate reviewed maintenance awards and deduplicate against the subsequent repair.

All numbers refer to `elizaOS/eliza`. Public source links use `https://github.com/elizaOS/eliza/pull/<number>`. The detailed audit inspected 68 selected PR records, including six merged and three unmerged coverage PRs sampled across ss251's ordered PR range. This is not a random sample or every merged diff. The reproducible enrichment found 28 complete, head-matching credited diff records and one matching-patch group. Complete comment and formal-review connections were captured for all 2,642 unmerged closures; automated discussion flags are search aids, never verdicts. No exhaustive semantic ranking or historical test rerun is claimed.

## Coverage campaigns need outcome review

A follow-up count found 579 merged and 487 unmerged ss251 PRs with the test-coverage title pattern. Six sampled merged patches have materially different value: #25155 exercises priority-queue behavior; #25156 tests BatchQueue orchestration through its public entrypoint; #25724 exercises permission states through OS stubs; #26022 tests a local lodash-compatible `maxBy` implementation through its browser-bundle re-export; #26425 also repairs a real default-value defect; and #27545 checks a narrow export/bundle-anchor contract. These are static observations, not historical test reruns. Neither a test-only title nor hundreds of assertions establishes a useful independent outcome. Conversely, a test title can conceal an actual repair.

The diff inspector now flags complete test-only changes for regression-value and overlap review. It does not award points per assertion or penalize all test contributions. Use failure-sensitive behavioral evidence, existing coverage and accepted integration scope to decide whether to retain micro credit, group overlapping work, or propose a substantive tier.

## Operating the workflow

1. Use the canonical frozen preparation and exact snapshot bytes. Run `collect-quality-census.ts PROJECT YYYY-MM OUTPUT_PREFIX` to collect closed-PR metadata from the manifest repositories. It uses the unfiltered repository PR connection in creation order, stops at the next month, and checks immutable IDs and monotonic pagination. Search indexing is not accepted as completeness evidence.
2. Run `prepare-contribution-quality.ts PREPARATION SNAPSHOT CLOSED_CENSUS MERGE_BASES OUTPUT`. It reconciles every credited actor, event identity, score and weight with the preparation. Keep raw snapshots and comments outside the public tree.
3. Run `collect-quality-discussions.ts CENSUS OUTPUT` to capture and paginate closure context. Run `enrich-quality-discussions.ts QUALITY DISCUSSIONS OUTPUT` to publish only conservative search flags and the captured-source digest; keep raw discussion text private. Optionally run `enrich-contribution-quality.ts QUALITY CENSUS DETAILS_DIRECTORY OUTPUT` against captured PR details. Incomplete or mismatched evidence remains explicitly unclassified. Review source completeness before committing the safe metadata projection under `funding/quality/`.
4. The site build validates and generates the public quality index. Open the project's funding page, expand contribution quality and load the cycle evidence. Search by contributor or PR; review implementation, maintenance and unmerged closures separately.
5. Select constituent events, explain the outcome and choose a tier. Inspect every contributor's revised amount. Propose any review-burden adjustment separately and inspect retained principal. Download the source-bound decisions and comparison before copying amounts into the recipient draft.
6. Submit the proposed allocation and supporting decisions through the existing GitHub review process. Confirm authority, related-party review, contributor challenges, missing-wallet retention and the 14-day window before progressing to funding and unsigned settlement plans.

This flow never marks local proposals approved or paid. A complete financial total is not proof of complete semantic review. Production release, identity/wallet availability, funded-vault operation and finalized settlement remain separate verification boundaries.

## Validation and remaining research

The executable tests cover full August source reconciliation, stable integer allocation, source replay/mismatch rejection, duplicate grouping, cross-author rejection, meaningful small-change upgrades, deduction conservation, duplicate/backlog burden rejection, patch truncation, whitespace semantics, keyboard operation, responsive layout and the app-to-recipient-draft handoff.

Before selecting final payout amounts, compare sensitivity to tier assignments and grouping across contributors, not just the largest accounts. Inspect both flagged and unflagged accepted work; otherwise targeted sampling will overstate the prevalence of low-value contributions. Independently review self-awards and a sample of both upgrades and downgrades. Record disagreements and reasons rather than presenting model confidence as adjudication.

The remaining empirical task is complete outcome assessment and reviewed ratification, including missing maintenance awards. Metadata, exact arithmetic and a richer UI cannot by themselves establish that all 4,668 implementations or 2,383 reviews deserve a particular tier. The app exposes that unresolved work and preserves the original record until a successor is reviewed.

## Follow-up assessment correction

Pinned source inspection of #26022 at `515d54db89a5550a4f82d6663939b1d8105de9b3` shows that `es-toolkit-compat-maxBy.ts` re-exports from the local `./es-toolkit-compat` implementation. The shim explicitly keeps the real es-toolkit package out of the bundle. Its tests exercise local compatibility behavior, including iterable inputs, property-path iteratees, unsafe paths, coercion and NaN handling. Describing these as tests of the third-party implementation was incorrect. A small outcome tier is a defensible proposal pending independent review of overlap and regression value; the 226 lines do not determine the award. [Pinned shim](https://github.com/elizaOS/eliza/blob/515d54db89a5550a4f82d6663939b1d8105de9b3/packages/app/src/shims/es-toolkit-compat-maxBy.ts).

The #17718 maintenance candidate remains unresolved: #17707 was also closed unmerged, and its author's overlap comment does not establish a maintainer decision caused by the review. In contrast, the maintainer's closure explanation on #22374 identifies the review's no-follow repair as retained in accepted replacement #22380 while documenting the further repairs that were necessary. This supports an independently reviewed, bounded maintenance-award proposal; it does not transfer the replacement author's implementation credit. The review on #26425 already appears in the ordinary ledger, so its accepted default-value finding must not create a second evaluation award.
