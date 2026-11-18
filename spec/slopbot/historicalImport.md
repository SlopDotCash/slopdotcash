# Historical subscription value import

PRD section 5 starts paid API assessment on 1 November 2026 UTC. September
and October assessments use ChatGPT subscription subagents, and the Slop
repository slice may instead use Claude subscription subagents. Results
enter through the standard assessment journal with exact attribution, and a
subscription declaration is not an API receipt or billing proof. PRD section
7 holds historical Points publication until the journal reconciles. Source
is `backend/slopbot/value-import.ts`, `workers/slopbot/value-import.ts`,
`workers/slopbot/value-import-service.ts`, `workers/slopbot/value-producer.ts`,
`workers/slopbot/value-journal.ts` and `workers/slopbot/value-settings.ts`
at development 67fd54fd4. The retained `historical_subscription_intake` and
`bot_historical_import` models cover the same intake.

This unit owns the import decision and the imported assessment keys. The
[value journal](./valueHistory.md) and the [joint journal](./workUnits.md)
own the appended records and their predecessors: the development import
publishes through the same work-unit append, with its supersession, legacy
predecessors and revision reason. Binding each accepted import here to that
append is a composition obligation; this unit does not model it. The Points
domain owns the historical publication hold.

## Story: An administrator imports a pre-November subscription assessment once

### The import needs an administrator, a deployed producer and registered accepted work before the API start

The route accepts a same-origin JSON or multipart request of at most
33 MiB from a signed-in configured administrator. The Worker accepts only
a subscription producer: development knows two channels, a ChatGPT and a
Claude subscription (`SUBSCRIPTION_CHANNELS` in `value-producer.ts`), each
labelled with its model and client and accepted for any registered
repository; the PRD's Codex channel and its Slop-slice restriction are not
in development's code. It needs a deployed producer revision and the
active installation row. Every source must be a public repository in
contributor scope. The cutoff is the value consumer's configured start, or
1 November 2026 UTC when the consumer has no valid settings
(`subscriptionCutoff`), so no work belongs to neither route. It is read
from the configuration again for every import: the configured start may
move to another date on or after 1 November 2026, and it returns to
1 November 2026 whenever the settings become invalid. A single
import's one source is a closed pull request whose merge time, else close
time, is before the cutoff. A joint import's sources are distinct; when
any of them is not such a source, the import still passes when its evidence
has no limitation and at least one claim, and every later source is closed
unmerged, not indirectly accepted, and neither credits, carries nor accepts
any claim (`historicalSubscriptionWorkUnit`): it is context for the earlier
accepted work. Each assessment key is appended once: a repeated key answers
the stored receipt and appends nothing (`appendValueRecord`). Every refusal
is reported without the provider body or the uploaded assessment.

