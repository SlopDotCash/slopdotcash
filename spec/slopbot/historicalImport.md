# Historical subscription value import

PRD section 5 starts paid API assessment on 1 November 2026 UTC. September
and October assessments use ChatGPT subscription subagents, and the Slop
repository slice may instead use Claude subscription subagents or Codex
subscription sessions or subagents with GPT-6.1 Sol. Results enter through
the standard assessment journal with exact attribution, and a subscription
declaration is not an API receipt or billing proof. PRD section 7 holds
historical Points publication until the journal reconciles. Source is
`backend/slopbot/value-import.ts`, `workers/slopbot/value-import.ts`,
`workers/slopbot/value-import-service.ts`, `workers/slopbot/value-producer.ts`
and `workers/slopbot/value-settings.ts` at the pinned development revision.
The retained `historical_subscription_intake` and `bot_historical_import`
models cover the same intake.

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
25 MiB from a signed-in configured administrator. The Worker accepts only
a subscription producer. It needs a deployed producer revision and the
active installation row. Every source must be a public repository in
contributor scope and a closed pull request whose merge or close time is
before 1 November 2026 UTC. A single import has one source. A joint
import's sources are distinct. A ChatGPT subscription subagent may assess
any registered repository. A Claude subscription subagent, or a Codex
subscription session or subagent running GPT-6.1 Sol, is accepted only for
the Slop repository slice: every source must belong to the platform
project, whose registry ID the deployment records once. Each assessment
key is imported once. Every refusal is reported without the provider body
or the uploaded assessment.

