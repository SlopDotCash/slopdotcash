// A fresh-policy cycle imports no carry and no legacy README proof: legacy
// records do not automatically authorize a new payout protocol (PRD WAL-01,
// section 23). A README-only row stays unclaimed; an actor-bound registry
// claim is still a destination. A normal cycle keeps the frozen README proofs.
// No checked-in project has an active freshCyclePaymentPolicy, so this file
// adds a test-only fixture: the eliza definition with a policy for 2026-09
// (when `fresh` is set), and a prior-cycle loader with the contract of
// loadPriorCycleAccrual: carry and frozen proofs in the normal mode, neither
// in the fresh mode. Outside these tests both mocks return the real values.
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
  fresh: boolean;
  loader: (input: LoaderInput) => Promise<PriorAccrual>;
} | null = null;

mock.module("../src/lib/projects.mjs", () => ({
  ...realProjects,
  findProject: (value: unknown) => {
    const project = realFindProject(value as string);
    if (!fixture?.fresh || project?.id !== "eliza") return project;
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
// The actor-bound registry claims are the registry wallets that the frozen
// cycle holds. Every other scored actor has only its frozen README proof.
const registry = new Map<string, WalletProof>(
  scored.flatMap((row) =>
    row.wallet && "sourceClaimId" in row.wallet
      ? [[row.actor.id, row.wallet] as const]
      : [],
  ),
);
const readmeOnly = scored
  .map((row) => row.actor.id)
  .filter((actorId) => !registry.has(actorId));

afterEach(() => {
  fixture = null;
});

/**
 * Runs the generator and then proposal validation on the fixture. `fresh`
 * gives the project its fresh-cycle policy. `leakProofs` makes the loader
 * return the frozen proofs also in the fresh mode, so the generator itself
 * must refuse them.
 */
async function generateAndValidate(
  options: { fresh?: boolean; leakProofs?: boolean } = {},
) {
  const loaderCalls: (boolean | undefined)[] = [];
  fixture = {
    fresh: options.fresh ?? true,
    // The same contract as loadPriorCycleAccrual: the fresh mode returns no
    // carry and no README proof; the normal mode returns the frozen proofs
    // and the accrual of the carried actor.
    loader: async (input) => {
      loaderCalls.push(input.freshPolicy);
      return input.freshPolicy
        ? {
            actorLogins: new Map(),
            accruedMinor: new Map(),
            actorReadmeProofs: options.leakProofs ? frozenProofs : new Map(),
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
      // The observer returns the actor-bound registry claim, else the
      // frozen README proof it is given (as fetchPublishedGithubWallet does
      // when that README still publishes it); it reads no new README.
      observeWallet: async (actorId, _login, _observedAt, prior) => {
        lookups.push({ actorId, prior: prior?.readmeProof });
        return registry.get(actorId) ?? prior?.readmeProof ?? null;
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
  test("a README-only row is unclaimed; an actor-bound claim is kept", async () => {
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
    // No lookup of a scored actor carries a README proof.
    expect(lookups).toHaveLength(scored.length);
    for (const lookup of lookups) expect(lookup.prior ?? null).toBeNull();
    expect(FROZEN.carriedMinor).toBe("0");
    expect(proposal.allocations).toHaveLength(scored.length);
    expect(registry.size).toBeGreaterThan(0);
    expect(readmeOnly.length).toBeGreaterThan(0);
    for (const row of proposal.allocations) {
      expect(row.wallet).toEqual(registry.get(row.actor.id) ?? null);
      if (!registry.has(row.actor.id)) expect(row.state).toBe("unclaimed");
    }
  }, 30_000);
});
