/** A published upstream address is evidence of publication, never key control. */
import { createHash } from "node:crypto";
import { assertFundingAddresses } from "./funding-address.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_AUTHORITY_BYTES = 64 * 1024;

function record(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function keys(value, expected, field) {
  record(value, field);
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function addressBytes(addresses) {
  return JSON.stringify(
    addresses.map(({ network, asset, address, effectiveAt, replacedAt }) => [
      network,
      asset,
      address,
      effectiveAt,
      replacedAt,
    ]),
  );
}

/** Validates the optional extension against the same route schema as manifests. */
export function assertProjectFundingAuthority(value, project) {
  const authority = record(value, "upstream authority");
  keys(
    authority,
    [
      "kind",
      "policyRevision",
      "projectId",
      "proposal",
      "repository",
      "schemaVersion",
      "steward",
      ...(Object.hasOwn(authority, "funding") ? ["funding"] : []),
    ],
    "upstream authority",
  );
  const repository = project.repositories[0];
  const identities = [repository.id, ...(repository.aliases ?? [])];
  keys(
    authority.repository,
    ["fullName", "id", "integrationBranch"],
    "upstream repository",
  );
  keys(authority.steward, ["actorId", "login", "nodeId"], "upstream steward");
  if (
    authority.schemaVersion !== "1" ||
    authority.kind !== "slop-project-authority" ||
    authority.projectId !== project.id ||
    authority.policyRevision !== project.authority.proof?.policyRevision ||
    !identities.includes(authority.repository.fullName) ||
    authority.repository.id !== project.authority.repositoryId ||
    authority.repository.integrationBranch !== repository.integrationBranch ||
    authority.steward.actorId !== project.steward.github.actorId ||
    authority.steward.nodeId !== project.steward.github.nodeId ||
    authority.steward.login !== project.steward.github.login ||
    typeof authority.proposal !== "string" ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/u.test(
      authority.proposal,
    )
  ) {
    throw new TypeError(
      "upstream authority does not bind the registered project and steward",
    );
  }
  if (Object.hasOwn(authority, "funding")) {
    keys(authority.funding, ["addresses"], "upstream funding");
    assertFundingAddresses(
      authority.funding.addresses,
      "upstream funding.addresses",
    );
  }
  return authority;
}

async function githubJson(path, fetchImpl) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "slop-funding-authority-check",
    },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("upstream funding authority could not be verified");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(
          "upstream funding authority response exceeds the byte bound",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Requires the pinned file to belong to the live registered integration history. */
export async function verifyProjectFundingAuthority(
  project,
  { fetchImpl = fetch } = {},
) {
  const proof = project.authority.proof;
  if (
    project.authority.state !== "verified" ||
    !proof ||
    !COMMIT.test(proof.commitSha)
  ) {
    throw new TypeError(
      "funding address changes require verified upstream authority",
    );
  }
  const repository = project.repositories[0];
  const live = await githubJson(
    `/repositories/${project.authority.repositoryId}`,
    fetchImpl,
  );
  const identities = [repository.id, ...(repository.aliases ?? [])];
  if (
    String(live.id) !== project.authority.repositoryId ||
    live.node_id !== project.authority.repositoryNodeId ||
    !identities.includes(live.full_name)
  ) {
    throw new TypeError(
      "upstream repository identity differs from the manifest",
    );
  }
  const prefix = `/repos/${live.full_name}`;
  const branch = repository.integrationBranch;
  const ref = await githubJson(
    `${prefix}/git/ref/heads/${encodeURIComponent(branch)}`,
    fetchImpl,
  );
  if (
    ref.ref !== `refs/heads/${branch}` ||
    ref.object?.type !== "commit" ||
    !COMMIT.test(ref.object.sha)
  ) {
    throw new TypeError("upstream integration head is invalid");
  }
  const comparison = await githubJson(
    `${prefix}/compare/${proof.commitSha}...${ref.object.sha}?per_page=1`,
    fetchImpl,
  );
  if (
    !["identical", "ahead"].includes(comparison.status) ||
    comparison.base_commit?.sha !== proof.commitSha ||
    comparison.merge_base_commit?.sha !== proof.commitSha
  ) {
    throw new TypeError(
      "authority commit is not on the upstream integration branch",
    );
  }
  const file = await githubJson(
    `${prefix}/contents/.github/slop-project.json?ref=${proof.commitSha}`,
    fetchImpl,
  );
  if (
    file.type !== "file" ||
    file.path !== ".github/slop-project.json" ||
    file.encoding !== "base64" ||
    typeof file.content !== "string" ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > MAX_AUTHORITY_BYTES
  ) {
    throw new TypeError("upstream authority file is invalid or oversized");
  }
  const source = Buffer.from(file.content, "base64");
  if (
    source.byteLength !== file.size ||
    createHash("sha256").update(source).digest("hex") !== proof.fileSha256
  ) {
    throw new TypeError(
      "upstream authority bytes do not match the pinned digest",
    );
  }
  if (ref.object.sha !== proof.commitSha) {
    const currentFile = await githubJson(
      `${prefix}/contents/.github/slop-project.json?ref=${ref.object.sha}`,
      fetchImpl,
    );
    if (
      currentFile.type !== "file" ||
      currentFile.path !== ".github/slop-project.json" ||
      currentFile.encoding !== "base64" ||
      currentFile.size !== source.byteLength ||
      typeof currentFile.content !== "string" ||
      !Buffer.from(currentFile.content, "base64").equals(source)
    ) {
      throw new TypeError(
        "pinned authority is no longer current on the upstream integration branch",
      );
    }
  }
  const authority = assertProjectFundingAuthority(
    JSON.parse(source.toString("utf8")),
    project,
  );
  if (
    !authority.funding ||
    addressBytes(authority.funding.addresses) !==
      addressBytes(project.funding.addresses)
  ) {
    throw new TypeError(
      "manifest addresses do not exactly match upstream funding authority",
    );
  }
}

/** Unchanged address inventories incur no network request; new projects are covered too. */
export async function verifyFundingAddressTransitions(
  previous,
  current,
  options,
) {
  for (const [id, project] of current) {
    const prior = previous.get(id);
    if (
      addressBytes(prior?.funding.addresses ?? []) ===
      addressBytes(project.funding.addresses)
    )
      continue;
    await verifyProjectFundingAuthority(project, options);
  }
}
