/**
 * An owner page rechecks the signed-in account when its tab is shown again
 * (PRD section 4). The recheck runs behind the page: the same account keeps
 * the page it already has, and only a changed or ended session replaces it.
 * Model: formal/models/ui/ui_project_authority.qnt.
 */
import { expect, test } from "bun:test";
import {
  type ProjectSessionState,
  sessionAfterReturn,
} from "../src/lib/project-api";
import type { WebSession } from "../src/lib/project-contracts";

const account = (githubId: string, githubLogin = "owner") =>
  ({ githubId, githubLogin, admin: false }) as WebSession;
const signedIn = (
  githubId: string,
  githubLogin = "owner",
): ProjectSessionState => ({
  status: "signed-in",
  session: account(githubId, githubLogin),
});

test("the same account keeps the page it already has", () => {
  const shown = signedIn("1");
  const after = sessionAfterReturn(shown, {
    session: account("1"),
  });
  // The identical object: nothing below the session re-renders or remounts.
  expect(after).toBe(shown);
});

test("a different account replaces the page", () => {
  const after = sessionAfterReturn(signedIn("1"), {
    session: account("2", "other"),
  });
  expect(after).toEqual(signedIn("2", "other"));
});

test("an ended session signs the page out", () => {
  expect(sessionAfterReturn(signedIn("1"), { session: null })).toEqual({
    status: "signed-out",
  });
});

test("a failed recheck is not evidence of a change", () => {
  const shown = signedIn("1");
  expect(sessionAfterReturn(shown, { error: "Network error" })).toBe(shown);
});

test("a page that never finished signing in takes the answer as is", () => {
  expect(
    sessionAfterReturn({ status: "checking" }, { error: "Network error" }),
  ).toEqual({ status: "error", message: "Network error" });
  expect(
    sessionAfterReturn({ status: "signed-out" }, { session: account("1") }),
  ).toEqual(signedIn("1"));
});
