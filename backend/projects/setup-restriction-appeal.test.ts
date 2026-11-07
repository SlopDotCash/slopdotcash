import { describe, expect, test } from "bun:test";
import type {
  ProjectEnforcement,
  ProjectRecord,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { planEnforcement, projectRestriction } from "./enforcement";
import { projectSetupStatus } from "./setup";

const at = "2026-11-05T00:00:00.000Z";
const moderator = { githubId: "900", githubLogin: "mod-a" };
const owner = { githubId: "100", githubLogin: "owner-a" };
const maintainer = { githubId: "200", githubLogin: "maint-a" };

const project: ProjectRecord = {
  id: "restricted-fixture",
  status: "paused",
  revision: 3,
  manifest: applicationManifest(
    "restricted-fixture",
    "example/restricted-fixture",
    { status: "paused", listingTier: "retired" },
  ) as unknown as ProjectDefinition,
  manifestSha256: "b".repeat(64),
  createdAt: at,
  updatedAt: at,
  sourceApplicationId: null,
  referrer: null,
};

function record(partial: Partial<ProjectEnforcement>): ProjectEnforcement {
  return {
    id: `enf_${partial.sequence ?? 1}`,
    projectId: project.id,
    sequence: 1,
    action: "quarantine",
    stateAfter: "quarantined",
    appealAfter: "none",
    reason: "Fixture reason",
    evidenceReference: "fixture-evidence",
    repositoryGithubId: "123456789",
    repositoryKeys: ["example/restricted-fixture"],
    actor: moderator,
    actorRole: "project-moderator",
    decisionSource: "admin-panel",
    beforeRevision: 2,
    beforeManifestSha256: "a".repeat(64),
    afterRevision: 3,
    afterManifestSha256: "b".repeat(64),
    result: "revision_appended",
    createdAt: at,
    ...partial,
  } as ProjectEnforcement;
}

const quarantine = record({});
const appealRequest = record({
  sequence: 2,
  action: "request_reinstatement",
  stateAfter: "quarantined",
  appealAfter: "requested",
  actor: owner,
  actorRole: "project-steward",
  decisionSource: "owner-request",
  result: "no_revision_needed",
  afterRevision: null,
  afterManifestSha256: null,
});
const appealDenial = record({
  sequence: 3,
  action: "deny_reinstatement",
  stateAfter: "quarantined",
  appealAfter: "denied",
  result: "no_revision_needed",
  afterRevision: null,
  afterManifestSha256: null,
});
const maintainerBan = (sequence: number) =>
  record({
    sequence,
    action: "ban",
    stateAfter: "banned",
    appealAfter: "none",
    maintainerBans: [maintainer],
  });
const accountAppeal = (sequence: number) =>
  record({
    sequence,
    action: "request_reinstatement",
    stateAfter: "banned",
    appealAfter: "requested",
    actor: maintainer,
    actorRole: "banned-account",
    decisionSource: "owner-request",
    result: "no_revision_needed",
    afterRevision: null,
    afterManifestSha256: null,
  });

const cleared: VettingClearance = {
  state: "cleared",
  assessment: null,
  grandfathered: true,
};

function status(records: ProjectEnforcement[]) {
  return projectSetupStatus({
    project,
    restriction: projectRestriction(project.id, records),
    authority: { state: "verified", message: "Fixture authority check." },
    access: {
      state: "read",
      access: {
        installation: "installed",
        installationId: 123,
        permission: "admin",
        roleName: "admin",
      },
    },
    clearance: cleared,
    scanRequest: null,
    activatedRevision: null,
    checkedAt: at,
  });
}

describe("restricted setup status next action", () => {
  test("invites a reinstatement request while no appeal is open", () => {
    const result = status([quarantine]);
    expect(result.state).toBe("restricted");
    expect(result.nextAction.kind).toBe("restricted");
    expect(result.nextAction.message).toContain("may request reinstatement");
  });

  test("reports the open request instead of inviting a second one", () => {
    const result = status([quarantine, appealRequest]);
    expect(result.state).toBe("restricted");
    expect(result.nextAction.message).toContain(
      "A reinstatement request is open",
    );
    expect(result.nextAction.message).not.toContain(
      "may request reinstatement",
    );
  });

  test("invites a new request again after a denial", () => {
    const result = status([quarantine, appealRequest, appealDenial]);
    expect(result.state).toBe("restricted");
    expect(result.nextAction.message).toContain("may request reinstatement");
  });

  test("invites a project request while only an account appeal is open", () => {
    const records = [quarantine, maintainerBan(2), accountAppeal(3)];
    const result = status(records);
    expect(result.state).toBe("restricted");
    expect(result.nextAction.message).toContain("may request reinstatement");
    expect(result.nextAction.message).not.toContain(
      "A reinstatement request is open",
    );
    // The enforcement path agrees: no project appeal is open, so a project
    // filing is accepted instead of refused with appeal_open.
    expect(() =>
      planEnforcement({
        action: "request_reinstatement",
        actor: owner,
        actorRole: "project-steward",
        project,
        restriction: projectRestriction(project.id, records),
        listedBefore: false,
      }),
    ).not.toThrow();
  });

  test("invites a project request after a denial while an account appeal is open", () => {
    const records = [
      quarantine,
      appealRequest,
      appealDenial,
      maintainerBan(4),
      accountAppeal(5),
    ];
    const result = status(records);
    expect(result.state).toBe("restricted");
    expect(result.nextAction.message).toContain("may request reinstatement");
    expect(result.nextAction.message).not.toContain(
      "A reinstatement request is open",
    );
  });
});
