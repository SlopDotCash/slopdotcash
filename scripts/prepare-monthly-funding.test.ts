import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertFundingPreparation,
  createFundingReview,
} from "../src/lib/funding-review-data";
import { findProject } from "../src/lib/projects.mjs";
import { snapshotFixture } from "../tests/fixtures";
import { fundingReviewSha256 } from "./prepare-funding-review";
import {
  parseMonthlyFundingArguments,
  prepareMonthlyFunding,
  refreshPreparationWallets,
} from "./prepare-monthly-funding";

// A newly registered manifest identity using an existing fixture repository;
// production still obtains its inventory exclusively from the canonical registry.
vi.mock("../src/lib/projects.mjs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/projects.mjs")>();
  const project = {
    ...actual.PROJECTS[0],
    id: "new-maintainer-project",
    slug: "new-maintainer-project",
    name: "New maintainer project",
  };
  return {
    ...actual,
    findProject: (id: string) =>
      id === project.id ? project : actual.findProject(id),
  };
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "monthly-funding-"));
  roots.push(root);
  const snapshot = snapshotFixture("2026-08-02T00:00:00.000Z");
  snapshot.window.from = "2026-06-27T00:00:00.000Z";
  snapshot.window.to = "2026-08-01T00:00:00.000Z";
  snapshot.source.cutoffAt = snapshot.window.to;
  snapshot.source.verificationWindow = { ...snapshot.window };
  const snapshotPath = join(root, "snapshot.json");
  const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(snapshotPath, bytes);
  const project = findProject("new-maintainer-project");
  if (!project) throw new Error("Missing new-project fixture");
  const observeWallet = vi.fn(async () => null);
  return {
    root,
    snapshot,
    bytes,
    observeWallet,
    dependencies: { projects: [project], observeWallet },
    options: {
      root,
      cycleId: "2026-07",
      snapshotPath,
      observedAt: "2026-08-02T01:00:00.000Z",
      evidenceDirectory: join(root, "artifacts"),
      evidenceUrl: "https://github.com/example/public-repo/actions/runs/123",
      evidenceArtifact: "funding-preparation-2026-07-123-1",
      projectId: project.id,
    },
  };
}
describe("generic monthly funding preparation", () => {
  it("prepares a new manifest project without an audit, retaining missing wallets and exact source bytes", async () => {
    const f = await fixture();
    const inputs = await prepareMonthlyFunding(f.options, f.dependencies);
    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    expect(input.projectId).toBe("new-maintainer-project");
    expect(input.sourceAuditSha256).toBeNull();
    expect(input.provenance.derivation).toBe("snapshot-derived");
    expect(input.provenance.mergedCensus).toBeNull();
    expect(input.sourceSnapshotSha256).toBe(fundingReviewSha256(f.bytes));
    expect(input.contributors).toHaveLength(1);
    expect(input.contributors[0]).toMatchObject({
      wallet: null,
      lookupUnavailable: false,
    });
    expect(f.observeWallet).toHaveBeenCalledWith(
      input.contributors[0].actor.id,
      input.contributors[0].actor.login,
      f.options.observedAt,
      { token: undefined },
    );
    const review = createFundingReview(input);
    expect(
      BigInt(review.contributors[0].simulatedMinor ?? "0"),
    ).toBeGreaterThan(0n);
    expect(review).toMatchObject({
      status: "preparation",
      paymentAuthorized: false,
      proposalPublished: false,
    });
    expect(
      await readFile(
        join(f.options.evidenceDirectory, "source-snapshot.json"),
        "utf8",
      ),
    ).toBe(f.bytes);
    const walletBytes = await readFile(
      join(f.options.evidenceDirectory, "wallet-observations.json"),
    );
    expect(fundingReviewSha256(walletBytes)).toBe(
      input.provenance.walletObservationsSha256,
    );
    expect(
      assertFundingPreparation(
        JSON.parse(
          await readFile(
            join(
              f.root,
              "funding/preparations/new-maintainer-project-2026-07.json",
            ),
            "utf8",
          ),
        ),
      ),
    ).toEqual(input);
    await expect(
      readFile(
        join(f.root, "cycles/new-maintainer-project/2026-07/proposal.json"),
      ),
    ).rejects.toThrow();
  });
  it.each(["mismatched-cutoff", "partial-month"])(
    "rejects %s before any wallet lookup or output",
    async (kind) => {
      const f = await fixture();
      if (kind === "mismatched-cutoff")
        f.snapshot.source.cutoffAt = "2026-07-31T00:00:00.000Z";
      else {
        f.snapshot.window.from = "2026-07-08T00:00:00.000Z";
        f.snapshot.source.verificationWindow.from = f.snapshot.window.from;
      }
      await writeFile(f.options.snapshotPath, JSON.stringify(f.snapshot));
      await expect(
        prepareMonthlyFunding(f.options, f.dependencies),
      ).rejects.toThrow();
      expect(f.observeWallet).not.toHaveBeenCalled();
      await expect(
        readFile(
          join(
            f.root,
            "funding/preparations/new-maintainer-project-2026-07.json",
          ),
        ),
      ).rejects.toThrow();
    },
  );
  it("refuses existing preparation bytes before fetching, including independently audited inputs", async () => {
    const f = await fixture();
    const path = join(
      f.root,
      "funding/preparations/new-maintainer-project-2026-07.json",
    );
    await mkdir(join(f.root, "funding/preparations"), { recursive: true });
    const existing = "preserve existing audited bytes exactly\n";
    await writeFile(path, existing);
    await expect(
      prepareMonthlyFunding(f.options, f.dependencies),
    ).rejects.toThrow("Refusing existing");
    expect(await readFile(path, "utf8")).toBe(existing);
    expect(f.observeWallet).not.toHaveBeenCalled();
  });
  it("does not publish a missing registration when the wallet lookup failed", async () => {
    const f = await fixture();
    f.observeWallet.mockRejectedValueOnce(new Error("lookup unavailable"));
    await expect(
      prepareMonthlyFunding(f.options, f.dependencies),
    ).rejects.toThrow("lookup unavailable");
    await expect(
      readFile(join(f.options.evidenceDirectory, "wallet-observations.json")),
    ).rejects.toThrow();
  });
  it("rejects unknown, repeated and absent CLI arguments", () => {
    expect(() =>
      parseMonthlyFundingArguments([
        "--cycle",
        "2026-07",
        "--cycle",
        "2026-08",
      ]),
    ).toThrow();
    expect(() =>
      parseMonthlyFundingArguments(["--snapshot", "file"]),
    ).toThrow();
    expect(() =>
      parseMonthlyFundingArguments(["--execute-payment", "yes"]),
    ).toThrow();
  });
});

