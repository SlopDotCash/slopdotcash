import { expect, test } from "bun:test";
import { advisoryGithubLine } from "./security-advisory-state";

test("an advisory's GitHub state is labelled, and unknown states show nothing", () => {
  const line = (githubState: string | null, receiptState = "received") =>
    advisoryGithubLine({ githubState, receiptState, maintainer: true });
  expect(line("triage")?.label).toBe("Open, in triage");
  expect(line("closed")?.label).toBe("Closed");
  expect(line(null)).toBeNull();
  expect(line("something-new")).toBeNull();
});

test("only a maintainer is offered the GitHub close link, only after a closing decision, only while open there", () => {
  const offered = (
    githubState: string,
    receiptState: string,
    maintainer = true,
  ) =>
    advisoryGithubLine({ githubState, receiptState, maintainer })
      ?.closeOnGithub;
  expect(offered("triage", "rejected")).toBe(true);
  expect(offered("draft", "duplicate")).toBe(true);
  expect(offered("triage", "out-of-scope")).toBe(true);
  expect(offered("triage", "triaging")).toBe(false);
  expect(offered("triage", "confirmed")).toBe(false);
  expect(offered("closed", "rejected")).toBe(false);
  expect(offered("triage", "rejected", false)).toBe(false);
});
