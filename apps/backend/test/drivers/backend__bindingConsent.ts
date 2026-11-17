import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Notices } from "@repo/ports/operations";
import { Audit } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/backend__bindingConsent.conformance.ts";
import type { Binding, CaseAccess, Consent, Deployment, Event, PaymentEvidence } from "../../gen/backend__bindingConsent.ts";
import type { Event as WalletEvent, WalletChain } from "../../gen/backend__wallets.ts";
import { type Facts, type Outside, type Scope, loadBinding, noFacts, sendBinding } from "../../src/bindingConsent/store.vibe";
import { type Context, type Facts as WalletFacts, contextOf, freshContext, send as sendWallet } from "../../src/wallets/store.vibe";

interface View {
  consents: Consent[];
  caseAccessLog: CaseAccess[];
  evmClaims: number;
  solanaClaims: number;
  evmAuthorized: number;
  solanaAuthorized: number;
}

interface Partition {
  chain: WalletChain;
  context: Context;
  challenges: Map<number, number>;
  issued: number;
}

interface Track {
  key: string;
  actor: string;
  evm: Partition;
  solana: Partition;
  outside: Omit<Outside, "cases">;
  made: number;
}

const projectId = "binding-conformance";
const seededAt = "2026-11-16T00:00:00.000Z";
const deployments: Deployment[] = [
  { network: "base", vault: "vault-a", chain: "Base", chainId: 8453, family: "Evm", registered: true, solanaContext: false },
  { network: "base", vault: "vault-b", chain: "Base", chainId: 8453, family: "Evm", registered: true, solanaContext: false },
  { network: "base", vault: "vault-b", chain: "Base", chainId: 84532, family: "Evm", registered: true, solanaContext: false },
  { network: "robinhood", vault: "vault-a", chain: "Robinhood", chainId: 4663, family: "Evm", registered: true, solanaContext: false },
  { network: "solana", vault: "vault-s", chain: "Solana", chainId: 0, family: "Svm", registered: true, solanaContext: true },
  { network: "solana", vault: "vault-x", chain: "Solana", chainId: 0, family: "Svm", registered: true, solanaContext: false },
];

const mf = startWorker({ d1: { SLOP_DB: "binding-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const manifest = JSON.stringify({ id: projectId, status: "paused" });
await db.batch([
  db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'Listed', ?)").bind(projectId, manifest, "b".repeat(64), seededAt),
  db.prepare("INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'paused', 1, ?, ?, ?, ?)").bind(projectId, manifest, "b".repeat(64), seededAt, seededAt),
]);
const unrecorded = Layer.mergeAll(
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]) }),
  Layer.succeed(Audit, { statements: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, unrecorded));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

let generation = 0;
let nextActor = 8_000_000;
const tracks = new Map<string, Track>();
const senders = new Map<string, string>();
const cases = new Map<string, number>();

const hex = (text: string) => createHash("sha256").update(text).digest("hex");
const iso = (millis: number) => new Date(millis).toISOString();

function senderOf(track: Track, by: unknown): string {
  const model = String(by);
  if (model === "1") return track.actor;
  if (model === "operator" || model === "settlement" || model === "scanner") return model;
  const key = `${generation}:${model}`;
  const known = senders.get(key);
  if (known !== undefined) return known;
  const made = String(nextActor++);
  senders.set(key, made);
  return made;
}

function modelSender(track: Track, actor: string): string {
  if (actor === track.actor) return "1";
  for (const [key, made] of senders) if (made === actor && key.startsWith(`${generation}:`)) return key.slice(`${generation}:`.length);
  return actor;
}

function caseId(track: Track, privateCase: number): string {
  return `sc_binding_${generation}_${track.key}_${privateCase}`;
}

async function caseFor(track: Track, privateCase: number): Promise<string> {
  const id = caseId(track, privateCase);
  if (!cases.has(id)) {
    await db.prepare(`INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state,
        receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, revision, created_at, updated_at)
      VALUES (?, ?, 'example/bindings', 'GHSA-aaaa-bbbb-cccc', ?, 'reporter', 'claimed', 'received', 'not-started', 'not-applicable', 'not-applicable', 'embargoed', 'private', 'none', 1, ?, ?)`)
      .bind(id, projectId, track.actor, seededAt, seededAt).run();
    cases.set(id, privateCase);
  }
  return id;
}

