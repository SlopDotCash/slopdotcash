// A fresh-policy cycle imports no carry, but generation and proposal
// validation must still load the README proofs that the reviewed prior
// manifest froze for each actor id (review of #676 at 6df7bbf). No checked-in
// project has an active freshCyclePaymentPolicy, so this file adds a
// test-only fixture: the eliza definition with a policy for 2026-09, and a
// prior-cycle loader that returns carry unless the caller asks for the fresh
// mode, as loadPriorCycleAccrual does. Outside these tests both mocks return
// the real values.
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareRankedEntries,
  TARGET_REPOSITORIES,
} from "../src/lib/leaderboard";
import * as realProjects from "../src/lib/projects.mjs";
import type {
  ProfileReadmeWalletProof,
  RewardAllocationManifest,
  WalletProof,
} from "../src/lib/rewards";
import * as realAccrual from "./prior-cycle-accrual";

const realFindProject = realProjects.findProject;
const realLoadPriorCycleAccrual = realAccrual.loadPriorCycleAccrual;

type LoaderInput = Parameters<typeof realLoadPriorCycleAccrual>[0];
type PriorAccrual = Awaited<ReturnType<typeof realLoadPriorCycleAccrual>>;

let fixture: {
  loader: (input: LoaderInput) => Promise<PriorAccrual>;
} | null = null;

mock.module("../src/lib/projects.mjs", () => ({
  ...realProjects,
  findProject: (value: unknown) => {
    const project = realFindProject(value as string);
    if (!fixture || project?.id !== "eliza") return project;
    return {
      ...project,
      funding: {
        ...project.funding,
        freshCyclePaymentPolicy: { projectId: "eliza", cycleId: "2026-09" },
      },
    };
  },
}));
mock.module("./prior-cycle-accrual", () => ({
  ...realAccrual,
  loadPriorCycleAccrual: (input: LoaderInput) =>
    fixture ? fixture.loader(input) : realLoadPriorCycleAccrual(input),
}));

const { prepareRewardCycle } = await import("./prepare-reward-cycle");
const { verifyProposalAgainstSnapshot } = await import("./sync-cycle-index");

const CYCLES = resolve(import.meta.dir, "../cycles");
const CYCLE_DIR = join(CYCLES, "eliza/2026-09");
const FROZEN = JSON.parse(
  readFileSync(join(CYCLE_DIR, "proposal.json"), "utf8"),
) as RewardAllocationManifest;

// The archived 2026-09 snapshot predates the current publication rules: the
// registry now has four repositories, and leaders are ordered by score and
// actor id. The fixture snapshot follows these rules. The eliza leaders and
// their scores do not change.
function fixtureSnapshotBytes(): Buffer {
  const snapshot = JSON.parse(
    readFileSync(join(CYCLE_DIR, "source-snapshot.json"), "utf8"),
  );
  const repositories = new Map(
    snapshot.repositories.map((r: { id: string }) => [r.id, r]),
  );
  const sources = new Map(
    snapshot.source.repositories.map((r: { id: string }) => [r.id, r]),
  );
  snapshot.repositories = TARGET_REPOSITORIES.map(
    ({ aliases: _aliases, expectedNodeId: _nodeId, ...repository }) =>
      repositories.get(repository.id) ?? repository,
  );
  snapshot.source.repositories = TARGET_REPOSITORIES.map(
    (repository) =>
      sources.get(repository.id) ?? {
        id: repository.id,
        repositoryId: repository.expectedNodeId ?? "R_kgDOFIXTUR",
      },
  );
  snapshot.leaders.sort(compareRankedEntries);
  let rank = 0;
  snapshot.leaders.forEach(
    (leader: { rank: number; scoreThirds: number }, index: number) => {
      if (leader.scoreThirds !== snapshot.leaders[index - 1]?.scoreThirds)
        rank = index + 1;
      leader.rank = rank;
    },
  );
  return Buffer.from(JSON.stringify(snapshot));
}
const SNAPSHOT_BYTES = fixtureSnapshotBytes();
const SNAPSHOT_DIR = mkdtempSync(join(tmpdir(), "slop-fresh-"));
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "leaderboard.json");
writeFileSync(SNAPSHOT_PATH, SNAPSHOT_BYTES);
afterAll(() => rmSync(SNAPSHOT_DIR, { recursive: true, force: true }));