```quint
import repositoryScope as RS from "./repositoryScope"
import valueRequests as VR from "./valueRequests"
import installation as I from "./installation"
type Channel = ChatgptSubscription | ClaudeSubscription | CodexSubscription
type Producer = ApiProducer({ provider: str, requested: str, reported: str })
  | SubscriptionProducer({ channel: Channel, model: str, client: str })
type ImportMode = Single | Joint
type ImportSource = { repository: int, project: int, pull: int, registry: RS::RegistryObservation,
  visibility: RS::Visibility, read: VR::PullRead, occurredAt: int }
type AdministratorEvidence = { actor: int, verifiedAdministrator: bool }
type ImportRequest = { admin: AdministratorEvidence, producerRevision: str, mode: ImportMode,
  sources: List[ImportSource], producer: Producer, assessmentKey: int }
type ImportResult = NoImport | Imported | Refused
type SourceKey = { repository: int, pull: int }
type ImportedRecord = { key: int, producer: Producer, sources: List[SourceKey] }
type Imports = { records: List[ImportedRecord], keys: Set[int], last: ImportResult, refusals: int,
  platformProject: int, install: I::Installation }
pure val solModel = "gpt-6.1-sol"
pure val initial: Imports = { records: List(), keys: Set(), last: NoImport, refusals: 0, platformProject: 0,
  install: I::initial }
pure def subscription(p: Producer): bool = match p { | SubscriptionProducer(x) => true | ApiProducer(x) => false }
pure def sliceOnly(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.channel != ChatgptSubscription | ApiProducer(x) => false }
pure def labelled(p: Producer): bool =
  match p {
    | SubscriptionProducer(x) => x.model != "" and x.client != "" and (x.channel == CodexSubscription implies x.model == solModel)
    | ApiProducer(x) => false }
pure def billingProof(p: Producer): bool =
  match p { | ApiProducer(x) => x.requested != "" and x.requested == x.reported | SubscriptionProducer(x) => false }
pure def acceptedBeforeStart(src: ImportSource): bool =
  src.read == VR::PullClosed and src.occurredAt > 0 and src.occurredAt < VR::apiStart
pure def eligibleSource(s: Imports, src: ImportSource, p: Producer): bool =
  src.repository > 0 and src.pull > 0 and src.project > 0 and src.visibility == RS::PublicRepo
    and RS::mayAssessValue(RS::slopbotScope(src.registry)) and src.registry.observedId == src.repository
    and acceptedBeforeStart(src) and (sliceOnly(p) implies (s.platformProject > 0 and src.project == s.platformProject))
pure def distinctSources(sources: List[ImportSource]): bool =
  sources.every(src => sources.select(o => o.repository == src.repository and o.pull == src.pull).length() == 1)
pure def sourceIds(sources: List[ImportSource]): List[SourceKey] =
  sources.listMap(src => { repository: src.repository, pull: src.pull })
pure def acceptable(s: Imports, request: ImportRequest): bool =
  request.admin.actor > 0 and request.admin.verifiedAdministrator and request.producerRevision != ""
    and I::active(s.install) and subscription(request.producer) and labelled(request.producer)
    and request.sources.length() > 0 and (request.mode == Joint or request.sources.length() == 1)
    and distinctSources(request.sources) and request.sources.every(src => eligibleSource(s, src, request.producer))
    and request.assessmentKey > 0 and not(s.keys.contains(request.assessmentKey))
pure def canRecordPlatformProject(s: Imports, project: int): bool = s.platformProject == 0 and project > 0
pure def recordPlatformProject(s: Imports, project: int): Imports = { ...s, platformProject: project }
pure def canApplyInstallation(s: Imports, change: I::InstallEvent): bool = I::canDeliver(s.install, change)
pure def applyInstallation(s: Imports, change: I::InstallEvent): Imports = { ...s, install: I::deliver(s.install, change) }
pure def submit(s: Imports, request: ImportRequest): Imports =
  if (acceptable(s, request))
    { ...s, records: s.records.append({ key: request.assessmentKey, producer: request.producer,
        sources: sourceIds(request.sources) }),
      keys: s.keys.union(Set(request.assessmentKey)), last: Imported }
  else { ...s, last: Refused, refusals: s.refusals + 1 }
pure def lawDeclarationIsNotReceipt(p: Producer): bool = subscription(p) implies not(billingProof(p))
pure def lawApiProducerNeverImported(s: Imports, request: ImportRequest): bool =
  not(subscription(request.producer)) implies not(acceptable(s, request))
pure def lawPostStartWorkRefused(s: Imports, request: ImportRequest): bool =
  request.sources.some(src => src.occurredAt >= VR::apiStart) implies not(acceptable(s, request))
pure def lawSliceChannelsOnlyForPlatformProject(s: Imports, request: ImportRequest): bool =
  (sliceOnly(request.producer) and request.sources.some(src => src.project != s.platformProject or s.platformProject == 0))
    implies not(acceptable(s, request))
pure def codexWithoutSol(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.channel == CodexSubscription and x.model != solModel | ApiProducer(x) => false }
pure def lawCodexNeedsSol(s: Imports, request: ImportRequest): bool =
  codexWithoutSol(request.producer) implies not(acceptable(s, request))
pure def lawNonAdministratorRefused(s: Imports, request: ImportRequest): bool =
  not(request.admin.verifiedAdministrator) implies not(acceptable(s, request))
pure def lawInactiveInstallationRefused(s: Imports, request: ImportRequest): bool =
  not(I::active(s.install)) implies not(acceptable(s, request))
pure def alwaysImportedOnceEach(s: Imports): bool =
  s.records.every(r => r.key > 0 and subscription(r.producer) and s.keys.contains(r.key) and r.sources.length() > 0)
    and s.keys.size() == s.records.length()
pure def stepImportsAreAppendOnly(before: Imports, after: Imports): bool =
  before.records.every(r => after.records.includes(r))
    and before.keys.subseteq(after.keys) and after.refusals >= before.refusals
    and (before.platformProject > 0 implies after.platformProject == before.platformProject)
pure def sometimesImported(s: Imports): bool = s.records.length() > 0
pure def sometimesSliceImported(s: Imports): bool = s.records.some(r => sliceOnly(r.producer))
pure def sometimesDuplicateRefused(s: Imports): bool = s.records.length() > 0 and s.last == Refused
pure val historicalSource: ImportSource = { repository: 1, project: 1, pull: 1,
  registry: { lookup: RS::CurrentPath, registeredId: 1, observedId: 1, rowActive: true, manifestActive: true,
    retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged },
  visibility: RS::PublicRepo, read: VR::PullClosed, occurredAt: 1790000000 }
pure val chatgpt: Producer = SubscriptionProducer({ channel: ChatgptSubscription, model: "subagent", client: "chatgpt" })
pure val claude: Producer = SubscriptionProducer({ channel: ClaudeSubscription, model: "subagent", client: "claude" })
pure val codex: Producer = SubscriptionProducer({ channel: CodexSubscription, model: "gpt-6.1-sol", client: "codex" })
pure val api: Producer = ApiProducer({ provider: "orbio", requested: "anthropic/claude-sonnet-5.5", reported: "anthropic/claude-sonnet-5.5" })
pure val baseRequest: ImportRequest = { admin: { actor: 1, verifiedAdministrator: true }, producerRevision: "revision",
  mode: Single, sources: List(historicalSource), producer: chatgpt, assessmentKey: 1 }
pure val requestValues = Set(baseRequest, { ...baseRequest, assessmentKey: 2, producer: claude },
  { ...baseRequest, assessmentKey: 3, producer: claude, sources: List({ ...historicalSource, project: 2 }) },
  { ...baseRequest, assessmentKey: 4, producer: api },
  { ...baseRequest, assessmentKey: 5, sources: List({ ...historicalSource, occurredAt: 1793491200 }) },
  { ...baseRequest, assessmentKey: 6, admin: { actor: 1, verifiedAdministrator: false } },
  { ...baseRequest, assessmentKey: 7, mode: Joint, sources: List(historicalSource, { ...historicalSource, pull: 2 }) },
  { ...baseRequest, assessmentKey: 8, sources: List(historicalSource, { ...historicalSource, pull: 2 }) },
  { ...baseRequest, assessmentKey: 9, producer: codex },
  { ...baseRequest, assessmentKey: 10, producer: SubscriptionProducer({ channel: CodexSubscription, model: "gpt-6.1-terra", client: "codex" }) },
  { ...baseRequest, assessmentKey: 11, sources: List({ ...historicalSource, read: VR::PullOpen }) })
pure val projectValues = Set(1, 2)
pure val changeValues = Set({ delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: I::Suspend, sourceTime: 2, hasAccount: true, validTime: true })
pure val pValues = Set(chatgpt, claude, codex, api)
pure val srcValues = Set(historicalSource, { ...historicalSource, occurredAt: 1793491200 })
pure val sValues = Set(initial, { ...initial, platformProject: 1, install: { ...I::initial, known: true, sourceTime: 1 } })
```
