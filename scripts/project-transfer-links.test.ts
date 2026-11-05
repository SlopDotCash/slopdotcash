// A recorded repository transfer must move the project links with it.
// `links.repository` / `links.issues` are derived from the primary
// repository when a project is created, and the project page's GitHub link
// and the security page's "View in GitHub" link publish them verbatim.
// `assertRepositoryTransition` already forces a transfer revision to
// publish the appended alias as the repository's current identity through
// `githubUrl` and `displayName`; before this fix nothing forced the
// visitor-facing links to move, so a transfer revision could leave the
// public pages publishing the pre-transfer path indefinitely.
import { expect, test } from "bun:test";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import { RAW_PROJECT_DEFINITIONS } from "../tests/fixtures/project-registry.mjs";

const asi = RAW_PROJECT_DEFINITIONS.find((project) => project.id === "asi");
if (!asi) throw new Error("asi fixture missing");
const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
const OLD = "elizaOS/asi";
const NEW = "SlopDotCash/asi";
const swap = (value: unknown) =>
  typeof value === "string" ? value.replaceAll(NEW, OLD) : value;

// asi's manifest before its recorded transfer, rebuilt the way the
// registry recorded it: repository-bound URLs under the original name, no
// aliases, and the terms revision + receipt-policy binding the transfer
// later appended rolled back.
function beforeTransfer() {
  const before = clone(asi);
  before.repositories = [
    {
      ...before.repositories[0],
      aliases: undefined,
      displayName: OLD,
      githubUrl: `https://github.com/${OLD}`,
    },
  ];
  before.links = {
    ...before.links,
    repository: `https://github.com/${OLD}`,
    issues: `https://github.com/${OLD}/issues`,
  };
  before.authority = {
    ...before.authority,
    proof: { ...before.authority.proof, url: swap(before.authority.proof.url) },
  };
  const [firstBinding] = before.terms.receiptPolicy.bindings;
  before.terms = {
    ...before.terms,
    revision: firstBinding.policyRevision,
    effectiveAt: firstBinding.activatedAt,
    repositoryLicense: {
      ...before.terms.repositoryLicense,
      url: swap(before.terms.repositoryLicense.url),
    },
    inbound: {
      ...before.terms.inbound,
      termsUrl: swap(before.terms.inbound.termsUrl),
    },
    receiptPolicy: {
      ...before.terms.receiptPolicy,
      bindings: [firstBinding],
    },
  };
  return before;
}

test("the recorded transfer, links moved with it, publishes", () => {
  expect(() =>
    assertProjectPolicyTransition(beforeTransfer(), clone(asi)),
  ).not.toThrow();
});

test("a transfer that leaves the project links at the old path is refused", () => {
  const stale = clone(asi);
  stale.links = {
    ...stale.links,
    repository: `https://github.com/${OLD}`,
    issues: `https://github.com/${OLD}/issues`,
  };
  expect(() => assertProjectPolicyTransition(beforeTransfer(), stale)).toThrow(
    "a repository transfer must publish its appended alias in the project links",
  );
});

test("a transfer that moves only the repository link is refused", () => {
  const stale = clone(asi);
  stale.links = {
    ...stale.links,
    issues: `https://github.com/${OLD}/issues`,
  };
  expect(() => assertProjectPolicyTransition(beforeTransfer(), stale)).toThrow(
    "a repository transfer must publish its appended alias in the project links",
  );
});

test("a revision with no transfer may still repoint the project links", () => {
  const repointed = clone(asi);
  repointed.links = {
    ...repointed.links,
    repository: "https://github.com/example/elsewhere",
    issues: "https://github.com/example/elsewhere/issues",
  };
  expect(() =>
    assertProjectPolicyTransition(clone(asi), repointed),
  ).not.toThrow();
});
