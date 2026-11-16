import type { FileChange } from "./value-evidence-types";

/** Ignore flat package override order only; conditional exports remain ordered.
 * JSON.parse alone loses duplicate keys and rounds large numeric values. */
function exactJsonIdentity(source: string): string | null {
  try {
    JSON.parse(source); // Validate grammar before walking the original tokens.
    const tokens =
      source.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/gu) ?? [];
    let cursor = 0;
    function value(path: string[] = []): unknown {
      const token = tokens[cursor++];
      if (token === "{") {
        const entries = new Map<string, unknown>();
        while (tokens[cursor] !== "}") {
          const key = JSON.parse(tokens[cursor++]) as string;
          if (entries.has(key)) throw new Error("Duplicate JSON key");
          cursor++; // colon; grammar already checked
          entries.set(key, value([...path, key]));
          if (tokens[cursor] !== ",") break;
          cursor++;
        }
        cursor++;
        const ordered = [...entries];
        if (
          path.length === 1 &&
          path[0] === "overrides" &&
          ordered.every(
            ([key, entry]) =>
              /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(key) &&
              Array.isArray(entry) &&
              entry[0] === "string",
          )
        ) {
          ordered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        }
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
      return token?.startsWith('"')
        ? ["string", JSON.parse(token)]
        : ["literal", token];
    }
    const identity = value();
    return cursor === tokens.length ? JSON.stringify(identity) : null;
  } catch {
    return null;
  }
}

/** Full manifest comparisons are collected from immutable GitHub contents and
 * verified against Git blob hashes. Bind both ends to the commit being matched.
 * This recognizes an identical manifest change, not arbitrary semantic edits. */
export function retainedManifestIdentity(
  file: FileChange,
  commit: { sha: string; parents: { sha: string }[] },
): string | null {
  const comparison = file.fullComparison;
  if (
    !/(^|\/)package\.json$/u.test(file.filename) ||
    file.status !== "modified" ||
    file.previous_filename !== undefined ||
    !comparison ||
    commit.parents.length !== 1 ||
    comparison.headSha !== commit.sha ||
    comparison.baseSha !== commit.parents[0].sha
  )
    return null;
  const before = exactJsonIdentity(comparison.before.text);
  const after = exactJsonIdentity(comparison.after.text);
  if (before === null || after === null || before === after) return null;
  return JSON.stringify([file.filename, "manifest", before, after]);
}
