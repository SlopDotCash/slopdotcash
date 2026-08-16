/** Proves funding records resolve receiving policy from an immutable ancestor. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import eliza from "../projects/eliza/project.json";
import { fundingAddressesAtRevision } from "./sync-funding-index";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

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
    execFileSync("git", ["commit", "--quiet", "-m", "manifest"], {
      cwd: root,
    });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    expect(fundingAddressesAtRevision("eliza", revision, root)).toEqual(
      manifest.funding.addresses,
    );
    expect(() =>
      fundingAddressesAtRevision("eliza", "f".repeat(40), root),
    ).toThrow(/not an ancestor/u);
  });
});
