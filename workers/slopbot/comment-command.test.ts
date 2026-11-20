import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  appealCommandStatement,
  slopbotCommentCommand,
} from "./comment-command";

test("appeal text keeps the operative reason and drops a fenced sample command", () => {
  assert.equal(
    appealCommandStatement("/slopbot dispute Exact dispute from comment 77"),
    "Exact dispute from comment 77",
  );
  assert.equal(
    appealCommandStatement(
      "The SPL Token ELF sha256 is correct and verified locally.\n/slopbot appeal",
    ),
    "The SPL Token ELF sha256 is correct and verified locally.",
  );
  assert.equal(
    appealCommandStatement("/slopbot appeal: This is a legitimate PR"),
    "This is a legitimate PR",
  );
  assert.equal(appealCommandStatement("/slopbot appeal"), "(no reason given)");
  assert.equal(
    appealCommandStatement(
      "```\n/slopbot dispute\n```\n/slopbot appeal the cited rule does not apply",
    ),
    "```\n/slopbot dispute\n```\nthe cited rule does not apply",
  );
  assert.equal(appealCommandStatement("```\n/slopbot appeal\n```"), null);
  assert.equal(appealCommandStatement("/slopbot accept the draft"), null);
  assert.equal(slopbotCommentCommand("> /slopbot appeal"), null);
});
