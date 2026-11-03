import type { EvidenceClient } from "./value-evidence";

/** Historical authority comes from accepted base policy, never a PR's head. */
export interface ValueBranchPolicy {
  baseSha: string;
  path: "CONTRIBUTING.md";
  text: string;
}

export function declaredIntegrationBranch(text: string): string | null {
  // Recognize an explicit policy sentence, not examples in fenced code blocks.
  const branches = new Set<string>();
  let fence: { marker: string; length: number } | null = null;
  for (const line of text
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .split(/\r?\n/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    // CommonMark: the info string of a backtick fence cannot contain a
    // backtick, so a line like "```bun run verify``` passes." is an inline
    // code span, not a fence opening. Tilde fences may contain backticks.
    const inlineSpan =
      delimiter !== null &&
      fence === null &&
      delimiter[1][0] === "`" &&
      delimiter[2].includes("`");
    if (delimiter && !inlineSpan) {
      if (fence === null)
        fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    const declaration = /^Pull requests target `([^`\r\n]+)`\./u.exec(line);
    if (declaration) branches.add(declaration[1]);
  }
  return branches.size === 1 ? [...branches][0] : null;
}

export function matchesHistoricalIntegrationBranch(
  policy: ValueBranchPolicy | undefined,
  base: { sha: string; ref: string },
): boolean {
  return (
    policy !== undefined &&
    /^[a-f0-9]{40}$/u.test(base.sha) &&
    policy.baseSha === base.sha &&
    policy.path === "CONTRIBUTING.md" &&
    declaredIntegrationBranch(policy.text) === base.ref
  );
}

export async function collectBranchPolicy(
  client: EvidenceClient,
  repository: string,
  baseSha: string,
): Promise<ValueBranchPolicy> {
  if (!/^[a-f0-9]{40}$/u.test(baseSha))
    throw new Error("Invalid policy revision");
  const file = await client.get<{
    type: string;
    path: string;
    encoding: string;
    content: string;
    size: number;
  }>(`/repos/${repository}/contents/CONTRIBUTING.md?ref=${baseSha}`);
  if (
    !file ||
    file.type !== "file" ||
    file.path !== "CONTRIBUTING.md" ||
    file.encoding !== "base64" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 65536 ||
    typeof file.content !== "string"
  )
    throw new Error("Complete historical branch policy is unavailable");
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/gu, "")), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length !== file.size)
    throw new Error("Historical branch policy size mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (declaredIntegrationBranch(text) === null)
    throw new Error("Historical integration branch is absent or ambiguous");
  return { baseSha, path: "CONTRIBUTING.md", text };
}
