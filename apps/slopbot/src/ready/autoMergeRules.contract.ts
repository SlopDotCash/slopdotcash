// spec/slopbot/readyLabel.md, "The pilot workflow merges only on Slop's own repository when switched on, into the registered integration branch, and never touches `.github/`"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { pilotRepository, pilotRepositoryId, readyLabelName, slopbotBotId, slopbotBotLogin } from "../../gen/slopbot__readyLabel.ts";
import {
  isGithubPath,
  mergeComment,
  parseLabelEventTime,
  parseRegisteredIntegrationBranch,
  parseWorkflowPathProblem,
} from "./autoMergeRules.ts";

function exactly<I, O>(cases: ReadonlyArray<readonly [I, O]>, run: (input: I) => O) {
  return contract({
    input: Arbitrary.Constant(cases),
    run: (all) => all.map(([input]) => run(input)),
    invariant: (all, outcomes) => all.every(([, expected], index) => JSON.stringify(outcomes[index]) === JSON.stringify(expected)),
  });
}

export const githubPathsAreMatchedCaseInsensitively = exactly<string, boolean>([
  [".github/workflows/deploy.yml", true],
  [".GitHub/x.json", true],
  [".github", true],
  ["docs/.github/readme.md", false],
  ["src/lib/thing.ts", false],
], isGithubPath);

export const workflowPathCheckCatchesRenamedGithubPaths = exactly<ReadonlyArray<unknown>, unknown>([
  [[{ filename: "src/a.ts" }], { ok: true, value: null }],
  [[{ filename: ".github/workflows/ci.yml" }], { ok: true, value: "it touches .github/workflows/ci.yml, and nothing under .github/ merges this way" }],
  [[{ filename: "docs/moved.json", previous_filename: ".GitHub/x.json" }], { ok: true, value: "it touches .GitHub/x.json, and nothing under .github/ merges this way" }],
], (files) => parseWorkflowPathProblem(files, files.length));

export const projectManifestIntegrationBranchRequiresExactPilotIdentity = exactly<string, unknown>([
  [
    Buffer.from(JSON.stringify({ repository: { fullName: pilotRepository, id: String(pilotRepositoryId), integrationBranch: "development" } })).toString("base64"),
    { ok: true, value: true },
  ],
  [
    Buffer.from(JSON.stringify({ repository: { fullName: pilotRepository, id: String(pilotRepositoryId), integrationBranch: "staging" } })).toString("base64"),
    { ok: true, value: false },
  ],
  [
    Buffer.from(JSON.stringify({ repository: { fullName: "other/repo", id: String(pilotRepositoryId), integrationBranch: "development" } })).toString("base64"),
    { ok: true, value: false },
  ],
  [
    Buffer.from("not-json").toString("base64"),
    { ok: false, reason: ".github/slop-project.json on development is not valid JSON" },
  ],
], (content) => parseRegisteredIntegrationBranch({ encoding: "base64", content }, pilotRepository, "development"));

export const labelEventRequiresSlopbotWithoutForcePush = exactly<ReadonlyArray<unknown>, boolean>([
  [[{ event: "labeled", created_at: "2026-11-25T10:05:00Z", label: { name: readyLabelName }, actor: { id: slopbotBotId, login: slopbotBotLogin, type: "Bot" } }], true],
  [[{ event: "labeled", created_at: "2026-11-25T10:05:00Z", label: { name: readyLabelName }, actor: { id: 22, login: "maint", type: "User" } }], false],
  [
    [
      { event: "labeled", created_at: "2026-11-25T10:05:00Z", label: { name: readyLabelName }, actor: { id: slopbotBotId, login: slopbotBotLogin, type: "Bot" } },
      { event: "head_ref_force_pushed", created_at: "2026-11-25T10:06:00Z", actor: { id: 11, login: "author", type: "User" } },
    ],
    false,
  ],
], (events) => parseLabelEventTime(events).ok);

export const mergeCommentNamesApproversWithoutMentions = contract({
  input: Arbitrary.Constant({ head: "a".repeat(40), approvers: ["alice", "bob"] }),
  run: ({ head, approvers }) => mergeComment(head, approvers),
  invariant: ({ head }, text) =>
    text.includes(head) &&
    text.includes("alice, bob") &&
    !text.includes("@") &&
    text.includes("Slopbot applied the label and did not merge."),
});
