# Source-bound formal report aggregation

PRD section12,STATE-04/05. The prior workflow accepted synthetic reports with
empty tool digests and rows marked `passed: true` even when their exit code
was1 and their command was `false`. The regression executes the original
workflow's actual aggregation code; it does not execute those fake commands.
Existing genuine graph receipts remain evidence at their recorded sources.

The producer and consumer now share one pure contract for canonical command
arguments, tool-file lists and per-model resource allowances. All original
model domains, scenario seeds,100scenario samples,500simulation samples,
60steps, invariant/temporal selection and17existing time allowances are
preserved. The producer includes this contract's digest in every new report.

Aggregation requires exact current tool and mapped-source key sets/digests;
the expected report mode, translation, pinned Quint version and Java metadata;
all and only the expected ordered stages; successful exit/no error; the exact
command tail, seed, bounds and property; expected finite transition, requested
and applied safety metadata; and the current resource allowance. It retains
the previous current-checkout, model census, all-shard and inventory checks.
Unknown/missing/extra fields in bound key maps fail instead of passing vacuously.

Producer installation paths differ across runners. The validator checks
absolute executable roles, the canonical Quint suffix and matching translator
checkout, without equating the producer's Node installation path to the
aggregation job's path. The workflow still pins Node24.15.0 and Bun1.3.14.
The applied overlay digest must be present and well formed; its actual
construction remains checked by the source-bound canonical producer.

Tests mutate individual report obligations and execute the actual workflow
heredoc with complete and malformed temporary receipts. A native-enabled
integration runs the real canonical producer's scenarios/sampling and a tiny
two-state TLC graph, then feeds its unmodified reports to the actual workflow.
Synthetic validator fixtures are never evidence of application behavior.

This checks consistency and source binding inside the trusted workflow's
artifact boundary. JSON metadata alone is not an independent execution
attestation, a machine-checked source refinement, or provider evidence.
