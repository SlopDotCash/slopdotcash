/** Read-only signed queue and revision/template acquisition. No result-write capability. */
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { acquireRepository } from "./acquire";
import { signedServiceHeaders } from "./service";

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const HEX = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid service record");
  return value as Record<string, unknown>;
};
const safePath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    value.includes("\\") ||
    value
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/u.test(part) || part === "." || part === "..",
      )
  )
    throw new Error("Invalid input path");
  return value;
};
export type QueuedAssessment = {
  assessmentId: string;
  projectId: string;
  revision: number;
  manifestSha256: string;
  commitSha: string;
  templateSha256: string;
};
export type QueueConnection = {
  origin: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  fetch?: typeof fetch;
  now?: () => Date;
};
function originOf(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error("An explicit HTTPS service origin is required");
  return value;
}
async function bytes(
  fetcher: typeof fetch,
  url: string,
  headers?: HeadersInit,
): Promise<Buffer> {
  const response = await fetcher(url, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Pinned input unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) throw new Error("Pinned input size limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export async function readPendingAssessments(
  connection: QueueConnection,
): Promise<QueuedAssessment[]> {
  const origin = originOf(connection.origin);
  const path = "/api/v1/vetting/requests";
  const at = (connection.now?.() ?? new Date()).toISOString();
  const value = object(
    JSON.parse(
      (
        await bytes(
          connection.fetch ?? fetch,
          `${origin}${path}`,
          await signedServiceHeaders({
            signer: connection,
            method: "GET",
            pathAndQuery: path,
            body: new Uint8Array(),
            at: new Date(at),
          }),
        )
      ).toString("utf8"),
    ),
  );
  if (
    value.schemaVersion !== "slop-vetting-queue-v1" ||
    !Array.isArray(value.assessments) ||
    value.assessments.length > 100
  )
    throw new Error("Invalid pending queue");
  const ids = new Set();
  return value.assessments.map((item) => {
    const row = object(item);
    if (
      typeof row.assessmentId !== "string" ||
      !/^vet_[a-f0-9]{32}$/u.test(row.assessmentId) ||
      ids.has(row.assessmentId) ||
      typeof row.projectId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(row.projectId) ||
      !Number.isSafeInteger(row.revision) ||
      (row.revision as number) < 1 ||
      !HEX.test(String(row.manifestSha256)) ||
      !HEX.test(String(row.templateSha256)) ||
      !COMMIT.test(String(row.commitSha)) ||
      row.manifestUrl !==
        `${origin}/api/v1/project-revisions/${row.projectId}/${row.revision}` ||
      row.templateIndexUrl !== `${origin}/skill-templates/index.json`
    )
      throw new Error("Invalid queued pin");
    ids.add(row.assessmentId);
    return {
      assessmentId: row.assessmentId,
      projectId: row.projectId,
      revision: row.revision as number,
      manifestSha256: String(row.manifestSha256),
      commitSha: String(row.commitSha),
      templateSha256: String(row.templateSha256),
    };
  });
}

export async function acquireQueuedAssessment(
  connection: QueueConnection,
  assessmentId: string,
  directory: string,
) {
  const deadline = AbortSignal.timeout(180_000);
  const baseFetch = connection.fetch ?? fetch;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
    baseFetch(input, {
      ...init,
      signal: AbortSignal.any([
        deadline,
        ...(init?.signal ? [init.signal] : []),
      ]),
    })) as typeof fetch;
  // Re-read the signed queue at acquisition start. Caller-supplied commit/template pins are not accepted.
  const assessment = (
    await readPendingAssessments({ ...connection, fetch: fetcher })
  ).find((item) => item.assessmentId === assessmentId);
  if (!assessment) throw new Error("Assessment is no longer pending");
  const origin = connection.origin;
  const revision = object(
    JSON.parse(
      (
        await bytes(
          fetcher,
          `${origin}/api/v1/project-revisions/${assessment.projectId}/${assessment.revision}`,
        )
      ).toString("utf8"),
    ),
  );
  if (
    revision.projectId !== assessment.projectId ||
    revision.revision !== assessment.revision ||
    revision.manifestSha256 !== assessment.manifestSha256 ||
    typeof revision.manifestText !== "string" ||
    sha256(revision.manifestText) !== assessment.manifestSha256
  )
    throw new Error("Manifest pin mismatch");
  const manifest = assertProjectDefinition(JSON.parse(revision.manifestText));
  if (
    manifest.id !== assessment.projectId ||
    manifest.repositories.length !== 1
  )
    throw new Error("Unsupported repository inventory");
  const repositoryIdentity = object(
    JSON.parse(
      (
        await bytes(
          fetcher,
          `https://api.github.com/repos/${manifest.repositories[0].id}`,
          {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "slop-vetting-acquisition",
          },
        )
      ).toString("utf8"),
    ),
  );
  if (
    !Number.isSafeInteger(repositoryIdentity.id) ||
    String(repositoryIdentity.id) !== manifest.authority.repositoryId ||
    repositoryIdentity.node_id !== manifest.authority.repositoryNodeId ||
    typeof repositoryIdentity.full_name !== "string" ||
    repositoryIdentity.full_name.toLowerCase() !==
      manifest.repositories[0].id.toLowerCase() ||
    repositoryIdentity.private !== false
  )
    throw new Error("Immutable repository identity mismatch");
  const index = object(
    JSON.parse(
      (await bytes(fetcher, `${origin}/skill-templates/index.json`)).toString(
        "utf8",
      ),
    ),
  );
  if (
    index.schemaVersion !== "1" ||
    index.templateSha256 !== assessment.templateSha256 ||
    index.revisionStatus !== "committed" ||
    object(index.renderer).revisionStatus !== "committed" ||
    !COMMIT.test(String(index.commit)) ||
    typeof index.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(index.repository)
  )
    throw new Error("Template pin is stale or uncommitted");
  safePath(index.repository);
  const files = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64)
      throw new Error("Invalid template file inventory");
    const seen = new Set<string>();
    return value.map((item) => {
      const file = object(item);
      const path = safePath(file.path);
      if (!HEX.test(String(file.sha256)) || seen.has(path))
        throw new Error("Invalid template digest");
      seen.add(path);
      return { path, sha256: String(file.sha256) };
    });
  };
  const group = (value: unknown) => {
    const entry = object(value);
    return {
      sourcePath: safePath(entry.sourcePath),
      files: files(entry.files),
    };
  };
  const contributor = group(index.contributor);
  const reviewer = group(index.reviewer);
  const rendererSources = files(object(index.renderer).sources);
  if (
    !Array.isArray(index.acceptedRevisions) ||
    index.acceptedRevisions.length > 64 ||
    index.acceptedRevisions.some(
      (revision) => typeof revision !== "string" || revision.length > 1024,
    )
  )
    throw new Error("Invalid accepted template revisions");
  const templateInputs = {
    contributor,
    reviewer,
    rendererSources,
    acceptedRevisions: index.acceptedRevisions,
  };
  if (sha256(JSON.stringify(templateInputs)) !== assessment.templateSha256)
    throw new Error("Template input digest mismatch");
  const acquired = await acquireRepository({
    repository: manifest.repositories[0].id,
    commitSha: assessment.commitSha,
    directory,
    fetch: fetcher,
  });
  try {
    const sourceInventoryBytes = await readFile(
      join(acquired.directory, "inventory.json"),
    );
    if (sha256(sourceInventoryBytes) !== acquired.inventorySha256)
      throw new Error("Source inventory changed");
    const sourceInventory = object(
      JSON.parse(sourceInventoryBytes.toString("utf8")),
    );
    if (
      !Array.isArray(sourceInventory.visibilityGaps) ||
      sourceInventory.visibilityGaps.some((gap) => typeof gap !== "string")
    )
      throw new Error("Invalid source coverage");
    const inputs = [];
    const sources = [
      ...[contributor, reviewer].flatMap((group) =>
        group.files.map((file) => ({
          ...file,
          path: `${group.sourcePath}/${file.path}`,
          url: `${origin}/skill-templates/${group.sourcePath}/${file.path}`,
        })),
      ),
      ...rendererSources.map((file) => ({
        ...file,
        url: `https://raw.githubusercontent.com/${index.repository}/${index.commit}/${file.path}`,
      })),
    ];
    let templateBytes = 0;
    for (const source of sources) {
      const content = await bytes(fetcher, source.url);
      templateBytes += content.byteLength;
      if (templateBytes > 32 * 1024 * 1024)
        throw new Error("Template acquisition size limit");
      if (sha256(content) !== source.sha256)
        throw new Error("Template file bytes changed");
      const objectPath = join(acquired.directory, "objects", source.sha256);
      try {
        await writeFile(objectPath, content, { flag: "wx", mode: 0o400 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          sha256(await readFile(objectPath)) !== source.sha256
        )
          throw error;
      }
      inputs.push({
        path: source.path,
        sha256: source.sha256,
        state: "quarantined",
      });
    }
    const bundle = Buffer.from(
      JSON.stringify({
        schema: "slop-queued-inputs-v1",
        assessment,
        sourceInventorySha256: acquired.inventorySha256,
        repositoryIdentity: {
          id: String(repositoryIdentity.id),
          nodeId: repositoryIdentity.node_id,
          fullName: repositoryIdentity.full_name,
        },
        manifestText: revision.manifestText,
        templateInputs,
        inputs,
        state: "quarantined",
        visibilityGaps: [
          ...new Set([
            ...sourceInventory.visibilityGaps.filter(
              (gap) => gap !== "skill-template-inputs-not-acquired",
            ),
            "rendered-skills-and-execution-dependencies-not-acquired",
            "secure-runtime-and-model-review-not-performed",
          ]),
        ].sort(),
      }),
    );
    await writeFile(join(acquired.directory, "queued-inputs.json"), bundle, {
      mode: 0o400,
      flag: "wx",
    });
    return {
      directory: acquired.directory,
      inputManifestSha256: sha256(bundle),
    };
  } catch (error) {
    await rm(acquired.directory, { recursive: true, force: true });
    throw error;
  }
}
