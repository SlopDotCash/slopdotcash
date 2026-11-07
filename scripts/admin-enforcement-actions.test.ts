/**
 * The admin panel's offered enforcement actions (PRD ADM-06). A restriction
 * recorded on another project that claims the same repository is inherited:
 * its appeal and reinstatement decisions belong to that project, so the row
 * offers only the actions on the project itself.
 */

import { describe, expect, test } from "bun:test";
import type { ProjectEnforcementState } from "../src/lib/project-contracts";
import { availableActions } from "../src/lib/project-enforcement-actions";

function state(
  overrides: Partial<ProjectEnforcementState> = {},
): ProjectEnforcementState {
  return {
    state: "banned",
    appeal: "none",
    projectAppeal: "none",
    since: "2026-10-18T12:00:00.000Z",
    restrictedBy: [],
    nextSequence: 1,
    revisionPending: true,
    moderation: "moderator",
    decisionRequired: false,
    bannedMaintainers: [],
    sourceProjectId: "open-registry",
    records: [],
    ...overrides,
  };
}

describe("admin enforcement actions", () => {
  test("the project holding the ban offers reinstatement", () => {
    expect(availableActions("open-registry", state())).toEqual([
      "request_reinstatement",
    ]);
  });

  test("an inherited ban offers no action", () => {
    expect(availableActions("renamed-registry", state())).toEqual([]);
  });

  test("an inherited quarantine offers only the ban on the project itself", () => {
    expect(
      availableActions("renamed-registry", state({ state: "quarantined" })),
    ).toEqual(["ban"]);
  });

  test("a payload without sourceProjectId is not treated as inherited", () => {
    const missing = state();
    delete (missing as Partial<ProjectEnforcementState>).sourceProjectId;
    expect(availableActions("open-registry", missing)).toEqual([
      "request_reinstatement",
    ]);
  });

  test("an inherited restriction with an open appeal offers no decision", () => {
    expect(
      availableActions(
        "renamed-registry",
        state({ appeal: "requested", projectAppeal: "requested" }),
      ),
    ).toEqual([]);
    expect(
      availableActions(
        "open-registry",
        state({ appeal: "requested", projectAppeal: "requested" }),
      ),
    ).toEqual(["reinstate", "deny_reinstatement"]);
  });

  test("an inherited restriction with banned accounts offers no account action", () => {
    const banned = {
      appeal: "requested" as const,
      bannedMaintainers: [{ githubId: "1", githubLogin: "maintainer" }],
    };
    expect(availableActions("renamed-registry", state(banned))).toEqual([]);
    expect(availableActions("open-registry", state(banned))).toEqual([
      "reinstate_accounts",
      "request_reinstatement",
      "deny_reinstatement",
    ]);
  });
});
