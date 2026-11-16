# Authenticated pull_request_opened evidence

PRD sections 4, 5 and 11 make a member's own authenticated Slop run with a
`pull_request_opened` event for the exact pull request the only participation
authority for automatic closure (CLAUDE.md "Slopbot"). A copied marker, footer
or signed local receipt is never proof. This machine is the closure-relevant
view of one `pr_opened_<PR node ID>` server run: the
[`opened` command](./openedRun.md) writes it through the
[server trace run](./traceServer.md) `createRun` and `appendEvent`, and the
[work model](./workflow.md) `recordRun` and Slopbot closure read only
`participationProof`. The evidence is never a prerequisite for ordinary
GitHub submission, and its run is separate from an optional
[trace run](./runEvidence.md). Every event names its authenticated sender
`by`, which the shell takes from the current Slop session, never from the
request body; run finalization comes from the server runtime
(`serverRuntime`).

## Story: Record the opened event on the author's own run

### Only the signed-in author of the exact pull request registers its run

The adapter validates the exact project repository, the canonical GitHub pull
request URL, the node ID and its current GitHub author. A retried
registration of the same actor, project, repository, node and server run
returns the existing run; any other registration over a registered run is
refused and changes nothing.

```quint
type OpenedReply = NoReply | ReplyCreated | ReplyExisting | RefusedOtherActor | RefusedMismatch | RefusedFinalized
type OpenedRun = { actor: int, project: int, repository: str, prNode: str, serverRun: str, finalized: bool,
  events: List[int], reply: OpenedReply }
pure val serverRuntime = -1
pure val noOpenedRun: OpenedRun = { actor: 0, project: 0, repository: "", prNode: "", serverRun: "", finalized: false,
  events: List(), reply: NoReply }
pure val initial: OpenedRun = noOpenedRun
pure def registered(o: OpenedRun): bool = o.serverRun != ""
pure def sameRun(o: OpenedRun, by: int, project: int, repository: str, prNode: str, serverRun: str): bool =
  o.actor == by and o.project == project and o.repository == repository and o.prNode == prNode and o.serverRun == serverRun
pure def canRegister(o: OpenedRun, by: int, project: int, repository: str, prNode: str, serverRun: str, prAuthor: int): bool =
  by > 0 and prAuthor == by and project > 0 and repository != "" and prNode != "" and serverRun != ""
    and (not(registered(o)) or sameRun(o, by, project, repository, prNode, serverRun))
pure def register(o: OpenedRun, by: int, project: int, repository: str, prNode: str, serverRun: str, prAuthor: int): OpenedRun =
  if (registered(o)) { ...o, reply: ReplyExisting }
  else { ...o, actor: by, project: project, repository: repository, prNode: prNode, serverRun: serverRun, reply: ReplyCreated }
pure def alwaysRegisteredIdentity(o: OpenedRun): bool =
  (registered(o) iff o.actor > 0) and (registered(o) iff o.prNode != "") and (registered(o) iff o.project > 0)
    and ((o.events.length() > 0 or o.finalized) implies registered(o))
```

### An exact body retry returns the same event and a different timestamp is a distinct event

The event idempotency key is the digest of the server run and the canonical
event body, timestamp included. An exact retry derives the same key and the
server returns the existing event; a different timestamp derives a new key and
is kept as a second event, as `appendEvent` does. The caller keeps the
verified server reply and never assumes success from a marker.

