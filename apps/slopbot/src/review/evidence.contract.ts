// spec/slopbot/closure.md, "The evidence finding names a field that the declared change types of a signed Slop submission require"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { type MissingEvidence, type PolicyText, hasSlopParticipationFooter, missingSubmissionEvidence } from "./evidence.ts";

function exactly<I, O>(cases: ReadonlyArray<readonly [I, O]>, run: (input: I) => O) {
  return contract({
    input: Arbitrary.Constant(cases),
    run: (all) => all.map(([input]) => run(input)),
    invariant: (all, outcomes) => all.every(([, expected], index) => JSON.stringify(outcomes[index]) === JSON.stringify(expected)),
  });
}

const footer = "Made via @slopdotcash";
const guideText = [
  "## Evidence",
  "- Change types: docs, non-ui, ui, performance, hardware",
  "- Test results:",
  "- Proof of change:",
  "- Runtime logs:",
  "- UI video:",
  "- Benchmarks:",
  "- On-device testing:",
].join("\n");
const guide: PolicyText = { path: "CONTRIBUTING.md", text: guideText, truncated: false };
const screenshotGuide: PolicyText = { path: ".github/CONTRIBUTING.md", text: `${guideText}\n- \`UI screenshots:\` links`, truncated: false };
const tests = "- Test results: pnpm test passed all forty cases";
const proof = "- Proof of change: https://slop.cash/proof/1";
const logs = "- Runtime logs: https://logs.slop.test/runs/42";
const video = "- UI video: https://videos.slop.test/clips/7";

function signed(...fields: string[]) {
  return ["Work", "", "## Evidence", ...fields, "", footer].join("\n");
}

function missing(source: string, ...fields: string[]): MissingEvidence {
  return { source, quote: "## Evidence", fields };
}

export const theFooterCountsOnlyWhenVisible = exactly<string, boolean>([
  [`Work\n\n${footer}`, true],
  [`Work\n\n${footer}   `, true],
  [`Work\n<!-- ${footer} -->`, false],
  [`Work\n\`\`\`\n${footer}\n\`\`\``, false],
  [`Work ${footer}`, false],
], hasSlopParticipationFooter);

export const theFindingNamesEachMissingFieldInDevelopmentsOrder = exactly<readonly [string, readonly PolicyText[]], MissingEvidence | null>([
  [[signed("- Change types: non-ui", tests, logs), [guide]], missing("CONTRIBUTING.md", "Proof of change")],
  [[signed("- Change types: non-ui", tests, proof, logs), [guide]], null],
  [[signed("- Change types: docs", tests, proof), [guide]], null],
  [[signed("- Change types: ui.", tests, proof, video), [screenshotGuide]], missing(".github/CONTRIBUTING.md", "UI screenshots")],
  [[signed("- Change types: ui.", tests, proof, video), [guide]], null],
  [[signed("- Change types: docs, ui", tests, proof), [guide]], missing("CONTRIBUTING.md", "Change types", "UI video")],
  [[signed("- Change types: frontend", tests, proof), [guide]], missing("CONTRIBUTING.md", "Change types")],
  [[signed(tests, proof), [guide]], missing("CONTRIBUTING.md", "Change types")],
  [[signed("- Change types: hardware, performance", tests, "- Proof of change: N/A", "- Benchmarks: TBD"), [guide]], missing("CONTRIBUTING.md", "Proof of change", "On-device testing", "Benchmarks")],
  [[signed("- Change types: ui", tests, proof, "- UI video: https://example.com/clip"), [guide]], missing("CONTRIBUTING.md", "UI video")],
  [[signed("- Change types: ui", tests, proof, "- UI video: https://user:secret@videos.slop.test/clip"), [guide]], missing("CONTRIBUTING.md", "UI video")],
  [[signed("- Change types: non-ui", tests, tests, proof, logs), [guide]], missing("CONTRIBUTING.md", "Test results")],
  [[signed("- Change types: non-ui", "- Test results: passed", proof, logs), [guide]], missing("CONTRIBUTING.md", "Test results")],
  [[`Work\n\n## Evidence\n- Change types: non-ui\n${tests}`, [guide]], null],
  [[signed("- Change types: non-ui", tests, logs), [{ ...guide, truncated: true }]], null],
  [[signed("- Change types: non-ui", tests, logs), [{ ...guide, path: "README.md" }]], null],
  [[signed("- Change types: non-ui", tests, logs), [{ ...guide, text: guideText.replace("- Benchmarks:\n", "") }]], null],
  [[["Work", "## Evidence", "- Change types: non-ui", tests, logs, "## Notes", proof, "", footer].join("\n"), [guide]], missing("CONTRIBUTING.md", "Proof of change")],
], ([body, policy]) => missingSubmissionEvidence(body, policy));
