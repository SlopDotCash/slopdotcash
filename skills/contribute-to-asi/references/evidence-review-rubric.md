# ASI evidence rubric

A result is a claim about a number. The evidence has to let a reviewer
reproduce that number without trusting the summary.

## Every measured claim carries

- the lane and the exact metric, named as the repository names it;
- the exact commands with every flag, and the commit SHA they ran at;
- the seed list and `n`, stating which seeds were tuning and which were
  evaluation;
- baseline and candidate as **mean and spread**, plus the delta — never a
  single run, never a best-of-`k`;
- the baseline re-measured in the same environment as the candidate;
- the artifact paths written under `outputs/`, attached as immutable GitHub
  attachment URLs;
- the evidence tier: development-grade and nonpromoting, or promoted through a
  frozen protocol and its validator;
- the focused tests and lane verification that ran, and their result;
- every deviation from the pre-registration, with the reason;
- what remains open, unexplained, or unmeasured.

## What makes a comparison fair

One variable changes. Baseline and candidate share seeds, steps, data order,
and hardware. Tuning happens on tuning seeds; evaluation seeds are touched
once. The comparison is decided against a threshold chosen **before** the
numbers existed.

If the result is inside the seed-to-seed spread, it is not an improvement yet
— say so and either raise `n` or report it as inconclusive.

## Reviewing someone else's result

Reproduce the changed path in an isolated environment, rerun the stated
commands with the stated seeds, and trace the number from the raw artifact
through its validator to the summary. Check the claim against
`RESEARCH_STATUS.md` and `NEGATIVE_RESULTS_LEDGER.md`. A green test suite does
not prove a measurement means what the summary says it means.

For a ported method, read the cited paper section next to the implementation.
Check that stated deviations are the only deviations, and that the paper's
own baseline was reproduced or its failure to reproduce was reported.

## Reject or hold

- a number without its command, seeds, spread, or commit;
- a single-seed or best-of-`k` claim presented as an improvement;
- a candidate compared against a baseline from another environment, machine,
  or commit;
- tuning on evaluation seeds, or reusing consumed evidence seeds;
- a threshold, validator, or test weakened to make the lane pass;
- edited, regenerated, or deleted pinned `outputs/` artifacts;
- development-grade numbers presented as promoted results;
- an unstated seed, config, or protocol change;
- a paper claim imported as if it were a measurement made here;
- a change with no measured effect: a refactor, a rename, a new abstraction,
  or a configuration knob nothing sets;
- work that spreads across lanes instead of moving one.

## Negative results are results

A refutation that closes a direction is worth crediting when it is decisive,
reproducible, and recorded in `NEGATIVE_RESULTS_LEDGER.md` conventions with
the same rigour as a win. An inconclusive run reported honestly is worth more
than a win claimed from noise.
