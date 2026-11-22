// spec/slopbot/readyLabel.md, "A changed file is protected when it is deleted, on a default or owner path, or has no text diff"; spec/slopbot/readyLabel.md, "The decision takes the first failing condition, and only a running review or unsettled mergeability is pending"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { enabledSettings, protectedFile, readyLineMarker } from "../../gen/slopbot__readyLabel.ts";
import { type GitHubFile, changedFileOf, ownerPatternMatches, protectedDetail, protectedPathReason, readyLine, withReadyLine } from "./protectedPaths.ts";

function exactly<I, O>(cases: ReadonlyArray<readonly [I, O]>, run: (input: I) => O) {
  return contract({
    input: Arbitrary.Constant(cases),
    run: (all) => all.map(([input]) => run(input)),
    invariant: (all, outcomes) => all.every(([, expected], index) => JSON.stringify(outcomes[index]) === JSON.stringify(expected)),
  });
}

const ownerPatterns = ["docs/legal/", "*.sql", "src/**/generated/*.ts"];
const file: GitHubFile = { filename: "src/parser.ts", status: "modified", additions: 10, deletions: 2, patch: "@@ -1 +1 @@" };

export const theBuiltInSetCoversEachNamedCategory = exactly<string, string | null>([
  [".github/dependabot.yml", "CI or GitHub settings"],
  [".gitlab-ci.yml", "CI or GitHub settings"],
  [".circleci/config.yml", "CI or GitHub settings"],
  ["package-lock.json", "a dependency manifest or lockfile"],
  ["services/api/go.sum", "a dependency manifest or lockfile"],
  ["Cargo.toml", "a dependency manifest or lockfile"],
  ["requirements-dev.txt", "a dependency manifest or lockfile"],
  ["bun.lock", "a dependency manifest or lockfile"],
  ["src/payments/fees.ts", "contracts or payment code"],
  ["programs/escrow/src/lib.rs", "contracts or payment code"],
  ["evm/Token.sol", "contracts or payment code"],
  ["skills/slop/SKILL.md", "a skill, agent or policy file"],
  ["AGENTS.md", "a skill, agent or policy file"],
  ["docs/CLAUDE.md", "a skill, agent or policy file"],
  ["LICENSE", "a skill, agent or policy file"],
  [".github/slop-project.json", "CI or GitHub settings"],
  ["slop-project.json", "the Slop project manifest"],
  ["Security.md", "SECURITY.md"],
  ["assets/logo.png", "a binary file or a file without a text diff"],
  ["dist/app.wasm", "a binary file or a file without a text diff"],
  ["src/parser.ts", null],
  ["docs/guide.md", null],
  ["README.md", null],
], (path) => protectedPathReason(path, []));

export const ownerPatternsOnlyAddProtectedPaths = exactly<readonly [string, ReadonlyArray<string>], string | null>([
  [["docs/legal/terms.md", ownerPatterns], "a path this project protects"],
  [["db/migrations/0001.sql", ownerPatterns], "a path this project protects"],
  [["src/a/b/generated/x.ts", ownerPatterns], "a path this project protects"],
  [["docs/guide.md", ownerPatterns], null],
  [[".github/workflows/ci.yml", ["!.github/"]], "CI or GitHub settings"],
], ([path, patterns]) => protectedPathReason(path, patterns));

export const ownerPatternsAnchorOnlyWithASlash = exactly<readonly [string, string], boolean>([
  [["docs", "site/docs/a.md"], true],
  [["docs/a", "site/docs/a"], false],
  [["docs/a", "docs/a/b.md"], true],
  [["*.sql", "db/a.sql"], true],
  [["src/*.ts", "src/a/b.ts"], false],
  [["src/**/x.ts", "src/x.ts"], true],
], ([pattern, path]) => ownerPatternMatches(pattern, path));

export const theFirstProtectedChangeNamesItsPath = exactly<ReadonlyArray<GitHubFile>, string | null>([
  [[{ ...file, filename: "db/schema.sql" }], "a path this project protects (db/schema.sql)"],
  [[file, { ...file, filename: "gone.ts", status: "removed" }], "a deleted file (gone.ts)"],
  [[{ ...file, filename: "src/new.ts", previous_filename: ".github/ci.yml", status: "renamed" }], "CI or GitHub settings (.github/ci.yml)"],
  [[{ filename: "src/big.ts", status: "modified", additions: 4000, deletions: 0 }], "a binary file or a file without a text diff (src/big.ts)"],
  [[{ filename: "src/moved.ts", previous_filename: "src/old.ts", status: "renamed", additions: 0, deletions: 0 }], null],
  [[file], null],
], (files) => protectedDetail(files, ownerPatterns));

export const theGeneratedRuleAgreesWithTheReasonText = contract({
  input: Arbitrary.Constant<ReadonlyArray<GitHubFile>>([
    file,
    { ...file, filename: "db/schema.sql" },
    { ...file, status: "removed" },
    { filename: "src/big.ts", status: "modified", additions: 4000, deletions: 0 },
    { filename: "src/moved.ts", previous_filename: "src/old.ts", status: "renamed", additions: 0, deletions: 0 },
    { ...file, filename: "assets/logo.png" },
  ]),
  run: (files) => files.map((changed) => [protectedFile(changedFileOf(changed, ownerPatterns)), protectedDetail([changed], ownerPatterns) !== null] as const),
  invariant: (_files, outcomes) => outcomes.every(([byRule, byText]) => byRule === byText),
});

const body = ["<!-- slopbot:review -->", "### Slopbot review", "", "Summary.", "", "<details><summary>Review details</summary>", "", "details", "</details>"].join("\n");

export const theReviewCommentCarriesOneReadyLine = contract({
  input: Arbitrary.Constant(body),
  run: (text) => {
    const first = withReadyLine(text, `${readyLineMarker} first`);
    const second = withReadyLine(first, `${readyLineMarker} second`);
    return { first, second, removed: withReadyLine(second, null) };
  },
  invariant: (_text, { first, second, removed }) =>
    first.split("\n").filter((line) => line.startsWith(readyLineMarker)).length === 1 &&
    first.indexOf(readyLineMarker) < first.indexOf("<details>") &&
    second.split("\n").filter((line) => line.startsWith(readyLineMarker)).join() === `${readyLineMarker} second` &&
    !removed.includes(readyLineMarker),
});

const counts = { additions: 10, deletions: 2, changedFiles: 1, approvals: 1, mergeableState: "clean", protectedDetail: null };

export const theReadyLineStatesTheDecisionAtTheShortHead = exactly<boolean, string>([
  [false, `${readyLineMarker} **Not labelled \`slopbot:ready\`** at \`abcdef1\`: the pull request is a draft.`],
  [true, `${readyLineMarker} **Labelled \`slopbot:ready\`** at \`abcdef1\`. Checked: GitHub reports every check passing and the branch mergeable, Slopbot's review has no finding, 1 approval at this commit from accounts with write access (1 required), 12 changed lines in 1 file (caps 400 and 20), no protected path. Not checked: whether the change is correct or wanted, and anything the checks do not test. A maintainer merges; Slopbot never merges.`],
], (ready) => readyLine(ready, "the pull request is a draft", "abcdef1234567890", counts, enabledSettings));
