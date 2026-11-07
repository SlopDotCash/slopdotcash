# State review status

The goal remains active and incomplete. The source census and finite models are
maintained against `origin/development` in the separate `slopdotcash-quint`
worktree. The earlier dirty `slopdotcash` checkout is preserved and its results
are not counted as coverage of this application.

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

The parallel current-development LemmaScript work has been integrated locally.
Its four selected pure-kernel proof modules passed together; unselected functions
remain unproved. No production deployment, live payment or provider activation
has been performed.
