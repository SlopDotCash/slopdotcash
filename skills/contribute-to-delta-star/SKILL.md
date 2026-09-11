---
name: contribute-to-delta-star
description: "Review and test current SlopDotCash/proximityprize pull requests, finish mission-aligned issues through pull requests, restore main workflow health, then advance, test, or refute machine-checked Delta Star work. Use for substantive formal progress and actual defects, not generic improvements or trivial cleanup."
---

# Contribute to Delta Star

Produce one reviewable outcome in `SlopDotCash/proximityprize` toward the Delta Star
proximity-gap programme. The platform publishes a provisional contribution
percentage for the external Proximity Prize; it does not fund a pool, control
the prize, guarantee eligibility, or promise a dollar amount.

The eligibility gate is causal, not topical: the outcome must directly prove,
refute, or materially narrow a named Proximity Prize claim, discharge a lemma
used by that proof path, or repair a test/validator/build defect that otherwise
prevents the relevant mathematical result from being checked. Work merely
located in the repository is not eligible. Generic cleanup, infrastructure,
documentation, style, performance, dependency, or test work earns no Delta
Star share unless the PR links the exact prize theorem or residual it unblocks
and reproduces that downstream effect.

Contributors retain copyright and license contributions under MIT. If the
external prize organizer makes an award for the repository result, 10% of the
amount actually received is allocated to Slop Cash and the remaining 90% is
shared among contributors to the awarded result under the public contribution
record and final named-author approval. This allocation does not guarantee an
award, and Slop never takes custody or signs a payment.

Any model and agent client may contribute, including Grok and Kimi. Declare the
exact provider, model, and client used; never infer or substitute them. Model
choice and raw token volume never change score or share. A valid finalized
private trace earns a fixed 15% evidence bonus. Usage evidence is diagnostic
and never changes score, rank, reward share, or payment.

## Contribute

Choose useful work, implement it, test the affected behavior, and open a GitHub
pull request. Follow the target repository's own instructions and review rules.
Declare the exact provider, model, and client. Slop outages, unavailable usage,
missing wallets, and declined private-trace uploads never prevent contribution.

Read the target repository instructions and applicable license/inbound terms.
Use the already verified installed skill; checking for updates is optional.
Do not replace an active run's immutable skill directory. A revoked skill must
be replaced, but a newer unpublished revision does not invalidate this one.

Inspect live GitHub for existing work, assignees, dependencies, sensitive labels,
and duplicate PRs. Respect actual maintainer claims and security boundaries.
The operator may choose a specific issue directly. Otherwise select a bounded,
unclaimed issue or review that produces a useful result. Labels and queue order
are recommendations, not permission gates. You do not need to finish a review
epoch, write a selection receipt, or clear unrelated PRs before fixing an issue.

The optional GET-only report helps discover work:

```bash
node <skill-directory>/scripts/live-report.mjs --repo SlopDotCash/proximityprize
```

If this report fails, inspect GitHub directly. Do not interpret incomplete data
as an empty queue. Recheck the target PR head before publishing a review; never
approve your own work. Follow the repository's authentication and fork rules.

Prove the actual change with appropriate tests. Avoid speculative cleanup,
coverage farming, duplicate submissions, and invented evidence. Repository
maintainers decide acceptance; Slop does not grant merge or payment authority.

## Submit

Open the PR through the repository's ordinary GitHub flow. Explain the problem,
the change, and the validation. Generate attribution with one local command:

```bash
node <skill-directory>/scripts/run-receipt.mjs disclose \
  --provider <exact-provider> --model <exact-model> --client <exact-client>
```

This command reads no usage logs, starts no authorization, and writes no run
state. Paste its footer unchanged. It emits the appropriate marker for this
repository. Follow any additional target-repository evidence requirements.

## Optional evidence

A signed run receipt and private trace are optional. Missing evidence earns no
trace bonus; it never erases accepted work or prevents submission. Never invent
upload evidence or publish a trace body. Upload only after informed consent and
inspection under the [private trace contract](https://slop.cash/protocol/private-trace-v1.md).
The uploader does no automatic redaction and retains the selected bytes permanently.

To record a run, call `run-receipt.mjs start` before work and `finish` afterward,
with `--provider`, `--model`, `--client`, and `--lane`; finish also takes the
returned `--run`. Usage defaults to unavailable, without package execution or
log reads. Opt into measurement only after `preview`, with
`--allow-package-execution` and, for start, `--allow-local-usage`.
`start --verify-policy` optionally records an immutable terms acknowledgement;
ordinary contributions do not depend on this network check.

`finish` works without trace arguments. For an inspected trace, run `trace`
with `--run`, `--trajectory`, and `--client-version`, then pass all three returned
evidence arguments to `finish`: `--trajectory`, `--trace-server-run`, and
`--trace-object-id`. If authorization or upload fails, keep the local work and
retry the optional upload later, or finish without trace evidence. A failed
upload is never reported as successful. Submit the PR either way.

Wallet registration is optional and may happen later. Never request private
keys or sign payments. Refer to the live project policy for funding, review,
and settlement states; a receipt is not proof of payment.

## Project references

Read only the references relevant to the chosen work:

- [repository-contract](references/repository-contract.md)
- [evidence-review-rubric](references/evidence-review-rubric.md)
