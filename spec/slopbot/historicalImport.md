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
own the appended records and their predecessors. The Points domain owns
the historical publication hold.

## Story: An administrator imports a pre-November subscription assessment once

### The import needs an administrator, a deployed producer and registered accepted work before the API start

The route accepts a same-origin JSON or multipart request of at most
25 MiB from a signed-in configured administrator. The Worker accepts only
a subscription producer. It needs a deployed producer revision and an
active installation. Every source must be a public repository in
contributor scope and a closed pull request whose merge or close time is
before 1 November 2026 UTC. A single import has one source. A joint
import's sources are distinct, and the joint journal checks its partition
and predecessors. A Claude subscription is accepted only for the Slop
repository slice. Each assessment key is imported once. Every refusal is
reported without the provider body or the uploaded assessment.

```quint
import repositoryScope as RS from "./repositoryScope"
import valueRequests as VR from "./valueRequests"
type Channel = ChatgptSubscription | ClaudeSubscription
type Producer = ApiProducer({ provider: str, requested: str, reported: str })
  | SubscriptionProducer({ channel: Channel, model: str, client: str })
type ImportMode = Single | Joint
type ImportSource = { repository: int, pull: int, registry: RS::RegistryObservation, publicRepo: bool,
  closed: bool, occurredAt: int, platformSlice: bool }
type AdministratorEvidence = { actor: int, verifiedAdministrator: bool }
type ImportRequest = { admin: AdministratorEvidence, producerRevision: str, installationActive: bool,
  mode: ImportMode, sources: List[ImportSource], producer: Producer, assessmentKey: int }
type ImportResult = NoImport | Imported | Refused
type ImportedRecord = { key: int, producer: Producer }
type Imports = { records: List[ImportedRecord], last: ImportResult, refusals: int }
pure val initial: Imports = { records: List(), last: NoImport, refusals: 0 }
pure def subscription(p: Producer): bool = match p { | SubscriptionProducer(x) => true | ApiProducer(x) => false }
pure def claudeChannel(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.channel == ClaudeSubscription | ApiProducer(x) => false }
pure def labelled(p: Producer): bool =
  match p { | SubscriptionProducer(x) => x.model != "" and x.client != "" | ApiProducer(x) => false }
pure def billingProof(p: Producer): bool =
  match p { | ApiProducer(x) => x.requested != "" and x.requested == x.reported | SubscriptionProducer(x) => false }
pure def acceptedBeforeStart(src: ImportSource): bool =
  src.closed and src.occurredAt > 0 and src.occurredAt < VR::apiStart
pure def eligibleSource(src: ImportSource, p: Producer): bool =
  src.repository > 0 and src.pull > 0 and src.publicRepo and RS::mayAssessValue(RS::slopbotScope(src.registry))
    and src.registry.observedId == src.repository and acceptedBeforeStart(src) and (not(claudeChannel(p)) or src.platformSlice)
pure def distinctSources(sources: List[ImportSource]): bool =
  sources.every(src => sources.select(o => o.repository == src.repository and o.pull == src.pull).length() == 1)
pure def acceptable(s: Imports, request: ImportRequest): bool =
  request.admin.actor > 0 and request.admin.verifiedAdministrator and request.producerRevision != ""
    and request.installationActive and subscription(request.producer) and labelled(request.producer)
    and request.sources.length() > 0 and (request.mode == Joint or request.sources.length() == 1)
    and distinctSources(request.sources) and request.sources.every(src => eligibleSource(src, request.producer))
    and request.assessmentKey > 0 and not(s.records.some(r => r.key == request.assessmentKey))
pure def submit(s: Imports, request: ImportRequest): Imports =
  if (acceptable(s, request))
    { ...s, records: s.records.append({ key: request.assessmentKey, producer: request.producer }), last: Imported }
  else { ...s, last: Refused, refusals: s.refusals + 1 }
pure def lawDeclarationIsNotReceipt(p: Producer): bool = subscription(p) implies not(billingProof(p))
pure def lawApiProducerNeverImported(s: Imports, request: ImportRequest): bool =
  not(subscription(request.producer)) implies not(acceptable(s, request))
pure def lawPostStartWorkRefused(s: Imports, request: ImportRequest): bool =
  request.sources.some(src => src.occurredAt >= VR::apiStart) implies not(acceptable(s, request))
pure def lawClaudeOnlyForSlopSlice(s: Imports, request: ImportRequest): bool =
  (claudeChannel(request.producer) and request.sources.some(src => not(src.platformSlice))) implies not(acceptable(s, request))
pure def lawNonAdministratorRefused(s: Imports, request: ImportRequest): bool =
  not(request.admin.verifiedAdministrator) implies not(acceptable(s, request))
pure def alwaysImportedOnceEach(s: Imports): bool =
  s.records.every(r => r.key > 0 and subscription(r.producer) and s.records.select(o => o.key == r.key).length() == 1)
pure def stepImportsAreAppendOnly(before: Imports, after: Imports): bool =
  before.records.every(r => after.records.includes(r)) and after.refusals >= before.refusals
pure def sometimesImported(s: Imports): bool = s.records.length() > 0
pure def sometimesDuplicateRefused(s: Imports): bool = s.records.length() > 0 and s.last == Refused
pure val historicalSource: ImportSource = { repository: 1, pull: 1,
  registry: { lookup: RS::CurrentPath, registeredId: 1, observedId: 1, rowActive: true, manifestActive: true,
    retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged },
  publicRepo: true, closed: true, occurredAt: 1790000000, platformSlice: false }
pure val chatgpt: Producer = SubscriptionProducer({ channel: ChatgptSubscription, model: "subagent", client: "chatgpt" })
pure val claude: Producer = SubscriptionProducer({ channel: ClaudeSubscription, model: "subagent", client: "claude" })
pure val api: Producer = ApiProducer({ provider: "orbio", requested: "anthropic/claude-sonnet-5.5", reported: "anthropic/claude-sonnet-5.5" })
pure val baseRequest: ImportRequest = { admin: { actor: 1, verifiedAdministrator: true }, producerRevision: "revision",
  installationActive: true, mode: Single, sources: List(historicalSource), producer: chatgpt, assessmentKey: 1 }
pure val requestValues = Set(baseRequest, { ...baseRequest, assessmentKey: 2, producer: claude },
  { ...baseRequest, assessmentKey: 3, producer: claude, sources: List({ ...historicalSource, platformSlice: true }) },
  { ...baseRequest, assessmentKey: 4, producer: api },
  { ...baseRequest, assessmentKey: 5, sources: List({ ...historicalSource, occurredAt: 1793491200 }) },
  { ...baseRequest, assessmentKey: 6, admin: { actor: 1, verifiedAdministrator: false } },
  { ...baseRequest, assessmentKey: 7, mode: Joint, sources: List(historicalSource, { ...historicalSource, pull: 2 }) },
  { ...baseRequest, assessmentKey: 8, sources: List(historicalSource, { ...historicalSource, pull: 2 }) })
pure val pValues = Set(chatgpt, claude, api)
pure val srcValues = Set(historicalSource, { ...historicalSource, occurredAt: 1793491200 })
pure val sValues = Set(initial)
```
