// spec/slopbot/historicalImport.md, "Story: An administrator imports a pre-November subscription assessment once"
import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Redacted, Schema } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, first, rows, sql } from "@repo/platform/d1";
import { githubApp } from "@repo/platform/github/app";
import { outboundVia } from "@repo/platform/http";
import { rolesFrom } from "@repo/platform/roles";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience, type ProjectView, Registry, type RepositoryLookup, Restrictions, type Retirement } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import { Enforcement, type Restriction } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/slopbot__historicalImport.conformance.ts";
import type { Channel, Event, ImportRequest, ImportSource, ImportedRecord, Imports, Producer } from "../../gen/slopbot__historicalImport.ts";
import type { RegistryObservation } from "../../gen/slopbot__repositoryScope.ts";
import { type AdmittedImport, HistoricalPublication, PublicationFailed, importSettings, publishSubscription } from "../../src/import/publisher.vibe";
import { type Numbered, deliver, installationState } from "../../src/installation/store.vibe";
import { appendValueRecord } from "../../src/value/history/store.vibe";

type Observed = Omit<Imports, "install"> & { readonly install: Pick<Imports["install"], "known" | "suspended" | "removed" | "sourceTime"> };

const mf = startWorker({ d1: { SLOPBOT_DB: "historical-import-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");

const noNotices = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, noNotices));
const appKey = githubFake().app.privateKeyPem;
const account = { id: 101, login: "ada", type: "User" };
const administrator = "7";
const assessedAt = "2026-10-20T00:00:00.000Z";
const rubricVersion = "slop-value-rubric:v1";

const channels: Readonly<Record<Channel, { readonly channel: string; readonly provider: string }>> = {
  ChatgptSubscription: { channel: "chatgpt-subscription", provider: "openai" },
  ClaudeSubscription: { channel: "claude-subscription", provider: "anthropic" },
  CodexSubscription: { channel: "codex-subscription", provider: "openai" },
};

const retirements: Readonly<Record<RegistryObservation["retirement"], Retirement>> = {
  NotRetired: "NotRetired",
  OwnerRetired: "OwnerRemoved",
  RestrictionRetired: "RestrictionRetired",
  RetirementProofUnavailable: "RetirementProofUnavailable",
};

const enforcements: ReadonlyArray<{ readonly restriction: RegistryObservation["restriction"]; readonly flags: RegistryObservation["flags"]; readonly view: Restriction; readonly restricted: boolean }> = [
  { restriction: "Clear", flags: "NotFlagged", view: "Clear", restricted: false },
  { restriction: "RestrictionUnknown", flags: "NotFlagged", view: "Clear", restricted: true },
  { restriction: "Quarantined", flags: "Flagged", view: "FlagQuarantine", restricted: false },
  { restriction: "Quarantined", flags: "NotFlagged", view: "ModeratorQuarantine", restricted: false },
  { restriction: "Banned", flags: "NotFlagged", view: "ServiceBan", restricted: false },
];

let generation = 0;
let platformProject = 0;
let installs: number[] = [];
let records: ImportedRecord[] = [];
let last: Imports["last"] = "NoImport";
let refusals = 0;
const published: AdmittedImport[] = [];
const Digest = Schema.Struct({ record_digest: Schema.String });
const keyOfDigest = new Map<string, number>();

const installationId = () => 700_000 + generation;
const repositoryBase = () => 9_000_000 + 1_000 * generation;
const repositoryName = (repository: number) => `repo${repository}`;
const repositoryNodeId = (repository: number) => `R_g${generation}_${repository}`;
const hex = (text: string, length = 64) => createHash("sha256").update(text).digest("hex").slice(0, length);
const sourceDigestOf = (key: number) => hex(`assessment-${generation}-${key}`);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, "Z");

function unrealizable(why: string): never {
  throw new Error(`the import request cannot be built from GitHub, the registry and the journal: ${why}`);
}

