import { describe, expect, test } from "bun:test";
import {
  type EnforcementDecisionInput,
  type EnforcementHistoryRow,
  foldEnforcementStatus,
  planEnforcementAction,
} from "./verified-enforcement";

/**
 * Unknown-action fail-open (second-round audit N1, enforcement).
 * A banned project with only a banned-account appeal and no project appeal:
 * `reinstate` is refused, `deny_reinstatement` decides only the account
 * appeal, and an action that does not exist must be refused too instead of
 * clearing the project.
 */

const banRecord: EnforcementHistoryRow = {
  action: "ban",
  stateAfter: "banned",
  appealAfter: "none",
  actor: { kind: "actor", id: "mod-1" },
  actorRole: "project-moderator",
  sequence: 1,
  bannedAccounts: ["acct-1"],
  reinstatedAccounts: [],
};

const accountAppealRecord: EnforcementHistoryRow = {
  action: "request_reinstatement",
  stateAfter: "banned",
  appealAfter: "requested",
  actor: { kind: "actor", id: "acct-1" },
  actorRole: "banned-account",
  sequence: 2,
  bannedAccounts: [],
  reinstatedAccounts: [],
};

const records = [banRecord, accountAppealRecord];

function inputFor(action: string): EnforcementDecisionInput {
  const status = foldEnforcementStatus(records, ["acct-1"]);
  return {
    action,
    actorId: "mod-2",
    actorRole: "project-moderator",
    hasActorRole: true,
    state: status.state,
    appeal: status.appeal,
    records,
    restrictedBy: ["mod-1"],
    bannedAccounts: ["acct-1"],
    activeBans: [
      {
        accountId: "acct-1",
        moderator: { kind: "actor", id: "mod-1" },
      },
    ],
    responsibleAccounts: [],
    manifestStatus: "paused",
    manifestTier: "retired",
    listedBefore: true,
  };
}

describe("planEnforcementAction unknown action", () => {
  test("account-only appeal leaves no open project appeal", () => {
    const status = foldEnforcementStatus(records, ["acct-1"]);
    expect(status.state).toBe("banned");
    expect(status.appeal).toBe("requested");
  });

  test("reinstate is refused without a project appeal", () => {
    expect(planEnforcementAction(inputFor("reinstate"))).toEqual({
      kind: "refused",
      status: 409,
      code: "no_open_appeal",
      message: "Record a reinstatement request before a decision",
    });
  });

  test("deny_reinstatement decides only the account appeal", () => {
    expect(planEnforcementAction(inputFor("deny_reinstatement"))).toEqual({
      kind: "plan",
      stateAfter: "banned",
      appealAfter: "denied",
      bansMaintainer: false,
      revision: "none",
    });
  });

  test("an unknown action is refused instead of clearing the project", () => {
    expect(planEnforcementAction(inputFor("bogus-action"))).toEqual({
      kind: "refused",
      status: 409,
      code: "invalid_action",
      message: "Unknown enforcement action",
    });
  });

  test("every known action is planned or refused, never cleared by default", () => {
    for (const action of [
      "quarantine",
      "ban",
      "request_reinstatement",
      "reinstate",
      "reinstate_accounts",
      "deny_reinstatement",
    ]) {
      const decision = planEnforcementAction(inputFor(action));
      if (decision.kind === "plan")
        expect(decision.stateAfter).not.toBe("clear");
    }
  });
});
