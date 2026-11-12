# Dev identity bridge phase VIEW V1

This private PRD section 12 static candidate starts from
`dabd9d893d2b323746128496d65c49daee308aab`. The complete original
`formal/models/tooling/dev_identity_bridge.qnt`, 43 direct scenarios,
all domains/actions/parameters, concrete step, invariant, runtime, checker,
config/lock/adapter and allowance remain unchanged. This source-bound VIEW is
an observation candidate, not execution or application refinement evidence.
The parent checker keeps its original default 180-second budget; the separate
raw14 600-second probe is retained as an incomplete historical receipt.

## Exact whole-source observation

Every global stays EXACT except three reviewed observations:

| Global | Observation | Complete consumer cone |
| --- | --- | --- |
| startResult | membership in {error,process-lost}, canonical error/none | Only captureStartClock/createRemoteFlow read this class for an abandoned start. Restart preserves it or writes process-lost; other start actions write original diagnostics. |
| authorizeResult | none/non-none | Only authorize's unused-result guard reads it. Original response categories are diagnostic values in direct scenarios. |
| rowCreated | -1 | Store copies poll.created into it. No executable guard, retained-field writer or invariant reads it. |

All clocks, restart/start phases, remote creation/presence/status/expiry/claim
count, Map/flow knowledge, local row presence/expiry/consumption, local write
count, token knowledge and consume commit count stay exact. Their independent
false clauses are never frozen, merged or assumed true. Every map DOMAIN and
request index remains original.

For every poll, including unknown phases, normalize created to -1 and classify
its desired/response as 200 versus other. Classify remoteResult into THREE
values: 200 / none / other. Raw none at remote-body bypasses identityBound:
pollResponseBody first returns a non200 remoteResult verbatim, then compares
result with none. Combining none with another error would change its branch.
Created is a closed copy cone: assertionHash writes it, store copies it to the
already erased rowCreated, and nothing consumes either coordinate elsewhere.
Original scenarios retain the exact times and diagnostics without VIEW.

Poll unused/finish/done becomes a tuple containing exact phase, RAW claimed,
RAW response-is200, and RAW (phase==finish AND desired-is200). These flags
reconstruct the original local implications dynamically against exact
remoteClaims/localWrites/tokenKnown. Finish's desired200 remains a real input
to pollReply, even in a dirty false prefix with failed obligations or alive=false.
Do not merge the three phases: beginPoll requires unused, pollReply requires
finish and done never reopens. Begin fully replaces an unused poll.

All other known poll phases keep the complete original record except the
uniform reductions above and these exact liveness frontiers:

| Field | Keep exact only in |
| --- | --- |
| capability | lookup |
| remoteStamp | remote-read |
| issueStamp | remote-write |
| expiry | hash/store |
| alive | body/lookup/remote-read/remote-clock/remote-write/remote-write-reply/remote-reply |

The remaining known phases are remote-body/delete-map/mint/store-reply/readback.
Outside a field's frontier it is canonical false/-1/true as appropriate.
Unknown poll phases otherwise keep their FULL record, with only the uniform
created/status/result observations applied. No currently dead caller or
failed comparison is used as a request-erasure condition.

Consumer response is uniformly 200 versus other. Unused/reply/done retains
exact phase, RAW accepted, response-is200 and exact stamp iff accepted. Known
body/hash/write keeps its full record except response class, matches only
in hash/write, and stamp only in write OR whenever accepted. Accepted is
always raw. Unknown consumer phases otherwise keep the FULL original record.

## Every action, frontier entry and projected successor

pruned reads only exact Map presence, now and remoteExpiry. tick and all
original start actions retain exact guards/phases and original parameters.
Abandoned error/process-lost starts may still capture a clock and create a
remote flow. There is no permanent-failure collapse. Start response delivery
still sets exact flowKnown; authorize retains exact flow/query inputs and its
none guard while its output category is classified.

Complete/cleanup remote flow keep exact presence/status and time bounds.
BeginPoll fully resets all fields from unusedPoll. PollBody overwrites
capability before lookup; all other exits finish without reading the old one.
Lookup keeps capability and alive exact, and captures exact now into remoteStamp
before entering remote-read. ReadRemote consumes only that captured stamp plus
exact global expiry/presence/status; afterward no action reads remoteStamp.
RemoteClock overwrites issueStamp before remote-write; claimRemote consumes it
and exact remote facts, and writes the raw claimed result plus exact counter.
RemoteWriteReply reads raw claimed and its complete original outcome domain;
all its emitted remoteResults have the reviewed three classes.

RemoteFailure, loseRemoteCaller and remoteResponse retain exact remote phase
and alive. Caller loss and restart do NOT cancel the dispatched server work:
remote-read/clock/write can continue to a claim while alive=false. Restart
preserves these five remote phases. It clears response200 when the caller was
alive, but preserves the old response class when already dead. Therefore alive
stays exact throughout body/lookup and all five remote phases. Other local
phases cannot return to a remote phase before a full begin reset; restart sends
them directly to done independently of their old alive value.

PollResponseBody uses exact original decoded/identityBound parameters and the
three remoteResult classes. DeleteFlow reads raw claimed and removes Map
presence. Mint overwrites expiry before hash; hash preserves that exact expiry
into store. AssertionHash's old created value and its new now copy stay inside
the erased cone. Store retains exact expiry and rowPresent guard, changes the
complete exact row facts/write count, and writes only erased rowCreated from
erased created. StoreReply/readLocalAssertion retain their original outcomes,
row presence/consumption checks and phase; neither reads old local expiry.
PollReply reads the retained finish desired200 flag and delivered parameter,
updates exact tokenKnown, and yields the exact new response-is200 observation.
All terminal claimed/response flags are recomputed on the actual successor.

