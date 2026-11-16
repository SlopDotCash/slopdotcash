/** One source-discovery query permits only its own confirmed missing-item error. */
export const VALUE_REFERENCE_QUERY =
  "query SlopValuePublicReference($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id isPrivate nameWithOwner issueOrPullRequest(number:$number){__typename ... on PullRequest{id number url}}} rateLimit{cost limit remaining resetAt}}";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function isConfirmedMissingPublicReference(
  query: string,
  variables: Record<string, unknown>,
  envelope: unknown,
): boolean {
  if (query !== VALUE_REFERENCE_QUERY || !object(envelope)) return false;
  const data = envelope.data;
  if (!object(data) || !object(data.repository)) return false;
  const repository = data.repository;
  const rateLimit = data.rateLimit;
  const expected = `${variables.owner}/${variables.name}`;
  return (
    object(rateLimit) &&
    Number.isSafeInteger(rateLimit.cost) &&
    Number(rateLimit.cost) >= 0 &&
    Number.isSafeInteger(rateLimit.limit) &&
    Number(rateLimit.limit) > 0 &&
    Number.isSafeInteger(rateLimit.remaining) &&
    Number(rateLimit.remaining) >= 0 &&
    Number(rateLimit.remaining) <= Number(rateLimit.limit) &&
    typeof rateLimit.resetAt === "string" &&
    Number.isFinite(Date.parse(rateLimit.resetAt)) &&
    Number.isSafeInteger(variables.number) &&
    Number(variables.number) > 0 &&
    typeof variables.owner === "string" &&
    typeof variables.name === "string" &&
    repository.isPrivate === false &&
    typeof repository.id === "string" &&
    /^(?:R_[A-Za-z0-9_-]+|[A-Za-z0-9+/]+=*)$/u.test(repository.id) &&
    typeof repository.nameWithOwner === "string" &&
    repository.nameWithOwner.toLowerCase() === expected.toLowerCase() &&
    repository.issueOrPullRequest === null &&
    Array.isArray(envelope.errors) &&
    envelope.errors.length === 1 &&
    object(envelope.errors[0]) &&
    envelope.errors[0].type === "NOT_FOUND" &&
    JSON.stringify(envelope.errors[0].path) ===
      '["repository","issueOrPullRequest"]'
  );
}
