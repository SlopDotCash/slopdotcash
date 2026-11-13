import { afterAll, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Disclosure = { provider: string; model: string } | null;

type LiveReport = {
  parseModelDisclosure(text: string): Disclosure;
  auditCommentDisclosures(
    comments: {
      authorKnown: boolean;
      bot: boolean;
      body: string;
      id: number;
      kind: string;
      url: string;
      author: string;
    }[],
  ): { id: number; kind: string; url: string; author: string }[];
};

const root = mkdtempSync(join(tmpdir(), "slop-disclosure-"));
const scripts = join(root, "scripts");
mkdirSync(scripts);
for (const name of ["live-report.mjs", "run-receipt.mjs"]) {
  copyFileSync(
    resolve("skills/project-contributor-template/scripts", name),
    join(scripts, name),
  );
}
writeFileSync(
  join(root, "project.json"),
  JSON.stringify({ repositoryId: "Example/repo" }),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const report = (await import(
  pathToFileURL(join(scripts, "live-report.mjs")).href
)) as LiveReport;

const lane = "\u2014 [contributor]";
const marker =
  '<!-- slop-contribution-attribution:v1 {"provider":"Cursor","model":"gpt-5.4","client":"Cursor-cloud-agent","skill_revision":"N/A - ordinary GitHub contribution without optional run evidence"} -->';

function footer(provider = "Cursor", model = "gpt-5.4"): string {
  return [
    "Made via @slopdotcash",
    `AI provider/model: ${provider} / ${model}`,
    "Client / agent tooling: Cursor-cloud-agent",
    "Contribution skill revision: N/A - ordinary GitHub contribution without optional run evidence",
    "Attribution status: self-reported",
    lane,
    marker,
  ].join("\n");
}

function legacyFooter(providerModel = "Cursor / gpt-5.4"): string {
  return [
    `AI provider/model: ${providerModel}`,
    "Client / agent tooling: Cursor-cloud-agent",
    "Contribution skill revision: N/A - ordinary GitHub contribution without optional run evidence",
    "Compute receipt: 10 project-attributed tokens (unavailable; device-signed, locally reported)",
    "Attribution status: self-reported",
    lane,
    marker,
  ].join("\n");
}

function checklist(providerModel: string): string {
  return [
    "## Contribution provenance",
    "",
    "- AI assistance:",
    `- AI provider/model: ${providerModel}`,
    "- Client / agent tooling:",
    "- Contribution skill revision:",
    "- Attribution status: self-reported",
    "",
    "## Safety review",
    "",
    "- [ ] No secrets were added.",
  ].join("\n");
}

function comment(body: string) {
  return {
    authorKnown: true,
    bot: false,
    body,
    id: 41,
    kind: "pr-comment",
    url: "https://github.com/Example/repo/pull/1#issuecomment-41",
    author: "ada",
  };
}

test("a checklist provider row does not hide the attribution footer", () => {
  const body = `${checklist("Cursor/gpt-5")}\n\n${footer()}`;
  expect(report.parseModelDisclosure(body)).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
  expect(report.auditCommentDisclosures([comment(body)])).toEqual([]);
});

test("the footer provider wins over a different exact checklist row", () => {
  const body = `${checklist("OpenAI / gpt-4.1")}\n\n${footer()}`;
  expect(report.parseModelDisclosure(body)).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
});

test("a note after the footer does not replace the footer provider", () => {
  const body = `${footer()}\n\nAI provider/model: OpenAI / gpt-4.1`;
  expect(report.parseModelDisclosure(body)).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
});

test("an empty checklist row still resolves the footer", () => {
  const body = `${checklist("")}\n\n${footer()}`;
  expect(report.parseModelDisclosure(body)).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
});

test("a legacy footer split by the compute receipt still resolves", () => {
  expect(report.parseModelDisclosure(legacyFooter())).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
});

test("a trailing note does not replace a legacy footer split by the compute receipt", () => {
  const body = `${legacyFooter()}\n\nAI provider/model: OpenAI / gpt-4.1`;
  expect(report.parseModelDisclosure(body)).toEqual({
    provider: "Cursor",
    model: "gpt-5.4",
  });
  expect(report.auditCommentDisclosures([comment(body)])).toEqual([]);
});

test("an inexact legacy footer is not rescued by an earlier checklist pair", () => {
  const body = `${checklist("OpenAI / gpt-4.1")}\n\n${legacyFooter("TBD")}`;
  expect(report.parseModelDisclosure(body)).toBeNull();
  expect(report.auditCommentDisclosures([comment(body)])).toEqual([
    {
      id: 41,
      kind: "pr-comment",
      url: "https://github.com/Example/repo/pull/1#issuecomment-41",
      author: "ada",
    },
  ]);
});

test("one exact provider row is that disclosure", () => {
  expect(
    report.parseModelDisclosure("AI provider/model: Cursor / gpt-5.4"),
  ).toEqual({ provider: "Cursor", model: "gpt-5.4" });
});

test("a placeholder row is not an exact disclosure", () => {
  expect(report.parseModelDisclosure("AI provider/model: TBD")).toBeNull();
  expect(
    report.auditCommentDisclosures([
      comment("AI provider/model: Cursor/gpt-5\nClaiming: this work"),
    ]),
  ).toEqual([
    {
      id: 41,
      kind: "pr-comment",
      url: "https://github.com/Example/repo/pull/1#issuecomment-41",
      author: "ada",
    },
  ]);
});

test("an inexact footer is not rescued by an earlier checklist pair", () => {
  const body = [
    checklist("OpenAI / gpt-4.1"),
    "",
    "Made via @slopdotcash",
    "AI provider/model: TBD",
    "Client / agent tooling: Cursor-cloud-agent",
    "Contribution skill revision: N/A - reason without a measured run",
    "Attribution status: self-reported",
    lane,
  ].join("\n");
  expect(report.parseModelDisclosure(body)).toBeNull();
});
