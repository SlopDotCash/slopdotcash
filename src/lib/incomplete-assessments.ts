/** Safe private Inbox metadata; never a review body or scoring decision. */
export type IncompleteAssessment = {
  projectId: string;
  projectName: string;
  repository: string;
  pullRequest: number;
  since: string;
  retryAt: string | null;
  running: boolean;
};

export type IncompleteAssessments = {
  recipientGithubId: string;
  items: IncompleteAssessment[];
  next: string | null;
};

export function parseIncompleteAssessments(
  value: unknown,
): IncompleteAssessments {
  const body = value as IncompleteAssessments | null;
  if (
    !body ||
    !/^[1-9][0-9]{0,19}$/u.test(body.recipientGithubId) ||
    !Array.isArray(body.items) ||
    body.items.length > 25 ||
    !(
      body.next === null ||
      (typeof body.next === "string" && body.next.length <= 1000)
    ) ||
    !body.items.every(
      (item) =>
        typeof item.projectId === "string" &&
        typeof item.projectName === "string" &&
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(item.repository) &&
        Number.isSafeInteger(item.pullRequest) &&
        item.pullRequest > 0 &&
        Number.isFinite(Date.parse(item.since)) &&
        (item.retryAt === null || Number.isFinite(Date.parse(item.retryAt))) &&
        typeof item.running === "boolean",
    )
  )
    throw new Error("The assessment queue returned an invalid response.");
  return body;
}
