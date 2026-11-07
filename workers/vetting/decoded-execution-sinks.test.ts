import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. Decoding an obfuscated payload and running it is the same act
 * whatever the decoder or the sink is called, so the sink branches share one
 * decoder list. These cases pin that parity: the verdict must not change when
 * `exec` is rewritten as `eval`, when the Node `vm` entry point changes, or
 * when a hex decoder replaces the base64 one.
 *
 * The same act must also survive a spelling change that does not change what
 * runs: a qualified decoder (`window.atob`, `globalThis.Buffer.from`),
 * whitespace or a block comment around the dotted name, a parenthesised
 * decoder (`(base64.b64decode)(x)`), or a tagged template (`atob` + backtick).
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
  "bz2 decoder under exec": ["setup.py", "exec(bz2.decompress(blob))\n"],
  "lzma decoder under exec": ["setup.py", "exec(lzma.decompress(blob))\n"],
  "pickle decoder under eval": ["setup.py", "eval(pickle.loads(blob))\n"],
  "urlsafe base64 decoder under eval": [
    "setup.py",
    'eval(base64.urlsafe_b64decode("cHJpbnQoMSk="))\n',
  ],
  "base32 decoder under exec": [
    "setup.py",
    'exec(base64.b32decode("OBYXE5DZOJ2GK==="))\n',
  ],
  "base16 decoder under exec": [
    "setup.py",
    'exec(base64.b16decode("7072696e74283129"))\n',
  ],
  "base85 decoder under exec": [
    "setup.py",
    'exec(base64.b85decode("NM&qnZ%G(qNKb?8$G"))\n',
  ],
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
  // A qualifier in front of the decoder is static member access, not a
  // computed name: `window.atob` and `globalThis.Buffer.from` are the
  // idiomatic browser and isomorphic spellings of the same act.
  "qualified window.atob under eval": [
    "install.js",
    'eval(window.atob("cHJvY2Vzcy5leGl0KDEp"));\n',
  ],
  "qualified globalThis.atob under eval": [
    "install.js",
    'eval(globalThis.atob("cHJvY2Vzcy5leGl0KDEp"));\n',
  ],
  "qualified globalThis.Buffer.from under eval": [
    "install.js",
    'eval(globalThis.Buffer.from(blob, "base64").toString());\n',
  ],
  "qualified window.Buffer.from under eval": [
    "install.js",
    'eval(window.Buffer.from(blob, "base64").toString());\n',
  ],
  "qualified namespace on a python decoder": [
    "setup.py",
    'eval(util.base64.b64decode("cHJpbnQoMSk="))\n',
  ],
  // Whitespace around the dot is valid in both languages.
  "whitespace before the dot": [
    "setup.py",
    'exec(base64 .b64decode("cHJpbnQoMSk="))\n',
  ],
  "whitespace after the dot": [
    "setup.py",
    'exec(base64. b64decode("cHJpbnQoMSk="))\n',
  ],
  "whitespace before the vm entry point": [
    "install.js",
    'vm .runInThisContext(Buffer.from(blob, "base64").toString());\n',
  ],
  // A parenthesised decoder is still called.
  "parenthesised python decoder": [
    "setup.py",
    'exec((base64.b64decode)("cHJpbnQoMSk="))\n',
  ],
  "parenthesised javascript decoder": [
    "install.js",
    'eval((atob)("cHJvY2Vzcy5leGl0KDEp"));\n',
  ],
  // A block comment between the sink and its call does not change the act.
  "block comment before the decoder call": [
    "install.js",
    'eval /*c*/ (atob("cHJvY2Vzcy5leGl0KDEp"));\n',
  ],
  "block comment before the vm entry point": [
    "install.js",
    'vm /*c*/ .runInThisContext(Buffer.from(blob, "base64").toString());\n',
  ],
  // A tagged template is a call as well.
  "decoder used as a tagged template": [
    "install.js",
    "eval(atob`cHJvY2Vzcy5leGl0KDEp`);\n",
  ],
  // setTimeout / setInterval execute a string first argument exactly like
  // eval, so a decoder there is the same act as a decoder under eval.
  "setTimeout of a decoded payload": [
    "install.js",
    'setTimeout(atob("cHJvY2Vzcy5leGl0KDEp"), 0);\n',
  ],
  "setTimeout of a decoded buffer": [
    "install.js",
    'setTimeout(Buffer.from(blob, "base64").toString(), 1000);\n',
  ],
  "setInterval of a decoded payload": [
    "install.js",
    'setInterval(unescape("%70%72%6f%63"), 0);\n',
  ],
  "setTimeout of a decodeURIComponent result": [
    "install.js",
    "setTimeout(decodeURIComponent(x), 0);\n",
  ],
  // Python obfuscation wraps the decoded payload in compile() before handing
  // it to exec/eval; the decoded bytes still run.
  "exec of a compiled decoded payload": [
    "setup.py",
    'exec(compile(base64.b64decode("cHJpbnQoMSk="), "<string>", "exec"))\n',
  ],
  "eval of a compiled decoded payload": [
    "setup.py",
    'eval(compile(base64.b64decode("cHJpbnQoMSk="), "<string>", "eval"))\n',
  ],
  "qualified compile of a decoded payload": [
    "setup.py",
    'exec(builtins.compile(pickle.loads(blob), "<string>", "exec"))\n',
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
  // Encoding a payload is not decoding it.
  "base64 encoder without a sink": [
    "setup.py",
    "encoded = base64.b64encode(payload)\n",
  ],
  "pickle dumps without a sink": ["setup.py", "blob = pickle.dumps(state)\n"],
  "bz2 compressor feeding a file": [
    "setup.py",
    "archive = bz2.compress(payload)\n",
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
  // Tolerating a comment must not widen the decoder list: a comment in front
  // of a call that decodes nothing stays clean.
  "block comment before a non-decoder call": [
    "install.js",
    "eval /* explanation */ (someExpression);\n",
  ],
  // The widening is scoped to a decoder name under a sink. A qualified,
  // decoder-looking method anywhere else is ordinary code.
  "decoder-looking method compared, not executed": [
    "install.js",
    'if (logger.atob("cHJvY2Vzcy5leGl0KDEp") === expected) throw new Error("mismatch");\n',
  ],
  "qualified non-decoder under eval": [
    "install.js",
    "eval(parser.decodeSource(source));\n",
  ],
  "atob-looking identifier": [
    "install.js",
    "const atobEnabled = flags.atobEnabled;\n",
  ],
  // setTimeout / setInterval with a function or identifier first argument
  // run no decoded string, so they stay clean.
  "setTimeout of an arrow function": [
    "install.js",
    "setTimeout(() => cleanup(), 0);\n",
  ],
  "setTimeout of an identifier": ["install.js", "setTimeout(handler, 1000);\n"],
  "setInterval of a function": ["install.js", "setInterval(render, 1000);\n"],
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

test("a run of block comments in the gap keeps the rule cheap and still flags", () => {
  // Cost is part of the rule, not an afterthought: the first version of the
  // comment gap repeated a lazy `/* ... */` group, which is exponentially
  // ambiguous once the whole match fails. `eval` followed by 100 block comments
  // and a call that decodes nothing took about 17 s on 625 bytes, and a
  // submitted repository controls that text. The bound below is ~60x the
  // measured cost (~30 ms for the 4000-comment pair on a dev machine), so it
  // catches a return to the exponential shape without being load-sensitive.
  const run = (n: number) => "/*c*/ ".repeat(n);
  const build = (n: number) =>
    `eval ${run(n)}(plainThing());\n` + `exec ${run(n)}(plainThing())\n`;
  const time = (text: string) => {
    const started = performance.now();
    inspectRepository({
      files: [{ path: "install.js", bytes: new TextEncoder().encode(text) }],
    });
    return performance.now() - started;
  };
  time(build(200)); // warm up
  expect(time(build(4000))).toBeLessThan(2000);

  // The repeated gap must not be bought by dropping the match itself.
  const commented = inspected(
    "install.js",
    `eval ${run(5)}(atob("cHJvY2Vzcy5leGl0KDEp"));\n`,
  );
  expect(categories(commented)).toEqual(["install.js:unsafe-execution:high"]);
});
