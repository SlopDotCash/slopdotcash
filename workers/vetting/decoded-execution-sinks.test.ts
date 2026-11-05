import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. Decoding an obfuscated payload and running it is the same act
 * whatever the decoder or the sink is called, so the sink branches share one
 * decoder list. These cases pin that parity: the verdict must not change when
 * `exec` is rewritten as `eval`, when the Node `vm` entry point changes, or
 * when a hex decoder replaces the base64 one.
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

const DECODED_EXECUTION: Record<string, [string, string]> = {
  // The decoder sets of `eval` and `exec` were not the same: `exec` of a
  // Python decoder flagged and `eval` of the same decoder did not.
  "python base64 decoder under eval": [
    "setup.py",
    'eval(base64.b64decode("cHJpbnQoMSk="))\n',
  ],
  "python base64 decoder under exec": [
    "setup.py",
    'exec(base64.b64decode("cHJpbnQoMSk="))\n',
  ],
  "python zlib decoder under eval": [
    "setup.py",
    "eval(zlib.decompress(blob))\n",
  ],
  "python zlib decoder under exec": [
    "setup.py",
    "exec(zlib.decompress(blob))\n",
  ],
  "python marshal decoder under eval": [
    "setup.py",
    "eval(marshal.loads(blob))\n",
  ],
  "python marshal decoder under exec": [
    "setup.py",
    "exec(marshal.loads(blob))\n",
  ],
  "javascript atob under eval": [
    "install.js",
    'eval(atob("cHJvY2Vzcy5leGl0KDEp"));\n',
  ],
  "javascript Buffer.from under eval": [
    "install.js",
    'eval(Buffer.from(blob, "base64").toString());\n',
  ],
  "javascript unescape under eval": [
    "install.js",
    'eval(unescape("%70%72%6f%63"));\n',
  ],
  "javascript decodeURIComponent under eval": [
    "install.js",
    'eval(decodeURIComponent("%70%72%6f%63"));\n',
  ],
  // Hex decoders are the same family as base64.
  "hex decoder under exec": [
    "setup.py",
    'exec(bytes.fromhex("7072696e74283129").decode())\n',
  ],
  "hex decoder under eval": [
    "setup.py",
    'eval(bytes.fromhex("7072696e74283129").decode())\n',
  ],
  "codecs hex decoder under exec": [
    "setup.py",
    'exec(codecs.decode("7072696e74283129", "hex").decode())\n',
  ],
  "binascii hex decoder under exec": [
    "setup.py",
    'exec(binascii.unhexlify("7072696e74283129"))\n',
  ],
  "gzip decoder under exec": ["setup.py", "exec(gzip.decompress(blob))\n"],
  // The Node vm entry points run a decoded payload exactly as eval does.
  "vm.runInContext of a decoded buffer": [
    "install.js",
    'vm.runInContext(Buffer.from(blob, "base64").toString(), ctx);\n',
  ],
  "vm.runInNewContext of a decoded buffer": [
    "install.js",
    'vm.runInNewContext(Buffer.from(blob, "base64").toString(), ctx);\n',
  ],
  "vm.runInThisContext of a decoded buffer": [
    "install.js",
    'vm.runInThisContext(Buffer.from(blob, "base64").toString());\n',
  ],
  "new vm.Script of a decoded buffer": [
    "install.js",
    'new vm.Script(Buffer.from(blob, "base64").toString()).runInThisContext();\n',
  ],
  // A parameter name before the decoded body does not hide the sink.
  "Function with a parameter name before the decoded body": [
    "install.js",
    'Function("a", atob("cHJvY2Vzcy5leGl0KDEp"))();\n',
  ],
  "Function with a parameter name before a decoded buffer": [
    "install.js",
    'new Function("a", Buffer.from(blob, "base64").toString())();\n',
  ],
};

const BENIGN: Record<string, [string, string]> = {
  // The repository's own idiom: a decoder that feeds a byte array, not an
  // execution sink.
  "decoded bytes assigned to a Uint8Array": [
    "adapter.ts",
    'const value = "aGVsbG8=";\nUint8Array.from(atob(value), (c) => c.charCodeAt(0));\n',
  ],
  "decoded bytes turned into a string": [
    "adapter.ts",
    'const text = Buffer.from(blob, "base64").toString("utf8");\n',
  ],
  "eval of parsed json": [
    "install.js",
    "const parsed = eval(JSON.parse(payload));\n",
  ],
  "exec of a compiled literal": [
    "setup.py",
    'exec(compile(source, "setup.py", "exec"))\n',
  ],
  "vm.runInThisContext of a literal": [
    "install.js",
    'vm.runInThisContext("return 1;");\n',
  ],
  "Function with plain string arguments": [
    "install.js",
    'Function("a", "return a")(1);\n',
  ],
  "eval of an arithmetic literal": ["install.js", 'eval("1 + 1");\n'],
  "hex decoder without a sink": [
    "setup.py",
    'checksum = bytes.fromhex("7072696e74283129")\n',
  ],
  "codecs decode of a local string": [
    "setup.py",
    'text = codecs.decode(raw, "utf-8")\n',
  ],
  // Decoder names in prose are documentation, not execution.
  "decoder names in a comment": [
    "README.md",
    "The helpers wrap atob and Buffer.from for callers.\n",
  ],
};

test("decoding an obfuscated payload into an execution sink is unsafe execution", () => {
  for (const [name, [path, body]] of Object.entries(DECODED_EXECUTION)) {
    const inspection = inspected(path, body);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("decoding without an execution sink, or running a literal, keeps no finding", () => {
  for (const [name, [path, body]] of Object.entries(BENIGN)) {
    const inspection = inspected(path, body);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: [],
    });
  }
});
