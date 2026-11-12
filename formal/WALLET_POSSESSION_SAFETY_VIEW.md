# Wallet possession continuation safety VIEW

PRD section 12, STATE-04/05. This private candidate addresses the completed
model check's wide frontier without changing any QNT, finite domain, action,
invariant, failure path or named scenario. It is a manual same-parameter
successor congruence argument, not a machine-checked source refinement.
No temporal, crypto, current-wallet-control or payment-authority claim exists.

All globals and the complete challenges, attestations, witnesses and audits
maps remain exact. All request phases remain exact; no terminal stutter or ID
symmetry is introduced. Full QNT/TLA/VIEW/adapter source binding remains closed.

## Proof observations

Every proof, including unused and done, retains exact claim, verified and
committed values. The global invariant can select either slot through the
witness map, independently of phase. Claim is also needed for future healing
or failure when another request writes an attestation or witness. Never erase
these fields merely because the current local invariant happens to be true.

The response retains exactly membership in `{200,201}`. Its original safety
clause reads only this class and the exact claim/attestation map. A successful
response for an unrecorded claim remains false and can heal on a later commit.
The desired response retains that class only in response phase, before actual
`respondProof` overwrites response. Other status names are outputs only; the
raw scenarios still check their exact values outside the VIEW.

A separate raw, indexed `verified implies consumed` bit is retained for every
slot before masking. Consumed itself remains exact in consume-reply and verify:
the former reads it, and the latter can set verified true even in a false
prefix. Consume overwrites consumed from exact challenge/time state. Before
consume it has no other future reader before overwrite; after verify it has
only the retained implication. All other transitions carry that bit, or reset
both fields through beginProof. Thus false and healing classes are preserved
without assuming the invariant.

## Phase liveness

| Field | Exact until final consumer |
| --- | --- |
| Issue actor | owner |
| Issue claim | owner, existing, prepare, write |
| Issue stamp | write; valid prepare overwrites it first |
| Issue desired/response | no executable guard or invariant consumes them |
| Proof actor | owner |
| Proof body validity | owner, existing, body |
| Proof challenge | owner through batch, including hash/prewrite |
| Proof stamp | consume; successful body overwrites it first |
| Proof desired success class | response |

Issue response/done payloads have no safety-relevant readers. respondIssue
reads desired only to copy it into the erased response output. Written issue reply only uses
its slot to update challenge known, not its saved claim or stamp. Unused issue
payload is overwritten completely by beginIssue. All live issue fields above
remain until their consumer; no invariant observes an issue record.

Proof challenge is dead after commit/batch-failure: the retained global
attestation map already records the exact challenge, and global witness
checks read only the proof's verified/committed booleans. Unused proof payload
is fully reset, but its claim, verified/committed and response observations
still remain because false-prefix invariants can reference that slot.

The fields/signature/window booleans have exactly one consumer: verify uses
their conjunction. No independent invariant or active writer reads or changes
a component. Keep the conjunction through owner/existing/body/consume/
consume-reply/verify, then erase it. This differs from combining independent
safety clauses: each component has only that one joint consumer, and an unused
beginProof overwrites all three. Global kind, clock and complete challenge
windows remain exact, so future configuration or time changes cannot hide a
currently dormant signature condition.

## Successor argument

Use identical action parameters from related states. Configure, tick and
successor read/update exact globals. Every begin overwrites the erased input
payload. Issue guards/prepare/write retain their exact live inputs; reply and
response alter only retained phase or exact global challenge fields. Proof
owner/existing/body retain their readers; consume uses exact challenge and
stamp and overwrites consumed; consumedReply and verify retain their exact
consumed value. Verify's only flag input is the retained conjunction. Hash,
prewrite, commit, recovery and response retain every needed claim/challenge/
desired class. Commit's global maps and exact verified/committed witness bits
preserve both local and cross-slot safety conditions. Copy-only dead fields
cannot become live again because request phases never rewind or reuse done
slots. Explicit stutter preserves the relation.

All original invariant values are constant on each class: globals/maps are
exact, witness verified/committed are exact, success-response membership and
claim are exact, committed-to-witness index is exact, and the only otherwise
masked clause has its independent raw bit. This includes already false states
and their later repairs, not just reachable healthy prefixes.

## Qualification

Private candidate only. Independent actual-expression and controller review
cleared the unchanged source, literal VIEW, all 40 named witnesses and all 10
paired raw/view cases. Every named witness is false initially. A State 2
marker proves noninitiality; some real action continuations reach their named
witness at State 3. Both raw and viewed positive cases require an empty queue.
No native control, original scenario/sampler or complete V1 graph has run.
Those qualifications remain pending. Raw hosted 600s verification remained incomplete
at its last reported 48,127,930 distinct states and 34,941,289 queued, depth 9.
No passing or source-refinement claim is authorized by this document.
