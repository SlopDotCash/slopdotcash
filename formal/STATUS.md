# State review status

The goal remains active and incomplete. The source census and finite models are
maintained against `origin/development` in the separate
`slopdotcash-quint-current` integration worktree. It includes development
`ccc37c36e3f557e7bddf32a95830f29f4876ff9c`. The earlier dirty `slopdotcash`
checkout is preserved. The prior `slopdotcash-quint` checkpoint and its logs
remain available; they do not substitute for verification of the latest tree.

Required policy is recorded in PRD section 12, CONTRIBUTING and identical
AGENTS/CLAUDE instructions. Quint is lockfile-pinned. The model runner records
each exact model hash, command, result and diagnostic under ignored
`evidence/formal/`. It rejects a model changed during its check.

`formal/inventory.json` records production sources, lexical state-review hints,
model links and explicit pending classifications. Run `formal:inventory:update`
only after reviewing changes. `formal:coverage` exits unsuccessfully while
unmapped sources remain. A mapped source is not a proof of full refinement.

Read the area audits for actual fixes and evidence. Completion still requires
finishing the source/action inventory, extending models and conformance evidence
for the pending families, resolving all known discrepancies, and running the
full code/browser/contract checks against a stable final revision. Production
deployment and live-provider availability are separate boundaries.

The current file census has reached zero unmapped application sources. This is
a coverage-index milestone, not completion of this goal. Every linked audit
continues to distinguish finite abstractions from whole-source refinement.
Remaining work includes cross-tab and navigation/draft interleavings, further
concurrent backend/payment interactions, exact-revision combined verification,
and the explicitly listed source-to-model conformance gaps.

The subsequent composition pass added real-handler and browser evidence for
those concrete interleavings and corrected the discrepancies in `FINDINGS.md`.
It also integrated the retained-account/recovery work from PR 2403 and reused
the original authored report/payout fixes from PRs 2252 and 2313. The current
source and model indexes must pass again after every integration change.

The isolated Solana run passed both production-delay scenarios and all 25
lifecycle scenarios. Rebuilt JavaScript bundles matched all 17 exercised
bundles. Its receipt distinguishes command-pinned runtime selection and the
local build-tool workaround from production artifact or mainnet evidence.
The earlier concurrent run's confirmation timeouts remain failed evidence.
Full combined code/model/browser verification remains pending; focused passes
do not close this goal.

The parallel current-development LemmaScript work has been integrated locally.
Its four selected pure-kernel proof modules passed together; unselected functions
remain unproved. No production deployment, live payment or provider activation
has been performed.
