// A renamed actor must keep its earnings and its wallet claim, must not stop
// the cycle, and a new account that takes the old login must receive nothing
// (PRD ACC-01,
// docs/base-solana-payout-plan.md "Rename account and preserve earnings").
// These tests run the wallet observation through proposal validation and the
// payment import, with and without a registry claim.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import type { RewardAllocationManifest, WalletProof } from "../src/lib/rewards";
import { fetchPublishedGithubWallet } from "./github-wallets";
import { walletObservationsSql } from "./prepare-payments-import";
import { carriedActorLogins } from "./prepare-reward-cycle";
import { isRenamedCarriedRow } from "./sync-cycle-index";

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
}) {
  const requests: string[] = [];
  const readmes = new Map<string, string>([[options.current, ACTOR_WALLET]]);
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

/**
 * Regenerates the frozen cycle with one carried accrual for actor 123456.
 * `current` is the login that the observer verified for the immutable id.
 */
function propose(
  wallet: WalletProof | null,
  current?: string,
): RewardAllocationManifest {
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
    priorActorLogins: carriedActorLogins(
      new Map([[NODE, "alice"]]),
      new Map(wallet ? [[NODE, wallet]] : []),
      new Map(current ? [[NODE, current]] : []),
    ),
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

/** Runs the payment import over a repository that holds only `proposal`. */
function importSql(proposal: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "slop-676-"));
  mkdirSync(join(root, "funding/preparations"), { recursive: true });
  mkdirSync(join(root, "cycles/eliza/2026-09"), { recursive: true });
  writeFileSync(
    join(root, "cycles/eliza/2026-09/proposal.json"),
    JSON.stringify(proposal),
  );
  return walletObservationsSql(root, "2026-10-13T00:00:00.000Z");
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

/** Observes as prepare-reward-cycle does for a carried row. */
async function observeCarried(login: string, fetchImpl: typeof fetch) {
  let current: string | undefined;
  const wallet = await fetchPublishedGithubWallet(
    NODE,
    login,
    FROZEN.generatedAt,
    {
      fetch: fetchImpl,
      onCurrentLogin: (value) => {
        current = value;
      },
    },
  );
  return { current, wallet };
}

describe("renamed actor through proposal and payment import", () => {
  test("no registry claim: the README claim under the current login is kept", async () => {
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const { current, wallet } = await observeCarried("alice", fetchImpl);
    expect(current).toBe("alice-new");
    expect(wallet).toMatchObject({
      address: ACTOR_WALLET,
      sourceUrl: `https://github.com/alice-new/alice-new/blob/${SHA}/README.md`,
    });
    // The README of the account that now holds "alice" is never read.
    expect(requests.some((url) => url.startsWith(`${API}/repos/alice/`))).toBe(
      false,
    );

    const proposal = propose(wallet, current);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice-new" },
      accruedMinor: CARRIED_MINOR,
      state: "proposed",
      wallet: { address: ACTOR_WALLET },
    });
    const sql = importSql(proposal);
    expect(sql).toContain(`'123456','${NODE}','alice-new','solana'`);
    expect(sql).toContain(ACTOR_WALLET);
    expect(sql).not.toContain(NEW_ACCOUNT_WALLET);

    // The cycle check accepts the current login only on this carried row.
    const expected = carried(propose(null));
    expect(isRenamedCarriedRow(carried(proposal), expected, "alice")).toBe(
      true,
    );
  });

  test("a caller that does not record the current login gets no README proof", async () => {
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const wallet = await observe("alice", fetchImpl);
    expect(wallet).toBeNull();
    // No profile README is read for a login that is not the recorded one.
    expect(requests.some((url) => url.includes("/repos/"))).toBe(false);

    const proposal = propose(wallet);
    expect(proposal.allocations).toHaveLength(FROZEN.allocations.length + 1);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice" },
      accruedMinor: CARRIED_MINOR,
      state: "unclaimed",
      wallet: null,
    });

    // The import still runs for every other recipient of the cycle.
    const sql = importSql(proposal);
    expect(sql).toContain("INSERT INTO wallet_observations");
    expect(sql).not.toContain("'123456'");
    expect(sql).not.toContain("alice");
  });

  test("registry claim: the renamed actor is payable through its immutable id", async () => {
    const { fetchImpl } = world({ current: "alice-new", registry: true });
    const { current, wallet } = await observeCarried("alice", fetchImpl);
    expect(wallet).toMatchObject({
      address: ACTOR_WALLET,
      sourceActorId: NODE,
    });

    // A registry proof is bound by the id, so the recorded login is kept.
    const proposal = propose(wallet, current);
    expect(carried(proposal)).toMatchObject({
      actor: { id: NODE, login: "alice" },
      accruedMinor: CARRIED_MINOR,
      state: "proposed",
      wallet: { address: ACTOR_WALLET },
    });
    // Registry wallets are already in D1; the README import skips them.
    expect(importSql(proposal)).not.toContain("'123456'");
  });

  test("unchanged login: the README fallback still reaches proposal and import", async () => {
    const { fetchImpl } = world({ current: "alice", registry: false });
    const wallet = await observe("alice", fetchImpl);
    expect(wallet).toMatchObject({
      address: ACTOR_WALLET,
      sourceUrl: `https://github.com/alice/alice/blob/${SHA}/README.md`,
    });

    const proposal = propose(wallet);
    expect(carried(proposal).state).toBe("proposed");
    const sql = importSql(proposal);
    expect(sql).toContain(`'123456','${NODE}','alice','solana'`);
    expect(sql).toContain(ACTOR_WALLET);
  });
});

