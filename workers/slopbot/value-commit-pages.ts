/** Reuse immutable commit pages and complete policy files within one publication. */
import type { GitHubClient } from "./github";
import type {
  CommitChangeEvidence,
  EvidenceClient,
} from "./value-evidence-types";

const PAGE_LIMIT = 2048;
const BYTE_LIMIT = 32 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/u;
const pagePath =
  /^(\/repos\/[^/]+\/[^/]+)\/commits\/([a-f0-9]{40})\?per_page=100&page=[1-9][0-9]*$/u;
const repositoryPath = /^\/repos\/[^/]+\/[^/]+$/u;

function lineCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validPage(value: unknown, sha: string) {
  const page = value as CommitChangeEvidence | null;
  return (
    page?.sha === sha &&
    typeof page.html_url === "string" &&
    page.html_url.length > 0 &&
    Array.isArray(page.parents) &&
    page.parents.every((parent) => shaPattern.test(parent?.sha ?? "")) &&
    !!page.stats &&
    lineCount(page.stats.additions) &&
    lineCount(page.stats.deletions) &&
    page.stats.total === page.stats.additions + page.stats.deletions &&
    Array.isArray(page.files) &&
    page.files.length <= 100 &&
    page.files.every(
      (file) =>
        file &&
        typeof file.filename === "string" &&
        file.filename.length > 0 &&
        typeof file.status === "string" &&
        file.status.length > 0 &&
        lineCount(file.additions) &&
        lineCount(file.deletions) &&
        (file.previous_filename === undefined ||
          typeof file.previous_filename === "string") &&
        (file.patch === undefined || typeof file.patch === "string") &&
        (file.blob_url === null || typeof file.blob_url === "string"),
    ) &&
    new Set(page.files.map((file) => file.filename)).size === page.files.length
  );
}

/** Each wrapped client rechecks live public repository identity before reuse.
 * PRs, discussions and installation membership always reach GitHub. Pinned
 * policy bytes may be shared; policy parsing and enforcement still run each time.
 */
export function publicationCommitPages() {
  const pages = new Map<string, string>();
  const identities = new Map<string, string>();
  let bytes = 0;
  return <T extends EvidenceClient & Partial<Pick<GitHubClient, "fileText">>>(
    client: T,
  ): T => {
    const verified = new Set<string>();
    const wrapped = Object.create(client) as T;
    wrapped.get = async <R>(path: string): Promise<R | null> => {
      const match = pagePath.exec(path);
      const authorized = match && verified.has(match[1]);
      const saved = authorized ? pages.get(path) : undefined;
      if (saved !== undefined) return JSON.parse(saved) as R;
      const value = await client.get<R>(path);
      if (repositoryPath.test(path)) {
        const live = value as {
          id?: number;
          node_id?: string;
          private?: boolean;
        } | null;
        verified.delete(path);
        if (
          live?.private === false &&
          Number.isSafeInteger(live.id) &&
          Number(live.id) > 0 &&
          typeof live.node_id === "string" &&
          live.node_id.length > 0
        ) {
          const identity = JSON.stringify([live.id, live.node_id]);
          if (!identities.has(path)) identities.set(path, identity);
          if (identities.get(path) === identity) verified.add(path);
        }
      }
      if (
        authorized &&
        match &&
        !pages.has(path) &&
        pages.size < PAGE_LIMIT &&
        bytes < BYTE_LIMIT &&
        validPage(value, match[2])
      ) {
        const serialized = JSON.stringify(value);
        const size = new TextEncoder().encode(serialized).length;
        if (bytes + size <= BYTE_LIMIT) {
          pages.set(path, serialized);
          bytes += size;
        }
      }
      return value;
    };
    if (client.fileText) {
      const fileText = client.fileText.bind(client);
      wrapped.fileText = async (owner, repo, path, ref, maxBytes) => {
        const repository = `/repos/${owner}/${repo}`;
        const authorized = shaPattern.test(ref) && verified.has(repository);
        const key = JSON.stringify([repository, path, ref, maxBytes]);
        const saved = authorized ? pages.get(key) : undefined;
        if (saved !== undefined) return JSON.parse(saved);
        const value = await fileText(owner, repo, path, ref, maxBytes);
        if (
          authorized &&
          value &&
          value.truncated === false &&
          typeof value.text === "string" &&
          !pages.has(key) &&
          pages.size < PAGE_LIMIT &&
          bytes < BYTE_LIMIT
        ) {
          const serialized = JSON.stringify(value);
          const size = new TextEncoder().encode(serialized).length;
          if (bytes + size <= BYTE_LIMIT) {
            pages.set(key, serialized);
            bytes += size;
          }
        }
        return value;
      };
    }
    return wrapped;
  };
}
