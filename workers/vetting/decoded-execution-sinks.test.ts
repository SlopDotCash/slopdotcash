import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const B64 = '"YWxlcnQoMSk="';

function findingsOf(path: string, body: string) {
  const inspection = inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
  });
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/**
 * The scan reports executing decoded code as high unsafe-execution, and PRD
 * section 8 requires the unsafe execution check. The rule named `eval` and
 * `new Function`, so the same sink reached as `Function(...)`, as a string
 * timer, through `vm`, or as `eval(compile(...))` produced no finding.
 */
test("executing decoded code is high unsafe execution", () => {
  const payloads: [string, string][] = [
    ["install.js", `Function(atob(${B64}))();`],
    ["install.js", `Function(Buffer.from(${B64}, "base64").toString())();`],
    ["install.js", `new Function(atob(${B64}))();`],
    ["install.js", `setTimeout(atob(${B64}), 10);`],
    [
      "install.js",
      `setInterval(Buffer.from(${B64}, "base64").toString(), 1000);`,
    ],
    [
      "install.js",
      `require("vm").runInThisContext(Buffer.from(${B64}, "base64").toString());`,
    ],
    ["install.js", `vm.runInNewContext(atob(${B64}));`],
    ["install.js", `eval(atob(${B64}));`],
    ["install.py", `eval(compile(base64.b64decode(${B64}), "<s>", "exec"))`],
    ["install.py", `exec(compile(base64.b64decode(${B64}), "<s>", "exec"))`],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("a callback, a plain decode or a plain eval keeps no finding", () => {
  const payloads: [string, string][] = [
    ["install.js", "setTimeout(() => run(), 10);"],
    ["install.js", "setTimeout(handler, 100);"],
    [
      "install.js",
      'const decoded = Buffer.from(payload, "base64").toString();',
    ],
    ["install.js", "Function.prototype.call(null);"],
    ["install.js", 'require("vm").runInThisContext(script);'],
    ["install.py", "pattern = re.compile(source)"],
    ["install.js", "eval(userInput);"],
  ];
  for (const [path, body] of payloads) {
    expect({ path, body, findings: findingsOf(path, body) }).toEqual({
      path,
      body,
      findings: [],
    });
  }
});