function partition(chain: WalletChain): Partition {
  return { chain, context: freshContext(1), challenges: new Map(), issued: 0 };
}

function evidenceFor(track: Track, evidence: PaymentEvidence): PaymentEvidence {
  return { ...evidence, owner: evidence.owner === "" ? "" : senderOf(track, evidence.owner) };
}

function walletFacts(track: Track, side: Partition, event: WalletEvent, by: string): WalletFacts {
  const id = `${generation}-${track.key}-${track.made++}`;
  const audit = { actorGithubId: by === "operator" ? track.actor : by, action: "wallet_claim.created", requestId: `request-${id}`, details: {} };
  switch (event.type) {
    case "register":
      return { kind: "claim", id, login: `member-${track.actor}`, sourceBodySha256: hex(id), issueRepository: null, issueNumber: null, observedAt: iso(side.context.clock), audit };
    case "operatorClaim": {
      const issue = event.request.source === "FromGithubIssue";
      return { kind: "claim", id, login: `member-${track.actor}`, sourceBodySha256: hex(id), issueRepository: issue ? "SlopDotCash/slopdotcash" : null, issueNumber: issue ? 1 : null, observedAt: iso(event.request.observedAt), audit };
    }
    case "issue":
      return { kind: "challenge", id, message: event.messageDigest };
    case "commitAuthorization":
      return { kind: "authorization", signature: `signature-${id}` };
    default:
      return { kind: "none" };
  }
}

function digestOf(track: Track, side: Partition, digest: string): string {
  return digest === "" ? "" : hex(`${generation}:${track.key}:${side.chain}:${digest}`);
}

function walletTranslated(track: Track, side: Partition, event: WalletEvent): WalletEvent {
  switch (event.type) {
    case "register":
      return { ...event, registration: { ...event.registration, digest: digestOf(track, side, event.registration.digest) } };
    case "operatorClaim":
      return { ...event, request: { ...event.request, digest: digestOf(track, side, event.request.digest) } };
    case "issue":
      return { ...event, challengeId: event.challengeId <= 0 ? event.challengeId : side.challenges.get(event.challengeId) ?? side.issued + 1 };
    case "readProof":
      return { ...event, proof: { ...event.proof, challengeId: side.challenges.get(event.proof.challengeId) ?? 0 } };
    default:
      return event;
  }
}

async function walletStep(track: Track, side: Partition, event: WalletEvent, by: string): Promise<"accepted" | "refused"> {
  const translated = walletTranslated(track, side, event);
  const step = { event: translated, by, facts: walletFacts(track, side, translated, by) };
  const result = await runtime.runPromise(sendWallet({ actor: track.actor, chain: side.chain }, () => [step], side.context).pipe(Effect.catchTags({ Rejected: () => Effect.succeed(undefined) })));
  if (result === undefined) return "refused";
  side.context = contextOf(result.state);
  if (event.type === "issue" && translated.type === "issue") {
    side.challenges.set(event.challengeId, translated.challengeId);
    side.issued += 1;
  }
  return "accepted";
}

async function authorizedSample(track: Track, side: Partition, wallet: string): Promise<void> {
  const steps: WalletEvent[] = [
    { type: "register", registration: { wallet, digest: "digest-a", predecessor: 0 } },
    { type: "issue", claim: 1, challengeId: 1, messageDigest: "message-a" },
    { type: "readProof", proof: { requestId: 1, challengeId: 1, claim: 1, recoveredSigner: wallet, messageDigest: "message-a" } },
    { type: "consume", requestId: 1 },
    { type: "commitAuthorization", requestId: 1, storageSucceeded: true },
  ];
  for (const event of steps) {
    if ((await walletStep(track, side, event, track.actor)) !== "accepted") throw new Error(`the launch sample refused ${event.type}`);
  }
}

async function trackOf(key: string): Promise<Track> {
  const known = tracks.get(key);
  if (known !== undefined) return known;
  const actor = String(nextActor++);
  const track: Track = { key, actor, evm: partition("Base"), solana: partition("Solana"), outside: { payments: [], generations: [], lastGeneration: 0, finalizedHeight: 1000 }, made: 0 };
  tracks.set(key, track);
  await authorizedSample(track, track.evm, "wallet-a");
  await authorizedSample(track, track.solana, "wallet-s");
  track.outside = {
    ...track.outside,
    payments: [
      { obligation: 1, owner: actor, network: "solana", vault: "vault-s", reserved: true, attemptClaim: 1, attemptOpen: true, privateCase: 0, outboxReady: true },
      { obligation: 2, owner: actor, network: "solana", vault: "vault-s", reserved: true, attemptClaim: 1, attemptOpen: true, privateCase: 5, outboxReady: true },
    ],
  };
  return track;
}