describe("wallet-only preparation refresh", () => {
  it("preserves audited census and all source/score provenance while changing only selected wallet observations", async () => {
    const f = await fixture();
    const [derived] = await prepareMonthlyFunding(f.options, f.dependencies);
    const {
      derivation: _derivation,
      evidenceUrl: _url,
      evidenceArtifact: _artifact,
      ...provenance
    } = derived.provenance;
    const original = assertFundingPreparation({
      ...derived,
      sourceAuditSha256: "a".repeat(64),
      provenance: {
        ...provenance,
        mergedCensus: derived.provenance.scoredMerges,
      },
    });
    const path = join(
      f.root,
      "funding/preparations/new-maintainer-project-2026-07.json",
    );
    await writeFile(path, JSON.stringify(original));
    const other = join(f.root, "funding/preparations/eliza-2026-07.json");
    await writeFile(other, "other project must remain byte-identical");
    const cycle = join(f.root, "cycles/new-maintainer-project/2026-07");
    await mkdir(cycle, { recursive: true });
    await writeFile(
      join(cycle, "proposal.json"),
      "published wallet remains locked",
    );
    const observedAt = "2026-08-02T02:00:00.000Z";
    const actor = original.contributors[0].actor;
    const observeWallet = vi.fn(async () => ({
      chain: "solana" as const,
      address: "59W5HpZu1FFqEHj8Qvkwd9UXb62aQMCt32LD4uarrRsc",
      observedAt,
      sourceCommit: "1".repeat(40),
      sourceUrl: `https://github.com/${actor.login}/${actor.login}/blob/${"1".repeat(40)}/README.md`,
    }));
    const evidenceDirectory = join(f.root, "refresh-artifact");
    const updated = await refreshPreparationWallets(
      { ...f.options, observedAt, evidenceDirectory },
      { ...f.dependencies, observeWallet },
    );
    expect(observeWallet).toHaveBeenCalledTimes(original.contributors.length);
    expect(observeWallet).toHaveBeenCalledWith(
      actor.id,
      actor.login,
      observedAt,
      { token: undefined },
    );
    const immutable = (input: typeof original) => ({
      ...input,
      observedAt: original.observedAt,
      provenance: {
        ...input.provenance,
        walletObservationsSha256: original.provenance.walletObservationsSha256,
      },
      contributors: input.contributors.map((r, i) => ({
        ...r,
        wallet: original.contributors[i].wallet,
        lookupUnavailable: original.contributors[i].lookupUnavailable,
      })),
    });
    expect(immutable(updated)).toEqual(original);
    expect(updated.contributors[0].wallet?.address).toBe(
      "59W5HpZu1FFqEHj8Qvkwd9UXb62aQMCt32LD4uarrRsc",
    );
    expect(updated.provenance.walletObservationsSha256).not.toBe(
      original.provenance.walletObservationsSha256,
    );
    expect(updated.provenance.walletObservationsSha256).toBe(
      fundingReviewSha256(
        await readFile(join(evidenceDirectory, "wallet-observations.json")),
      ),
    );
    expect(
      JSON.parse(
        await readFile(
          join(evidenceDirectory, "preparation-before.json"),
          "utf8",
        ),
      ),
    ).toEqual(original);
    expect(await readFile(other, "utf8")).toBe(
      "other project must remain byte-identical",
    );
    expect(await readFile(join(cycle, "proposal.json"), "utf8")).toBe(
      "published wallet remains locked",
    );
    expect(
      createFundingReview(updated).contributors.map((r) => r.simulatedMinor),
    ).toEqual(
      createFundingReview(original).contributors.map((r) => r.simulatedMinor),
    );
    await expect(
      prepareMonthlyFunding(
        { ...f.options, evidenceDirectory: join(f.root, "new-ingestion") },
        f.dependencies,
      ),
    ).rejects.toThrow("Refusing existing");
  });
  it("records lookup failure explicitly without dropping or rescoring the contributor", async () => {
    const f = await fixture();
    const [original] = await prepareMonthlyFunding(f.options, f.dependencies);
    const observeWallet = vi.fn(async () => {
      throw new Error("private failure details must not be copied");
    });
    const evidenceDirectory = join(f.root, "refresh-artifact");
    const updated = await refreshPreparationWallets(
      {
        ...f.options,
        observedAt: "2026-08-02T02:00:00.000Z",
        evidenceDirectory,
      },
      { ...f.dependencies, observeWallet },
    );
    expect(updated.counts).toEqual(original.counts);
    expect(updated.contributors[0]).toMatchObject({
      actor: original.contributors[0].actor,
      scoreThirds: original.contributors[0].scoreThirds,
      weight: original.contributors[0].weight,
      wallet: null,
      lookupUnavailable: true,
    });
    const bytes = await readFile(
      join(evidenceDirectory, "wallet-observations.json"),
      "utf8",
    );
    expect(bytes).toContain("lookup-unavailable");
    expect(bytes).not.toContain("private failure");
  });
  it("rejects a different project's payload before looking up or replacing wallets", async () => {
    const f = await fixture();
    const [original] = await prepareMonthlyFunding(f.options, f.dependencies);
    const path = join(
      f.root,
      "funding/preparations/new-maintainer-project-2026-07.json",
    );
    const bytes = JSON.stringify({ ...original, projectId: "eliza" });
    await writeFile(path, bytes);
    f.observeWallet.mockClear();
    await expect(
      refreshPreparationWallets(
        {
          ...f.options,
          observedAt: "2026-08-02T02:00:00.000Z",
          evidenceDirectory: join(f.root, "refresh-artifact"),
        },
        f.dependencies,
      ),
    ).rejects.toThrow("does not match");
    expect(f.observeWallet).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(bytes);
  });
  it("requires explicit refresh scope and rejects new source ingestion in refresh mode", () => {
    expect(() =>
      parseMonthlyFundingArguments([
        "--refresh-wallets",
        "--cycle",
        "2026-07",
        "--evidence-directory",
        "evidence",
      ]),
    ).toThrow();
    expect(() =>
      parseMonthlyFundingArguments([
        "--refresh-wallets",
        "--cycle",
        "2026-07",
        "--project",
        "eliza",
        "--snapshot",
        "new.json",
        "--evidence-directory",
        "evidence",
      ]),
    ).toThrow();
    expect(
      parseMonthlyFundingArguments([
        "--refresh-wallets",
        "--cycle",
        "2026-07",
        "--project",
        "eliza",
        "--evidence-directory",
        "evidence",
      ]).refreshWallets,
    ).toBe(true);
  });
});
