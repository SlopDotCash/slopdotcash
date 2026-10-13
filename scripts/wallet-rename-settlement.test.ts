// A renamed actor must keep its earnings and its claim, must not stop the
// cycle, and no other account may receive its award (PRD ACC-01,
// docs/base-solana-payout-plan.md "Rename account and preserve earnings").
// A README proof has no actor id. A scored row binds it to the snapshot login
// of this cycle. A carried row (prior accrual, no score) has only the login of
// the prior manifest, and that login can now belong to another account. So a
// carried row may keep only the README proof that the reviewed prior manifest
// froze for the same actor id, or use an actor-bound registry claim. These
// tests run the wallet observation through proposal validation and the
// payment import.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
  type WalletProof,
} from "../src/lib/rewards";
import { fetchPublishedGithubWallet } from "./github-wallets";
import { walletObservationsSql } from "./prepare-payments-import";
import { walletObservationRequests } from "./prepare-reward-cycle";
import { carriedPriorWallets } from "./prior-cycle-accrual";
import { assertAllocationsMatchBaseline } from "./sync-cycle-index";

// A frozen monthly-pool cycle is the base; one carried accrual is added.
const CYCLE_DIR = join(import.meta.dir, "../cycles/eliza/2026-09");
const SNAPSHOT_BYTES = readFileSync(join(CYCLE_DIR, "source-snapshot.json"));
const FROZEN = JSON.parse(
  readFileSync(join(CYCLE_DIR, "proposal.json"), "utf8"),
) as RewardAllocationManifest;

const NODE = "U_kgDOAAHiQA"; // actor 123456, recorded as "alice", now "alice-new"
const NEW_ACCOUNT_NODE = "U_kgDOAA9CPw"; // actor 999999, took the free "alice"
const CARRIED_MINOR = "3000000";
const ACTOR_WALLET = "4Nd1mBQtrMJVYVfKf2PJy9NZUse8sLfY4Yt9JZ7bW6Lx";
const NEW_ACCOUNT_WALLET = "Cr8wzyr222pyjHpQorndcZBeUDH8LP1x3MnbcuNSd3zH";
const ATTACKER_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SHA = "c".repeat(40);
const API = "https://api.github.com";
const REGISTRY =
  "https://api.slop.cash/api/v1/wallet-claims/actors/123456/current";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const readme = (address: string) =>
  Buffer.from(
    `# me\n<!-- slop-wallet:v1 {"address":"${address}","chain":"solana"} -->\n`,
  ).toString("base64");

/**
 * GitHub as seen by the observer. `current` is the login of actor 123456 now.
 * When it is not "alice", account 999999 holds "alice" and publishes its own
 * wallet in its profile README. Each README contains its owner's wallet.
 */
function world(options: {
  current: string;
  registry: boolean;
  claimActorId?: string;
  actorReadme?: string | null;
}) {
  const requests: string[] = [];
  const readmes = new Map<string, string>();
  if (options.actorReadme !== null)
    readmes.set(options.current, options.actorReadme ?? ACTOR_WALLET);
  if (options.current !== "alice") readmes.set("alice", NEW_ACCOUNT_WALLET);
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === `${API}/user/123456`)
      return json(200, { id: 123456, node_id: NODE, login: options.current });
    if (url === REGISTRY)
      return options.registry
        ? json(200, {
            schemaVersion: 1,
            claimId: "c1",
            githubActorId: options.claimActorId ?? "123456",
            githubLogin: "alice",
            address: ACTOR_WALLET,
            chain: "solana",
            source: "d1_registry",
            sourceBodySha256: "a".repeat(64),
            observedAt: "2026-09-01T00:00:00.000Z",
            recordDigest: "b".repeat(64),
          })
        : json(404, { message: "Not Found" });
    for (const [login, address] of readmes) {
      const repo = `${API}/repos/${login}/${login}`;
      if (url === `${repo}/readme`) return json(200, { path: "README.md" });
      if (url === `${repo}/commits?path=README.md&per_page=1`)
        return json(200, [{ sha: SHA }]);
      if (url === `${repo}/contents/README.md?ref=${SHA}`)
        return json(200, {
          type: "file",
          path: "README.md",
          encoding: "base64",
          content: readme(address),
        });
    }
    return json(404, { message: "Not Found" });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