function scopeOf(track: Track): Scope<undefined, never, never> {
  return {
    actor: track.actor,
    chain: "Base",
    contexts: { evm: track.evm.context, solana: track.solana.context },
    deployments,
    fingerprint: { text: "SELECT ''", params: [] },
    outside: () => Effect.succeed({ outside: { ...track.outside, cases: Object.fromEntries(cases) }, found: undefined }),
  };
}

async function factsFor(track: Track, event: Event): Promise<Facts> {
  if (event.type === "bindAuthorize") return { kind: "consent", signature: `0x${hex(`${generation}:${track.key}:${track.made++}`)}` };
  if (event.type !== "solanaPrepare" && event.type !== "solanaComplete" && event.type !== "solanaRefused") return noFacts;
  const evidence = track.outside.payments.find((payment) => payment.obligation === event.obligation);
  return evidence === undefined || evidence.privateCase <= 0 ? noFacts : { kind: "access", caseId: await caseFor(track, evidence.privateCase) };
}

async function bindingStep(track: Track, event: Event, by: string): Promise<"accepted" | "refused"> {
  const sent = event.type === "observePayment" ? { ...event, evidence: evidenceFor(track, event.evidence) } : event;
  const step = { event: sent, by, facts: await factsFor(track, sent) };
  const effect: Effect.Effect<{ state: Binding } | undefined, unknown, Services> = sendBinding(scopeOf(track), () => [step]).pipe(Effect.catchTags({ Rejected: () => Effect.succeed(undefined) }));
  const result = await runtime.runPromise(effect);
  if (result === undefined) return "refused";
  track.outside = { payments: result.state.payments, generations: result.state.generations, lastGeneration: result.state.lastGeneration, finalizedHeight: result.state.finalizedHeight };
  return "accepted";
}

async function dispatch(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const track = await trackOf(key);
  const sender = senderOf(track, by);
  switch (event.type) {
    case "observeTime":
    case "register":
    case "issue":
    case "readProof":
    case "consume":
    case "commitAuthorization":
      return walletStep(track, track.evm, event, sender);
    case "solanaRegister":
      return walletStep(track, track.solana, { type: "register", registration: event.registration }, sender);
    case "solanaOperatorClaim":
      return walletStep(track, track.solana, { type: "operatorClaim", request: event.request }, sender);
    case "solanaIssue":
      return walletStep(track, track.solana, { type: "issue", claim: event.claim, challengeId: event.challengeId, messageDigest: event.messageDigest }, sender);
    case "solanaReadProof":
      return walletStep(track, track.solana, { type: "readProof", proof: event.proof }, sender);
    case "solanaConsume":
      return walletStep(track, track.solana, { type: "consume", requestId: event.requestId }, sender);
    case "solanaCommitAuthorization":
      return walletStep(track, track.solana, { type: "commitAuthorization", requestId: event.requestId, storageSucceeded: event.storageSucceeded }, sender);
    default:
      return bindingStep(track, event, sender);
  }
}

function view(state: Binding): View {
  return {
    consents: state.consents,
    caseAccessLog: state.caseAccessLog,
    evmClaims: state.wallet.claims.length,
    solanaClaims: state.solanaWallet.claims.length,
    evmAuthorized: state.wallet.authorizations.at(-1)?.claim ?? 0,
    solanaAuthorized: state.solanaWallet.authorizations.at(-1)?.claim ?? 0,
  };
}

async function observe(key: string): Promise<View> {
  const track = await trackOf(key);
  const loaded = await runtime.runPromise(loadBinding(scopeOf(track)));
  const state = loaded.state;
  return view({ ...state, caseAccessLog: state.caseAccessLog.map((access) => ({ ...access, actor: modelSender(track, access.actor) })) });
}

export const driver: Driver<View> & AsyncDisposable = {
  reset: () => {
    generation++;
    tracks.clear();
  },
  dispatch,
  observe,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { keys: ["binding"], walks: 4, steps: 10, view };
