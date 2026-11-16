import { decodeBase64 } from "../../src/lib/byte-encoding";
import type { EvidenceClient, ValueBranchPolicy } from "./value-evidence-types";

function declaredIntegrationBranch(text: string): string | null {
  // Recognize an explicit policy sentence, not examples in fenced code blocks.
  const branches = new Set<string>();
  let fence: { marker: string; length: number } | null = null;
  for (const line of text
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .split(/\r?\n/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter) {
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
  const bytes = decodeBase64(file.content.replace(/\s/gu, ""));
  if (bytes.length !== file.size)
    throw new Error("Historical branch policy size mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (declaredIntegrationBranch(text) === null)
    throw new Error("Historical integration branch is absent or ambiguous");
  return { baseSha, path: "CONTRIBUTING.md", text };
}
