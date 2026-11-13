/**
 * Manual production release on published data only.
 *
 * A published census taken before a project was activated lacks that
 * project's repository, or still lists a repository that is now inactive.
 * Keep retained PR counts and issue history, archive inactive issues through
 * their existing channel, and add genuinely new repositories with zero counts.
 * The next full collection replaces the census with fresh observations.
 */
import { readFile, writeFile } from "node:fs/promises";
import { assertProfiles, type ProfileIndex } from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { assertRetainedProfiles } from "./published-profiles";

export function extendPublishedProfiles(
  census: ProfileIndex,
  targets: readonly string[] = TARGET_REPOSITORIES.map((r) => r.id),
): { census: ProfileIndex; added: string[] } {
  assertRetainedProfiles(census);
  const collected = new Set(census.repositories.map((r) => r.repository));
  const added = targets.filter((id) => !collected.has(id));
  const result: ProfileIndex = {
    ...census,
    repositories: [
      ...census.repositories,
      ...added.map((repository) => ({ repository, count: 0, excluded: 0 })),
    ],
  };
  if (census.issues) {
    const active = new Set(targets);
    const retained = [
      ...census.issues.items,
      ...(census.issues.archived ?? []),
    ];
    const items = retained.filter((issue) => active.has(issue.repository));
    const archived = retained.filter((issue) => !active.has(issue.repository));
    const previous = new Map(
      census.issues.repositories.map((row) => [row.repository, row]),
    );
    const counts = new Map<string, number>();
    for (const issue of items)
      if (issue.unavailableSince === null)
        counts.set(issue.repository, (counts.get(issue.repository) ?? 0) + 1);
    result.issues = {
      ...census.issues,
      repositories: targets.map(
        (repository) =>
          previous.get(repository) ?? {
            repository,
            count: counts.get(repository) ?? 0,
          },
      ),
      items,
      ...(archived.length > 0 || census.issues.archived !== undefined
        ? { archived }
        : {}),
    };
  }
  assertProfiles(result, targets);
  return { census: result, added };
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) throw Error("usage: extend-published-profiles.ts <profiles.json>");
  const { census, added } = extendPublishedProfiles(
    JSON.parse(await readFile(path, "utf8")),
  );
  await writeFile(path, `${JSON.stringify(census)}\n`);
  console.log(
    added.length
      ? `Added newly active repositories to the retained census: ${added.join(", ")}`
      : "Published census reconciled with every active repository",
  );
}