/** Regenerates the frozen cycle with one carried accrual for actor 123456. */
function propose(wallet: WalletProof | null): RewardAllocationManifest {
  const proposal = createRewardCycleProposal({
    ...(FROZEN.fundingBasis
      ? { fundingBasis: FROZEN.fundingBasis }
      : { legacyCapMinor: FROZEN.capMinor }),
    cycleId: FROZEN.cycleId,
    generatedAt: FROZEN.generatedAt,
    projectId: FROZEN.projectId,
    snapshot: JSON.parse(SNAPSHOT_BYTES.toString("utf8")),
    sourceSnapshotSha256: createHash("sha256")
      .update(SNAPSHOT_BYTES)
      .digest("hex"),
    priorAccruedMinor: new Map([[NODE, CARRIED_MINOR]]),
    // The prior manifest recorded the login the actor had then.
    priorActorLogins: new Map([[NODE, "alice"]]),
    // Every other recipient keeps the wallet frozen in the cycle.
    wallets: new Map([
      ...FROZEN.allocations.flatMap((row) =>
        row.wallet ? [[row.actor.id, row.wallet] as const] : [],
      ),
      ...(wallet ? [[NODE, wallet] as const] : []),
    ]),
  });
  if (proposal.kind !== "reward-allocation")
    throw new TypeError("expected a reward allocation");
  return proposal;
}

/**
 * Runs the payment import over a repository that holds `proposal`, its frozen
 * source snapshot, and a prior manifest that records actor 123456 as "alice".
 */
