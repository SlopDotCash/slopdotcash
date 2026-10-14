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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const { assertAllocationsMatchBaseline, verifyProposalAgainstSnapshot } =
  await import("./sync-cycle-index");
const { createRewardCycleProposal } = await import("../src/lib/reward-cycle");
const { walletObservationsSql } = await import("./prepare-payments-import");
const { LEGACY_README_PROOFS } = await import("./readme-proof-binding");

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

const FRESH_REASON = (actorId: string) =>
  `README wallet of ${actorId} is a legacy proof; a fresh-policy cycle accepts only an actor-bound claim`;

/** Sets the fixture project without running the generator. */
function useFixture(fresh: boolean) {
  fixture = {
    fresh,
    loader: () => Promise.reject(new Error("the loader is not used here")),
  };
}

// A legacy pin of eliza/2026-09 whose actor has no registry claim.
const PIN = (() => {
  const pin = LEGACY_README_PROOFS.find(
    (candidate) =>
      candidate.projectId === "eliza" &&
      candidate.cycleId === "2026-09" &&
      readmeOnly.includes(candidate.actorId),
  );
  if (!pin) throw new Error("no legacy pin for a README-only actor");
  return pin;
})();

/** A copy of `proposal` where the row of `actorId` holds `wallet`. */
function withWallet(
  proposal: RewardAllocationManifest,
  actorId: string,
  wallet: WalletProof,
): RewardAllocationManifest {
  const tampered = structuredClone(proposal);
  const row = tampered.allocations.find((a) => a.actor.id === actorId);
  if (!row) throw new Error(`row ${actorId} is missing`);
  row.wallet = wallet;
  row.state =
    BigInt(row.accruedMinor ?? row.suggestedMinor) <
    BigInt(tampered.minimumTransferMinor ?? "0")
      ? "held-below-minimum"
      : "proposed";
  return tampered;
}

const validate = (proposal: RewardAllocationManifest) =>
  verifyProposalAgainstSnapshot(
    proposal,
    JSON.parse(SNAPSHOT_BYTES.toString("utf8")),
    createHash("sha256").update(SNAPSHOT_BYTES).digest("hex"),
  );

describe("fresh-policy cycle: the generator refuses a README proof itself", () => {
  test("a loader that returns the frozen proofs still leaves README-only rows unclaimed", async () => {
    const { proposal, lookups } = await generateAndValidate({
      leakProofs: true,
    });
    // The leaked proofs reach the observer, and the observer returns them.
    expect(lookups.some((lookup) => lookup.prior)).toBe(true);
    for (const row of proposal.allocations) {
      expect(row.wallet).toEqual(registry.get(row.actor.id) ?? null);
      if (!registry.has(row.actor.id)) expect(row.state).toBe("unclaimed");
    }
  }, 30_000);

  test("an above-minimum README-only row is never proposed", () => {
    const build = () => {
      const proposal = createRewardCycleProposal({
        // A funded cycle, so rows reach the minimum transfer.
        fundingBasis: {
          ...FROZEN.fundingBasis,
          cycleId: "2026-09",
          fundingState: "committed",
          committedMinor: "5000000000",
          monthlyCapMinor: "5000000000",
          // A syntactically valid test instrument; no chain is read.
          instrumentId: `squads-v4-vault:solana:${WALLET}:0:${WALLET}`,
        } as NonNullable<RewardAllocationManifest["fundingBasis"]>,
        cycleId: "2026-09",
        generatedAt: FROZEN.generatedAt,
        projectId: "eliza",
        snapshot: JSON.parse(SNAPSHOT_BYTES.toString("utf8")),
        sourceSnapshotSha256: createHash("sha256")
          .update(SNAPSHOT_BYTES)
          .digest("hex"),
        wallets: new Map<string, WalletProof>([
          ...readmeOnly.map((actorId) => {
            const proof = frozenProofs.get(actorId);
            if (!proof) throw new Error(`no frozen proof for ${actorId}`);
            return [actorId, proof] as const;
          }),
          ...registry,
        ]),
      });
      if (proposal.kind !== "reward-allocation")
        throw new TypeError("expected a reward allocation");
      return proposal;
    };
    const minimum = BigInt(FROZEN.minimumTransferMinor ?? "0");
    const above = (proposal: RewardAllocationManifest) =>
      proposal.allocations.filter(
        (row) =>
          readmeOnly.includes(row.actor.id) &&
          BigInt(row.accruedMinor ?? row.suggestedMinor) >= minimum,
      );

    useFixture(true);
    const fresh = build();
    expect(above(fresh).length).toBeGreaterThan(0);
    for (const row of fresh.allocations) {
      if (readmeOnly.includes(row.actor.id)) {
        expect(row.wallet).toBeNull();
        expect(row.state).toBe("unclaimed");
      }
      if (row.state === "proposed")
        expect(row.wallet && "sourceCommit" in row.wallet).toBe(false);
    }
    // An actor-bound claim above the minimum is still proposed.
    expect(
      fresh.allocations.some(
        (row) => registry.has(row.actor.id) && row.state === "proposed",
      ),
    ).toBe(true);

    // The same inputs in a normal cycle propose the frozen README proofs.
    useFixture(false);
    const normal = build();
    for (const row of above(normal)) {
      expect(row.state).toBe("proposed");
      expect(row.wallet).toEqual(frozenProofs.get(row.actor.id) ?? null);
    }
  });
});

