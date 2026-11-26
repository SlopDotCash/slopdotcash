// spec/security/cases.md, "A claimed link settles against GitHub when its reporter or a maintainer checks the receipt"
const labels: Readonly<Record<string, string>> = {
  triage: "Open, in triage",
  draft: "Open, draft",
  published: "Published",
  closed: "Closed",
};

const closingReceipts: ReadonlySet<string> = new Set(["duplicate", "out-of-scope", "rejected"]);

export interface AdvisoryGithubLine {
  readonly label: string;
  readonly closeOnGithub: boolean;
}

/** @throws {never} */
export function advisoryGithubLine(input: {
  readonly githubState: string | null | undefined;
  readonly receiptState: string | null | undefined;
  readonly maintainer: boolean;
}): AdvisoryGithubLine | null {
  const label = input.githubState ? labels[input.githubState] : undefined;
  if (label === undefined) return null;
  return {
    label,
    closeOnGithub:
      input.maintainer &&
      (input.githubState === "triage" || input.githubState === "draft") &&
      closingReceipts.has(input.receiptState ?? ""),
  };
}
