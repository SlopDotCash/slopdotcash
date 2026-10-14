// A renamed actor must keep its earnings and its claim, must not stop the
// cycle, and no other account may receive its award (PRD ACC-01,
// docs/base-solana-payout-plan.md "Rename account and preserve earnings").
// A README proof has no actor id, and the login of any row (the snapshot login
// of a scored row, the prior-manifest login of a carried row) can belong to
// another account after a rename. So any row may keep only the README proof
// that the reviewed prior manifest froze for the same actor id (or a pinned
// legacy proof), or use an actor-bound registry claim. These tests run the
// wallet observation through proposal validation and the payment import.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import {
  cycleWalletObserver,
  walletObservationRequests,
} from "./prepare-reward-cycle";
import { loadPriorCycleAccrual } from "./prior-cycle-accrual";
import {
  LEGACY_README_PROOFS,
  priorReadmeProofs,
} from "./readme-proof-binding";
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

interface ExtraActor {
  actorId: string;
  login: string;
  accruedMinor: string;
}

/**
 * Regenerates the frozen cycle with one carried accrual for actor 123456 (and
 * `extra` carried accruals). `wallets` sets or replaces observed wallets.
 */
function propose(
  wallet: WalletProof | null,
  options: {
    extra?: ExtraActor[];
    wallets?: [string, WalletProof][];
  } = {},
): RewardAllocationManifest {
  const extra = options.extra ?? [];
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
    priorAccruedMinor: new Map([
      [NODE, CARRIED_MINOR],
      ...extra.map((actor) => [actor.actorId, actor.accruedMinor] as const),
    ]),
    // The prior manifest recorded the login the actor had then.
    priorActorLogins: new Map([
      [NODE, "alice"],
      ...extra.map((actor) => [actor.actorId, actor.login] as const),
    ]),
    // Every other recipient keeps the wallet frozen in the cycle.
    wallets: new Map([
      ...FROZEN.allocations.flatMap((row) =>
        row.wallet ? [[row.actor.id, row.wallet] as const] : [],
      ),
      ...(wallet ? [[NODE, wallet] as const] : []),
      ...(options.wallets ?? []),
    ]),
  });
  if (proposal.kind !== "reward-allocation")
    throw new TypeError("expected a reward allocation");
  return proposal;
}

interface PriorRow {
  actor: { id: string; login: string };
  wallet: WalletProof | null;
}

/**
 * Runs the payment import over a repository that holds `proposal`, its frozen
 * source snapshot, and a prior manifest that records actor 123456 as "alice"
 * (plus `extraPrior` rows). Returns the SQL and the rows it did not import.
 */
function importRun(
  proposal: unknown,
  priorWallet: WalletProof | null = null,
  extraPrior: PriorRow[] = [],
): { sql: string; skipped: string[] } {
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
        ...extraPrior,
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
  try {
    const sql = walletObservationsSql(
      root,
      "Tue 2026-10-13 3:00 AM EEST (UTC+03:00)",
      (message) => skipped.push(message),
    );
    return { sql, skipped };
  } finally {
    // Each repository copy holds the frozen snapshot (about 7 MB).
    rmSync(root, { recursive: true, force: true });
  }
}

const importSql = (
  proposal: unknown,
  priorWallet: WalletProof | null = null,
  extraPrior: PriorRow[] = [],
) => importRun(proposal, priorWallet, extraPrior).sql;

