# Proof results must precede publication

The release workflow's quality job originally depended on preparation, code,
browser and optional sandbox jobs. Quint's exhaustive checks and LemmaScript's
proofs ran in separate workflows. A separate failed or pending proof therefore
could not block that quality job or its downstream publication jobs.

Both proof workflows are now reusable jobs in the same release workflow.
Quality requires both results to be `success`, in addition to its existing
checks. Both proof jobs explicitly check out and verify `github.sha`, matching
the prepared build and code job. Their standalone manual triggers remain;
duplicate automatic triggers are removed. These jobs receive read-only content
permission and no deployment or protected-environment secrets are passed.
GitHub's automatic token remains limited to read-only content access.
No repository rule, environment approval,
deployment, DNS, credential or production activation was changed.

[GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds)
defines dependency ordering and failure/skip propagation. The workflow retains
its cancellation guard and its existing deployment conditions. A failed,
skipped, canceled or still-pending proof cannot produce the required successful
quality result. The other source, branch, artifact and publication fences remain
covered by `release_publication`.

`release_proof_gate` models the two proof results, a fixed checkout identity and
the other required quality inputs. It includes pending, failed, skipped and
canceled outcomes, rather than assuming every selected proof completes.
It abstracts GitHub's scheduler and does not invoke any deployment.

A local reproduction executes the actual old and new quality shell steps with
all 25 pairs of proof results. The old step returns success even when both
proofs fail; the corrected step succeeds only when both succeed. Five further
cases retain the existing checks and optional sandbox behavior. The 30-case
receipt is under ignored `evidence/formal/release-proof-gate/`. This is shell
conformance, not a hosted publication test.

Actionlint 1.7.12 validates the changed workflow graph. Its ordinary run retains
two pre-existing SC2016 informational findings in an unrelated shell block;
the same findings occur in the original workflow. With those findings filtered,
the changed workflows have no reported errors. Final exact-SHA hosted execution
is required to establish the integrated dependency path.