function importSql(
  proposal: unknown,
  priorWallet: WalletProof | null = null,
): string {
  const root = mkdtempSync(join(tmpdir(), "slop-676-"));
  mkdirSync(join(root, "funding/preparations"), { recursive: true });
  mkdirSync(join(root, "cycles/eliza/2026-08"), { recursive: true });
  mkdirSync(join(root, "cycles/eliza/2026-09"), { recursive: true });
  writeFileSync(
    // The reviewed prior manifest (an approved allocation of 2026-08).
    join(root, "cycles/eliza/2026-08/allocation.json"),
    JSON.stringify({
      allocations: [
        { actor: { id: NODE, login: "alice" }, wallet: priorWallet },
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
  return walletObservationsSql(root, "Tue 2026-10-13 3:00 AM EEST (UTC+03:00)");
}

const carried = (proposal: RewardAllocationManifest) => {
  const row = proposal.allocations.find((a) => a.actor.id === NODE);
  if (!row) throw new Error("carried row is missing");
  return row;
};

const observe = (login: string, fetchImpl: typeof fetch) =>
  fetchPublishedGithubWallet(NODE, login, FROZEN.generatedAt, {
    fetch: fetchImpl,
  });

/** The observation of the carried actor 123456, as the generator runs it. */
const observeCarried = (
  fetchImpl: typeof fetch,
  priorWallet: WalletProof | null,
) =>
  fetchPublishedGithubWallet(NODE, "alice", FROZEN.generatedAt, {
    fetch: fetchImpl,
    carried: { priorWallet },
  });

/** Validation of `proposal` against the honest regeneration. */
const validate = (
  proposal: RewardAllocationManifest,
  priorWallet: WalletProof | null = null,
) =>
  assertAllocationsMatchBaseline(
    proposal,
    propose(null),
    new Map([[NODE, priorWallet]]),
  );

/** The README proof that the reviewed prior manifest froze for "alice". */
const FROZEN_PROOF: WalletProof = {
  address: ACTOR_WALLET,
  chain: "solana",
  observedAt: new Date(Date.UTC(2026, 8, 1, 0, 0)).toISOString(),
  sourceCommit: "d".repeat(40),
  sourceUrl: `https://github.com/alice/alice/blob/${"d".repeat(40)}/README.md`,
};

const readmeProof = (login: string, address: string) => ({
  address,
  chain: "solana" as const,
  observedAt: FROZEN.generatedAt,
  sourceCommit: SHA,
  sourceUrl: `https://github.com/${login}/${login}/blob/${SHA}/README.md`,
});

/**
 * Changes the login, the README URL and the address of one row together to
 * another account, so the row is self-consistent.
 */
function retarget(
  proposal: RewardAllocationManifest,
  actorId: string,
  login: string,
  address: string,
): RewardAllocationManifest {
  const tampered = structuredClone(proposal);
  const row = tampered.allocations.find((a) => a.actor.id === actorId);
  if (!row) throw new Error("row is missing");
  row.actor.login = login;
  row.wallet = readmeProof(login, address);
  row.state = "proposed";
  return tampered;
}

const ADDS_README = "adds a README wallet to a carried row";
const IMPORT_NOT_FROZEN = `README wallet of carried actor ${NODE} is not its frozen prior proof`;

describe("a reused frozen login never redirects a carried award", () => {
  // Review of #676 at 3618c36: actor 123456 renamed from "alice"; account
  // 999999 took "alice". An edited proposal keeps the victim id and the stale
  // frozen login, adds the new owner's README and address, and flips the row
  // from unclaimed to proposed.
  test("the reviewer's case: stale frozen login with the new owner's README", () => {
    const honest = propose(null);
    expect(carried(honest).state).toBe("unclaimed");
    const tampered = structuredClone(honest);
    const row = carried(tampered);
    row.wallet = readmeProof("alice", NEW_ACCOUNT_WALLET);
    row.state = "proposed";
    expect(row.actor).toEqual({ id: NODE, login: "alice" });
    expect(() => validate(tampered, null)).toThrow(ADDS_README);
    expect(() => importSql(tampered, null)).toThrow(IMPORT_NOT_FROZEN);
  });

  test("a carried row with a frozen proof cannot swap the address", () => {
    const tampered = propose(FROZEN_PROOF);
    carried(tampered).wallet = { ...FROZEN_PROOF, address: ATTACKER_WALLET };
    expect(() => validate(tampered, FROZEN_PROOF)).toThrow(ADDS_README);
    expect(() => importSql(tampered, FROZEN_PROOF)).toThrow(IMPORT_NOT_FROZEN);
  });

  test("a carried row with a frozen proof cannot swap in a new README commit", () => {
    const tampered = propose(FROZEN_PROOF);
    carried(tampered).wallet = readmeProof("alice", NEW_ACCOUNT_WALLET);
    expect(() => validate(tampered, FROZEN_PROOF)).toThrow(ADDS_README);
    expect(() => importSql(tampered, FROZEN_PROOF)).toThrow(IMPORT_NOT_FROZEN);
  });

  test("an honest newly published README on a carried row is also refused", () => {
    // Offline, this is the same bytes as the reviewer's case with the actor's
    // own address: nothing binds the README owner to the actor id.
    const tampered = propose(readmeProof("alice", ACTOR_WALLET));
    expect(() => validate(tampered, null)).toThrow(ADDS_README);
    expect(() => importSql(tampered, null)).toThrow(IMPORT_NOT_FROZEN);
  });

  test("proposed without any wallet is refused", () => {
    const tampered = propose(null);
    carried(tampered).state = "proposed";
    expect(() => assertRewardAllocationManifest(tampered)).toThrow(
      "proposed payment needs a wallet observation",
    );
  });

  test("the exact frozen proof is carried and accepted", () => {
    const proposal = propose(FROZEN_PROOF);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice" },
      state: "proposed",
      wallet: FROZEN_PROOF,
    });
    expect(() => validate(proposal, FROZEN_PROOF)).not.toThrow();
    const sql = importSql(proposal, FROZEN_PROOF);
    expect(sql).toContain(`'123456','${NODE}','alice','solana'`);
    expect(sql).toContain(ACTOR_WALLET);
    expect(sql).not.toContain(NEW_ACCOUNT_WALLET);
  });

  test("dropping the frozen proof is accepted: the row stays unclaimed", () => {
    const proposal = propose(null);
    expect(carried(proposal).state).toBe("unclaimed");
    expect(() => validate(proposal, FROZEN_PROOF)).not.toThrow();
    expect(importSql(proposal, FROZEN_PROOF)).not.toContain("'123456'");
  });

  test("the carried set is the prior accrual minus scored actors", () => {
    const leader = FROZEN.allocations.find((row) => row.score > 0);
    if (!leader) throw new Error("no scored row");
    const prior = {
      actorLogins: new Map([
        [NODE, "alice"],
        [leader.actor.id, leader.actor.login],
      ]),
      accruedMinor: new Map([
        [NODE, CARRIED_MINOR],
        [leader.actor.id, "1"],
      ]),
      actorWallets: new Map([[NODE, FROZEN_PROOF]]),
    };
    const map = carriedPriorWallets(prior, new Set([leader.actor.id]));
    expect([...map]).toEqual([[NODE, FROZEN_PROOF]]);
    expect(walletObservationRequests([{ actor: leader.actor }], prior)).toEqual(
      [
        { actorId: leader.actor.id, login: leader.actor.login },
        {
          actorId: NODE,
          login: "alice",
          carried: { priorWallet: FROZEN_PROOF },
        },
      ],
    );
  });
});

describe("renamed carried actor: the claim survives, through proposal and import", () => {
  test("frozen README proof: kept after the rename (ACC-01), new owner never read", async () => {
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const wallet = await observeCarried(fetchImpl, FROZEN_PROOF);
    expect(wallet).toEqual(FROZEN_PROOF);
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
    const proposal = propose(wallet);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice" },
      accruedMinor: CARRIED_MINOR,
      state: "proposed",
      wallet: { address: ACTOR_WALLET },
    });
    expect(() => validate(proposal, FROZEN_PROOF)).not.toThrow();
    expect(importSql(proposal, FROZEN_PROOF)).toContain(ACTOR_WALLET);
  });

  test("no frozen proof, no registry claim: unclaimed, accrual carries, no README read", async () => {
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const wallet = await observeCarried(fetchImpl, null);
    expect(wallet).toBeNull();
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
    const proposal = propose(wallet);
    expect(proposal.allocations).toHaveLength(FROZEN.allocations.length + 1);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice" },
      accruedMinor: CARRIED_MINOR,
      state: "unclaimed",
      wallet: null,
    });
    expect(() => validate(proposal, null)).not.toThrow();
    const sql = importSql(proposal);
    expect(sql).toContain("INSERT INTO wallet_observations");
    expect(sql).not.toContain("'123456'");
    expect(sql).not.toContain(NEW_ACCOUNT_WALLET);
  });

  test("registry claim: payable through the immutable id, with or without a frozen proof", async () => {
    for (const prior of [null, FROZEN_PROOF]) {
      const { fetchImpl } = world({ current: "alice-new", registry: true });
      const wallet = await observeCarried(fetchImpl, prior);
      expect(wallet).toMatchObject({
        address: ACTOR_WALLET,
        sourceActorId: NODE,
      });
      const proposal = propose(wallet);
      expect(carried(proposal)).toMatchObject({
        actor: { id: NODE, login: "alice" },
        state: "proposed",
      });
      expect(() => validate(proposal, prior)).not.toThrow();
      // Registry wallets are already in D1; the README import skips them.
      expect(importSql(proposal, prior)).not.toContain(`'${NODE}','alice'`);
    }
  });
});