function installDeliveries(): [Numbered, ...Numbered[]] {
  return [{ deliveryId: `historical-import-${generation}-install-none`, number: 0 }, ...installs.map((number) => ({ deliveryId: `historical-import-${generation}-install-${number}`, number }))];
}

function provenanceOf(producer: Producer) {
  const named = producer.tag === "SubscriptionProducer"
    ? { ...channels[producer.channel], model: producer.model, client: producer.client }
    : { channel: "api", provider: producer.provider, model: producer.requested, client: producer.reported };
  return { ...named, exactVariant: null, identityEvidence: "self-reported", apiReceipt: null };
}

function producerOf(provenance: unknown): Producer {
  const fields = provenance as { readonly channel: string; readonly model: string; readonly client: string };
  const channel = (Object.keys(channels) as Channel[]).find((name) => channels[name].channel === fields.channel);
  if (channel === undefined) throw new Error(`published an unknown channel ${fields.channel}`);
  return { tag: "SubscriptionProducer", channel, model: fields.model, client: fields.client };
}

function single<A>(values: ReadonlyArray<A>, what: string): A {
  const [first] = values;
  if (first === undefined || values.some((value) => JSON.stringify(value) !== JSON.stringify(first))) unrealizable(`the sources of one repository disagree about ${what}`);
  return first;
}

function pullInput(repository: string, number: number, source: ImportSource | undefined) {
  if (source === undefined || source.read === "PullUnreadable") return { repo: repository, number, author: "bo", state: "closed" as const, mergedAt: iso(1_790_000_000) };
  if (source.read === "PullOpen") return { repo: repository, number, author: "bo", state: "open" as const };
  if (source.occurredAt <= 0) unrealizable("a closed pull request always has a closing time");
  return { repo: repository, number, author: "bo", state: "closed" as const, mergedAt: iso(source.occurredAt) };
}

function worldOf(request: ImportRequest) {
  const fake = githubFake({ appPrivateKeyPem: appKey });
  const world = fake.world;
  world.addUser({ id: 101, login: "ada", nodeId: "U_ada" });
  world.addUser({ id: 202, login: "bo", nodeId: "U_bo" });
  const covered: string[] = [];
  for (const repository of [...new Set(request.sources.map((source) => source.repository))].sort((left, right) => left - right)) {
    if (repository <= 0) unrealizable("a GitHub repository id is positive");
    const sources = request.sources.filter((source) => source.repository === repository);
    const visibility = single(sources.map((source) => source.visibility), "visibility");
    if (visibility === "VisibilityUnknown") unrealizable("GitHub always states a readable repository's visibility");
    world.addRepo({ id: repositoryBase() + repository, owner: "ada", name: repositoryName(repository), nodeId: repositoryNodeId(repository), private: visibility === "PrivateRepo" });
    const unreadable = single(sources.map((source) => source.read === "PullUnreadable"), "installation coverage");
    if (!unreadable) covered.push(repositoryName(repository));
    for (let number = 1; number <= Math.max(...sources.map((source) => source.pull)); number++) world.addPull(pullInput(`ada/${repositoryName(repository)}`, number, sources.find((source) => source.pull === number)));
  }
  world.addInstallation({ id: installationId(), account: "ada", repositories: covered, permissions: { metadata: "read", pull_requests: "read" } });
  return fake;
}

function viewOf(projectId: string, registry: RegistryObservation, repository: number): ProjectView {
  return {
    projectId,
    revision: 1,
    manifestSha256: "0".repeat(64),
    rowStatus: registry.rowActive ? "Active" : "Paused",
    manifestStatus: registry.manifestActive ? "Active" : "Paused",
    listingTier: "Community",
    retirement: retirements[registry.retirement],
    stewardGithubId: "101",
    repositories: [{ id: String(repositoryBase() + repository), nodeId: repositoryNodeId(repository), fullName: `ada/${repositoryName(repository)}`, integrationBranch: "main", aliases: [] }],
    closureConsent: false,
  };
}