const SHA = "e".repeat(40);
const WALLET = "4Nd1mBQtrMJVYVfKf2PJy9NZUse8sLfY4Yt9JZ7bW6Lx";
const CARRIED = { id: "U_kgDOAAHiQA", login: "carried-actor" };

const proofFor = (login: string): ProfileReadmeWalletProof => ({
  address: WALLET,
  chain: "solana",
  observedAt: new Date(Date.UTC(2026, 8, 1)).toISOString(),
  sourceCommit: SHA,
  sourceUrl: `https://github.com/${login}/${login}/blob/${SHA}/README.md`,
});

// The prior manifest froze a README proof for every scored actor (each
// leader of the project view, which is each row of the frozen cycle; it has
// no carried rows) and for one actor that is not scored and carries an
// accrual.
const scored = FROZEN.allocations;
const frozenProofs = new Map<string, ProfileReadmeWalletProof>([
  ...scored.map((row) => [row.actor.id, proofFor(row.actor.login)] as const),
  [CARRIED.id, proofFor(CARRIED.login)],
]);

afterEach(() => {
  fixture = null;
});

/** Runs the generator and then proposal validation on the fixture. */
async function generateAndValidate() {
  const loaderCalls: (boolean | undefined)[] = [];
  fixture = {
    // The same contract as loadPriorCycleAccrual: the fresh mode returns the
    // frozen proofs only; otherwise the accrual of the carried actor is added.
    loader: async (input) => {
      loaderCalls.push(input.freshPolicy);
      return input.freshPolicy
        ? {
            actorLogins: new Map(),
            accruedMinor: new Map(),
            actorReadmeProofs: frozenProofs,
            unsafeDestinationReports: new Map(),
          }
        : {
            actorLogins: new Map([[CARRIED.id, CARRIED.login]]),
            accruedMinor: new Map([[CARRIED.id, "3000000"]]),
            actorReadmeProofs: frozenProofs,
            unsafeDestinationReports: new Map(),
          };
    },
  };
  const lookups: { actorId: string; prior?: WalletProof | null }[] = [];
  const proposal = (await prepareRewardCycle(
    {
      cycleId: "2026-09",
      projectId: "eliza",
      outputPath: join(CYCLE_DIR, "proposal.json"),
      snapshotArchivePath: join(CYCLE_DIR, "source-snapshot.json"),
      snapshotPath: SNAPSHOT_PATH,
    },
    {
      generatedAt: FROZEN.generatedAt,
      // The bound observer keeps the frozen proof; it reads no README.
      observeWallet: async (actorId, _login, _observedAt, prior) => {
        lookups.push({ actorId, prior: prior?.readmeProof });
        return prior?.readmeProof ?? null;
      },
      write: async () => {},
      writeSnapshot: async () => {},
    },
  )) as RewardAllocationManifest;
  await verifyProposalAgainstSnapshot(
    proposal,
    JSON.parse(SNAPSHOT_BYTES.toString("utf8")),
    createHash("sha256").update(SNAPSHOT_BYTES).digest("hex"),
  );
  return { proposal, lookups, loaderCalls };
}

describe("fresh-policy cycle: generator and validation (fixture project)", () => {
  test("every scored row keeps its frozen README proof, with no carry", async () => {
    const { proposal, lookups, loaderCalls } = await generateAndValidate();
    // The generator and the validation both load the prior cycle in the
    // fresh mode.
    expect(loaderCalls).toEqual([true, true]);
    // No carry and no carried login.
    expect(proposal.carriedMinor).toBe("0");
    expect(lookups.map((lookup) => lookup.actorId)).not.toContain(CARRIED.id);
    expect(
      proposal.allocations.some(
        (row) =>
          row.actor.id === CARRIED.id || row.actor.login === CARRIED.login,
      ),
    ).toBe(false);
    // Each lookup of a scored actor carries its frozen proof, and each scored
    // row holds it.
    expect(lookups).toHaveLength(scored.length);
    for (const lookup of lookups)
      expect(lookup.prior).toEqual(frozenProofs.get(lookup.actorId));
    expect(FROZEN.carriedMinor).toBe("0");
    expect(proposal.allocations).toHaveLength(scored.length);
    for (const row of proposal.allocations)
      expect(row.wallet).toEqual(frozenProofs.get(row.actor.id) ?? null);
  }, 30_000);
});
