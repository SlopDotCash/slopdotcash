import { expect, test } from "bun:test";
import { missingSubmissionEvidence } from "./submission-evidence";

const guide = [
  "## Evidence",
  "Change types: Declare every applicable type.",
  "Test results: Show the executed checks and their results.",
  "Proof of change: Reproduce the failure and the working result.",
  "Runtime logs: Show the previous failure and the working result.",
  "UI video: Link the before and after video.",
  "Benchmarks: Show the matched workload and measured outcome.",
  "On-device testing: List the physical device, build, and result.",
].join("\n");

const policy = [{ path: "CONTRIBUTING.md", text: guide, truncated: false }];

function nonUiBody(testResults: string): string {
  return [
    "This fixes the empty product list.",
    "## Evidence",
    "- Change types: non-ui",
    `- Test results: ${testResults}`,
    "- Proof of change: The empty list at base now shows eligible projects at head.",
    "- Runtime logs: Before GET returned an empty list; after it returned three eligible records.",
    "Made via @slopdotcash",
  ].join("\n");
}

function uiBody(uiVideo: string): string {
  return [
    "This fixes the empty product list on desktop and mobile.",
    "## Evidence",
    "- Change types: ui, non-ui",
    "- Test results: bun run test completed with three passing integration journeys.",
    "- Proof of change: The empty list at base now shows eligible projects at head.",
    "- Runtime logs: Before GET returned an empty list; after it returned three eligible records.",
    `- UI video: ${uiVideo}`,
    "Made via @slopdotcash",
  ].join("\n");
}

test("a placeholder word before an inspectable artifact link still supplies evidence", () => {
  expect(
    missingSubmissionEvidence(
      nonUiBody(
        "not run locally; CI green https://github.com/SlopDotCash/slopdotcash/actions/runs/123456",
      ),
      policy,
    ),
  ).toBeNull();
  expect(
    missingSubmissionEvidence(
      uiBody(
        "pending https://github.com/user-attachments/assets/18a47654-7a03-48a7-8000-f30bafafa283",
      ),
      policy,
    ),
  ).toBeNull();
});

test("a placeholder without an inspectable artifact link stays missing", () => {
  for (const testResults of [
    "pending",
    "pending: results coming soon after CI finishes",
    "pending https://github.com",
    "todo: add the run link later",
  ]) {
    expect(
      missingSubmissionEvidence(nonUiBody(testResults), policy)?.fields,
    ).toEqual(["Test results"]);
  }
});

test("a concrete result without a placeholder word still supplies evidence", () => {
  expect(
    missingSubmissionEvidence(
      nonUiBody("bun test completed with fifteen passing integration journeys"),
      policy,
    ),
  ).toBeNull();
});
