// spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"
import { declarationOf, fenceOf, type Fence, withoutHtmlComments } from "./policy.ts";

const legacyIntegration = /^Every change ships through a PR against `([A-Za-z0-9_./-]+)`; do not push feature or fix$/u;

export function historicalCorrectionBranch(text: string, branch: string): boolean {
  const authority = new Set<string>();
  let open: Fence | null = null;
  const lines = withoutHtmlComments(text).split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const fence = fenceOf(line);
    if (fence !== null) {
      if (open === null) open = fence;
      else if (fence.marker === open.marker && fence.run >= open.run && fence.bare) open = null;
      continue;
    }
    if (open !== null) continue;
    const canonical = declarationOf(line);
    if (canonical !== null) authority.add(canonical);
    const legacy = legacyIntegration.exec(line)?.[1];
    if (legacy !== undefined && lines[index + 1]?.startsWith(`work straight to \`${legacy}\`. `)) authority.add(legacy);
  }
  return authority.size === 1 && authority.has(branch);
}