describe("carried actor with an unchanged login", () => {
  test("no frozen proof: a newly published README is not read into the row", async () => {
    const { fetchImpl, requests } = world({
      current: "alice",
      registry: false,
    });
    expect(await observeCarried(fetchImpl, null)).toBeNull();
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
  });

  test("frozen proof and the README still publishes it: the frozen proof is kept", async () => {
    const { fetchImpl } = world({ current: "alice", registry: false });
    const wallet = await observeCarried(fetchImpl, FROZEN_PROOF);
    expect(wallet).toEqual(FROZEN_PROOF);
    expect(() => validate(propose(wallet), FROZEN_PROOF)).not.toThrow();
  });

  test("frozen proof but the README now publishes another address: unclaimed", async () => {
    const { fetchImpl } = world({
      current: "alice",
      registry: false,
      actorReadme: ATTACKER_WALLET,
    });
    expect(await observeCarried(fetchImpl, FROZEN_PROOF)).toBeNull();
  });

  test("frozen proof but the README is gone: unclaimed", async () => {
    const { fetchImpl } = world({
      current: "alice",
      registry: false,
      actorReadme: null,
    });
    expect(await observeCarried(fetchImpl, FROZEN_PROOF)).toBeNull();
  });
});

describe("scored rows and changed logins", () => {
  test("a scored row keeps the README fallback under its snapshot login", async () => {
    const { fetchImpl } = world({ current: "alice", registry: false });
    expect(await observe("alice", fetchImpl)).toMatchObject({
      address: ACTOR_WALLET,
      sourceUrl: `https://github.com/alice/alice/blob/${SHA}/README.md`,
    });
  });

  // Review of #676 at e6f73d8: victim "alice" is carried; an edited proposal
  // sets login, README URL and address to "mallory" consistently.
  for (const login of ["mallory", "alice-new"]) {
    test(`a carried row retargeted to "${login}" is rejected by validation and import`, () => {
      const honest = propose(null);
      const tampered = retarget(honest, NODE, login, ATTACKER_WALLET);
      expect(() => validate(tampered, null)).toThrow(
        "differs from its frozen snapshot",
      );
      expect(() => importSql(tampered)).toThrow(
        `README wallet login ${login} is not the frozen login of ${NODE}`,
      );
    });
  }

  test("a scored row retargeted to another account is rejected by validation and import", () => {
    const honest = propose(null);
    const leader = honest.allocations.find((row) => row.score > 0);
    if (!leader) throw new Error("no scored row");
    const tampered = retarget(
      honest,
      leader.actor.id,
      "mallory",
      ATTACKER_WALLET,
    );
    expect(() => validate(tampered, null)).toThrow(
      "differs from its frozen snapshot",
    );
    expect(() => importSql(tampered)).toThrow(
      `README wallet login mallory is not the frozen login of ${leader.actor.id}`,
    );
  });

  test("a README proof is still bound to the recorded login", () => {
    // A current-login README on a row that keeps the stale login.
    expect(() => propose(readmeProof("alice-new", ACTOR_WALLET))).toThrow(
      "must be the actor's immutable GitHub profile README",
    );
  });

  test("a registry claim for a different actor id is rejected", async () => {
    const { fetchImpl } = world({
      current: "alice-new",
      registry: true,
      claimActorId: "999999",
    });
    await expect(observe("alice", fetchImpl)).rejects.toThrow(
      "Slop wallet registry claim is invalid",
    );
  });

  test("a registry proof on a carried row must carry the actor id", () => {
    const tampered = propose(null);
    const row = carried(tampered);
    row.state = "proposed";
    row.wallet = {
      address: ATTACKER_WALLET,
      chain: "solana",
      observedAt: FROZEN.generatedAt,
      sourceActorId: NEW_ACCOUNT_NODE,
      sourceClaimId: "c2",
      sourceRecordSha256: "e".repeat(64),
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/c2",
    };
    expect(() => assertRewardAllocationManifest(tampered)).toThrow(
      "sourceActorId does not match the contributor",
    );
  });

  test("an identity that does not match the immutable id is rejected", async () => {
    for (const identity of [
      { id: 123457, node_id: NODE, login: "alice" },
      { id: 123456, node_id: NEW_ACCOUNT_NODE, login: "alice" },
    ]) {
      const fetchImpl = (async () =>
        json(200, identity)) as unknown as typeof fetch;
      await expect(observe("alice", fetchImpl)).rejects.toThrow(
        "GitHub wallet actor identity changed",
      );
    }
  });
});