function registryOf(request: ImportRequest) {
  const lookups = new Map<string, RepositoryLookup>();
  const views = new Map<string, { readonly view: ProjectView; readonly restricted: boolean; readonly restriction: Restriction }>();
  for (const repository of new Set(request.sources.map((source) => source.repository))) {
    const sources = request.sources.filter((source) => source.repository === repository);
    const registry = single(sources.map((source) => source.registry), "registration");
    const project = single(sources.map((source) => source.project), "project");
    if (registry.observedId !== repository) unrealizable("the observed id is the GitHub repository id");
    if (registry.lookup === "NoRow") {
      if (JSON.stringify(registry) !== JSON.stringify({ ...registry, registeredId: 0, rowActive: false, manifestActive: false, retirement: "NotRetired", restriction: "Clear", flags: "NotFlagged" })) unrealizable("an unregistered repository has no registration facts");
      continue;
    }
    if (project <= 0) unrealizable("a registered repository belongs to a project");
    const enforcement = enforcements.find((entry) => entry.restriction === registry.restriction && entry.flags === registry.flags);
    if (enforcement === undefined) unrealizable("the enforcement view has no such restriction");
    const projectId = `project-${project}`;
    const view = viewOf(projectId, registry, repository);
    views.set(projectId, { view, restricted: enforcement.restricted, restriction: enforcement.view });
    lookups.set(`ada/${repositoryName(repository)}`, { match: registry.lookup, registeredRepositoryId: registry.registeredId > 0 ? String(repositoryBase() + registry.registeredId) : "0", project: view });
  }
  return Layer.mergeAll(
    Layer.succeed(Registry, {
      project: (projectId) => Effect.succeed(views.get(projectId)?.view),
      byRepository: (repositoryId) => Effect.succeed([...views.values()].find((entry) => entry.view.repositories.some((repository) => repository.id === repositoryId))?.view),
      byPath: (fullName) => Effect.succeed(lookups.get(fullName.toLowerCase())),
      active: () => Effect.succeed([...views.values()].map((entry) => entry.view)),
      fence: () => Effect.succeed(sql`1`),
    }),
    Layer.succeed(Restrictions, {
      account: () => Effect.succeed({ banned: false }),
      project: (projectId) => Effect.succeed({ restricted: views.get(projectId)?.restricted ?? false }),
      fence: () => Effect.succeed(sql`1`),
      unbanned: () => Effect.succeed(sql`1`),
    }),
    Layer.succeed(Enforcement, {
      project: (projectId) => Effect.succeed({ restriction: views.get(projectId)?.restriction ?? "Clear", enforcementGeneration: 0, clearanceGeneration: "0" }),
      fence: () => Effect.succeed(sql`1`),
    }),
  );
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const appendAdmitted = (admitted: AdmittedImport) => Effect.gen(function* () {
  const [source] = admitted.sources;
  if (source === undefined) return yield* Effect.fail(new PublicationFailed());
  const registry = yield* Registry;
  const project = yield* registry.project(source.projectId);
  if (project === undefined) return yield* Effect.fail(new PublicationFailed());
  if (admitted.mode === "single") {
    const supersedes = admitted.supersedes[0] ?? null;
    const recordJson = JSON.stringify({
      schemaVersion: "slop-value-record:v1",
      projectId: source.projectId,
      repository: source.repository,
      repositoryNodeId: source.repositoryNodeId,
      repositoryDatabaseId: source.repositoryDatabaseId,
      pullRequestNodeId: source.pullRequestNodeId,
      pullRequestNumber: source.number,
      headSha: "c".repeat(40),
      mergeSha: null,
      sourceDigest: admitted.result["sourceDigest"],
      rubricVersion: admitted.result["rubricVersion"],
      producerRevision: admitted.producerRevision,
      assessedAt: admitted.result["assessedAt"],
      supersedes,
      revisionReason: admitted.revisionReason,
      model: admitted.result["provenance"],
    });
    const registryFence = yield* registry.fence({ projectId: project.projectId, revision: project.revision, manifestSha256: project.manifestSha256, repositoryKeys: [source.repository.toLowerCase()] });
    const stored = yield* appendValueRecord(recordJson, { installationId: admitted.installationId, projectId: source.projectId, registryFence });
    return { recordDigest: stored.record_digest, sequence: stored.sequence };
  }
  const recordJson = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId: source.projectId,
    sourceDigest: admitted.result["sourceDigest"],
    sources: admitted.sources.map((member) => ({ repository: member.repository, repositoryNodeId: member.repositoryNodeId, repositoryDatabaseId: member.repositoryDatabaseId, pullRequestNodeId: member.pullRequestNodeId, pullRequestNumber: member.number })),
    claims: [],
    units: [],
    rubricVersion: admitted.result["rubricVersion"],
    producerRevision: admitted.producerRevision,
    assessedAt: admitted.result["assessedAt"],
    supersedes: admitted.supersedes,
    legacyPredecessors: admitted.legacyPredecessors,
    revisionReason: admitted.revisionReason,
  });
  const recordDigest = sha256(recordJson);
  const changed = yield* (yield* D1).run(sql`INSERT INTO slopbot_work_unit_journal (record_digest, assessment_key, project_id, source_digest, record_json, recorded_at)
    VALUES (${recordDigest}, ${admitted.assessmentKey}, ${source.projectId}, ${String(admitted.result["sourceDigest"])}, ${recordJson}, ${assessedAt})`);
  if (changed !== 1) return yield* Effect.fail(new PublicationFailed());
  const stored = yield* first(Schema.Struct({ sequence: Schema.Number }), sql`SELECT sequence FROM slopbot_work_unit_journal WHERE record_digest = ${recordDigest}`);
  if (stored === undefined) return yield* Effect.fail(new PublicationFailed());
  const sequence = stored.sequence;
  return { recordDigest, sequence };
});