describe("fresh-policy cycle: validation rejects a README wallet", () => {
  test("a pinned legacy proof is rejected in a fresh-policy cycle and accepted in a normal one", async () => {
    const { proposal: fresh } = await generateAndValidate();
    await expect(
      validate(withWallet(fresh, PIN.actorId, PIN.wallet)),
    ).rejects.toThrow(FRESH_REASON(PIN.actorId));

    const { proposal: normal } = await generateAndValidate({ fresh: false });
    await validate(withWallet(normal, PIN.actorId, PIN.wallet));
  }, 60_000);

  test("the exact frozen prior proof is rejected in a fresh-policy cycle", async () => {
    const { proposal } = await generateAndValidate();
    const [actorId] = readmeOnly;
    const proof = frozenProofs.get(actorId);
    if (!proof) throw new Error("no frozen proof");
    const tampered = withWallet(proposal, actorId, proof);
    // In the fresh mode a reviewed prior record does not bind the proof.
    expect(() =>
      assertAllocationsMatchBaseline(tampered, proposal, frozenProofs),
    ).toThrow(FRESH_REASON(actorId));
    // Through the full validation the fresh loader gives no prior proof.
    await expect(validate(tampered)).rejects.toThrow(actorId);
    // In a normal cycle the same frozen proof is bound to the actor id.
    useFixture(false);
    assertAllocationsMatchBaseline(tampered, proposal, frozenProofs);
  }, 30_000);
});

describe("fresh-policy cycle: the payment import skips a README wallet", () => {
  // A preparation row, so the import has one README row in every mode.
  const PREPARATION = {
    actor: { id: "U_kgDOAA9CPw", login: "prep-actor" },
    wallet: {
      address: "Cr8wzyr222pyjHpQorndcZBeUDH8LP1x3MnbcuNSd3zH",
      chain: "solana",
      observedAt: new Date(Date.UTC(2026, 8, 1)).toISOString(),
      sourceCommit: SHA,
      sourceUrl: `https://github.com/prep-actor/prep-actor/blob/${SHA}/README.md`,
    },
  };

  function importRun(proposal: RewardAllocationManifest) {
    const root = mkdtempSync(join(tmpdir(), "slop-fresh-import-"));
    try {
      mkdirSync(join(root, "funding/preparations"), { recursive: true });
      mkdirSync(join(root, "cycles/eliza/2026-08"), { recursive: true });
      mkdirSync(join(root, "cycles/eliza/2026-09"), { recursive: true });
      writeFileSync(
        join(root, "funding/preparations/fixture.json"),
        JSON.stringify({ contributors: [PREPARATION] }),
      );
      // The reviewed prior manifest froze every proof of the fixture.
      writeFileSync(
        join(root, "cycles/eliza/2026-08/allocation.json"),
        JSON.stringify({
          allocations: [
            ...scored.map((row) => ({
              actor: row.actor,
              wallet: frozenProofs.get(row.actor.id),
            })),
            { actor: CARRIED, wallet: frozenProofs.get(CARRIED.id) },
          ],
        }),
      );
      writeFileSync(
        join(root, "cycles/eliza/2026-09/source-snapshot.json"),
        SNAPSHOT_BYTES,
      );
      writeFileSync(
        join(root, "cycles/eliza/2026-09/proposal.json"),
        JSON.stringify(proposal),
      );
      const skipped: string[] = [];
      const sql = walletObservationsSql(
        root,
        new Date(Date.UTC(2026, 9, 14)).toISOString(),
        (message) => skipped.push(message),
      );
      return { sql, skipped };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("frozen and pinned README rows are not imported in a fresh-policy cycle", async () => {
    // The README rows that a normal cycle holds: every frozen proof, and the
    // legacy pin on its actor.
    const { proposal: normal } = await generateAndValidate({ fresh: false });
    const proposal = withWallet(normal, PIN.actorId, PIN.wallet);
    const readmeRows = proposal.allocations.filter(
      (row) => row.wallet && "sourceCommit" in row.wallet,
    );
    expect(readmeRows.length).toBeGreaterThan(1);

    useFixture(true);
    const fresh = importRun(proposal);
    expect(fresh.sql).not.toContain(WALLET);
    expect(fresh.sql).not.toContain(PIN.wallet.address);
    expect(fresh.skipped).toHaveLength(readmeRows.length);
    for (const row of readmeRows)
      expect(fresh.skipped.join("\n")).toContain(FRESH_REASON(row.actor.id));
    // The rest of the import still runs (PAY-07).
    expect(fresh.sql).toContain(PREPARATION.wallet.address);

    // A normal cycle imports the same rows.
    useFixture(false);
    const normalRun = importRun(proposal);
    expect(normalRun.skipped).toEqual([]);
    expect(normalRun.sql).toContain(WALLET);
    expect(normalRun.sql).toContain(PIN.wallet.address);
  }, 60_000);
});

describe("normal cycle: frozen README proofs are unchanged", () => {
  test("README-only rows keep the frozen proof and the carry is kept", async () => {
    const { proposal, lookups, loaderCalls } = await generateAndValidate({
      fresh: false,
    });
    expect(loaderCalls).toEqual([false, false]);
    for (const lookup of lookups)
      expect(lookup.prior).toEqual(frozenProofs.get(lookup.actorId));
    const carriedRow = proposal.allocations.find(
      (row) => row.actor.id === CARRIED.id,
    );
    expect(carriedRow?.accruedMinor).toBe("3000000");
    expect(carriedRow?.wallet).toEqual(frozenProofs.get(CARRIED.id));
    for (const row of proposal.allocations)
      expect(row.wallet).toEqual(
        registry.get(row.actor.id) ?? frozenProofs.get(row.actor.id) ?? null,
      );
  }, 30_000);
});
