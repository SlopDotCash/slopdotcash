// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"

export interface ManifestComparison {
  readonly baseSha: string;
  readonly headSha: string;
  readonly before: { readonly text: string };
  readonly after: { readonly text: string };
}

export interface ManifestChange {
  readonly filename: string;
  readonly status: string;
  readonly previous_filename?: string;
  readonly fullComparison?: ManifestComparison;
}

export interface ManifestCommit {
  readonly sha: string;
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
}

const tokenPattern = /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/gu;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const manifestPath = /(^|\/)package\.json$/u;

class DuplicateKey extends Error {}

/** @throws {never} */
export function exactJsonIdentity(source: string): string | null {
  try {
    JSON.parse(source);
    const tokens = source.match(tokenPattern) ?? [];
    let cursor = 0;
    const value = (path: ReadonlyArray<string>): unknown => {
      const token = tokens[cursor++];
      if (token === "{") {
        const entries = new Map<string, unknown>();
        while (tokens[cursor] !== "}") {
          const key = JSON.parse(tokens[cursor++] ?? "") as string;
          if (entries.has(key)) throw new DuplicateKey(key);
          cursor++;
          entries.set(key, value([...path, key]));
          if (tokens[cursor] !== ",") break;
          cursor++;
        }
        cursor++;
        const ordered = [...entries];
        if (
          path.length === 1 &&
          path[0] === "overrides" &&
          ordered.every(([key, entry]) => packageName.test(key) && Array.isArray(entry) && entry[0] === "string")
        )
          ordered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return ["object", ordered];
      }
      if (token === "[") {
        const entries: unknown[] = [];
        while (tokens[cursor] !== "]") {
          entries.push(value([...path, String(entries.length)]));
          if (tokens[cursor] !== ",") break;
          cursor++;
        }
        cursor++;
        return ["array", entries];
      }
      return token?.startsWith('"') ? ["string", JSON.parse(token)] : ["literal", token];
    };
    const identity = value([]);
    return cursor === tokens.length ? JSON.stringify(identity) : null;
  } catch {
    return null;
  }
}

/** @throws {never} */
export function manifestIdentity(file: ManifestChange, commit: ManifestCommit): string | null {
  const comparison = file.fullComparison;
  const parent = commit.parents[0];
  if (
    !manifestPath.test(file.filename) ||
    file.status !== "modified" ||
    file.previous_filename !== undefined ||
    comparison === undefined ||
    commit.parents.length !== 1 ||
    parent === undefined ||
    comparison.headSha !== commit.sha ||
    comparison.baseSha !== parent.sha
  )
    return null;
  const before = exactJsonIdentity(comparison.before.text);
  const after = exactJsonIdentity(comparison.after.text);
  if (before === null || after === null || before === after) return null;
  return JSON.stringify([file.filename, "manifest", before, after]);
}
