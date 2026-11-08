# Submitted-payment candidate ownership

This separate follow-up starts at `a8b0f8226`; it is not part of that frozen
observation candidate. It was authored by source inspection. No parser,
typecheck, test, simulation, verifier or browser run was performed here.

`BountySubmittedPayments` reads a saved wallet request and may await its
session and parent authorization before saving the entered candidate. The
original loop reread storage but did not require its selected row to exist.
An old EVM wallet prompt could decline during that wait and remove its empty
nonce entry. The fallback then spread the absent entry and stored a new
candidate-only object. That object lacked the original transaction and
request identity. Another delayed candidate could similarly overwrite a
replacement request's candidate or a newer verification choice.

The correction compares the selected saved record with the exact record
captured by the rendered row. A missing storage key, removed nonce, changed
request, returned wallet hash or newer candidate refuses the write and does
not call verification. EVM comparison is per nonce, so unrelated journal
entries can change without being overwritten. Solana comparison covers its
single saved record. The comparison and storage write have no await between
them. The existing parent still owns actor/generation authorization and
receipt acceptance; a candidate is not proof of payment.

After each successful write, the component acknowledges those stored bytes
for that row. It keeps the latest edited input value. This lets a failed API
verification retry another candidate without comparing against its own older
storage snapshot. A later row's storage failure leaves earlier writes and
acknowledgements intact and prevents the verification call. A changed row
loaded in the meantime is not replaced by this acknowledgement.

`ui_submitted_candidate_ownership.qnt` retains record presence, request
identity, wallet evidence, candidate evidence, one independent row and two
submissions. Its eleven unexecuted scenarios cover decline/removal,
replacement, late hash, newer candidate, independent nonce writes, both
wallet/candidate orders, storage failure, edited retry, captured input,
authority refusal and explicit empty input. Synchronous multi-row partial
writes, captured actor/generation slots and parent departure are composed
with `ui_submitted_payment_recovery`; its existing scenarios assume their
selected record remains owned. This focused model adds the ownership
condition for writes concurrent with another component's completion.

Same-tab storage visibility and synchronous compare/write, unique request
identity, JSON parsing and parent/API authorization are explicit assumptions.
The models do not prove arbitrary cross-tab histories or exact browser
scheduling. A real browser regression must hold fallback authorization,
resolve the prior wallet prompt as declined, and then release authorization;
the removed row must remain absent and no verification request may start.
Ordinary failed verification followed by an edited retry must also remain
available. No runtime conformance or complete application correctness is
claimed by this source-only follow-up.

An unexecuted regression extends `tests/e2e/bounty-full-flow.spec.ts`: it holds
the actual private case authorization GET, removes the one pending nonce from
browser storage, releases the GET and requires an intact empty journal plus
zero verification POSTs. It restores the captured record so the existing
real-API/local-Anvil flow continues through verification. This injects the
record removal as the boundary condition; it does not claim to reproduce a
wallet provider's decline timing. The retained workflow also exercises retry
after an entered invalid hash. Execution remains outstanding.