type Base = Layer.Success<typeof webCrypto> | D1 | Registry;

const recordingPublication = Layer.effect(HistoricalPublication, Effect.gen(function* () {
  const context = yield* Effect.context<Base>();
  return {
    publish: (admitted: AdmittedImport) => appendAdmitted(admitted).pipe(
      Effect.tap(() => Effect.sync(() => { published.push(admitted); })),
      Effect.provide(context),
      Effect.mapError(() => new PublicationFailed()),
    ),
  };
}));

async function heads(request: ImportRequest, fake: GitHubFake) {
  const sources = request.sources.map((source) => ({ repositoryNodeId: repositoryNodeId(source.repository), pullRequestNodeId: fake.world.findRepo(`ada/${repositoryName(source.repository)}`)?.items.get(source.pull)?.nodeId ?? "" }));
  const found = await runtime.runPromise(Effect.forEach(sources, (source) => Effect.all({
    legacy: first(Digest, sql`SELECT record_digest FROM slopbot_value_journal j WHERE repository_node_id = ${source.repositoryNodeId} AND pull_request_node_id = ${source.pullRequestNodeId}
      AND NOT EXISTS (SELECT 1 FROM slopbot_value_journal child WHERE child.supersedes = j.record_digest)`),
    joint: rows(Digest, sql`SELECT s.record_digest FROM slopbot_work_unit_sources s WHERE s.repository_node_id = ${source.repositoryNodeId} AND s.pull_request_node_id = ${source.pullRequestNodeId}
      AND NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors p WHERE p.predecessor_digest = s.record_digest)`),
  })));
  return {
    legacy: [...new Set(found.flatMap((source) => (source.legacy === undefined ? [] : [source.legacy.record_digest])))],
    joint: [...new Set(found.flatMap((source) => source.joint.map((row) => row.record_digest)))],
  };
}

