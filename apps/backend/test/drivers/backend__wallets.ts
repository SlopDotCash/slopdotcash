import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Notices } from "@repo/ports/operations";
import { Audit } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/backend__wallets.conformance.ts";
import type { Attestation, Authorization, Challenge, Event, PossessionChallenge, WalletChain, WalletClaim, WalletRegistration } from "../../gen/backend__wallets.ts";
import { type Context, type Facts, type Partition, type Sent, contextOf, freshContext, loadPartition, send } from "../../src/wallets/store.vibe";

interface View {
  chain: WalletChain;
  claims: WalletClaim[];
  challenges: string[];
  authorizations: { claim: number; authorizedAt: number; challenge: string }[];
  possessionChallenges: PossessionChallenge[];
  lastPossessionChallenge: number;
  attestations: Attestation[];
}

interface Track {
  actor: string;
  chain: WalletChain;
  context: Context;
  challenges: Map<number, number>;
  issued: number;
  made: number;
}

const mf = startWorker({ d1: { SLOP_DB: "wallet-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const unrecorded = Layer.mergeAll(
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]), payoutRecipient: (project) => Effect.succeed(project.stewardGithubId) }),
  Layer.succeed(Audit, { statements: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto, unrecorded));

let generation = 0;
let nextActor = 7_000_000;
const tracks = new Map<string, Track>();
const senders = new Map<string, string>();
const digests = new Map<string, string>();

const hex = (text: string) => createHash("sha256").update(text).digest("hex");
const iso = (millis: number) => new Date(millis).toISOString();

function trackOf(key: string): Track {
  const known = tracks.get(key);
  if (known !== undefined) return known;
  const made: Track = { actor: String(nextActor++), chain: "Base", context: freshContext(1), challenges: new Map(), issued: 0, made: 0 };
  tracks.set(key, made);
  return made;
}

function senderOf(track: Track, by: unknown): string {
  const model = String(by);
  if (model === "1") return track.actor;
  if (model === "operator") return model;
  const known = senders.get(model);
  if (known !== undefined) return known;
  const made = String(nextActor++);
  senders.set(model, made);
  return made;
}

function digestOf(key: string, digest: string): string {
  if (digest === "") return "";
  const stored = hex(`${generation}:${key}:${digest}`);
  digests.set(stored, digest);
  return stored;
}

function translated(key: string, track: Track, event: Event): Event {
  switch (event.type) {
    case "register":
    case "registerByBearer":
      return { ...event, registration: { ...event.registration, digest: digestOf(key, event.registration.digest) } };
    case "operatorClaim":
      return { ...event, request: { ...event.request, digest: digestOf(key, event.request.digest) } };
    case "issue":
      return { ...event, challengeId: event.challengeId <= 0 ? event.challengeId : track.challenges.get(event.challengeId) ?? track.issued + 1 };
    case "readProof":
      return { ...event, proof: { ...event.proof, challengeId: track.challenges.get(event.proof.challengeId) ?? 0 } };
    default:
      return event;
  }
}

function factsFor(key: string, track: Track, event: Event, by: string): Facts {
  const id = `${generation}-${key}-${track.made++}`;
  const audit = { actorGithubId: by === "operator" ? track.actor : by, action: "wallet_claim.created", requestId: `request-${id}`, details: {} };
  switch (event.type) {
    case "register":
    case "registerByBearer":
      return { kind: "claim", id, login: `member-${track.actor}`, sourceBodySha256: hex(id), issueRepository: null, issueNumber: null, observedAt: iso(track.context.clock), audit };
    case "operatorClaim": {
      const issue = event.request.source === "FromGithubIssue";
      return { kind: "claim", id, login: `member-${track.actor}`, sourceBodySha256: hex(id), issueRepository: issue ? "SlopDotCash/slopdotcash" : null, issueNumber: issue ? 1 : null, observedAt: iso(event.request.observedAt), audit };
    }
    case "issue":
      return { kind: "challenge", id, message: event.messageDigest };
    case "commitAuthorization":
      return { kind: "authorization", signature: `signature-${id}` };
    case "issuePossessionChallenge":
      return { kind: "possessionChallenge", id: hex(id).slice(0, 32) };
    case "attestPossession":
      return { kind: "attestation", id, signature: `${"A".repeat(86)}==`, messageSha256: hex(id), audit: { ...audit, action: "wallet_possession.attested" } };
    default:
      return { kind: "none" };
  }
}

const partitionOf = (track: Track): Partition => ({ actor: track.actor, chain: track.chain });

function contentOf(challenge: Challenge): string {
  return JSON.stringify([challenge.claim, challenge.claimDigest, challenge.wallet, challenge.issuedAt, challenge.expiresAt, challenge.messageDigest]);
}

function view(state: WalletRegistration): View {
  const entries = Object.entries<Challenge>(state.challenges);
  const byId = new Map(entries.map(([id, challenge]) => [Number(id), challenge]));
  const consumedAt = (id: number) => state.consumptions.find((used) => used.challengeId === id);
  return {
    chain: state.chain,
    claims: state.claims,
    challenges: entries.map(([id, challenge]) => {
      const used = consumedAt(Number(id));
      return JSON.stringify([contentOf(challenge), used === undefined ? null : [used.claim, used.at]]);
    }).sort(),
    authorizations: state.authorizations.map((authorization: Authorization) => ({
      claim: authorization.claim,
      authorizedAt: authorization.authorizedAt,
      challenge: contentOf(byId.get(authorization.challengeId) ?? { claim: 0, claimDigest: "", wallet: "", issuedAt: 0, expiresAt: 0, messageDigest: "" }),
    })),
    possessionChallenges: state.possessionChallenges,
    lastPossessionChallenge: state.lastPossessionChallenge,
    attestations: state.attestations,
  };
}

function original(state: WalletRegistration): WalletRegistration {
  const back = (digest: string) => digests.get(digest) ?? digest;
  return {
    ...state,
    claims: state.claims.map((claim) => ({ ...claim, digest: back(claim.digest) })),
    challenges: Object.fromEntries(Object.entries(state.challenges).map(([id, challenge]) => [id, { ...challenge, claimDigest: back(challenge.claimDigest) }])),
  };
}

type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function sent(effect: Effect.Effect<Sent, unknown, Services>): Promise<Sent | undefined> {
  return runtime.runPromise(effect.pipe(Effect.catchTags({ Rejected: () => Effect.succeed(undefined) })));
}

async function dispatch(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const track = trackOf(key);
  const sender = senderOf(track, by);
  const translatedEvent = translated(key, track, event);
  const step = { event: translatedEvent, by: sender, facts: factsFor(key, track, translatedEvent, sender) };
  const result = await sent(send(partitionOf(track), () => [step], track.context));
  if (result === undefined) return "refused";
  track.context = contextOf(result.state);
  if (event.type === "selectChain") track.chain = event.chain;
  if (event.type === "issue" && translatedEvent.type === "issue") {
    track.challenges.set(event.challengeId, translatedEvent.challengeId);
    track.issued += 1;
  }
  return "accepted";
}

async function observe(key: string): Promise<View> {
  const track = trackOf(key);
  const loaded = await runtime.runPromise(loadPartition(partitionOf(track), track.context));
  return view(original(loaded.state));
}

export const driver: Driver<View> & AsyncDisposable = {
  reset: () => {
    generation++;
    tracks.clear();
    senders.clear();
    digests.clear();
  },
  dispatch,
  observe,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { keys: ["alice", "bob"], walks: 6, steps: 12, view };