```quint
import repositoryScope as RS from "./repositoryScope"
import valueRequests as VR from "./valueRequests"
import installation as I from "./installation"
type Channel = ChatgptSubscription | ClaudeSubscription
type Producer = ApiProducer({ provider: str, requested: str, reported: str })
  | SubscriptionProducer({ channel: Channel, model: str, client: str })
type ImportMode = Single | Joint
type ImportSource = { repository: int, project: int, pull: int, registry: RS::RegistryObservation,
  visibility: RS::Visibility, read: VR::PullRead, occurredAt: int, merged: bool, indirectAcceptance: bool,
  claimed: bool }
type AdministratorEvidence = { actor: int, verifiedAdministrator: bool }
type ImportRequest = { admin: AdministratorEvidence, producerRevision: str, mode: ImportMode,
  sources: List[ImportSource], producer: Producer, assessmentKey: int, limitations: int, claims: int }
type ImportResult = NoImport | Imported | Replayed | Refused
type SourceKey = { repository: int, pull: int }
type ImportedRecord = { key: int, producer: Producer, sources: List[SourceKey] }
type Imports = { records: List[ImportedRecord], keys: Set[int], last: ImportResult, refusals: int,
  cutoff: int, install: I::Installation }
pure val importBodyLimit = 34603008
pure val initial: Imports = { records: List(), keys: Set(), last: NoImport, refusals: 0, cutoff: VR::apiStart,
  install: I::initial }
pure def subscription(p: Producer): bool = match p { | SubscriptionProducer(x) => true | ApiProducer(x) => false }
pure def claudeProducer(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.channel == ClaudeSubscription | ApiProducer(x) => false }
pure def labelled(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.model != "" and x.client != "" | ApiProducer(x) => false }
pure def billingProof(p: Producer): bool =
  match p { | ApiProducer(x) => x.requested != "" and x.requested == x.reported | SubscriptionProducer(x) => false }
pure def acceptedBeforeStart(src: ImportSource, cutoff: int): bool =
  src.read == VR::PullClosed and src.occurredAt > 0 and src.occurredAt < cutoff
pure def contextCandidate(src: ImportSource): bool = src.read == VR::PullClosed and not(src.merged)
pure def contextSource(src: ImportSource): bool =
  contextCandidate(src) and src.occurredAt > 0 and not(src.indirectAcceptance) and not(src.claimed)
pure def eligibleSource(s: Imports, src: ImportSource, mode: ImportMode): bool =
  src.repository > 0 and src.pull > 0 and src.project > 0 and src.visibility == RS::PublicRepo
    and RS::mayAssessValue(RS::slopbotScope(src.registry)) and src.registry.observedId == src.repository
    and (acceptedBeforeStart(src, s.cutoff) or (mode == Joint and contextCandidate(src)))
pure def historicalWork(s: Imports, request: ImportRequest): bool =
  request.sources.every(src => acceptedBeforeStart(src, s.cutoff))
    or (request.limitations == 0 and request.claims > 0
      and request.sources.every(src => acceptedBeforeStart(src, s.cutoff) or contextSource(src)))
pure def distinctSources(sources: List[ImportSource]): bool =
  sources.every(src => sources.select(o => o.repository == src.repository and o.pull == src.pull).length() == 1)
pure def sourceIds(sources: List[ImportSource]): List[SourceKey] =
  sources.listMap(src => { repository: src.repository, pull: src.pull })
pure def admissible(s: Imports, request: ImportRequest): bool =
  request.admin.actor > 0 and request.admin.verifiedAdministrator and request.producerRevision != ""
    and I::active(s.install) and subscription(request.producer) and labelled(request.producer)
    and request.sources.length() > 0 and (request.mode == Joint or request.sources.length() == 1)
    and distinctSources(request.sources) and request.sources.every(src => eligibleSource(s, src, request.mode))
    and historicalWork(s, request) and request.assessmentKey > 0
pure def acceptable(s: Imports, request: ImportRequest): bool =
  admissible(s, request) and not(s.keys.contains(request.assessmentKey))
pure def canRecordCutoff(s: Imports, cutoff: int): bool = cutoff >= VR::apiStart and cutoff != s.cutoff
pure def recordCutoff(s: Imports, cutoff: int): Imports = { ...s, cutoff: cutoff }
pure def canApplyInstallation(s: Imports, change: I::InstallEvent): bool = I::canDeliver(s.install, change)
pure def applyInstallation(s: Imports, change: I::InstallEvent): Imports = { ...s, install: I::deliver(s.install, change) }
pure def submit(s: Imports, request: ImportRequest): Imports =
  if (acceptable(s, request))
    { ...s, records: s.records.append({ key: request.assessmentKey, producer: request.producer,
        sources: sourceIds(request.sources) }),
      keys: s.keys.union(Set(request.assessmentKey)), last: Imported }
  else if (admissible(s, request)) { ...s, last: Replayed }
  else { ...s, last: Refused, refusals: s.refusals + 1 }
pure def lawDeclarationIsNotReceipt(p: Producer): bool = subscription(p) implies not(billingProof(p))
pure def lawApiProducerNeverImported(s: Imports, request: ImportRequest): bool =
  not(subscription(request.producer)) implies not(acceptable(s, request))
pure def lawPostStartWorkRefused(s: Imports, request: ImportRequest): bool =
  request.sources.some(src => src.occurredAt >= s.cutoff and (src.claimed or src.merged or src.indirectAcceptance))
    implies not(acceptable(s, request))
pure def lawSingleImportIsAcceptedBeforeTheCutoff(s: Imports, request: ImportRequest): bool =
  (request.mode == Single and request.sources.some(src => not(acceptedBeforeStart(src, s.cutoff))))
    implies not(acceptable(s, request))
pure def lawReplayAppendsNothing(s: Imports, request: ImportRequest): bool =
  s.keys.contains(request.assessmentKey) implies submit(s, request).records == s.records
pure def lawNonAdministratorRefused(s: Imports, request: ImportRequest): bool =
  not(request.admin.verifiedAdministrator) implies not(acceptable(s, request))
pure def lawInactiveInstallationRefused(s: Imports, request: ImportRequest): bool =
  not(I::active(s.install)) implies not(acceptable(s, request))
pure def alwaysImportedOnceEach(s: Imports): bool =
  s.records.every(r => r.key > 0 and subscription(r.producer) and s.keys.contains(r.key) and r.sources.length() > 0)
    and s.keys.size() == s.records.length()
pure def alwaysCutoffNotBeforeApiStart(s: Imports): bool = s.cutoff >= VR::apiStart
pure def stepImportsAreAppendOnly(before: Imports, after: Imports): bool =
  before.records.every(r => after.records.includes(r))
    and before.keys.subseteq(after.keys) and after.refusals >= before.refusals
pure def sometimesImported(s: Imports): bool = s.records.length() > 0
pure def sometimesClaudeImported(s: Imports): bool = s.records.some(r => claudeProducer(r.producer))
pure def sometimesReplayed(s: Imports): bool = s.records.length() > 0 and s.last == Replayed
pure def sometimesRefused(s: Imports): bool = s.records.length() > 0 and s.last == Refused
pure val contextKey = 12
pure def sometimesContextSourceImported(s: Imports): bool = s.keys.contains(contextKey)
pure def sometimesImportedAfterConfiguredStart(s: Imports): bool =
  s.cutoff > VR::apiStart and s.records.some(r => r.key == 13)
pure def sometimesCutoffReturnedToApiStart(s: Imports): bool =
  s.cutoff == VR::apiStart and s.records.some(r => r.key == 13)
pure val historicalSource: ImportSource = { repository: 1, project: 1, pull: 1,
  registry: { lookup: RS::CurrentPath, registeredId: 1, observedId: 1, rowActive: true, manifestActive: true,
    retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged },
  visibility: RS::PublicRepo, read: VR::PullClosed, occurredAt: 1790000000, merged: true,
  indirectAcceptance: false, claimed: true }
pure val laterContext: ImportSource = { ...historicalSource, pull: 3, occurredAt: 1793491300, merged: false,
  claimed: false }
pure val chatgpt: Producer = SubscriptionProducer({ channel: ChatgptSubscription, model: "subagent", client: "chatgpt" })
pure val claude: Producer = SubscriptionProducer({ channel: ClaudeSubscription, model: "subagent", client: "claude" })
pure val api: Producer = ApiProducer({ provider: "orbio", requested: "anthropic/claude-sonnet-5.5", reported: "anthropic/claude-sonnet-5.5" })
pure val baseRequest: ImportRequest = { admin: { actor: 1, verifiedAdministrator: true }, producerRevision: "revision",
  mode: Single, sources: List(historicalSource), producer: chatgpt, assessmentKey: 1, limitations: 0, claims: 1 }
pure val requestValues = Set(baseRequest, { ...baseRequest, assessmentKey: 2, producer: claude },
  { ...baseRequest, assessmentKey: 3, producer: claude, sources: List({ ...historicalSource, project: 2 }) },
  { ...baseRequest, assessmentKey: 4, producer: api },
  { ...baseRequest, assessmentKey: 5, sources: List({ ...historicalSource, occurredAt: 1793491200 }) },
  { ...baseRequest, assessmentKey: 6, admin: { actor: 1, verifiedAdministrator: false } },
  { ...baseRequest, assessmentKey: 7, mode: Joint, sources: List(historicalSource, { ...historicalSource, pull: 2 }) },
  { ...baseRequest, assessmentKey: 8, sources: List(historicalSource, { ...historicalSource, pull: 2 }) },
  { ...baseRequest, assessmentKey: 11, sources: List({ ...historicalSource, read: VR::PullOpen }) },
  { ...baseRequest, assessmentKey: contextKey, mode: Joint, sources: List(historicalSource, laterContext) },
  { ...baseRequest, assessmentKey: 14, mode: Joint, sources: List(historicalSource, { ...laterContext, claimed: true }) },
  { ...baseRequest, assessmentKey: 15, mode: Joint, sources: List(historicalSource, laterContext), limitations: 1 },
  { ...baseRequest, assessmentKey: 13, sources: List({ ...historicalSource, occurredAt: 1793491300 }) })
pure val cutoffValues = Set(1793491200, 1793577600, 1793664000)
pure val changeValues = Set({ delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: I::Suspend, sourceTime: 2, hasAccount: true, validTime: true })
pure val pValues = Set(chatgpt, claude, api)
pure val sValues = Set(initial, { ...initial, cutoff: 1793577600, install: { ...I::initial, known: true, sourceTime: 1 } })
```