describe("a rename never pays another account", () => {
  test("a new account that took the old login receives nothing", async () => {
    const { fetchImpl, requests } = world({
      current: "alice-new",
      registry: false,
    });
    const { current, wallet } = await observeCarried("alice", fetchImpl);
    expect(wallet?.address).toBe(ACTOR_WALLET);
    expect(requests).not.toContain(`${API}/users/alice`);
    expect(requests.some((url) => url.startsWith(`${API}/repos/alice/`))).toBe(
      false,
    );

    const proposal = propose(wallet, current);
    const text = JSON.stringify(proposal);
    expect(text).not.toContain(NEW_ACCOUNT_NODE);
    expect(text).not.toContain(NEW_ACCOUNT_WALLET);
    expect(importSql(proposal)).not.toContain(NEW_ACCOUNT_WALLET);
  });

  test("a README proof is still bound to the recorded login", () => {
    // A current-login README on a row that keeps the stale login.
    const currentLoginProof = {
      address: ACTOR_WALLET,
      chain: "solana" as const,
      observedAt: FROZEN.generatedAt,
      sourceCommit: SHA,
      sourceUrl: `https://github.com/alice-new/alice-new/blob/${SHA}/README.md`,
    };
    expect(() => propose(currentLoginProof)).toThrow(
      "must be the actor's immutable GitHub profile README",
    );

    // The new holder of "alice" cannot be attached to actor 123456 by import.
    const proposal = propose(null);
    const tampered = structuredClone(proposal);
    const row = tampered.allocations.find((a) => a.actor.id === NODE);
    if (!row) throw new Error("carried row is missing");
    row.actor.login = "alice-new";
    row.wallet = {
      ...currentLoginProof,
      address: NEW_ACCOUNT_WALLET,
      sourceUrl: `https://github.com/alice/alice/blob/${SHA}/README.md`,
    };
    expect(() => importSql(tampered)).toThrow(
      "invalid README wallet for alice-new",
    );
  });

  test("a registry claim for a different actor id is rejected", async () => {
    const { fetchImpl } = world({
      current: "alice-new",
      registry: true,
      claimActorId: "999999",
    });
    await expect(observeCarried("alice", fetchImpl)).rejects.toThrow(
      "Slop wallet registry claim is invalid",
    );
  });

  test("the cycle check accepts a new login only on a carried row with its README", () => {
    const expected = carried(propose(null));
    const renamed = {
      ...expected,
      actor: { id: NODE, login: "alice-new" },
      wallet: {
        address: ACTOR_WALLET,
        chain: "solana" as const,
        observedAt: FROZEN.generatedAt,
        sourceCommit: SHA,
        sourceUrl: `https://github.com/alice-new/alice-new/blob/${SHA}/README.md`,
      },
    };
    expect(isRenamedCarriedRow(renamed, expected, "alice")).toBe(true);
    // No README proof under the new login.
    expect(
      isRenamedCarriedRow({ ...renamed, wallet: null }, expected, "alice"),
    ).toBe(false);
    expect(
      isRenamedCarriedRow(
        {
          ...renamed,
          wallet: {
            ...renamed.wallet,
            sourceUrl: `https://github.com/alice/alice/blob/${SHA}/README.md`,
          },
        },
        expected,
        "alice",
      ),
    ).toBe(false);
    // A scored row keeps its snapshot login.
    const leader = FROZEN.allocations[0];
    expect(
      isRenamedCarriedRow(
        { ...leader, actor: { ...leader.actor, login: "alice-new" } },
        leader,
        leader.actor.login,
      ),
    ).toBe(false);
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
