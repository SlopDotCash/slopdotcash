import { createHash } from "node:crypto";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { isExactUtc, isRecord } from "../src/lib/record-validation.mjs";
import { renderProjectRevisions } from "./sync-project-registry.mjs";

function canonicalInstant(value: unknown): number {
  if (!isExactUtc(value))
    throw new Error(
      "Correction registry time is not a canonical UTC timestamp",
    );
  return Date.parse(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Keep the receipt's full registry digest as the authority. A changed live
 * registry may replay it only from immutable revisions, and only when every
 * selected project's full manifest and revision history are still identical.
 */
export function assertCorrectionRegistry(
  archivedDigest: unknown,
  through: unknown,
  projects: readonly string[] | undefined,
  registry: unknown,
): void {
  if (
    typeof archivedDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(archivedDigest)
  )
    throw new Error("Correction registry digest is invalid");
  const cutoff = canonicalInstant(through);
  if (
    projects !== undefined &&
    (!Array.isArray(projects) ||
      projects.length === 0 ||
      [...projects].some(
        (id) => typeof id !== "string" || id.length === 0 || id.trim() !== id,
      ) ||
      new Set(projects).size !== projects.length)
  )
    throw new Error("Correction registry requires distinct selected projects");
  // Preserve the original full-digest check for legacy receipts with no scope.
  if (digest(registry) === archivedDigest) return;

  if (projects === undefined)
    throw new Error(
      "Historical correction registry requires selected projects",
    );
  if (
    !isRecord(registry) ||
    Object.keys(registry).sort().join(",") !== "projects,revisions,withheld" ||
    !Array.isArray(registry.revisions) ||
    !Array.isArray(registry.withheld)
  )
    throw new Error("Correction registry history is malformed");
  const current = assertProjectRegistry(registry.projects);
  renderProjectRevisions(registry.revisions, current);
  const withheld = new Set(registry.withheld);
  if (
    withheld.size !== registry.withheld.length ||
    registry.withheld.some(
      (id) =>
        typeof id !== "string" || !current.some((project) => project.id === id),
    )
  )
    throw new Error("Correction registry withheld scope is malformed");

  const latest = new Map<string, Record<string, unknown>>();
  const archived = new Map<string, unknown>();
  const revisions: Record<string, unknown>[] = [];
  const laterProjects = new Set<string>();
  let previousProjectId = "";
  let previousTime = -Infinity;
  for (const row of registry.revisions) {
    // The renderer validates immutable manifests, digests and contiguous
    // revisions. Preserve the D1 API's original row order and property order
    // for the archived JSON hash; the renderer has its own output format.
    if (
      !isRecord(row) ||
      !isRecord(row.manifest) ||
      typeof row.projectId !== "string" ||
      typeof row.reason !== "string" ||
      !row.reason.trim()
    )
      throw new Error("Correction registry revision is malformed");
    const time = canonicalInstant(row.createdAt);
    if (
      row.projectId < previousProjectId ||
      (row.projectId === previousProjectId && time < previousTime)
    )
      throw new Error("Correction registry revision order changed");
    previousProjectId = row.projectId;
    previousTime = time;
    latest.set(row.projectId, row.manifest);
    if (time <= cutoff) {
      archived.set(row.projectId, row.manifest);
      revisions.push(row);
    } else laterProjects.add(row.projectId);
  }
  const orderedCurrent = [...latest].map(([id, manifest]) => {
    if (!withheld.has(id)) return manifest;
    if (manifest.status === "paused" && manifest.listingTier === "retired")
      throw new Error(
        "Correction registry withheld scope does not match history",
      );
    return { ...manifest, status: "paused", listingTier: "retired" };
  });
  if (JSON.stringify(orderedCurrent) !== JSON.stringify(current))
    throw new Error(
      "Correction registry manifests do not match ordered immutable history",
    );

  const archivedProjects = assertProjectRegistry([...archived.values()]);
  // A pending restriction has no immutable history. Replaying an empty
  // archived withheld list is safe only when the full frozen digest proves it.
  if (
    digest({ projects: archivedProjects, revisions, withheld: [] }) !==
    archivedDigest
  )
    throw new Error(
      "Archived correction registry cannot be reproduced exactly",
    );

  const selected = new Set(projects);
  const archivedScope = archivedProjects.filter((project) =>
    selected.has(project.id),
  );
  const currentScope = current.filter((project) => selected.has(project.id));
  if (
    archivedScope.length !== projects.length ||
    JSON.stringify(archivedScope) !== JSON.stringify(currentScope) ||
    projects.some((id) => laterProjects.has(id) || withheld.has(id))
  )
    throw new Error("Selected correction registry scope changed");
}