```quint
pure def canRecord(o: OpenedRun, by: int, prNode: str, at: int): bool =
  registered(o) and not(o.finalized) and by == o.actor and prNode == o.prNode and at > 0
pure def record(o: OpenedRun, by: int, prNode: str, at: int): OpenedRun =
  if (o.events.includes(at)) { ...o, reply: ReplyExisting } else { ...o, events: o.events.append(at), reply: ReplyCreated }
pure def alwaysEventsDistinct(o: OpenedRun): bool =
  o.events.every(at => at > 0 and o.events.select(x => x == at).length() == 1)
pure def lawExactRetryAddsNothing(o: OpenedRun, by: int, prNode: str, at: int): bool =
  record(record(o, by, prNode, at), by, prNode, at).events == record(o, by, prNode, at).events
pure def sometimesRetryReturnsExisting(o: OpenedRun): bool = o.reply == ReplyExisting and o.events.length() == 1
pure def sometimesDistinctTimestampKept(o: OpenedRun): bool = o.events.length() == 2
```

### A finalized run and every other actor, node or run are refused

The server runtime finalizes the run; afterwards it accepts no event. A
request by another actor, or for another pull request node, is refused and
changes no evidence.

```quint
pure def canObserveFinalized(o: OpenedRun, by: int): bool = by == serverRuntime and registered(o) and not(o.finalized)
pure def observeFinalized(o: OpenedRun, by: int): OpenedRun = { ...o, finalized: true, reply: NoReply }
pure def canRefuse(o: OpenedRun, by: int, prNode: str, at: int): bool = registered(o) and at > 0
  and not(canRecord(o, by, prNode, at))
pure def refuse(o: OpenedRun, by: int, prNode: str, at: int): OpenedRun =
  { ...o, reply: if (o.finalized) RefusedFinalized else if (by != o.actor) RefusedOtherActor else RefusedMismatch }
pure def stepEvidenceFrozenAfterFinal(before: OpenedRun, after: OpenedRun): bool =
  before.finalized implies after.finalized and after.events == before.events
pure def stepIdentityFixed(before: OpenedRun, after: OpenedRun): bool =
  registered(before) implies sameRun(after, before.actor, before.project, before.repository, before.prNode, before.serverRun)
pure def stepEventsAppendOnly(before: OpenedRun, after: OpenedRun): bool = before.events.every(at => after.events.includes(at))
pure def stepRefusalChangesNothing(before: OpenedRun, via: str, after: OpenedRun): bool =
  via == "refuse" implies after == { ...before, reply: after.reply }
pure def sometimesRefusedAfterFinal(o: OpenedRun): bool = o.finalized and o.reply == RefusedFinalized
pure def sometimesOtherActorRefused(o: OpenedRun): bool = o.reply == RefusedOtherActor and o.events.length() > 0
pure def sometimesOtherNodeRefused(o: OpenedRun): bool = o.reply == RefusedMismatch
pure val byValues = Set(1, 2, serverRuntime)
pure val prAuthorValues = Set(1, 2)
pure val projectValues = Set(1)
pure val repositoryValues = Set("o/r")
pure val prNodeValues = Set("PR_a", "PR_b")
pure val serverRunValues = Set("run-a", "run-b")
pure val atValues = Set(1, 2)
pure val weight_record = 6
```

## Story: Grant closure participation only from this run

### Participation needs the member's own run with an event for the exact pull request

The member is the GitHub actor the session authenticated. Without a
registered run and a recorded event, no marker or receipt supplies
participation.

```quint
pure def participationProof(o: OpenedRun, member: int, project: int, repository: str, prNode: str): bool =
  member > 0 and prNode != "" and o.actor == member and o.project == project and o.repository == repository
    and o.prNode == prNode and o.events.length() > 0
pure def lawNoRunNoParticipation(member: int, project: int, repository: str, prNode: str): bool =
  not(participationProof(noOpenedRun, member, project, repository, prNode))
pure def stepParticipationNeverLost(before: OpenedRun, after: OpenedRun): bool =
  participationProof(before, before.actor, before.project, before.repository, before.prNode)
    implies participationProof(after, before.actor, before.project, before.repository, before.prNode)
pure def sometimesParticipationProven(o: OpenedRun): bool = participationProof(o, o.actor, o.project, o.repository, o.prNode)
pure val memberValues = Set(0, 1, 2)
```
