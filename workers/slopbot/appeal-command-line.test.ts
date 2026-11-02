// The appeal command counts on any line of an author's comment (#1930): the
// author explains the finding first and ends with the command.
import { expect, test } from "bun:test";
import { appealCommandLine, appealStatementText } from "./appeal-command";
import { jobFor } from "./index";

type Payload = Parameters<typeof jobFor>[2];

const APP_USER_ID = "999";

function comment(body: string): Payload {
  return {
    action: "created",
    installation: { id: 1 },
    repository: {
      id: 9,
      name: "repo",
      private: false,
      owner: { login: "owner" },
    },
    sender: { id: 42, type: "User" },
    issue: { number: 7, pull_request: {} },
    comment: { id: 5, body },
  } as Payload;
}

test("an appeal command on a later line queues the appeal", () => {
  const job = jobFor(
    "issue_comment",
    "appeal-trailing-command",
    comment(
      "The pinned ELF hashes to 8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697, so the assertion can pass.\n\n/slopbot appeal",
    ),
    APP_USER_ID,
  );
  expect(job?.kind).toBe("appeal");
});

test("a bare appeal mention inside a sentence is not a command", () => {
  const job = jobFor(
    "issue_comment",
    "appeal-mention-in-sentence",
    comment("The footer mentions /slopbot appeal, but I am only asking."),
    APP_USER_ID,
  );
  expect(job).toBeNull();
});

test("the command line is found on any line and keeps the explanation", () => {
  const body =
    "The digest is a valid SHA-256 and the test passes locally.\n\n/slopbot appeal";
  expect(appealCommandLine(body)).toBe("/slopbot appeal");
  expect(appealStatementText(body)).toBe(
    "The digest is a valid SHA-256 and the test passes locally.",
  );
});

test("a command-only comment yields an empty statement, not the command", () => {
  expect(appealStatementText("/slopbot appeal")).toBe("");
  expect(appealStatementText("/slopbot dispute")).toBe("");
});

test("text after the command on the same line is kept", () => {
  expect(
    appealStatementText("/slopbot dispute Exact dispute from comment 77"),
  ).toBe("Exact dispute from comment 77");
  expect(
    appealStatementText("/slopbot appeal Evidence: the digest is valid"),
  ).toBe("Evidence: the digest is valid");
});

test("a comment without the command has no command line or statement", () => {
  expect(appealCommandLine("Please look again at the finding.")).toBeNull();
  expect(appealStatementText("Please look again at the finding.")).toBeNull();
});
