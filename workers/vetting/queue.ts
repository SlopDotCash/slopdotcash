/** Read-only signed queue and revision/template acquisition. No result-write capability. */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { readRecord } from "../../src/lib/record-validation.mjs";
import { sha256Hex as sha256 } from "../../src/lib/sha256";
import {
  AcquisitionRefusal,
  acquireRepository,
  readAcquisitionBody,
} from "./acquire";
import {
  serviceOrigin,
  signedVettingFetch,
  type VettingConnection,
} from "./service";

const HEX = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const object = (value: unknown) => readRecord(value, "Service record");
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
/** A refusal bound to the assignment reread by acquisition itself. */
export class QueuedAcquisitionRefusal extends AcquisitionRefusal {
  constructor(
    readonly assessment: QueuedAssessment,
    readonly repository: string,
    refusal: AcquisitionRefusal,
  ) {
    super(refusal.reason, refusal.capacity);
  }
}
export type QueueConnection = VettingConnection & {
  /**
   * Test-only source remote for a repository path (`file://` or loopback
   * HTTP, enforced by `acquireRepository`). Production fetches GitHub.
   */
  testGitRemote?: (repository: string) => string;
};
/** A pinned input of at most 1 MiB. */
async function pinnedBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Pinned input unavailable");
  }
  return readAcquisitionBody(response, 1024 * 1024);
}
async function bytes(
  fetcher: typeof fetch,
  url: string,
  headers?: HeadersInit,
): Promise<Uint8Array> {
  return pinnedBytes(
    await fetcher(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }),
  );
}
const json = (bytes: Uint8Array) =>
  object(JSON.parse(new TextDecoder().decode(bytes)));
export async function readPendingAssessments(
  connection: QueueConnection,
): Promise<QueuedAssessment[]> {
  const origin = serviceOrigin(connection.origin);
  const value = json(
    await pinnedBytes(
      await signedVettingFetch(connection, {
        method: "GET",
        path: "/api/v1/vetting/requests",
        timeoutMs: 15_000,
      }),
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
  githubToken?: string,
) {
  const deadline = AbortSignal.timeout(180_000);
  const baseFetch = connection.fetch ?? fetch;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // This credential belongs to trusted acquisition only. Never send it to
    // Slop, raw content, the model provider, or an isolated execution service.
    if (
      githubToken &&
      url.origin === "https://api.github.com" &&
      url.pathname.startsWith("/repos/") &&
      (init?.method ?? "GET") === "GET"
    )
      headers.set("authorization", `Bearer ${githubToken}`);
    return baseFetch(input, {
      ...init,
      headers: Object.fromEntries(headers),
      redirect: "error",
      signal: AbortSignal.any([
        deadline,
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  }) as typeof fetch;
  // Re-read the signed queue at acquisition start. Caller-supplied commit/template pins are not accepted.
  const assessment = (
    await readPendingAssessments({ ...connection, fetch: fetcher })
  ).find((item) => item.assessmentId === assessmentId);
  if (!assessment) throw new Error("Assessment is no longer pending");
  const origin = connection.origin;
  const revision = json(
    await bytes(
      fetcher,
      `${origin}/api/v1/project-revisions/${assessment.projectId}/${assessment.revision}`,
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
  if (manifest.id !== assessment.projectId)
    throw new Error("Manifest project mismatch");
  const refusal = (error: AcquisitionRefusal) =>
    new QueuedAcquisitionRefusal(
      assessment,
      manifest.repositories[0].id,
      error,
    );
  if (manifest.repositories.length !== 1)
    throw refusal(new AcquisitionRefusal("Unsupported repository inventory"));
  // A recorded rename keeps the original path as the id and publishes the
  // current path as githubUrl. GitHub redirects the former name, and
  // acquisition follows no redirects, so read and fetch the current name.
  const currentPath = new URL(
    manifest.repositories[0].githubUrl,
  ).pathname.replace(/^\/|\/$/gu, "");
  const repositoryIdentity = json(
    await bytes(fetcher, `https://api.github.com/repos/${currentPath}`, {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "slop-vetting-acquisition",
    }),
  );
  if (
    !Number.isSafeInteger(repositoryIdentity.id) ||
    String(repositoryIdentity.id) !== manifest.authority.repositoryId ||
    repositoryIdentity.node_id !== manifest.authority.repositoryNodeId ||
    typeof repositoryIdentity.full_name !== "string" ||
    repositoryIdentity.full_name.toLowerCase() !== currentPath.toLowerCase() ||
    repositoryIdentity.private !== false
  )
    throw refusal(
      new AcquisitionRefusal("Immutable repository identity mismatch"),
    );
  const index = json(
    await bytes(fetcher, `${origin}/skill-templates/index.json`),
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
      (revision) => typeof revision !== "string" || revision.length > 128,
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
  // One shallow Git fetch of the exact commit. It sends no credential: the
  // source is public, and the GitHub token stays on the API reads above.
  const acquired = await acquireRepository({
    repository: currentPath,
    commitSha: assessment.commitSha,
    directory,
    testRemote: connection.testGitRemote?.(currentPath),
  }).catch((error: unknown) => {
    if (error instanceof AcquisitionRefusal) throw refusal(error);
    throw error;
  });
  try {
    const sourceInventoryBytes = await readFile(
      join(acquired.directory, "inventory.json"),
    );
    if (sha256(sourceInventoryBytes) !== acquired.inventorySha256)
      throw new Error("Source inventory changed");
    const sourceInventory = json(sourceInventoryBytes);
    if (
      !Array.isArray(sourceInventory.visibilityGaps) ||
      sourceInventory.visibilityGaps.some((gap) => typeof gap !== "string")
    )
      throw new Error("Invalid source coverage");
    const inputs = [];
    const inputDigests = new Map<string, string>();
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
        throw new AcquisitionRefusal("Template acquisition size limit", {
          unit: "bytes",
          observed: templateBytes,
          maximum: 32 * 1024 * 1024,
        });
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
      const existing = inputDigests.get(source.path);
      if (existing !== undefined && existing !== source.sha256)
        throw new Error("Conflicting template input digests");
      if (existing === undefined) {
        inputDigests.set(source.path, source.sha256);
        inputs.push({
          path: source.path,
          sha256: source.sha256,
          state: "quarantined",
        });
      }
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
    if (error instanceof AcquisitionRefusal) throw refusal(error);
    throw error;
  }
}
