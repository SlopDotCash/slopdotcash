// spec/points/projectionTransport.md, "Story: Read the published projection without mistaking a reset for a refusal"; spec/points/ingestion.md, "A multi-part leaderboard is read as one content-addressed generation"
import { Effect } from "effect";
import { utf8, webCrypto } from "@repo/platform/crypto";
import { type EncodedSnapshot, type LeaderboardSnapshot, type RepositoryRegistry, assembleProjection, decodeSnapshot, encodeParts, maxFileBytes, readParts, shardPath, validateSnapshot } from "../../src/client/index.vibe";
import { journalFile } from "../../src/kernels/records/ids.vibe";
import { projectionFiles } from "../../src/publication/projections.vibe";
import { historyText, snapshotFile } from "./u9/fixtures.ts";

export { acceptedReviewHistoryJson, registryAnswer, registryOrigin, repositoryRegistry, served, type Served } from "./catchup3-e1/world.ts";
export * from "./u5/github.ts";

export interface PublishedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface PublishedShard {
  readonly path: string;
  readonly text: string;
}

export interface PublishedFixture {
  readonly registry: RepositoryRegistry;
  readonly leaderboard: { readonly bytes: Uint8Array; readonly snapshot: LeaderboardSnapshot };
  readonly transport: EncodedSnapshot;
  readonly index: string;
  readonly shards: ReadonlyArray<PublishedShard>;
  readonly summary: string;
  readonly files: ReadonlyArray<PublishedFile>;
}

function registryOfSnapshot(snapshot: LeaderboardSnapshot): RepositoryRegistry {
  const targets = snapshot.repositories.map(({ id, owner, name, displayName, githubUrl, description, integrationBranch, projectId }) => ({
    id,
    owner,
    name,
    displayName,
    githubUrl,
    description,
    integrationBranch,
    projectId,
    nodeId: snapshot.source.repositories.find((row) => row.id === id)?.repositoryId ?? "",
    aliases: id === `${owner}/${name}` ? [] : [`${owner}/${name}`],
  }));
  return { registered: targets, targets, projects: [...new Set(targets.map((target) => target.projectId))].map((id) => ({ id, skillSourcePath: "SKILL.md" })) };
}

function padded(bytes: Uint8Array): Uint8Array {
  const spaces = maxFileBytes + 1 - Math.min(bytes.length, maxFileBytes);
  const whole = new Uint8Array(spaces + bytes.length).fill(0x20, 0, spaces);
  whole.set(bytes, spaces);
  return whole;
}

const readBack = (encoded: EncodedSnapshot, registry: RepositoryRegistry) => Effect.gen(function* () {
  const read = yield* readParts(encoded.root, (path) => Effect.sync(() => encoded.parts.find((part) => part.path === path)?.bytes ?? new Uint8Array()));
  return yield* validateSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read)), registry);
});

const built = (history: string, leaderboardText: string) => Effect.gen(function* () {
  const bytes = utf8(leaderboardText);
  const registry = registryOfSnapshot(yield* decodeSnapshot(JSON.parse(leaderboardText)));
  const encoded = yield* encodeParts(bytes);
  const snapshot = yield* readBack(encoded, registry);
  const transport = yield* encodeParts(padded(bytes));
  yield* readBack(transport, registry);
  const projection = yield* projectionFiles(yield* journalFile(history));
  yield* assembleProjection(projection.index, projection.shards);
  const shards = projection.shards.map((text, position) => ({ path: shardPath(position), text }));
  const files: ReadonlyArray<PublishedFile> = [
    { path: "/data/leaderboard.json", bytes: encoded.root },
    ...encoded.parts,
    { path: "/data/points.json", bytes: utf8(projection.index) },
    { path: "/data/points-summary.json", bytes: utf8(projection.summary) },
    ...shards.map((shard) => ({ path: shard.path, bytes: utf8(shard.text) })),
  ];
  return { registry, leaderboard: { bytes, snapshot }, transport, index: projection.index, shards, summary: projection.summary, files } satisfies PublishedFixture;
});

let fixture: Promise<PublishedFixture> | undefined;

export function publishedFixture(): Promise<PublishedFixture> {
  fixture ??= Promise.all([historyText(), snapshotFile()]).then(([history, leaderboard]) => Effect.runPromise(Effect.provide(built(history, leaderboard.text), webCrypto)));
  return fixture;
}
