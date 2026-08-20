/** Proves funding records resolve receiving policy from an immutable ancestor. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import eliza from "../projects/eliza/project.json";
import {
  buildFundingIndex,
  fundingAddressesAtRevision,
  fundingCommitmentsAtRevision,
} from "./sync-funding-index";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function commitRepository(root: string, manifest: unknown): string {
  mkdirSync(join(root, "projects", "eliza"), { recursive: true });
  writeFileSync(
    join(root, "projects", "eliza", "project.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Slop test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@slop.cash"], {
    cwd: root,
  });
  execFileSync("git", ["add", "projects/eliza/project.json"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "manifest"], { cwd: root });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

describe("funding manifest history", () => {
  it("loads the exact address policy only from a current-tree ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "slop-funding-history-"));
    temporaryRoots.push(root);
    const manifest = structuredClone(eliza);
    manifest.funding.addresses = [
      {
        network: "solana",
        asset: "USDC",
        address: "11111111111111111111111111111111",
        effectiveAt: "2026-08-16T00:00:00.000Z",
        replacedAt: null,
      },
    ] as never;
    const revision = commitRepository(root, manifest);

    expect(fundingAddressesAtRevision("eliza", revision, root)).toEqual(
      manifest.funding.addresses,
    );
    expect(() =>
      fundingAddressesAtRevision("eliza", "f".repeat(40), root),
    ).toThrow(/not an ancestor/u);
  });

  it("publishes commitments separately and bounds committed claims", async () => {
    const root = mkdtempSync(join(tmpdir(), "slop-funding-commitment-"));
    temporaryRoots.push(root);
    const vault = "Vote111111111111111111111111111111111111111";
    const funderMember = "Stake11111111111111111111111111111111111111";
    const stewardMember = "SysvarRent111111111111111111111111111111111";
    const instrument = {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig: "11111111111111111111111111111111",
      funderMember,
      stewardMember,
      vault,
      vaultIndex: 0,
      funderActorId: "18633264",
      deadline: "2026-12-01T00:00:00.000Z",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    };
    const manifest = structuredClone(eliza) as Record<string, unknown> & {
      funding: Record<string, unknown>;
      reward: Record<string, unknown>;
    };
    manifest.funding.commitments = [instrument];
    const revision = commitRepository(root, manifest);
    expect(fundingCommitmentsAtRevision("eliza", revision, root)).toEqual([
      instrument,
    ]);
    const signature = "3".repeat(88);
    const record = {
      schemaVersion: "1",
      kind: "project-commitment",
      recordId: "cmt_deposit_01",
      projectId: "eliza",
      manifestRevision: revision,
      event: "deposit",
      network: "solana",
      asset: "USDC",
      instrument: {
        funderMember,
        multisig: instrument.multisig,
        stewardMember,
        vault: instrument.vault,
        vaultIndex: 0,
      },
      transactionId: signature,
      amountMinor: "5000000",
      observedAt: "2026-08-02T00:00:00.000Z",
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: {
        version: "commitment-squads-v2",
        checkedAt: "2026-08-02T01:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${signature}`,
        reason: null,
      },
      supersedes: null,
    };
    const recordRoot = join(
      root,
      "funding",
      "eliza",
      "commitments",
      "solana",
      signature,
    );
    mkdirSync(recordRoot, { recursive: true });
    writeFileSync(
      join(recordRoot, "cmt_deposit_01.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    const committedProject = () => {
      const project = structuredClone(manifest) as {
        id: string;
        funding: {
          recordsPath: string;
          addresses: readonly unknown[];
          commitments?: readonly unknown[];
        };
        reward: { committedMinor: string; fundingState: string };
      };
      project.reward.fundingState = "committed";
      project.reward.committedMinor = "5000000";
      return project;
    };

    const resolved = await buildFundingIndex({
      repositoryRoot: root,
      projects: [committedProject()],
    });
    expect(resolved.records).toEqual([]);
    expect(resolved.commitments).toEqual([record]);
    expect(resolved.generatedAt).toBe("2026-08-02T00:00:00.000Z");

    const overcommitted = committedProject();
    overcommitted.reward.committedMinor = "5000001";
    await expect(
      buildFundingIndex({
        repositoryRoot: root,
        projects: [overcommitted],
      }),
    ).rejects.toThrow(/exceeds the verified commitment balance/u);

    const withoutInstrument = committedProject();
    withoutInstrument.funding.commitments = [];
    await expect(
      buildFundingIndex({
        repositoryRoot: root,
        projects: [withoutInstrument],
      }),
    ).rejects.toThrow(/not active/u);
  });
});
