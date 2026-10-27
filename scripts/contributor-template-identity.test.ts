import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { copyFixtureSkills } from "../tests/fixture-overlay.mjs";

const COMMIT = "a".repeat(40);

// Rendered skill copies: the shared scripts read the project.json beside them.
const skills = mkdtempSync(join(tmpdir(), "contributor-skills-"));
copyFixtureSkills(skills);
afterAll(() => rmSync(skills, { recursive: true, force: true }));

const { auditPrEvidence } = (await import(
  pathToFileURL(join(skills, "contribute-to-feed/scripts/live-report.mjs")).href
)) as {
  auditPrEvidence: (
    body: string,
    repository: string,
  ) => { findings: { id: string; status: string }[] };
};

function backendLogStatus(body: string, repository: string) {
  return auditPrEvidence(body, repository).findings.find(
    (finding) => finding.id === "backend-logs",
  )?.status;
}

function row(url: string) {
  return `<!-- evidence-row:backend-logs -->\n- Backend logs: ${url}\n`;
}

test("repository evidence counts only for the inspected project repository", () => {
  const feedBlob = `https://github.com/feedforagents/feed/blob/${COMMIT}/logs/run.txt`;
  const elizaBlob = `https://github.com/elizaOS/eliza/blob/${COMMIT}/logs/run.txt`;
  const feedArtifact =
    "https://github.com/FeedForAgents/Feed/actions/runs/12/artifacts/34";
  const feedRaw = `https://raw.githubusercontent.com/feedforagents/feed/${COMMIT}/logs/run.txt`;

  expect(backendLogStatus(row(feedBlob), "feedforagents/feed")).toBe("ok");
  expect(backendLogStatus(row(feedArtifact), "feedforagents/feed")).toBe("ok");
  expect(backendLogStatus(row(feedRaw), "feedforagents/feed")).toBe("ok");
  // Another project's immutable file is not this project's evidence.
  expect(backendLogStatus(row(elizaBlob), "feedforagents/feed")).toBe(
    "unsatisfied",
  );
  expect(backendLogStatus(row(elizaBlob), "elizaOS/eliza")).toBe("ok");
  expect(() => auditPrEvidence(row(feedBlob), "feed")).toThrow(
    "owner/name form",
  );
});

function disclose(skill: string): string {
  const result = spawnSync(
    process.execPath,
    [
      join(skills, skill, "scripts/run-receipt.mjs"),
      "disclose",
      "--provider",
      "Anthropic",
      "--model",
      "claude-opus-5-5",
      "--client",
      "claude-code",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  const marker = result.stdout.match(/^<!-- (\S+) \{/mu)?.[1];
  expect(marker).toBeDefined();
  return marker as string;
}

test("ordinary attribution uses the Slop marker unless the target repository requires its legacy one", () => {
  expect(disclose("contribute-to-feed")).toBe(
    "slop-contribution-attribution:v1",
  );
  expect(disclose("contribute-to-slopdotcash")).toBe(
    "slop-contribution-attribution:v1",
  );
  // elizaOS/eliza's own PR validator accepts only its legacy marker.
  expect(disclose("contribute-to-eliza")).toBe("eliza-computer-attribution:v1");
});
