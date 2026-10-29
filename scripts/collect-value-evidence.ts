/** Read-only evidence export. Raw source evidence stays outside the repository. */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { collectTargetRepositories } from "../src/lib/repositories.mjs";
import { GitHubClient } from "../workers/slopbot/github";
import {
  collectValueContext,
  type ValueContextSelection,
} from "../workers/slopbot/value-context";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import { resolveGitHubToken } from "./github-token";
import { isInsideDirectory } from "./path-containment";
import {
  fetchProjectRegistry,
  renderProjectRevisions,
} from "./sync-project-registry.mjs";
import { collectMergeResolutions } from "./value-merge-resolution";

const [repository, numberText, directory, ...contextArgs] =
  process.argv.slice(2);
if (!repository || !numberText || !directory)
  throw new Error(
    "Usage: bun scripts/collect-value-evidence.ts owner/repo PR_NUMBER /absolute/private-output-directory [--local-git /absolute/repository] [context-path | --context-at SHA path ...]",
  );
const contextPaths: ValueContextSelection[] = [];
let localGit: string | undefined;
for (let index = 0; index < contextArgs.length; index += 1) {
  if (contextArgs[index] === "--local-git") {
    localGit = contextArgs[++index];
    if (!localGit || !isAbsolute(localGit))
      throw new Error("--local-git requires an absolute repository path");
    continue;
  }
  if (contextArgs[index] !== "--context-at") {
    contextPaths.push(contextArgs[index]);
    continue;
  }
  const ref = contextArgs[++index];
  const path = contextArgs[++index];
  if (!ref || !/^[a-f0-9]{40}$/u.test(ref) || !path)
    throw new Error(
      "--context-at requires an immutable SHA and repository path",
    );
  contextPaths.push({ path, ref });
}
const output = resolve(directory);
if (!isAbsolute(directory))
  throw new Error("Output directory must be absolute");
const repositoryRoot = await realpath(resolve(import.meta.dir, ".."));
if (isInsideDirectory(repositoryRoot, output))
  throw new Error("Raw evidence must be outside the repository");
await mkdir(output, { recursive: true, mode: 0o700 });
const canonicalOutput = await realpath(output);
if (isInsideDirectory(repositoryRoot, canonicalOutput))
  throw new Error(
    "Raw evidence must be outside the repository, including through symlinks",
  );
// Use the same typed provider failures as authenticated journal collection.
// Retained-reference discovery distinguishes an absent/ambiguous commit from
// a provider outage; collapsing both into a generic CLI error stops valid PRs.
const client = GitHubClient.forToken(await resolveGitHubToken());
const registry = await fetchProjectRegistry();
const projects = assertProjectRegistry(registry.projects);
renderProjectRevisions(registry.revisions, projects);
const repositoryPolicy = collectTargetRepositories(projects).find((entry) =>
  [entry.id, ...entry.aliases].some(
    (id) => id.toLowerCase() === repository.toLowerCase(),
  ),
);
if (!repositoryPolicy)
  throw new Error("Repository is not active in the live project registry");
const collected = await collectValueEvidence(
  client,
  repository,
  Number(numberText),
  repositoryPolicy,
);
const contextual = await collectValueContext(client, collected, contextPaths);
const evidence = localGit
  ? await collectMergeResolutions(contextual, localGit)
  : contextual;
const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const path = `${canonicalOutput}/${repository.replace("/", "-")}-${numberText}-${digest}.json`;
await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
console.log(
  JSON.stringify({
    path,
    sha256: digest,
    complete: evidence.limitations.length === 0,
    limitations: evidence.limitations,
    files: evidence.files.length,
    reviews: evidence.reviews.length,
    comments: evidence.comments.length + evidence.reviewComments.length,
  }),
);