/** The import does not emit `address` and reports `reason` for the row. */
function expectNotImported(
  proposal: unknown,
  priorWallet: WalletProof | null,
  address: string,
  reason: string,
  extraPrior: PriorRow[] = [],
) {
  const { sql, skipped } = importRun(proposal, priorWallet, extraPrior);
  expect(sql).not.toContain(address);
  expect(skipped.join("\n")).toContain(reason);
  // Every other README row of the cycle is still imported (PAY-07).
  expect(sql).toContain("INSERT INTO wallet_observations");
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

/** The observation of actor 123456 ("alice"), as the generator runs it. */
const observeCarried = (
  fetchImpl: typeof fetch,
  priorWallet: WalletProof | null,
) =>
  fetchPublishedGithubWallet(NODE, "alice", FROZEN.generatedAt, {
    fetch: fetchImpl,
    prior: { readmeProof: priorWallet },
  });

/** Validation of `proposal` against the honest regeneration. */
const validate = (
  proposal: RewardAllocationManifest,
  priorWallet: WalletProof | null = null,
  extraPrior: PriorRow[] = [],
  baseline: RewardAllocationManifest = propose(null),
) =>
  assertAllocationsMatchBaseline(
    proposal,
    baseline,
    priorReadmeProofs({
      allocations: [
        { actor: { id: NODE, login: "alice" }, wallet: priorWallet },
        ...extraPrior,
      ],
    }),
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

const NEW_README = (actorId: string) =>
  `README wallet of ${actorId} is new; only an actor-bound claim or a frozen prior proof is accepted`;
const NOT_FROZEN = (actorId: string) =>
  `README wallet of ${actorId} is not the proof that the prior manifest froze for it`;

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
    expect(() => validate(tampered, null)).toThrow(NEW_README(NODE));
    expectNotImported(tampered, null, NEW_ACCOUNT_WALLET, NEW_README(NODE));
  });

  test("a carried row with a frozen proof cannot swap the address", () => {
    const tampered = propose(FROZEN_PROOF);
    carried(tampered).wallet = { ...FROZEN_PROOF, address: ATTACKER_WALLET };
    expect(() => validate(tampered, FROZEN_PROOF)).toThrow(NOT_FROZEN(NODE));
    expectNotImported(
      tampered,
      FROZEN_PROOF,
      ATTACKER_WALLET,
      NOT_FROZEN(NODE),
    );
  });

  test("a carried row with a frozen proof cannot swap in a new README commit", () => {
    const tampered = propose(FROZEN_PROOF);
    carried(tampered).wallet = readmeProof("alice", NEW_ACCOUNT_WALLET);
    expect(() => validate(tampered, FROZEN_PROOF)).toThrow(NOT_FROZEN(NODE));
    expectNotImported(
      tampered,
      FROZEN_PROOF,
      NEW_ACCOUNT_WALLET,
      NOT_FROZEN(NODE),
    );
  });

  test("an honest newly published README on a carried row is also refused", () => {
    // Offline, this is the same bytes as the reviewer's case with the actor's
    // own address: nothing binds the README owner to the actor id.
    const tampered = propose(readmeProof("alice", ACTOR_WALLET));
    expect(() => validate(tampered, null)).toThrow(NEW_README(NODE));
    const { sql, skipped } = importRun(tampered, null);
    expect(sql).not.toContain(`'${NODE}'`);
    expect(skipped.join("\n")).toContain(NEW_README(NODE));
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

  test("every lookup, scored or carried, carries the frozen prior README proof", () => {
    const leader = FROZEN.allocations.find((row) => row.score > 0);
    if (!leader) throw new Error("no scored row");
    const leaderProof = readmeProof(leader.actor.login, ACTOR_WALLET);
    const prior = {
      actorLogins: new Map([
        [NODE, "alice"],
        [leader.actor.id, leader.actor.login],
      ]),
      accruedMinor: new Map([
        [NODE, CARRIED_MINOR],
        [leader.actor.id, "1"],
      ]),
      actorReadmeProofs: new Map([
        [NODE, FROZEN_PROOF],
        [leader.actor.id, leaderProof],
      ]),
    };
    expect(walletObservationRequests([{ actor: leader.actor }], prior)).toEqual(
      [
        {
          actorId: leader.actor.id,
          login: leader.actor.login,
          // Review at 4242238 (P2): a scored actor lost its frozen proof here.
          prior: { readmeProof: leaderProof },
        },
        { actorId: NODE, login: "alice", prior: { readmeProof: FROZEN_PROOF } },
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
  test("without the generator's prior option (funding preparations), the live README is read", async () => {
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
      expectNotImported(
        tampered,
        null,
        ATTACKER_WALLET,
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
    expectNotImported(
      tampered,
      null,
      ATTACKER_WALLET,
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

// Review of #676 at 4242238 (powermsn 5511384508).
const unclaimedLeader = () => {
  const row = propose(null).allocations.find(
    (allocation) => allocation.score > 0 && allocation.state === "unclaimed",
  );
  if (!row) throw new Error("no unclaimed scored row");
  return row;
};

describe("scored rows: the same README binding as carried rows", () => {
  // High: the actor renamed after the snapshot and another account took the
  // snapshot login. The edit keeps the frozen actor id and snapshot login and
  // adds the new owner's README under that login.
  test("the reviewer's case: same-login README added to an unclaimed scored row", () => {
    const victim = unclaimedLeader();
    const tampered = propose(null);
    const row = tampered.allocations.find(
      (allocation) => allocation.intentId === victim.intentId,
    );
    if (!row) throw new Error("row is missing");
    row.wallet = readmeProof(victim.actor.login, NEW_ACCOUNT_WALLET);
    row.state = "proposed";
    expect(row.actor).toEqual(victim.actor);
    expect(() => assertRewardAllocationManifest(tampered)).not.toThrow();
    expect(() => validate(tampered)).toThrow(NEW_README(victim.actor.id));
    expectNotImported(
      tampered,
      null,
      NEW_ACCOUNT_WALLET,
      NEW_README(victim.actor.id),
    );
  });

  test("a scored row keeps the exact frozen prior proof", () => {
    const leader = unclaimedLeader();
    const proof = readmeProof(leader.actor.login, ACTOR_WALLET);
    const priorRows = [{ actor: leader.actor, wallet: proof }];
    const proposal = propose(null, { wallets: [[leader.actor.id, proof]] });
    expect(() => validate(proposal, null, priorRows)).not.toThrow();
    expect(importSql(proposal, null, priorRows)).toContain(ACTOR_WALLET);
  });

  test("a scored row with a frozen prior proof cannot swap in another README", () => {
    const leader = unclaimedLeader();
    const proof = readmeProof(leader.actor.login, ACTOR_WALLET);
    const priorRows = [{ actor: leader.actor, wallet: proof }];
    const proposal = propose(null, {
      wallets: [[leader.actor.id, { ...proof, address: NEW_ACCOUNT_WALLET }]],
    });
    expect(() => validate(proposal, null, priorRows)).toThrow(
      NOT_FROZEN(leader.actor.id),
    );
    expectNotImported(
      proposal,
      null,
      NEW_ACCOUNT_WALLET,
      NOT_FROZEN(leader.actor.id),
      priorRows,
    );
  });

  test("the generator reads no new README for a scored actor, even with an unchanged login", async () => {
    const { fetchImpl, requests } = world({
      current: "alice",
      registry: false,
    });
    // The default observer of prepareRewardCycle, with the lookup that
    // walletObservationRequests builds for a scored actor with no prior proof.
    const observeDefault = cycleWalletObserver({
      chain: "solana",
      fetch: fetchImpl,
    });
    expect(
      await observeDefault(NODE, "alice", FROZEN.generatedAt, {
        readmeProof: null,
      }),
    ).toBeNull();
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
  });

  test("a pinned legacy proof is bound to its actor id, not to its login", () => {
    // A carried actor whose stale recorded login equals the login of a pinned
    // proof cannot take that pinned proof.
    const [pin] = LEGACY_README_PROOFS.filter(
      (entry) => entry.projectId === "eliza" && entry.cycleId === "2026-09",
    );
    const login = /github\.com\/([^/]+)\//u.exec(pin.wallet.sourceUrl)?.[1];
    if (!login) throw new Error("pin has no login");
    const OTHER = "U_kgDOAAAAAQ";
    const extra = [{ actorId: OTHER, login, accruedMinor: CARRIED_MINOR }];
    const proposal = propose(null, { extra, wallets: [[OTHER, pin.wallet]] });
    expect(() =>
      validate(proposal, null, [], propose(null, { extra })),
    ).toThrow(NEW_README(OTHER));
  });

  test("legacy proofs are pinned: each existing one passes, a moved or edited one does not", () => {
    expect(LEGACY_README_PROOFS).toHaveLength(7);
    // Every README row merged before this rule is pinned, and validation of
    // the merged cycle accepts it (cycles:check runs the real cycles).
    const pinned = LEGACY_README_PROOFS.filter(
      (pin) => pin.projectId === "eliza" && pin.cycleId === "2026-09",
    );
    expect(pinned).toHaveLength(4);
    expect(() => validate(propose(null))).not.toThrow();
    const [pin] = pinned;
    // The same proof on another actor of the cycle.
    const leader = unclaimedLeader();
    const moved = propose(null, {
      wallets: [
        [
          leader.actor.id,
          {
            ...pin.wallet,
            sourceUrl: pin.wallet.sourceUrl.replaceAll(
              /github\.com\/[^/]+\/[^/]+\//gu,
              `github.com/${leader.actor.login}/${leader.actor.login}/`,
            ),
          },
        ],
      ],
    });
    expect(() => validate(moved)).toThrow(NEW_README(leader.actor.id));
    // The pinned row with another address.
    const edited = propose(null, {
      wallets: [[pin.actorId, { ...pin.wallet, address: ATTACKER_WALLET }]],
    });
    expect(() => validate(edited)).toThrow(NEW_README(pin.actorId));
  });
});

describe("a renamed actor who scores again keeps the frozen README proof (P2)", () => {
  test("the frozen proof is kept and the new owner of the old login is not read", async () => {
    // Actor 123456 was "alice" in the prior manifest and in this snapshot;
    // it renamed after the snapshot, and account 999999 took "alice".
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    expect(await observeCarried(fetchImpl, FROZEN_PROOF)).toEqual(FROZEN_PROOF);
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
  });

  test("a scored-again row with the kept proof passes validation and import", () => {
    const leader = unclaimedLeader();
    const proof = readmeProof(leader.actor.login, ACTOR_WALLET);
    const priorRows = [{ actor: leader.actor, wallet: proof }];
    const proposal = propose(null, { wallets: [[leader.actor.id, proof]] });
    const row = proposal.allocations.find(
      (allocation) => allocation.actor.id === leader.actor.id,
    );
    expect(row?.wallet).toEqual(proof);
    expect(row?.state).not.toBe("unclaimed");
    expect(() => validate(proposal, null, priorRows)).not.toThrow();
    const { sql, skipped } = importRun(proposal, null, priorRows);
    expect(skipped).toEqual([]);
    expect(sql).toContain(ACTOR_WALLET);
  });

  test("a frozen proof under a login other than the snapshot login is not reused", async () => {
    // Renamed before the snapshot: the row login is the new login, so the
    // old-login proof cannot be bound to the row; the row stays unclaimed.
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const wallet = await fetchPublishedGithubWallet(
      NODE,
      "alice-new",
      FROZEN.generatedAt,
      { fetch: fetchImpl, prior: { readmeProof: FROZEN_PROOF } },
    );
    expect(wallet).toBeNull();
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);
  });
});

describe("cross-project: a leader of another project only is carried here (P1)", () => {
  // U_kgDOEtGEfg is a leader of asi in this snapshot, not of eliza. In eliza
  // it is carried with its prior-manifest login, which differs from the
  // global snapshot login after a rename.
  const OTHER = "U_kgDOEtGEfg";
  const OLD_LOGIN = "tokenmaxxor-old";
  const proof = readmeProof(OLD_LOGIN, ACTOR_WALLET);
  const extra = [
    { actorId: OTHER, login: OLD_LOGIN, accruedMinor: CARRIED_MINOR },
  ];
  const priorRows = [{ actor: { id: OTHER, login: OLD_LOGIN }, wallet: proof }];

  test("the global leader list does not change the carried login", () => {
    const snapshot = JSON.parse(SNAPSHOT_BYTES.toString("utf8"));
    expect(
      snapshot.leaders.some(
        (leader: { actor: { id: string } }) => leader.actor.id === OTHER,
      ),
    ).toBe(true);
    const proposal = propose(null, { extra, wallets: [[OTHER, proof]] });
    const row = proposal.allocations.find(
      (allocation) => allocation.actor.id === OTHER,
    );
    expect(row).toMatchObject({
      actor: { id: OTHER, login: OLD_LOGIN },
      state: "proposed",
      wallet: proof,
    });
    expect(() =>
      validate(proposal, null, priorRows, propose(null, { extra })),
    ).not.toThrow();
    const { sql, skipped } = importRun(proposal, null, priorRows);
    expect(skipped).toEqual([]);
    expect(sql).toContain(`'${OTHER}','${OLD_LOGIN}'`);
  });

  test("one bad row is skipped; every other row is still imported (PAY-07)", () => {
    const proposal = propose(null, {
      extra,
      wallets: [[OTHER, { ...proof, address: ATTACKER_WALLET }]],
    });
    const { sql, skipped } = importRun(proposal, null, priorRows);
    expect(sql).not.toContain(ATTACKER_WALLET);
    expect(skipped).toHaveLength(1);
    // The pinned legacy rows of the cycle are imported.
    for (const pin of LEGACY_README_PROOFS.filter(
      (entry) => entry.projectId === "eliza" && entry.cycleId === "2026-09",
    ))
      expect(sql).toContain(pin.wallet.address);
  });
});

describe("a fresh-policy cycle keeps the frozen prior README proofs", () => {
  test("generation and validation load the proofs without the carry", async () => {
    const prior = await loadPriorCycleAccrual({
      asOf: "2026-11-01T00:00:00.000Z",
      cycleId: "2026-10",
      cyclesRoot: join(import.meta.dir, "../cycles"),
      projectId: "eliza",
      freshPolicy: true,
    });
    expect(prior.accruedMinor.size).toBe(0);
    expect(prior.actorLogins.size).toBe(0);
    expect(prior.actorReadmeProofs?.size).toBeGreaterThan(0);
    expect(prior.actorReadmeProofs).toEqual(priorReadmeProofs(FROZEN));
  });
});
