import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

// The template's live-report.mjs only runs inside an installed skill: its
// run-receipt.mjs import reads project.json at module load. Stage the two
// scripts into a scratch skill layout, as contributor-transport.test.js
// stages its template scripts, and drive the module's exported declaration
// consumers.
let root, liveReport;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-live-report-"));
  await mkdir(join(root, "scripts"));
  for (const name of ["live-report.mjs", "run-receipt.mjs"])
    await copyFile(
      new URL(
        `../skills/project-contributor-template/scripts/${name}`,
        import.meta.url,
      ),
      join(root, "scripts", name),
    );
  await writeFile(
    join(root, "project.json"),
    JSON.stringify({ repositoryId: "SlopDotCash/slopdotcash" }),
  );
  liveReport = await import(
    pathToFileURL(join(root, "scripts/live-report.mjs")).href
  );
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const INLINE = "```bun run verify``` passes locally.";
const DISCLOSURE = "AI provider/model: Anthropic / claude-sonnet-4-5";
const DISCLOSED = { provider: "Anthropic", model: "claude-sonnet-4-5" };
const REPO = "SlopDotCash/slopdotcash";

test("an inline triple-backtick span does not hide a disclosure", () => {
  assert.deepEqual(
    liveReport.parseModelDisclosure(`${INLINE}\n${DISCLOSURE}`),
    DISCLOSED,
  );
});

test("an inline four-backtick span does not hide a disclosure", () => {
  assert.deepEqual(
    liveReport.parseModelDisclosure(
      ["````run `x` now```` done.", DISCLOSURE].join("\n"),
    ),
    DISCLOSED,
  );
});

test("a list-item inline span does not hide a closing reference", () => {
  assert.deepEqual(
    liveReport.closingIssueNumbers(`- ${INLINE}\nFixes #123`, REPO),
    [123],
  );
});

test("a closing reference after an inline span line is found", () => {
  assert.deepEqual(
    liveReport.closingIssueNumbers(`${INLINE}\nFixes #123`, REPO),
    [123],
  );
});

test("the disclosure audit sees claims and disclosures past a span line", () => {
  const comment = (id, body) => ({
    id,
    kind: "issue",
    url: `https://example.invalid/${id}`,
    author: "someone",
    authorKnown: true,
    bot: false,
    body,
  });
  // The disclosure follows the span line, so nothing is missing.
  assert.deepEqual(
    liveReport.auditCommentDisclosures([
      comment(
        1,
        `CLAIMING: the fix\n${INLINE}\nAI provider/model: OpenAI / gpt-5`,
      ),
    ]),
    [],
  );
  // The claim itself follows the span line and has no disclosure: flagged.
  assert.equal(
    liveReport.auditCommentDisclosures([
      comment(2, `${INLINE}\nCLAIMING: the fix`),
    ]).length,
    1,
  );
});

test("real fences still hide declarations", () => {
  assert.equal(
    liveReport.parseModelDisclosure(["```", DISCLOSURE, "```"].join("\n")),
    null,
  );
  // A tilde fence's info string may contain backticks; it still opens.
  assert.equal(
    liveReport.parseModelDisclosure(
      ["~~~ `info`", DISCLOSURE, "~~~"].join("\n"),
    ),
    null,
  );
  assert.deepEqual(
    liveReport.closingIssueNumbers("```\nFixes #123\n```", REPO),
    [],
  );
  // An info string on a later line does not close an open fence.
  assert.deepEqual(
    liveReport.closingIssueNumbers("```\n```js\nFixes #123\n```", REPO),
    [],
  );
  assert.deepEqual(
    liveReport.parseModelDisclosure(
      ["```", "some code", "```", DISCLOSURE].join("\n"),
    ),
    DISCLOSED,
  );
});
