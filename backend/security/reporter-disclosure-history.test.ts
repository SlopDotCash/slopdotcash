/** Reporter history for disclosure entries (PRD section 8, section 10
 * "Disclosure"). The case UI renders a disclosure event's approved-content
 * digest and embargo change in the shared history list, but the reporter
 * view used to strip every event's detail, so the reporter — the party
 * bound by the embargo and the author of the redacted text — saw only the
 * generic label and reason while the maintainer saw the actual change.
 * Restricted material (evidence references, root cause, triagers, the AI
 * analysis) stays hidden from the reporter.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { GithubPrivateReport } from "./advisories";
import { handleSecurityApi } from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ORIGIN = "https://slop.test";
const PROJECT = "bounty";
const REPOSITORY = "example/bounty";
const MAINTAINER = { githubId: "900000101", githubLogin: "maintainer" };
const REPORTER = { githubId: "900000102", githubLogin: "reporter" };
const TRIAGER = { githubId: "900000103", githubLogin: "triager" };
const FINANCE = { githubId: "900000104", githubLogin: "finance" };
const DISPUTE = { githubId: "900000105", githubLogin: "dispute" };
const OUTSIDER = { githubId: "900000199", githubLogin: "outsider" };
const AT = "2026-10-19T09:00:00.000Z";
const DIGEST = "a".repeat(64);
const EMBARGO =
  "Embargo extended until the private retest completes on 2027-02-01.";
const EVIDENCE = "maintainer-private-evidence-ref-xyz";

const PROGRAM = {
  status: "open",
  intake: { repository: REPOSITORY },
  amount: {
    currency: "USDC",
    decimals: 6,
    network: "base",
    grossMinor: "1000000",
  },
  funding: {
    state: "verified-available",
    evidence: "synthetic",
    verifiedAt: AT,
  },
  fundingPolicy: "after-approval",
  sponsor: { name: "Slop", githubId: null },
  approvers: {
    technical: [MAINTAINER],
    financial: [FINANCE],
    dispute: [DISPUTE],
  },
  capacity: { awards: 2, closesAt: null },
  responseTargets: { acknowledgeHours: 24 },
};

type Account = typeof MAINTAINER;
type CaseEvent = {
  revision: number;
  kind: string;
  reason: string | null;
  detail?: Record<string, unknown> | null;
};
type Reply = {
  case: {
    revision: number;
    view: string;
    events?: CaseEvent[];
  };
};

function setup() {
  const { db, sqlite } = sqliteD1(migrations);
  const manifest = JSON.stringify({
    id: PROJECT,
    status: "active",
    listingTier: "community",
    repositories: [{ id: REPOSITORY }],
    authority: { repositoryId: "123", repositoryNodeId: "R_kgDO123" },
    securityBounty: PROGRAM,
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'test', ?)",
    )
    .run(PROJECT, manifest, digest, AT);
  sqlite
    .query(
      "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)",
    )
    .run(PROJECT, manifest, digest, AT, AT);
  let actor: Account = MAINTAINER;
  let ids = 0;
  let keys = 0;
  const clock = Date.parse("2026-10-19T10:00:00.000Z");
  const reports: GithubPrivateReport[] = [
    {
      ghsa: "GHSA-2c3f-4g5h-6j7m",
      createdAt: "2026-10-19T09:30:00.000Z",
      state: "triage",
      author: {
        githubId: REPORTER.githubId,
        githubLogin: REPORTER.githubLogin,
      },
      summary: "Vault share rounding",
      description: "synthetic description",
      referenceLines: [],
      severity: "critical",
      cweIds: ["CWE-682"],
      packages: [],
    },
  ];
  const call = async (
    as: Account,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => {
    actor = as;
    const response = await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin: ORIGIN, "content-type": "application/json" }
            : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        db: db as never,
        now: () => new Date(clock),
        randomId: () => `case${String(++ids).padStart(8, "0")}`,
        sessionActor: async () => actor,
        reportingRead: async (target) => ({
          kind: "verified",
          enabled: true,
          repositoryId: target.repositoryId ?? "",
          repositoryNodeId: target.repositoryNodeId ?? "",
        }),
        advisories: {
          privateReports: async () => ({ state: "ok", reports: [...reports] }),
          privateReport: async (_repository: string, ghsa: string) => {
            const found = reports.find((entry) => entry.ghsa === ghsa);
            return found
              ? { state: "found", report: found }
              : { state: "unavailable" };
          },
        },
        analyzer: null,
        moderatorGithubIds: new Set([DISPUTE.githubId]),
      },
    );
    return {
      status: response?.status ?? 0,
      body: (await response?.json()) as Reply & Record<string, unknown>,
    };
  };
  const act = async (id: string, fields: Record<string, unknown>) => {
    const current = await call(MAINTAINER, "GET", `security-cases/${id}`);
    return call(MAINTAINER, "POST", `security-cases/${id}/actions`, {
      expectedRevision: current.body.case.revision,
      idempotencyKey: `test-key-${String(++keys).padStart(8, "0")}`,
      ...fields,
    });
  };
  return { sqlite, call, act };
}

test("the reporter sees a disclosure entry's approved digest and embargo change, and nothing restricted", async () => {
  const h = setup();
  const imported = await h.call(MAINTAINER, "POST", "security-cases", {
    mode: "import",
    projectId: PROJECT,
  });
  expect(imported.status).toBe(200);
  const { id } = h.sqlite.query("SELECT id FROM security_cases").get() as {
    id: string;
  };

  expect(
    (
      await h.act(id, {
        action: "assign-triager",
        githubId: TRIAGER.githubId,
        githubLogin: TRIAGER.githubLogin,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await h.act(id, {
        action: "decide",
        outcome: "confirmed",
        severity: "critical",
        loss: "verified-potential",
        inScope: true,
        reason: "Reproduced on an isolated local fork.",
        relatedParty: false,
        rootCauseKey: "vault-share-rounding",
        evidenceReference: EVIDENCE,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await h.act(id, {
        action: "disclosure",
        disclosureState: "redaction-approved",
        reason: "Independent human approval of the synthetic redacted text.",
        evidenceReference: EVIDENCE,
        redactedContentDigest: DIGEST,
        embargoChange: EMBARGO,
      })
    ).status,
  ).toBe(200);

  const reporter = await h.call(REPORTER, "GET", `security-cases/${id}`);
  expect(reporter.status).toBe(200);
  expect(reporter.body.case.view).toBe("reporter");
  const disclosure = reporter.body.case.events?.find(
    (event) => event.kind === "disclosure",
  );
  expect(disclosure?.detail).toEqual({
    disclosureState: "redaction-approved",
    redactedContentDigest: DIGEST,
    embargoChange: EMBARGO,
  });
  // Non-disclosure entries still carry no detail at all.
  for (const event of reporter.body.case.events ?? [])
    if (event.kind !== "disclosure") expect(event.detail).toBeUndefined();
  // Restricted material stays hidden from the reporter.
  const raw = JSON.stringify(reporter.body);
  expect(raw).not.toContain(EVIDENCE);
  expect(raw).not.toContain("vault-share-rounding");
  expect(raw).not.toContain(TRIAGER.githubLogin);
  expect(raw).not.toContain("assign-triager");

  // The maintainer's restricted view is unchanged, evidence included.
  const maintainer = await h.call(MAINTAINER, "GET", `security-cases/${id}`);
  expect(maintainer.body.case.view).toBe("restricted");
  expect(JSON.stringify(maintainer.body)).toContain(EVIDENCE);
  expect(JSON.stringify(maintainer.body)).toContain(EMBARGO);

  // A third party still gets the same 404 as for a missing case.
  const outsider = await h.call(OUTSIDER, "GET", `security-cases/${id}`);
  expect(outsider.status).toBe(404);
  h.sqlite.close();
});

test("the reporter is not shown an embargoed entry's digest as approved", async () => {
  const h = setup();
  const imported = await h.call(MAINTAINER, "POST", "security-cases", {
    mode: "import",
    projectId: PROJECT,
  });
  expect(imported.status).toBe(200);
  const { id } = h.sqlite.query("SELECT id FROM security_cases").get() as {
    id: string;
  };

  expect(
    (
      await h.act(id, {
        action: "assign-triager",
        githubId: TRIAGER.githubId,
        githubLogin: TRIAGER.githubLogin,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await h.act(id, {
        action: "decide",
        outcome: "confirmed",
        severity: "critical",
        loss: "verified-potential",
        inScope: true,
        reason: "Reproduced on an isolated local fork.",
        relatedParty: false,
        rootCauseKey: "vault-share-rounding",
        evidenceReference: EVIDENCE,
      })
    ).status,
  ).toBe(200);
  // The writer lets an embargoed entry carry a digest, but that digest was
  // never approved, so the reporter must not see it labeled as approved.
  const UNAPPROVED = "b".repeat(64);
  expect(
    (
      await h.act(id, {
        action: "disclosure",
        disclosureState: "embargoed",
        reason: "Embargo extended while the retest runs.",
        evidenceReference: EVIDENCE,
        redactedContentDigest: UNAPPROVED,
        embargoChange: EMBARGO,
      })
    ).status,
  ).toBe(200);

  const reporter = await h.call(REPORTER, "GET", `security-cases/${id}`);
  expect(reporter.status).toBe(200);
  const disclosure = reporter.body.case.events?.find(
    (event) => event.kind === "disclosure",
  );
  expect(disclosure?.detail).toEqual({
    disclosureState: "embargoed",
    redactedContentDigest: null,
    embargoChange: EMBARGO,
  });
  expect(JSON.stringify(reporter.body)).not.toContain(UNAPPROVED);

  // The maintainer's restricted view still carries the recorded digest.
  const maintainer = await h.call(MAINTAINER, "GET", `security-cases/${id}`);
  expect(JSON.stringify(maintainer.body)).toContain(UNAPPROVED);
  h.sqlite.close();
});
