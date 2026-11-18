# Published model attribution assessment

CLAUDE.md "Installer and attribution": every contribution discloses its
exact provider, model and client, and token or usage evidence never changes
score, rank, share or payment. The pinned sources are
`src/lib/leaderboard.ts` (`assessModelAttribution`, `modelStatus` and the
attribution marker pattern) and the frozen legacy-to-Slop identifier map of
`scripts/protocol-identity.mjs`. The GitHub ingestion adapter supplies each
text source with its immutable node ID, author, bot classification and
causal attachment to the scored contribution; the published work item shows
the resulting status beside, never inside, its Points. That an attribution
marker is never participation evidence is the [closure](../slopbot/closure.md)
rule "Only the author's own authenticated run for the exact PR supplies
participation authority".

## Story: Assess self-reported model provenance without scoring it

### Only same-actor text causally attached to a scored contribution is assessed

A source counts only when its author is the contribution's actor, is not a
bot, is causally attached to that scored contribution, and carries an
attribution signal: a declaration line, a `slop-review` record, a
human-only declaration or a claim line. Text by anyone else, and unattached
text by the same actor, never changes the assessment. An exact
provider/model declaration, a human-only declaration, or an accepted marker
that matches the visible footer makes a source valid; a malformed record, an
unknown marker or a marker that contradicts its footer makes it invalid.

```quint
type Declaration = NoDeclaration | ExactDeclaration | HumanOnly | MarkerDeclaration({ marker: str, matchesFooter: bool }) | Malformed
type TextSource = { node: int, author: int, bot: bool, attached: bool, signal: bool, declaration: Declaration }
type AttributionStatus = Complete | Partial | Missing | Invalid
pure val slopMarker = "slop-contribution-attribution:v1"
pure val legacyMarkers = Set("eliza-computer-attribution:v1", "eliza-computer-attribution:v2", "elizaos-contribution-attribution:v1",
  "elizaos-contribution-attribution:v2")
pure def acceptedMarker(marker: str): bool = marker == slopMarker or legacyMarkers.contains(marker)
pure def assessed(s: TextSource, actor: int): bool = s.author == actor and actor > 0 and not(s.bot) and s.attached and s.signal
pure def validDeclaration(d: Declaration): bool = match d {
  | ExactDeclaration => true
  | HumanOnly => true
  | MarkerDeclaration(m) => acceptedMarker(m.marker) and m.matchesFooter
  | _ => false }
pure def invalidDeclaration(d: Declaration): bool = match d {
  | Malformed => true
  | MarkerDeclaration(m) => not(acceptedMarker(m.marker) and m.matchesFooter)
  | _ => false }
pure def validSource(s: TextSource): bool = validDeclaration(s.declaration)
pure def invalidSource(s: TextSource): bool = invalidDeclaration(s.declaration)
pure def lawLegacyMarkersStayAccepted(marker: str): bool = legacyMarkers.contains(marker) implies acceptedMarker(marker)
pure def lawUnknownMarkerIsInvalid(node: int, actor: int): bool =
  invalidSource({ node: node, author: actor, bot: false, attached: true, signal: true,
    declaration: MarkerDeclaration({ marker: "army-attribution:v9", matchesFooter: true }) })
```

### The status is complete, partial, invalid or missing, in that order

Complete needs at least one assessed source, every assessed source valid and
none invalid; otherwise any valid source makes it partial, any invalid
source makes it invalid, and no valid or invalid source leaves it missing.

```quint
pure def status(sources: List[TextSource], actor: int): AttributionStatus =
  val eligible = sources.select(s => assessed(s, actor))
  val valid = eligible.select(s => validSource(s)).length()
  val invalid = eligible.select(s => invalidSource(s)).length()
  if (eligible.length() > 0 and valid == eligible.length() and invalid == 0) Complete
  else if (valid > 0) Partial
  else if (invalid > 0) Invalid
  else Missing
pure def lawOtherActorsNeverChangeStatus(sources: List[TextSource], actor: int, other: TextSource): bool =
  not(assessed(other, actor)) implies status(sources.append(other), actor) == status(sources, actor)
pure def lawBotTextIgnored(sources: List[TextSource], actor: int, other: TextSource): bool =
  status(sources.append({ ...other, bot: true }), actor) == status(sources, actor)
pure def lawNoSourceIsMissing(actor: int): bool = status(List(), actor) == Missing
```

### Attribution never changes Points, rank, share or payment

The published work item carries the status and the exact identifiers next to
the values the scoring and settlement rules computed; replacing the
attribution status changes none of them. No Points journal category, reward
weight or payment input reads it.

```quint
type WorkItemView = { points: int, rank: int, share: int, payment: int, modelStatus: AttributionStatus }
pure def withAttribution(view: WorkItemView, sources: List[TextSource], actor: int): WorkItemView =
  { ...view, modelStatus: status(sources, actor) }
pure def lawAttributionAddsNoValue(view: WorkItemView, sources: List[TextSource], actor: int): bool =
  val shown = withAttribution(view, sources, actor)
  shown.points == view.points and shown.rank == view.rank and shown.share == view.share and shown.payment == view.payment
pure val own: TextSource = { node: 1, author: 5, bot: false, attached: true, signal: true, declaration: ExactDeclaration }
pure val sourcesValues = Set(List(), List(own), List(own, { ...own, node: 2, declaration: Malformed }),
  List({ ...own, declaration: MarkerDeclaration({ marker: "elizaos-contribution-attribution:v2", matchesFooter: true }) }),
  List({ ...own, declaration: MarkerDeclaration({ marker: slopMarker, matchesFooter: false }) }),
  List({ ...own, declaration: NoDeclaration }))
pure val otherValues = Set({ ...own, node: 3, author: 6 }, { ...own, node: 4, attached: false }, { ...own, node: 5, declaration: Malformed, author: 6 })
pure val actorValues = Set(0, 5)
pure val markerValues = Set(slopMarker, "eliza-computer-attribution:v1", "eliza-computer-attribution:v2",
  "elizaos-contribution-attribution:v1", "gitarmy-v1")
pure val viewValues = Set({ points: 10, rank: 1, share: 3, payment: 0, modelStatus: Missing })
pure val nodeValues = Set(1, 2)
```