function envelopeOf(request: ImportRequest, predecessors: { readonly legacy: ReadonlyArray<string>; readonly joint: ReadonlyArray<string> }) {
  if (request.assessmentKey <= 0) unrealizable("an assessment key is a digest of the assessment");
  const sourceDigest = sourceDigestOf(request.assessmentKey);
  keyOfDigest.set(sourceDigest, request.assessmentKey);
  const joint = request.mode === "Joint";
  const supersedes = joint ? predecessors.joint : predecessors.legacy.slice(0, 1);
  const legacy = joint ? predecessors.legacy : [];
  return {
    installationId: installationId(),
    mode: joint ? "work-unit" : "single",
    result: { provenance: provenanceOf(request.producer), assessedAt, sourceDigest, rubricVersion },
    revisionReason: supersedes.length + legacy.length > 0 ? "Historical subscription assessment replaces the current record" : null,
    sources: request.sources.map((source) => ({ repository: `ada/${repositoryName(source.repository)}`, pullRequestNumber: source.pull, contextPaths: [] })),
    supersedes: joint ? supersedes : supersedes[0] ?? null,
    ...joint ? { legacyPredecessors: legacy } : {},
  };
}

function actorOf(request: ImportRequest) {
  if (request.admin.actor <= 0) return "0";
  return request.admin.verifiedAdministrator ? administrator : "8";
}

async function submit(request: ImportRequest) {
  const fake = worldOf(request);
  const revision = request.producerRevision === "" ? "" : hex(`revision-${generation}-${request.producerRevision}`, 40);
  const http = outboundVia({ fetch: (input: Request) => fake.fetch(input) });
  const registry = registryOf(request);
  const services = Layer.mergeAll(
    http,
    Layer.provide(githubApp({ appId: fake.app.id, privateKey: Redacted.make(fake.app.privateKeyPem), userAgent: "slopbot" }), http),
    rolesFrom({ ADMIN_GITHUB_IDS: administrator, PROJECT_MODERATOR_GITHUB_IDS: "" }),
    importSettings({ SLOPBOT_PRODUCER_REVISION: revision, ...platformProject > 0 ? { SLOPBOT_PLATFORM_PROJECT_ID: `project-${platformProject}` } : {} }),
    registry,
    Layer.provide(recordingPublication, registry),
  );
  published.length = 0;
  const envelope = envelopeOf(request, await heads(request, fake));
  const exit = await runtime.runPromiseExit(Effect.provide(publishSubscription(actorOf(request), envelope, undefined), services));
  const [admitted] = published;
  if (Exit.isSuccess(exit) && admitted !== undefined) {
    const key = keyOfDigest.get(String(admitted.result["sourceDigest"])) ?? 0;
    records = [...records, { key, producer: producerOf(admitted.result["provenance"]), sources: admitted.sources.map((source) => ({ repository: source.repositoryDatabaseId - repositoryBase(), pull: source.number })) }];
    last = "Imported";
    return "accepted" as const;
  }
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : new Error("an import succeeded without publishing");
  if (typeof error !== "object" || error === null || !("_tag" in error) || typeof error._tag !== "string") throw error;
  last = "Refused";
  refusals += 1;
  return "accepted" as const;
}

function view(state: Imports): Observed {
  const { known, suspended, removed, sourceTime } = state.install;
  return { ...state, install: { known, suspended, removed, sourceTime } };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    platformProject = 0;
    installs = [];
    records = [];
    last = "NoImport";
    refusals = 0;
    keyOfDigest.clear();
  },
  dispatch: (_key, event: Event) => {
    switch (event.type) {
      case "recordPlatformProject": {
        if (platformProject > 0 || event.project <= 0) return "refused";
        platformProject = event.project;
        return "accepted";
      }
      case "applyInstallation": {
        if (!installs.includes(event.change.delivery)) installs.push(event.change.delivery);
        return outcome(deliver({
          installationId: installationId(),
          account: event.change.hasAccount ? account : undefined,
          deliveryId: `historical-import-${generation}-install-${event.change.delivery}`,
          event: event.change,
          servedProjects: [],
        }, installDeliveries()), runtime);
      }
      case "submit":
        return submit(event.request);
    }
  },
  observe: async () => {
    const install = await runtime.runPromise(installationState(installationId(), installDeliveries()));
    return view({ records, keys: records.map((record) => record.key), last, refusals, platformProject, install });
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["imports"], walks: 3, steps: 14, view };