BeginConsume fully resets unusedConsume. ConsumeBody overwrites matches before
hash and leaves accepted/stamp unchanged, including dirty accepted prefixes on
failure. ConsumeHash overwrites stamp on success before write; on failure it
carries accepted, so an accepted stamp must remain exact even in body/hash.
ConsumeWrite retains matches, stamp and exact global row facts, uses the strict
stamp<rowExpiry cutoff, and writes exact consumption/count plus new raw accepted.
ConsumeFailure and consumeReply carry accepted/stamp; reply's 200 result depends
on original delivery/accepted. Restart preserves accepted/stamp when moving a
live consumer to done. There is no old-matches guard in body, and no unaccepted
old-stamp consumer before hash overwrites it.

All other-ID actions and explicit stutter preserve the same relation. Equal
observations therefore have identical enabledness and equal projected
successors for each SAME original action/parameter tuple. Every original
invariant conjunct is reconstructible: globals remain raw, poll clauses use
raw claimed/response flags with exact current globals, and accepted consumers
retain the exact stamp needed by the strict expiry comparison. No invariant
is a premise of this manual finite-safety congruence argument.

## False prefixes, late writes and healing

Terminal claimed=>remoteClaims==1 is dynamic. A late claim can heal a previously
false clause or raise a dirty count from 1 to 2 and break a previously true one.
Keep claimed, not a frozen clause-truth bit. A different poll's successful reply
can make tokenKnown true and heal an old response200 obligation. Raw response200
and claimed remain separate, with all current write/token facts exact.

Consumer accepted implies rowConsumed AND stamp<rowExpiry is dynamic too.
A false prefix may have rowPresent=false despite accepted=true and some stale
rowExpiry. Another poll's one permitted store can replace that expiry and heal
or break the consumer implication. Keep accepted AND its exact stamp even when
the current implication is true, including body/hash/terminal prefixes.
Do not infer stability from expected reachable once-only invariants.

Unused resets determine new local flags without relying on their old truth.
The exact original parameter guards remain, including capability=>flowKnown,
(bearer AND matches)=>tokenKnown and the original remote/write reply domains.
Every clock boundary and legal choice stays in the complete model. No bounded
state, invariant, domain, transition or scenario is deleted or weakened.

## Binding and required qualification

* QNT: `0af658165eef1d45cdae934d4daa730832822d28b5c279769498926c81e984af`
* Complete production TLA: `febe2cd96a24e9e7ac6484afec01361609b6efd73aa920ab89aee5c59fccd840`
* Complete final VIEW TLA: `2ce0c628145303c3806f2193b988f1be19d57d98594191ec815ec3737fc5fff2`

ID dev-identity-bridge-phase-safety-v1 / operator SlopDevIdentityBridgePhaseViewV1
is appended without changing the previous definitions. A fresh translation-only
capture stopped at the real TLC entry before exploration. Actual complete
bind/apply validates the full module and full terminator. The p/c/id binder scan
finds no collision with complete production operator names; this lexical check
is not SANY or native qualification. The native harness derives this complete
input afresh under its explicit flag, with no ignored-artifact dependency.

Whole-source gates reject added output/copy-cone consumers, earlier/later field
reads, new result distinctions, partial reset, terminal reuse, phase regression,
cross-ID dead-field reads, changed invariants/domains and temporal requests.
The pinned official translator/adapter/overlay and all model bytes remain
mandatory. Its dedicated native path is registered without removing any other.

Native SOURCE defines independent original false/healing observations, captured
cutoff and exact-expiry refusal, caller-loss/restart late commits, live/dead
restart response200 behavior, body-to-remote alive carry, dynamic terminal
healing/breakage, accepted-stamp preservation, full resets and unknown fallbacks.
Each negative uses its named witness ALONE as the complement in q_inv, requires
noninitial State2 or a later real continuation, and refuses initial violations.
The authorization-none control witnesses the retained Map pruning transition,
not an erased exact response category. Unrelated false clauses cannot pass it.

Pairs require q_inv TRUE alone, exact RAW/VIEW counts and queue zero. They cover
all reviewed phase carriers, independent false terminal flags and closed copies.
Actual start capture/store/remote-result consumption retain two raw inputs and
two raw outputs (RAW4/VIEW2). ConsumeBody/Hash overwrite their old matches/stamp,
so two raw inputs converge into one raw output (RAW3/VIEW2). Actual source guards
remain in these fixtures. Unviewed future-consumer controls show why new readers
need renewed review. These diagnostics do not prove the manual argument.

The raw14 run 43122136526 used a different checker/host and concrete step/no VIEW.
It exhausted 600000ms after 600585ms, with last progress 202065696 generated,
30335080 distinct, 12907575 queued and depth 18. Inputs were unchanged, uncanceled,
and no counterexample was reported. This is an incomplete frontier sample,
not completion or a fresh V1 result. Retain that failure separately.
Receipt SHA-256: `f7f43148ec2ff9643802438443985c7e74b4bc8730029f68c803866fa73ae14d`.

This packet is STATIC ONLY: native controls, original type/scenarios and 500x60
sampling, and a complete finite graph remain held for independently reviewed
hosted execution. No push/dispatch is performed. No source/SQL/crypto/provider
refinement, exact response semantics, liveness or unbounded safety is claimed.
