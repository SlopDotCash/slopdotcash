import type { ScoreEvent } from "./leaderboard-types";
import { findHistoricalRepository } from "./projects.mjs";

/** One GitHub item across node-ID formats, URL case and registered transfers. */
export function githubWorkKey(
  repository: string,
  source: ScoreEvent["source"],
): string | null {
  if (source.kind === "external") return null;
  const url = new URL(source.url);
  const path = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/([1-9][0-9]*)\/?$/u,
  );
  const expected = findHistoricalRepository(repository);
  const actual = path && findHistoricalRepository(`${path[1]}/${path[2]}`);
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    !path ||
    !expected ||
    !actual ||
    actual.repositoryId !== expected.repositoryId ||
    !Number.isSafeInteger(source.number) ||
    Number(path[3]) !== source.number ||
    (url.hash !== "" &&
      !/^#(?:issuecomment-|pullrequestreview-|discussion_r)[0-9]+$/iu.test(
        url.hash,
      ))
  )
    throw new TypeError("GitHub work must match a registered repository item");
  return JSON.stringify([
    expected.repositoryId,
    source.number,
    url.hash.toLowerCase(),
  ]);
}
