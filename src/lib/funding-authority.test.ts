import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import eliza from "../../projects/eliza/project.json";
import {
  assertProjectFundingAuthority,
  verifyFundingAddressTransitions,
  verifyProjectFundingAuthority,
} from "./funding-authority.mjs";
import { assertProjectDefinition } from "./project-schema.mjs";
import type { ProjectDefinition } from "./projects.mjs";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

const HEAD = "b".repeat(40);
const ADDRESS = {
  network: "solana" as const,
  asset: "USDC" as const,
  address: "11111111111111111111111111111111",
  effectiveAt: "2026-09-01T00:00:00.000Z",
  replacedAt: null as string | null,
};

function fixture(addresses = [ADDRESS]) {
  const project = assertProjectDefinition(
    structuredClone(eliza),
  ) as Mutable<ProjectDefinition>;
  project.funding.addresses = structuredClone(addresses);
  const proof = project.authority.proof;
  if (!proof) throw new Error("fixture requires authority");
  const authority = {
    kind: "slop-project-authority",
    schemaVersion: "1",
    projectId: project.id,
    policyRevision: proof.policyRevision,
    proposal: "https://github.com/SlopDotCash/slopdotcash/issues/115",
    repository: {
      fullName: project.repositories[0].id,
      id: project.authority.repositoryId,
      integrationBranch: project.repositories[0].integrationBranch,
    },
    steward: {
      actorId: project.steward.github.actorId,
      login: project.steward.github.login,
      nodeId: project.steward.github.nodeId,
    },
    funding: { addresses: structuredClone(addresses) },
  };
  const source = Buffer.from(JSON.stringify(authority));
  proof.fileSha256 = createHash("sha256").update(source).digest("hex");
  const responses: Record<string, unknown> = {
    [`/repositories/${project.authority.repositoryId}`]: {
      id: Number(project.authority.repositoryId),
      node_id: project.authority.repositoryNodeId,
      full_name: project.repositories[0].id,
    },
    "/repos/elizaOS/eliza/git/ref/heads/develop": {
      ref: "refs/heads/develop",
      object: { type: "commit", sha: HEAD },
    },
    [`/repos/elizaOS/eliza/compare/${proof.commitSha}...${HEAD}?per_page=1`]: {
      status: "ahead",
      base_commit: { sha: proof.commitSha },
      merge_base_commit: { sha: proof.commitSha },
    },
    [`/repos/elizaOS/eliza/contents/.github/slop-project.json?ref=${proof.commitSha}`]:
      {
        type: "file",
        path: ".github/slop-project.json",
        encoding: "base64",
        size: source.byteLength,
        content: source.toString("base64"),
      },
  };
  responses[
    `/repos/elizaOS/eliza/contents/.github/slop-project.json?ref=${HEAD}`
  ] = structuredClone(
    responses[
      `/repos/elizaOS/eliza/contents/.github/slop-project.json?ref=${proof.commitSha}`
    ],
  );
  const fetchImpl = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.github.com");
    expect(options?.redirect).toBe("error");
    const value = responses[url.pathname + url.search];
    return value ? Response.json(value) : new Response(null, { status: 404 });
  });
  return { project, authority, responses, fetchImpl };
}

describe("receiving-address upstream authority", () => {
  it("accepts an optional funding extension and rejects malformed or extra route fields", () => {
    const { project, authority } = fixture();
    expect(assertProjectFundingAuthority(authority, project)).toBe(authority);
    const { funding: _funding, ...legacy } = authority;
    expect(assertProjectFundingAuthority(legacy, project)).toBe(legacy);
    for (const route of [
      { ...ADDRESS, address: "invalid" },
      { ...ADDRESS, owner: "invented" },
    ]) {
      expect(() =>
        assertProjectFundingAuthority(
          { ...authority, funding: { addresses: [route] } },
          project,
        ),
      ).toThrow();
    }
    expect(() =>
      assertProjectFundingAuthority(
        { ...authority, steward: { ...authority.steward, actorId: "123" } },
        project,
      ),
    ).toThrow(/registered project and steward/u);
  });

  it("verifies an added address using exact pinned bytes and upstream ancestry", async () => {
    const { project, fetchImpl } = fixture();
    await verifyFundingAddressTransitions(
      new Map(),
      new Map([[project.id, project]]),
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("verifies rotations and replacement timestamps without rewriting their values", async () => {
    const { project, fetchImpl } = fixture([
      { ...ADDRESS, replacedAt: "2026-09-02T00:00:00.000Z" },
      {
        ...ADDRESS,
        address: "Vote111111111111111111111111111111111111111",
        effectiveAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    const prior = fixture().project;
    await verifyFundingAddressTransitions(
      new Map([[prior.id, prior]]),
      new Map([[project.id, project]]),
      { fetchImpl },
    );
    project.funding.addresses[0].replacedAt = "2026-09-03T00:00:00.000Z";
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/exactly match/u);
  });

  it("makes no network request for unchanged empty or existing addresses", async () => {
    for (const addresses of [[], [ADDRESS]]) {
      const { project, fetchImpl } = fixture(addresses);
      await verifyFundingAddressTransitions(
        new Map([[project.id, project]]),
        new Map([[project.id, project]]),
        { fetchImpl },
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("rejects a missing authority, mismatched address, or byte digest", async () => {
    const { project, fetchImpl } = fixture();
    project.funding.addresses[0].address =
      "Vote111111111111111111111111111111111111111";
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/exactly match/u);
    if (!project.authority.proof) throw new Error("missing fixture proof");
    project.authority.proof.fileSha256 = "0".repeat(64);
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/pinned digest/u);
    project.authority = {
      ...project.authority,
      state: "unverified",
      reason: "missing-repository-proof",
      proof: null,
    };
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/require verified/u);
  });

  it("fails closed when the file is unreachable or the commit is off-branch", async () => {
    const { project, responses, fetchImpl } = fixture();
    const comparisonPath = Object.keys(responses).find((path) =>
      path.includes("/compare/"),
    );
    const filePath = Object.keys(responses).find((path) =>
      path.includes("/contents/"),
    );
    if (!comparisonPath || !filePath) throw new Error("missing fixture route");
    responses[comparisonPath] = {
      status: "diverged",
      base_commit: { sha: project.authority.proof?.commitSha },
    };
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/not on the upstream/u);
    responses[comparisonPath] = {
      status: "identical",
      base_commit: { sha: project.authority.proof?.commitSha },
      merge_base_commit: { sha: project.authority.proof?.commitSha },
    };
    delete responses[filePath];
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/could not be verified/u);
  });

  it("rejects an old address authority that has been withdrawn upstream", async () => {
    const { project, responses, fetchImpl } = fixture();
    const currentPath = `/repos/elizaOS/eliza/contents/.github/slop-project.json?ref=${HEAD}`;
    responses[currentPath] = {
      ...(responses[currentPath] as Record<string, unknown>),
      content: Buffer.from("withdrawn").toString("base64"),
    };
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/no longer current/u);
  });

  it("rejects an oversized authority response before accepting its contents", async () => {
    const { project } = fixture();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(
      verifyProjectFundingAuthority(project, { fetchImpl }),
    ).rejects.toThrow(/byte bound/u);
  });
});
