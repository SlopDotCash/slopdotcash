/**
 * Appended project repositories. A project's first repository keeps its
 * identity in `authority`; later entries carry their own GitHub ids and the
 * UTC month from which their work counts.
 */

import { canonical } from "./project-policy.mjs";

/** The first instant of the UTC month after `now`, as an exact ISO string. */
export function nextUtcMonthStart(now) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
}

function sameEntry(left, right) {
  return canonical(left) === canonical(right);
}

/**
 * The entries `next` adds after `previous.repositories`, an empty array when
 * the lists are equal, or null when `next` is not `previous` plus a suffix.
 */
export function appendedRepositories(previous, next) {
  const before = previous.repositories;
  const after = next.repositories;
  if (after.length < before.length) return null;
  for (let index = 0; index < before.length; index += 1) {
    if (!sameEntry(before[index], after[index])) return null;
  }
  return after.slice(before.length);
}

function findRepository(manifest, repositoryId) {
  const wanted = repositoryId.toLowerCase();
  const index = manifest.repositories.findIndex((repository) =>
    [repository.id, ...(repository.aliases ?? [])].some(
      (candidate) => candidate.toLowerCase() === wanted,
    ),
  );
  return index < 0 ? null : { index, repository: manifest.repositories[index] };
}

/** The permanent GitHub identity of a listed repository, or null. */
export function repositoryIdentity(manifest, repositoryId) {
  const found = findRepository(manifest, repositoryId);
  if (found === null) return null;
  if (found.index === 0) {
    const { repositoryId: githubId, repositoryNodeId: nodeId } =
      manifest.authority ?? {};
    return githubId && nodeId ? { githubId, nodeId } : null;
  }
  const { githubId, nodeId } = found.repository;
  return githubId && nodeId ? { githubId, nodeId } : null;
}

/** Milliseconds from which the repository counts; null means the project start. */
export function repositoryCountsFrom(manifest, repositoryId) {
  const found = findRepository(manifest, repositoryId);
  const countsFrom = found?.repository.countsFrom;
  return countsFrom === undefined ? null : Date.parse(countsFrom);
}

/** The repositories whose work counts in the month starting at `monthStartMs`. */
export function repositoriesCountedFor(manifest, monthStartMs) {
  return manifest.repositories.filter(
    (repository) =>
      repository.countsFrom === undefined ||
      Date.parse(repository.countsFrom) <= monthStartMs,
  );
}
