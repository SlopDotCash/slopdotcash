# Operator keeper safety VIEW V1

Status: parent native controls and ordinary checks passed; its 180-second full
graph was incomplete. This private child grants the same reviewed graph 600
seconds for a hosted diagnostic. Full-graph qualification remains pending.
The unchanged concrete model is
`formal/models/payments/operator_keeper_lifecycle.qnt`, SHA-256
`7377521ae45adfa5ad7469e8492170b3a87ef406d613fd22e9a83437e2f1d89d`.
The manifest pins the complete actual production translation and appended VIEW;
translation capture is not graph verification. No model action, domain, scenario,
invariant, VIEW, manifest, native-control, adapter or runtime source changes.
Only the model-specific full-verifier allowance and reviewed manual diagnostic
selectors change in this private follow-up.

The observation keeps all globals except indexed/projects, all request indices,
phases and exact run IDs, and every live run field except projects. Request
instance/result are erased, caller retains its cron/non-cron class, and HTTP
retains equality to 200. Unused/lost runs retain phase; settled runs retain phase
and throw/partial/other outcome. Other run phases retain all remaining raw fields.
No actor, request or run ID symmetry is used.

## Whole-source future-read audit

- indexed is write-only. Global projects flows only into Run.projects, which has
  no guard, step or invariant consumer. Scenario observations of those fields
  remain concrete; arbitrary output predicates are outside this VIEW guarantee.
- Request.instance/result have no future consumer in init/step/invariant.
  request(id, caller) uses its raw caller PARAMETER for public/wrong-route/cron
  rejection before capture. Stored caller is tested only for equality to cron.
  Stored HTTP is tested only for equality to 200, in the invariant.
- Every live run is exact except projects. selectMode, identity, stage/commit,
  broadcast, gasEvidence, itemFailure, finish and fatal retain their guards,
  branch predicates, writes and parameter domains. Signing, nonce, liability,
  registry identity, broadcasts and safeSigning remain raw, including false
  values. indexReads may stutter in the quotient.
- No action reactivates terminal run payload. Run actions require mode/identity/
  core. Nonfresh dispatch preserves runs; fresh dispatch fully replaces the key
  from unusedRun/current globals before entering mode. Restart retains settled
  and unused runs; other phases become lost and active becomes zero. Old lost
  payload never becomes live without the same full replacement.
- deliver needs exact request phase/runId, settled run phase, throw outcome and
  cron caller class. Other outcomes flow only into erased result. A lost reply
  changes phase and erased result, retaining raw HTTP as before.
  inspectScheduled requires body/cron; partial affects only erased result.
  Keeping partial separate is conservative. Restart interruption uses request
  phase/runId and run phase, all retained. Late delivery after replacement uses
  the same exact run reference.

For equal observations and each concrete action with the same parameters,
phase guards and other enabledness predicates agree, and successor observations
agree. Full reset occurs before erased terminal data could be read. This manual
congruence argument covers the actual init/step/invariant source, not an abstract
replacement transition system, and does not assume the invariant already holds.

## Every invariant, including false prefixes

count, instance, safeSigning, signed, nonce, liability, settledGas and broadcasts
are retained exactly, so the first seven clauses retain their raw truth values.
For active != 0, a terminal run makes the phase conjunct false regardless of its
erased instance. A live run retains exact instance and phase. This preserves
false active/terminal states rather than assuming them unreachable.

The HTTP clause is reconstructed from exact request http==200, exact runId and
exact referenced run phase. It is deliberately NOT replaced by a frozen Boolean:
a fresh dispatch or restart may change a referenced run and break or heal the
clause, including from a false prefix. Exact indices/phases preserve that change.
No invariant conjunct is collapsed into a global validity flag.

## Qualification boundary

Targeted negative controls must isolate each original clause, live guards,
terminal phase/outcome distinctions, false-clause healing, full reset and late
response delivery. Paired raw/VIEW probes must demonstrate only the intended
coalescing with an independent true property. Complete actual production TLA
must pass source/translation/VIEW/adapter pins and a finite graph must report
zero queued states before a pass is claimed. Preserve prior incomplete receipts.
These model results do not prove application refinement or financial activation.


## Frozen qualification and private hosted follow-up

At frozen parent `6b28564ed868374cbae9ca201271f9c72e58a579`, the focused native
file passed 56 tests and 378 assertions in 155.88 seconds. Its 52 named
counterexamples, paired raw-two/view-one diagnostic and actual complete
production-translation binding passed. The unchanged ordinary typecheck,
named scenarios and 500×60 seeded traces all passed; the sampling stage took
37,638 ms. All 2,163 tracked-file hashes and ten verifier-tool hashes remained
stable. These are the parent experiment's receipts, not fresh qualification
receipts for this resource-only child.

The canonical 180-second full graph was INCOMPLETE: last logged progress was
25,887,606 generated, 4,556,991 distinct and 899,640 queued at depth 19. The
wrapper took 185,192 ms, with passed=false, inputsUnchanged=true and
canceled=false. Its receipt SHA-256 is
`076ed89a8ee1eb097cea2d80f0d8c7b5ee76c529cbf28e754c2c1b4bf4b35dd9`.
SIGKILL, kill EPERM and cleanup-did-not-finish warnings remain in the original
receipt. A separate post-exit process audit confirmed known checker PID 27593
and Java PID 37716 absent, with no matching owned Node/Java process. No signal
was performed. Verified cleanup does not turn an incomplete graph into a pass.

This private child changes only this model's full-verifier allowance to 600
seconds; ordinary stages retain 90 seconds. The concrete QNT, helper, VIEW
manifest, native test and adapter bytes stay exact. Manual models/shards
inputs match the reviewed diagnostic interface from
`e8977c1add61ea87ec04c3f5f607e3c7cebeceba`; trusted release defaults still
request all models and all six shards. The keeper's native CI registration is
retained. All three indexes are regenerated against the child. No other
projection or verifier prototype is imported.

The hosted 600-second measurement is PENDING until its own stable-source
receipt reports complete exploration with zero queued states. There is no
new native/full run in this preparation, no failed receipt is relabeled, and
no temporal, exact-output, application-refinement or financial-activation
claim is added. The sole release integrator owns publication of diagnostics.

## Hosted qualification after the local incomplete attempt

The isolated diagnostic at `4c2534d7839e9d543c543cca91067959e3ce5ce5`
completed the exact reviewed keeper VIEW in workflow `43122103257`,
job `130864867129`. The original local 180-second incomplete result above
remains historical evidence. The hosted result generated 47,536,725 states,
found 7,733,684 distinct VIEW classes, exhausted the queue at depth 29, and
finished in 126,272 ms within its explicit 600,000 ms bound. Exit status was
zero, with no error or invariant violation; inputs remained unchanged and
the run was not canceled. All ordinary keeper stages passed.

The verification receipt SHA-256 is
`4670d01d7c69c1db4cdcc942274d943d61dd9d127fc4cb5d4e42ab94f23c016c`.
The raw QNT, its applied VIEW, and all six mapped runtime source hashes match
the reviewed packet `3e8b36a04e7650603e87fc4e3b573cd70a8af123`.
The same diagnostic's complete native inventory subsequently passed all
713 tests across 19 files, with 3,865 assertions and zero failures.

This qualifies selective integration of this finite safety VIEW. It does not
qualify the other four diagnostic projections, establish source refinement,
or replace the final trusted branch and release gates.
